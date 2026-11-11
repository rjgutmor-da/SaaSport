-- ==============================================================================
-- SaaSport: Conciliación continua en bloque hacia atrás en Base de Datos
-- (sin límite de 50 por página) y desconciliación exclusiva de SuperAdministrador
-- desde la fila seleccionada hacia adelante.
-- ==============================================================================

-- 1. Actualizar rpc_desconciliar_desde_fecha para soportar tanto corte por fecha (pagos retroactivos)
-- como corte exacto por fila/movimiento (desconciliar desde una fila hacia adelante en la tabla).
CREATE OR REPLACE FUNCTION public.rpc_desconciliar_desde_fecha(
  p_caja_id UUID,
  p_desde_fecha TIMESTAMPTZ,
  p_motivo TEXT,
  p_movimiento_id UUID DEFAULT NULL,
  p_tipo_origen TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID := auth.uid();
  v_rol TEXT;
  v_escuela_id UUID;
  v_usuario_nombre TEXT;
  v_caja_nombre TEXT;
  v_dia DATE;
  v_registro TIMESTAMPTZ;
  v_grupo_id TEXT;
  v_origen TEXT;
  v_count_cobros INT := 0;
  v_count_pagos INT := 0;
BEGIN
  -- Validar que el usuario autenticado sea SuperAdministrador
  SELECT rol, escuela_id, NULLIF(TRIM(CONCAT_WS(' ', nombres, apellidos)), email)
  INTO v_rol, v_escuela_id, v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo IS TRUE;

  IF v_rol IS DISTINCT FROM 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo el SuperAdministrador puede reabrir o desmarcar periodos conciliados.' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo para desconciliar es obligatorio.';
  END IF;

  -- Validar pertenencia de la caja
  SELECT nombre INTO v_caja_nombre
  FROM public.cajas_bancos
  WHERE id = p_caja_id AND escuela_id = v_escuela_id;

  IF v_caja_nombre IS NULL THEN
    RAISE EXCEPTION 'Cuenta no encontrada o no pertenece a la escuela.';
  END IF;

  IF p_movimiento_id IS NOT NULL AND p_tipo_origen IN ('cobro', 'pago') THEN
    -- Ubicar posición exacta de la fila en el historial de la caja
    WITH grupos AS (
      SELECT b.grupo,
             b.origen,
             b.dia,
             b.registro,
             max(b.id::text) AS max_id,
             array_agg(b.id) AS ids
      FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
      GROUP BY b.grupo, b.origen, b.dia, b.registro
    )
    SELECT g.dia, g.registro, g.max_id, g.origen
    INTO v_dia, v_registro, v_grupo_id, v_origen
    FROM grupos g
    WHERE g.origen = p_tipo_origen
      AND p_movimiento_id = ANY(g.ids)
    LIMIT 1;
  END IF;

  IF v_grupo_id IS NOT NULL THEN
    -- Desmarcar desde la fila seleccionada hacia adelante (más recientes en el orden del historial)
    WITH grupos_objetivo AS (
      SELECT unnest(array_agg(b.id)) AS mov_id
      FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
      GROUP BY b.grupo, b.origen, b.dia, b.registro
      HAVING (b.dia, b.registro, max(b.id::text), b.origen) >= (v_dia, v_registro, v_grupo_id, v_origen)
    ),
    afectados AS (
      UPDATE public.cobros_aplicados ca
      SET conciliado = false
      WHERE ca.caja_id = p_caja_id
        AND ca.escuela_id = v_escuela_id
        AND ca.conciliado = true
        AND ca.id IN (SELECT mov_id FROM grupos_objetivo)
      RETURNING ca.id
    )
    SELECT count(*) INTO v_count_cobros FROM afectados;

    WITH grupos_objetivo AS (
      SELECT unnest(array_agg(b.id)) AS mov_id
      FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
      GROUP BY b.grupo, b.origen, b.dia, b.registro
      HAVING (b.dia, b.registro, max(b.id::text), b.origen) >= (v_dia, v_registro, v_grupo_id, v_origen)
    ),
    afectados AS (
      UPDATE public.pagos_aplicados pa
      SET conciliado = false
      WHERE pa.caja_id = p_caja_id
        AND pa.escuela_id = v_escuela_id
        AND pa.conciliado = true
        AND pa.id IN (SELECT mov_id FROM grupos_objetivo)
      RETURNING pa.id
    )
    SELECT count(*) INTO v_count_pagos FROM afectados;
  ELSE
    -- Desmarcar por fecha desde p_desde_fecha en adelante
    WITH afectados AS (
      UPDATE public.cobros_aplicados
      SET conciliado = false
      WHERE caja_id = p_caja_id
        AND escuela_id = v_escuela_id
        AND conciliado = true
        AND fecha >= p_desde_fecha
      RETURNING id
    )
    SELECT count(*) INTO v_count_cobros FROM afectados;

    WITH afectados AS (
      UPDATE public.pagos_aplicados
      SET conciliado = false
      WHERE caja_id = p_caja_id
        AND escuela_id = v_escuela_id
        AND conciliado = true
        AND fecha >= p_desde_fecha
      RETURNING id
    )
    SELECT count(*) INTO v_count_pagos FROM afectados;
  END IF;

  -- Registrar en audit_log
  INSERT INTO public.audit_log (
    escuela_id,
    usuario_id,
    usuario_nombre,
    accion,
    modulo,
    entidad_id,
    detalle,
    ip_address
  ) VALUES (
    v_escuela_id,
    v_usuario_id,
    v_usuario_nombre,
    'desconciliacion_cascada_pago_retroactivo',
    'cajas_bancos',
    p_caja_id::TEXT,
    jsonb_build_object(
      'caja_id', p_caja_id,
      'caja_nombre', v_caja_nombre,
      'desde_fecha', p_desde_fecha,
      'movimiento_id', p_movimiento_id,
      'tipo_origen', p_tipo_origen,
      'motivo', p_motivo,
      'cobros_desconciliados', v_count_cobros,
      'pagos_desconciliados', v_count_pagos,
      'total_desconciliados', v_count_cobros + v_count_pagos
    ),
    'SaaSport:database'
  );

  RETURN jsonb_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'cobros_desconciliados', v_count_cobros,
    'pagos_desconciliados', v_count_pagos,
    'total_desconciliados', v_count_cobros + v_count_pagos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_desconciliar_desde_fecha(UUID, TIMESTAMPTZ, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_desconciliar_desde_fecha(UUID, TIMESTAMPTZ, TEXT, UUID, TEXT) TO authenticated;

-- 2. Función RPC para conciliar en bloque hacia atrás en la base de datos (sin límite de 50 por página)
CREATE OR REPLACE FUNCTION public.rpc_conciliar_hasta_movimiento(
  p_caja_id UUID,
  p_movimiento_id UUID,
  p_tipo_origen TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id UUID := auth.uid();
  v_rol TEXT;
  v_escuela_id UUID;
  v_usuario_nombre TEXT;
  v_caja_nombre TEXT;
  v_dia DATE;
  v_registro TIMESTAMPTZ;
  v_grupo_id TEXT;
  v_origen TEXT;
  v_fecha_corte TIMESTAMPTZ;
  v_count_cobros INT := 0;
  v_count_pagos INT := 0;
BEGIN
  -- Validar permisos (SuperAdministrador o Administrador activo)
  SELECT rol, escuela_id, NULLIF(TRIM(CONCAT_WS(' ', nombres, apellidos)), email)
  INTO v_rol, v_escuela_id, v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo IS TRUE;

  IF v_rol IS NULL OR v_rol NOT IN ('SuperAdministrador', 'Administrador') THEN
    RAISE EXCEPTION 'No tienes permisos para conciliar cuentas.' USING ERRCODE = '42501';
  END IF;

  IF p_tipo_origen NOT IN ('cobro', 'pago') THEN
    RAISE EXCEPTION 'Tipo de origen inválido.';
  END IF;

  -- Validar pertenencia de la caja
  SELECT nombre INTO v_caja_nombre
  FROM public.cajas_bancos
  WHERE id = p_caja_id AND escuela_id = v_escuela_id;

  IF v_caja_nombre IS NULL THEN
    RAISE EXCEPTION 'Cuenta no encontrada o no pertenece a la escuela.';
  END IF;

  -- Ubicar el grupo del movimiento de corte usando el mismo orden del historial
  WITH grupos AS (
    SELECT b.grupo,
           b.origen,
           b.dia,
           b.registro,
           max(b.id::text) AS max_id,
           max(b.fecha) AS max_fecha,
           array_agg(b.id) AS ids
    FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
    GROUP BY b.grupo, b.origen, b.dia, b.registro
  )
  SELECT g.dia, g.registro, g.max_id, g.origen, g.max_fecha
  INTO v_dia, v_registro, v_grupo_id, v_origen, v_fecha_corte
  FROM grupos g
  WHERE g.origen = p_tipo_origen
    AND p_movimiento_id = ANY(g.ids)
  LIMIT 1;

  IF v_grupo_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró el movimiento de referencia en esta cuenta.';
  END IF;

  -- Marcar como conciliados todos los cobros desde ese movimiento hacia atrás
  WITH grupos_objetivo AS (
    SELECT unnest(array_agg(b.id)) AS mov_id
    FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
    GROUP BY b.grupo, b.origen, b.dia, b.registro
    HAVING (b.dia, b.registro, max(b.id::text), b.origen) <= (v_dia, v_registro, v_grupo_id, v_origen)
       OR max(b.fecha) <= v_fecha_corte
  ),
  afectados AS (
    UPDATE public.cobros_aplicados ca
    SET conciliado = true
    WHERE ca.caja_id = p_caja_id
      AND ca.escuela_id = v_escuela_id
      AND COALESCE(ca.conciliado, false) = false
      AND ca.id IN (SELECT mov_id FROM grupos_objetivo)
    RETURNING ca.id
  )
  SELECT count(*) INTO v_count_cobros FROM afectados;

  -- Marcar como conciliados todos los pagos desde ese movimiento hacia atrás
  WITH grupos_objetivo AS (
    SELECT unnest(array_agg(b.id)) AS mov_id
    FROM private.movimientos_caja_base(p_caja_id, v_escuela_id) b
    GROUP BY b.grupo, b.origen, b.dia, b.registro
    HAVING (b.dia, b.registro, max(b.id::text), b.origen) <= (v_dia, v_registro, v_grupo_id, v_origen)
       OR max(b.fecha) <= v_fecha_corte
  ),
  afectados AS (
    UPDATE public.pagos_aplicados pa
    SET conciliado = true
    WHERE pa.caja_id = p_caja_id
      AND pa.escuela_id = v_escuela_id
      AND COALESCE(pa.conciliado, false) = false
      AND pa.id IN (SELECT mov_id FROM grupos_objetivo)
    RETURNING pa.id
  )
  SELECT count(*) INTO v_count_pagos FROM afectados;

  -- Registrar en audit_log
  INSERT INTO public.audit_log (
    escuela_id,
    usuario_id,
    usuario_nombre,
    accion,
    modulo,
    entidad_id,
    detalle,
    ip_address
  ) VALUES (
    v_escuela_id,
    v_usuario_id,
    v_usuario_nombre,
    'conciliar_hasta',
    'cajas_bancos',
    p_caja_id::TEXT,
    jsonb_build_object(
      'caja_id', p_caja_id,
      'caja_nombre', v_caja_nombre,
      'movimiento_corte_id', p_movimiento_id,
      'tipo_origen', p_tipo_origen,
      'fecha_corte', v_fecha_corte,
      'cobros_conciliados', v_count_cobros,
      'pagos_conciliados', v_count_pagos,
      'movimientos_marcados', v_count_cobros + v_count_pagos
    ),
    'SaaSport:database'
  );

  RETURN jsonb_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'fecha_corte', v_fecha_corte,
    'cobros_conciliados', v_count_cobros,
    'pagos_conciliados', v_count_pagos,
    'total_conciliados', v_count_cobros + v_count_pagos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_conciliar_hasta_movimiento(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_conciliar_hasta_movimiento(UUID, UUID, TEXT) TO authenticated;

-- 3. Reforzar trigger para que nadie salvo SuperAdministrador pueda desmarcar conciliado = true -> false
CREATE OR REPLACE FUNCTION public.fn_validar_periodo_conciliado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_rol TEXT;
  v_ultimo_conciliado TIMESTAMPTZ;
  v_caja_id UUID;
  v_fecha TIMESTAMPTZ;
BEGIN
  -- Omitir si la llamada proviene de superusuario/sistema
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  SELECT rol INTO v_rol
  FROM public.usuarios
  WHERE id = v_actor AND activo IS TRUE;

  -- Si se intenta desconciliar un movimiento (conciliado: true -> false), solo SuperAdministrador puede hacerlo
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.conciliado, false) IS TRUE AND COALESCE(NEW.conciliado, false) IS FALSE THEN
    IF v_rol IS DISTINCT FROM 'SuperAdministrador' THEN
      RAISE EXCEPTION 'Solo el SuperAdministrador puede desmarcar o reabrir movimientos ya conciliados.' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_caja_id := NEW.caja_id;
  v_fecha := NEW.fecha;

  IF v_caja_id IS NULL OR v_fecha IS NULL THEN
    RETURN NEW;
  END IF;

  -- En UPDATE, solo validar si cambió la fecha, la caja o el monto
  IF TG_OP = 'UPDATE' THEN
    IF OLD.caja_id IS NOT DISTINCT FROM NEW.caja_id
       AND OLD.fecha IS NOT DISTINCT FROM NEW.fecha
       AND OLD.monto_aplicado IS NOT DISTINCT FROM NEW.monto_aplicado THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Si el usuario autenticado es SuperAdministrador, permitir
  IF v_rol = 'SuperAdministrador' THEN
    RETURN NEW;
  END IF;

  -- Verificar si existen movimientos conciliados en esa fecha o posteriores
  SELECT GREATEST(
    (SELECT MAX(fecha) FROM public.cobros_aplicados WHERE caja_id = v_caja_id AND conciliado = true AND (TG_OP = 'INSERT' OR id <> NEW.id)),
    (SELECT MAX(fecha) FROM public.pagos_aplicados WHERE caja_id = v_caja_id AND conciliado = true AND (TG_OP = 'INSERT' OR id <> NEW.id))
  ) INTO v_ultimo_conciliado;

  IF v_ultimo_conciliado IS NOT NULL AND v_fecha <= v_ultimo_conciliado THEN
    RAISE EXCEPTION 'La cuenta seleccionada tiene movimientos conciliados hasta el %. Solo el SuperAdministrador puede registrar o modificar pagos y cobros en fechas ya conciliadas.',
      (v_ultimo_conciliado AT TIME ZONE 'UTC')::date
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
