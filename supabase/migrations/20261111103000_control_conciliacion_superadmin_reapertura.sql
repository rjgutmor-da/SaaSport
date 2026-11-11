-- ==============================================================================
-- SaaSport: Control de Conciliación - Solo SuperAdministrador para pagos retroactivos
-- y reapertura en cascada (Opción 1).
-- ==============================================================================

-- 1. Función RPC para desconciliar en cascada desde una fecha
CREATE OR REPLACE FUNCTION public.rpc_desconciliar_desde_fecha(
  p_caja_id UUID,
  p_desde_fecha TIMESTAMPTZ,
  p_motivo TEXT
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
  v_count_cobros INT := 0;
  v_count_pagos INT := 0;
BEGIN
  -- Validar que el usuario autenticado sea SuperAdministrador
  SELECT rol, escuela_id, NULLIF(TRIM(CONCAT_WS(' ', nombres, apellidos)), email)
  INTO v_rol, v_escuela_id, v_usuario_nombre
  FROM public.usuarios
  WHERE id = v_usuario_id AND activo IS TRUE;

  IF v_rol IS DISTINCT FROM 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo el SuperAdministrador puede reabrir periodos conciliados.' USING ERRCODE = '42501';
  END IF;

  IF p_motivo IS NULL OR TRIM(p_motivo) = '' THEN
    RAISE EXCEPTION 'El motivo de la reapertura es obligatorio.';
  END IF;

  -- Validar pertenencia de la caja
  SELECT nombre INTO v_caja_nombre
  FROM public.cajas_bancos
  WHERE id = p_caja_id AND escuela_id = v_escuela_id;

  IF v_caja_nombre IS NULL THEN
    RAISE EXCEPTION 'Cuenta no encontrada o no pertenece a la escuela.';
  END IF;

  -- Desmarcar cobros aplicados desde p_desde_fecha en adelante en esa caja
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

  -- Desmarcar pagos aplicados desde p_desde_fecha en adelante en esa caja
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
      'motivo', p_motivo,
      'cobros_desconciliados', v_count_cobros,
      'pagos_desconciliados', v_count_pagos
    ),
    'SaaSport:database'
  );

  RETURN jsonb_build_object(
    'success', true,
    'caja_id', p_caja_id,
    'cobros_desconciliados', v_count_cobros,
    'pagos_desconciliados', v_count_pagos
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_desconciliar_desde_fecha(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_desconciliar_desde_fecha(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- 2. Trigger para impedir que usuarios NO SuperAdministrador inserten o editen movimientos en periodos conciliados
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
  SELECT rol INTO v_rol
  FROM public.usuarios
  WHERE id = v_actor AND activo IS TRUE;

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

REVOKE ALL ON FUNCTION public.fn_validar_periodo_conciliado() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validar_periodo_conciliado_cobros ON public.cobros_aplicados;
CREATE TRIGGER trg_validar_periodo_conciliado_cobros
BEFORE INSERT OR UPDATE ON public.cobros_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_validar_periodo_conciliado();

DROP TRIGGER IF EXISTS trg_validar_periodo_conciliado_pagos ON public.pagos_aplicados;
CREATE TRIGGER trg_validar_periodo_conciliado_pagos
BEFORE INSERT OR UPDATE ON public.pagos_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_validar_periodo_conciliado();
