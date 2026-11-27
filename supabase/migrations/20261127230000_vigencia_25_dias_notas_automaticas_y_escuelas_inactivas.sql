-- Migración: Vigencia estricta de 25 días para notas automáticas en borrador,
-- blindaje total de escuelas inactivas y alumnos archivados,
-- regularización inicial por única vez y RPC paginado de 30 registros por página.

-- 1. Índice parcial especializado para consultas y purga de borradores automáticos
CREATE INDEX IF NOT EXISTS idx_cuentas_cobrar_borradores_auto
  ON public.cuentas_cobrar (escuela_id, sucursal_id, fecha_emision DESC, created_at DESC)
  WHERE estado = 'borrador' AND origen_facturacion = 'automatico';

-- 2. Función central de limpieza de borradores automáticos expirados (> 25 días) o de escuelas inactivas
CREATE OR REPLACE FUNCTION public.fn_limpiar_notas_automaticas_expiradas(
  p_dias_vigencia integer DEFAULT 25,
  p_ahora timestamptz DEFAULT now()
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_eliminadas integer := 0;
  v_dias integer := GREATEST(COALESCE(p_dias_vigencia, 25), 1);
  v_referencia timestamptz := COALESCE(p_ahora, now());
BEGIN
  WITH candidatos AS (
    SELECT
      cc.id,
      cc.escuela_id,
      cc.alumno_id,
      cc.periodo_estadistico,
      CASE
        WHEN e.activa IS NOT TRUE THEN 'escuela_inactiva'
        ELSE 'expirado_25_dias'
      END AS motivo_omision
    FROM public.cuentas_cobrar cc
    LEFT JOIN public.escuelas e ON e.id = cc.escuela_id
    WHERE cc.estado = 'borrador'
      AND cc.origen_facturacion = 'automatico'
      AND (
        cc.created_at <= v_referencia - make_interval(days => v_dias)
        OR e.activa IS NOT TRUE
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.cobros_aplicados ca
        WHERE ca.cuenta_cobrar_id = cc.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventario_movimientos im
        WHERE im.escuela_id = cc.escuela_id
          AND im.referencia_tipo = 'cxc'
          AND im.referencia_id = cc.id
      )
  ), registrar_omitidos AS (
    INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
    SELECT c.escuela_id, c.alumno_id, c.periodo_estadistico, c.motivo_omision
    FROM candidatos c
    WHERE c.alumno_id IS NOT NULL
      AND c.periodo_estadistico IS NOT NULL
    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING
  ), borrados AS (
    DELETE FROM public.cuentas_cobrar cc
    USING candidatos c
    WHERE cc.id = c.id
    RETURNING cc.id
  )
  SELECT count(*)::integer INTO v_eliminadas FROM borrados;

  RETURN v_eliminadas;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_limpiar_notas_automaticas_expiradas(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_limpiar_notas_automaticas_expiradas(integer, timestamptz) TO service_role;

-- 3. Trigger: al desactivar una escuela, apagar facturación automática y depurar borradores pendientes
CREATE OR REPLACE FUNCTION private.fn_desactivar_facturacion_escuela_inactiva()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.activa IS NOT TRUE AND (TG_OP = 'INSERT' OR OLD.activa IS TRUE) THEN
    UPDATE public.configuracion_facturacion
    SET activo = FALSE,
        updated_at = now()
    WHERE escuela_id = NEW.id
      AND activo IS TRUE;

    WITH candidatos AS (
      SELECT cc.id, cc.escuela_id, cc.alumno_id, cc.periodo_estadistico
      FROM public.cuentas_cobrar cc
      WHERE cc.escuela_id = NEW.id
        AND cc.estado = 'borrador'
        AND cc.origen_facturacion = 'automatico'
        AND NOT EXISTS (
          SELECT 1 FROM public.cobros_aplicados ca WHERE ca.cuenta_cobrar_id = cc.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.inventario_movimientos im
          WHERE im.escuela_id = cc.escuela_id
            AND im.referencia_tipo = 'cxc'
            AND im.referencia_id = cc.id
        )
    ), omitidos AS (
      INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
      SELECT c.escuela_id, c.alumno_id, c.periodo_estadistico, 'escuela_inactiva'
      FROM candidatos c
      WHERE c.alumno_id IS NOT NULL
        AND c.periodo_estadistico IS NOT NULL
      ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING
    )
    DELETE FROM public.cuentas_cobrar cc
    USING candidatos c
    WHERE cc.id = c.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_desactivar_facturacion_escuela_inactiva ON public.escuelas;
CREATE TRIGGER trg_desactivar_facturacion_escuela_inactiva
  AFTER UPDATE OF activa ON public.escuelas
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_desactivar_facturacion_escuela_inactiva();

REVOKE ALL ON FUNCTION private.fn_desactivar_facturacion_escuela_inactiva() FROM PUBLIC, anon, authenticated;

-- 4. Trigger: al archivar un alumno, eliminar sus borradores automáticos no aprobados
CREATE OR REPLACE FUNCTION private.fn_limpiar_borradores_alumno_archivado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.archivado IS TRUE AND OLD.archivado IS NOT TRUE THEN
    WITH candidatos AS (
      SELECT cc.id, cc.escuela_id, cc.alumno_id, cc.periodo_estadistico
      FROM public.cuentas_cobrar cc
      WHERE cc.escuela_id = NEW.escuela_id
        AND cc.alumno_id = NEW.id
        AND cc.estado = 'borrador'
        AND cc.origen_facturacion = 'automatico'
        AND NOT EXISTS (
          SELECT 1 FROM public.cobros_aplicados ca WHERE ca.cuenta_cobrar_id = cc.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.inventario_movimientos im
          WHERE im.escuela_id = cc.escuela_id
            AND im.referencia_tipo = 'cxc'
            AND im.referencia_id = cc.id
        )
    ), omitidos AS (
      INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
      SELECT c.escuela_id, c.alumno_id, c.periodo_estadistico, 'alumno_archivado'
      FROM candidatos c
      WHERE c.alumno_id IS NOT NULL
        AND c.periodo_estadistico IS NOT NULL
      ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING
    )
    DELETE FROM public.cuentas_cobrar cc
    USING candidatos c
    WHERE cc.id = c.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_limpiar_borradores_alumno_archivado ON public.alumnos;
CREATE TRIGGER trg_limpiar_borradores_alumno_archivado
  AFTER UPDATE OF archivado ON public.alumnos
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_limpiar_borradores_alumno_archivado();

REVOKE ALL ON FUNCTION private.fn_limpiar_borradores_alumno_archivado() FROM PUBLIC, anon, authenticated;

-- 5. Blindar ingreso/reactivación de alumno para que escuelas inactivas no generen borradores
CREATE OR REPLACE FUNCTION private.crear_mensualidad_ingreso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escuela_activa boolean;
  v_hoy date;
  v_inicio date;
  v_fin date;
  v_periodo date;
  v_conflicto date;
  v_item uuid;
  v_cuenta uuid;
BEGIN
  IF NEW.archivado IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.archivado IS NOT TRUE THEN RETURN NEW; END IF;

  SELECT
    e.activa,
    timezone(COALESCE(NULLIF(e.zona_horaria, ''), 'America/La_Paz'), now())::date
  INTO STRICT v_escuela_activa, v_hoy
  FROM public.escuelas e
  WHERE e.id = NEW.escuela_id;

  IF v_escuela_activa IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.mensualidades_ingreso AS ingreso (alumno_id, fecha_ingreso, motivo)
  VALUES (NEW.id, v_hoy, CASE WHEN NEW.mensualidad IS NULL THEN 'sin_tarifa'
                             WHEN NEW.mensualidad <= 0 THEN 'tarifa_cero' END)
  ON CONFLICT (alumno_id) DO UPDATE
    SET fecha_ingreso = EXCLUDED.fecha_ingreso, motivo = EXCLUDED.motivo,
        cuenta_id = NULL, ciclo_inicio = NULL, ciclo_fin = NULL, monto = NULL;

  IF COALESCE(NEW.mensualidad, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT id INTO v_item FROM public.catalogo_items
  WHERE escuela_id = NEW.escuela_id AND lower(btrim(nombre)) = 'mensualidad'
  ORDER BY activo DESC NULLS LAST, id LIMIT 1;
  IF v_item IS NULL THEN
    INSERT INTO public.catalogo_items
      (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
    VALUES (NEW.escuela_id, 'Mensualidad', 'servicio', 'servicio', 'ingreso', 0, true, true, false)
    ON CONFLICT (escuela_id, nombre) DO NOTHING;
    SELECT id INTO STRICT v_item FROM public.catalogo_items
    WHERE escuela_id = NEW.escuela_id AND nombre = 'Mensualidad';
  END IF;

  v_inicio := v_hoy;
  LOOP
    v_fin := private.fin_ciclo_ingreso(v_inicio);
    v_conflicto := private.conflicto_ciclo_ingreso(NEW.escuela_id, NEW.id, v_inicio, v_fin, NULL);
    EXIT WHEN v_conflicto IS NULL;
    v_inicio := v_conflicto + 1;
  END LOOP;

  v_periodo := public.calcular_periodo_estadistico(v_inicio, v_fin);
  INSERT INTO public.cuentas_cobrar (
    escuela_id, sucursal_id, alumno_id, monto_total, descripcion, periodo,
    periodo_estadistico, ciclo_inicio, ciclo_fin, fecha_emision, fecha_vencimiento,
    estado, es_anticipo, origen_facturacion, es_mensualidad_ingreso
  ) VALUES (
    NEW.escuela_id, NEW.sucursal_id, NEW.id, NEW.mensualidad, 'Mensualidad',
    to_char(v_periodo, 'YYYY-MM'), v_periodo, v_inicio, v_fin, v_hoy, v_inicio,
    'borrador', false, 'automatico', true
  ) RETURNING id INTO v_cuenta;

  INSERT INTO public.cxc_detalle (
    escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario,
    periodo_meses, ciclo_inicio, ciclo_fin, periodo_estadistico
  ) VALUES (
    NEW.escuela_id, v_cuenta, v_item, 1, NEW.mensualidad,
    jsonb_build_array((ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
      [extract(month FROM v_periodo)::integer] || '-' || to_char(v_periodo, 'YYYY')),
    v_inicio, v_fin, v_periodo
  );

  UPDATE public.mensualidades_ingreso
  SET cuenta_id = v_cuenta, ciclo_inicio = v_inicio, ciclo_fin = v_fin, monto = NEW.mensualidad
  WHERE alumno_id = NEW.id;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.crear_mensualidad_ingreso() FROM PUBLIC, anon, authenticated;

-- 6. Blindar rpc_generar_facturacion_ciclo para escuelas inactivas
CREATE OR REPLACE FUNCTION public.rpc_generar_facturacion_ciclo(
  p_ciclo_inicio date,
  p_ciclo_fin date,
  p_solo_simular boolean DEFAULT true,
  p_ejecucion_id uuid DEFAULT gen_random_uuid(),
  p_escuela_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO ''
AS $function$
DECLARE
    v_escuela_usuario UUID := (SELECT public.current_user_escuela_id());
    v_escuela_id UUID := COALESCE(p_escuela_id, v_escuela_usuario);
    v_rol TEXT := (SELECT public.current_user_rol());
    v_es_service_role BOOLEAN := COALESCE(
        current_setting('request.jwt.claim.role', TRUE) = 'service_role',
        FALSE
    );
    v_escuela_activa BOOLEAN := FALSE;
    v_config public.configuracion_facturacion%ROWTYPE;
    v_periodo DATE;
    v_catalogo_item_id UUID;
    v_elegibles INTEGER := 0;
    v_generadas INTEGER := 0;
    v_existentes INTEGER := 0;
    v_ya_pagadas INTEGER := 0;
    v_existentes_no_pagadas INTEGER := 0;
    v_sin_asistencia INTEGER := 0;
    v_monto_cero INTEGER := 0;
BEGIN
    IF v_escuela_id IS NULL OR (
        NOT v_es_service_role
        AND (
            NOT COALESCE(v_rol IN ('Administrador', 'SuperAdministrador'), FALSE)
            OR v_escuela_id IS DISTINCT FROM v_escuela_usuario
        )
    ) THEN
        RAISE EXCEPTION 'No autorizado para generar facturacion.';
    END IF;

    SELECT e.activa INTO v_escuela_activa
    FROM public.escuelas e
    WHERE e.id = v_escuela_id;

    IF v_escuela_activa IS NOT TRUE THEN
        RAISE EXCEPTION 'La escuela no está activa para generar facturación automática.';
    END IF;

    IF p_ciclo_inicio IS NULL OR p_ciclo_fin IS NULL OR p_ciclo_fin < p_ciclo_inicio THEN
        RAISE EXCEPTION 'El rango del ciclo no es valido.';
    END IF;

    SELECT * INTO v_config
    FROM public.configuracion_facturacion
    WHERE escuela_id = v_escuela_id AND activo = TRUE;

    IF NOT FOUND OR v_config.plan_momento_emision = 'manual' THEN
        RAISE EXCEPTION 'La escuela no tiene facturacion automatica activa.';
    END IF;

    v_periodo := public.calcular_periodo_estadistico(p_ciclo_inicio);

    SELECT id INTO v_catalogo_item_id
    FROM public.catalogo_items
    WHERE escuela_id = v_escuela_id
      AND lower(nombre) = 'mensualidad'
      AND activo = TRUE
    LIMIT 1;

    IF v_catalogo_item_id IS NULL THEN
        RAISE EXCEPTION 'No existe un item activo Mensualidad en el catalogo.';
    END IF;

    WITH asistencias AS (
        SELECT x.alumno_id,
               count(*)::INTEGER AS registros,
               count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER AS presentes
        FROM (
            SELECT an.alumno_id, an.estado
            FROM public.asistencias_normales an
            JOIN public.alumnos a ON a.id = an.alumno_id
            WHERE a.escuela_id = v_escuela_id
              AND an.fecha >= p_ciclo_inicio AND an.fecha <= p_ciclo_fin
            UNION ALL
            SELECT aa.alumno_id, aa.estado
            FROM public.asistencias_arqueros aa
            JOIN public.alumnos a ON a.id = aa.alumno_id
            WHERE a.escuela_id = v_escuela_id
              AND aa.fecha >= p_ciclo_inicio AND aa.fecha <= p_ciclo_fin
        ) x
        GROUP BY x.alumno_id
    ), candidatos AS (
        SELECT a.id AS alumno_id,
               a.sucursal_id,
               COALESCE(ast.registros, 0) AS registros,
               COALESCE(ast.presentes, 0) AS presentes,
               round(CASE
                   WHEN v_config.plan_calculo_monto = 'fijo' THEN a.mensualidad
                   WHEN COALESCE(ast.registros, 0) = 0 THEN NULL
                   WHEN ast.presentes >= v_config.asistencias_minimo_completo THEN a.mensualidad
                   WHEN ast.presentes >= v_config.asistencias_minimo_parcial
                       THEN a.mensualidad * v_config.porcentaje_monto_parcial / 100
                   ELSE 0
               END, 2) AS monto,
               EXISTS (
                   SELECT 1 FROM public.cuentas_cobrar cc
                   WHERE cc.escuela_id = v_escuela_id
                     AND cc.alumno_id = a.id
                     AND cc.anulada IS NOT TRUE
                     AND cc.es_anticipo IS NOT TRUE
                     AND (
                         cc.periodo_estadistico = v_periodo
                         OR (cc.periodo_estadistico IS NULL
                             AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo))
                     )
               ) AS ya_existe,
               EXISTS (
                   SELECT 1 FROM public.cuentas_cobrar cc
                   WHERE cc.escuela_id = v_escuela_id
                     AND cc.alumno_id = a.id
                     AND cc.anulada IS NOT TRUE
                     AND cc.es_anticipo IS NOT TRUE
                     AND (
                         cc.periodo_estadistico = v_periodo
                         OR (cc.periodo_estadistico IS NULL
                             AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo))
                     )
                     AND (
                         cc.estado = 'pagada'
                         OR COALESCE((
                             SELECT SUM(ca.monto_aplicado)
                             FROM public.cobros_aplicados ca
                             WHERE ca.cuenta_cobrar_id = cc.id
                         ), 0) >= cc.monto_total
                     )
               ) AS ya_pagada
        FROM public.alumnos a
        LEFT JOIN asistencias ast ON ast.alumno_id = a.id
        WHERE a.escuela_id = v_escuela_id
          AND a.archivado IS NOT TRUE
          AND a.mensualidad IS NOT NULL
          AND a.mensualidad > 0
    )
    SELECT count(*)::INTEGER,
           count(*) FILTER (WHERE ya_existe)::INTEGER,
           count(*) FILTER (WHERE ya_pagada)::INTEGER,
           count(*) FILTER (WHERE ya_existe AND NOT ya_pagada)::INTEGER,
           count(*) FILTER (WHERE NOT ya_existe AND registros = 0
               AND v_config.plan_calculo_monto = 'asistencia')::INTEGER,
           count(*) FILTER (WHERE NOT ya_existe AND monto = 0)::INTEGER
    INTO v_elegibles, v_existentes, v_ya_pagadas, v_existentes_no_pagadas,
         v_sin_asistencia, v_monto_cero
    FROM candidatos;

    IF NOT p_solo_simular THEN
        WITH asistencias AS (
            SELECT x.alumno_id,
                   count(*)::INTEGER AS registros,
                   count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER AS presentes
            FROM (
                SELECT an.alumno_id, an.estado
                FROM public.asistencias_normales an
                JOIN public.alumnos a ON a.id = an.alumno_id
                WHERE a.escuela_id = v_escuela_id
                  AND an.fecha >= p_ciclo_inicio AND an.fecha <= p_ciclo_fin
                UNION ALL
                SELECT aa.alumno_id, aa.estado
                FROM public.asistencias_arqueros aa
                JOIN public.alumnos a ON a.id = aa.alumno_id
                WHERE a.escuela_id = v_escuela_id
                  AND aa.fecha >= p_ciclo_inicio AND aa.fecha <= p_ciclo_fin
            ) x
            GROUP BY x.alumno_id
        ), candidatos AS (
            SELECT a.id AS alumno_id, a.sucursal_id,
                   round(CASE
                       WHEN v_config.plan_calculo_monto = 'fijo' THEN a.mensualidad
                       WHEN COALESCE(ast.registros, 0) = 0 THEN NULL
                       WHEN ast.presentes >= v_config.asistencias_minimo_completo THEN a.mensualidad
                       WHEN ast.presentes >= v_config.asistencias_minimo_parcial
                           THEN a.mensualidad * v_config.porcentaje_monto_parcial / 100
                       ELSE 0
                   END, 2) AS monto
            FROM public.alumnos a
            LEFT JOIN asistencias ast ON ast.alumno_id = a.id
            WHERE a.escuela_id = v_escuela_id
              AND a.archivado IS NOT TRUE
              AND a.mensualidad IS NOT NULL
              AND a.mensualidad > 0
        ), nuevas AS (
            INSERT INTO public.cuentas_cobrar (
                escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                fecha_emision, fecha_vencimiento, estado, es_anticipo,
                origen_facturacion, ejecucion_facturacion_id
            )
            SELECT v_escuela_id, c.sucursal_id, c.alumno_id, c.monto, 'Mensualidad',
                   to_char(v_periodo, 'YYYY-MM'), v_periodo, p_ciclo_inicio, p_ciclo_fin,
                   CURRENT_DATE, CURRENT_DATE, 'pendiente', FALSE,
                   'automatico', p_ejecucion_id
            FROM candidatos c
            WHERE c.monto IS NOT NULL AND c.monto > 0
            ON CONFLICT (escuela_id, alumno_id, periodo_estadistico)
                WHERE periodo_estadistico IS NOT NULL
                  AND alumno_id IS NOT NULL
                  AND anulada IS NOT TRUE
                  AND es_anticipo IS NOT TRUE
                  AND estado <> 'borrador'
            DO NOTHING
            RETURNING id, alumno_id, monto_total
        ), detalles AS (
            INSERT INTO public.cxc_detalle (
                escuela_id, cuenta_cobrar_id, catalogo_item_id,
                cantidad, precio_unitario, periodo_meses, detalle_extra
            )
            SELECT v_escuela_id, n.id, v_catalogo_item_id,
                   1, n.monto_total,
                   jsonb_build_array(
                       (ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
                           [EXTRACT(MONTH FROM v_periodo)::INTEGER]
                       || '-' || EXTRACT(YEAR FROM v_periodo)::INTEGER::TEXT
                   ),
                   'Ciclo ' || to_char(p_ciclo_inicio, 'DD/MM/YYYY') || ' - ' || to_char(p_ciclo_fin, 'DD/MM/YYYY')
            FROM nuevas n
            RETURNING id
        )
        SELECT count(*)::INTEGER INTO v_generadas FROM detalles;
    END IF;

    RETURN jsonb_build_object(
        'solo_simular', p_solo_simular,
        'ejecucion_id', p_ejecucion_id,
        'periodo_estadistico', v_periodo,
        'elegibles', v_elegibles,
        'generadas', v_generadas,
        'existentes', v_existentes,
        'ya_pagadas', v_ya_pagadas,
        'existentes_no_pagadas', v_existentes_no_pagadas,
        'sin_asistencia', v_sin_asistencia,
        'monto_cero', v_monto_cero
    );
END;
$function$;

-- 7. Regularización inicial por única vez sobre borradores existentes antes de activar la purga de 25 días
DO $$
BEGIN
  -- Apagar facturación automática en escuelas inactivas
  UPDATE public.configuracion_facturacion cf
  SET activo = FALSE,
      updated_at = now()
  FROM public.escuelas e
  WHERE e.id = cf.escuela_id
    AND e.activa IS NOT TRUE
    AND cf.activo IS TRUE;

  -- Depurar borradores automáticos de escuelas inactivas
  WITH inactivas AS (
    SELECT cc.id, cc.escuela_id, cc.alumno_id, cc.periodo_estadistico
    FROM public.cuentas_cobrar cc
    JOIN public.escuelas e ON e.id = cc.escuela_id
    WHERE cc.estado = 'borrador'
      AND cc.origen_facturacion = 'automatico'
      AND e.activa IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.cobros_aplicados ca WHERE ca.cuenta_cobrar_id = cc.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.inventario_movimientos im
        WHERE im.escuela_id = cc.escuela_id
          AND im.referencia_tipo = 'cxc'
          AND im.referencia_id = cc.id
      )
  ), omit_inactivas AS (
    INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
    SELECT i.escuela_id, i.alumno_id, i.periodo_estadistico, 'escuela_inactiva'
    FROM inactivas i
    WHERE i.alumno_id IS NOT NULL
      AND i.periodo_estadistico IS NOT NULL
    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING
  )
  DELETE FROM public.cuentas_cobrar cc
  USING inactivas i
  WHERE cc.id = i.id;

  -- Depurar borradores automáticos de alumnos ya archivados
  WITH archivados AS (
    SELECT cc.id, cc.escuela_id, cc.alumno_id, cc.periodo_estadistico
    FROM public.cuentas_cobrar cc
    JOIN public.alumnos a ON a.id = cc.alumno_id
    WHERE cc.estado = 'borrador'
      AND cc.origen_facturacion = 'automatico'
      AND a.archivado IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.cobros_aplicados ca WHERE ca.cuenta_cobrar_id = cc.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.inventario_movimientos im
        WHERE im.escuela_id = cc.escuela_id
          AND im.referencia_tipo = 'cxc'
          AND im.referencia_id = cc.id
      )
  ), omit_archivados AS (
    INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
    SELECT ar.escuela_id, ar.alumno_id, ar.periodo_estadistico, 'alumno_archivado'
    FROM archivados ar
    WHERE ar.alumno_id IS NOT NULL
      AND ar.periodo_estadistico IS NOT NULL
    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING
  )
  DELETE FROM public.cuentas_cobrar cc
  USING archivados ar
  WHERE cc.id = ar.id;

  -- Aprobar por única vez los borradores vencidos (> 25 días) vigentes de escuelas activas con alumnos activos
  WITH vencidos_activos AS (
    SELECT
      cc.id,
      EXISTS (
        SELECT 1
        FROM public.cuentas_cobrar act
        WHERE act.escuela_id = cc.escuela_id
          AND act.alumno_id = cc.alumno_id
          AND act.periodo_estadistico = cc.periodo_estadistico
          AND act.id <> cc.id
          AND act.estado <> 'borrador'
          AND act.anulada IS NOT TRUE
          AND act.es_anticipo IS NOT TRUE
      ) AS tiene_duplicado
    FROM public.cuentas_cobrar cc
    JOIN public.escuelas e ON e.id = cc.escuela_id
    JOIN public.alumnos a ON a.id = cc.alumno_id
    WHERE cc.estado = 'borrador'
      AND cc.origen_facturacion = 'automatico'
      AND e.activa IS TRUE
      AND a.archivado IS NOT TRUE
      AND cc.created_at <= now() - interval '25 days'
  ), borrar_duplicados AS (
    DELETE FROM public.cuentas_cobrar cc
    USING vencidos_activos v
    WHERE cc.id = v.id
      AND v.tiene_duplicado IS TRUE
  )
  UPDATE public.cuentas_cobrar cc
  SET estado = 'pendiente',
      updated_at = now()
  FROM vencidos_activos v
  WHERE cc.id = v.id
    AND v.tiene_duplicado IS NOT TRUE;
END;
$$;

-- 8. Actualizar rpc_cron_facturacion_diaria para ejecutar la purga de 25 días al inicio de cada corrida
CREATE OR REPLACE FUNCTION public.rpc_cron_facturacion_diaria(p_hoy DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_config         RECORD;
    v_alumno         RECORD;
    v_ultimo_ciclo_fin DATE;
    v_sin_ciclo_previo BOOLEAN;
    v_es_ingreso     BOOLEAN;
    v_inicio_ingreso DATE;
    v_ciclo_inicio   DATE;
    v_ciclo_fin      DATE;
    v_periodo        DATE;
    v_item_id        UUID;
    v_cxc_id         UUID;
    v_ejecucion_id   UUID;
    v_monto          NUMERIC;
    v_registros      INTEGER;
    v_presentes      INTEGER;
    v_facturas_por_escuela INTEGER;
    v_borradores_depurados INTEGER := 0;
    v_ahora_ref      TIMESTAMPTZ;
    v_resumen        JSONB := '{}'::jsonb;
    v_detalle_extra  TEXT;
    v_fecha_emision  DATE;
    v_fecha_vencimiento DATE;
    v_ventana_dias   INTEGER := 7;
    v_iter           INTEGER;
BEGIN
    v_ahora_ref := CASE
        WHEN p_hoy IS NULL OR p_hoy = CURRENT_DATE THEN now()
        ELSE (p_hoy::timestamp AT TIME ZONE 'UTC') + interval '23 hours 59 minutes 59 seconds'
    END;

    v_borradores_depurados := public.fn_limpiar_notas_automaticas_expiradas(25, v_ahora_ref);

    FOR v_config IN (
        SELECT cf.escuela_id, cf.plan_momento_emision, cf.plan_calculo_monto,
               cf.asistencias_minimo_completo, cf.asistencias_minimo_parcial, cf.porcentaje_monto_parcial
        FROM public.configuracion_facturacion cf
        JOIN public.escuelas e ON e.id = cf.escuela_id
        WHERE cf.activo = TRUE
          AND e.activa = TRUE
          AND cf.plan_momento_emision IN ('adelantado', 'atrasado')
    ) LOOP
        v_facturas_por_escuela := 0;
        v_ejecucion_id := NULL;

        SELECT id INTO v_item_id
        FROM public.catalogo_items
        WHERE escuela_id = v_config.escuela_id
          AND lower(nombre) = 'mensualidad'
          AND activo = TRUE
        LIMIT 1;

        IF v_item_id IS NULL THEN
            CONTINUE;
        END IF;

        FOR v_alumno IN (
            SELECT id, sucursal_id, mensualidad, fecha_inicio
            FROM public.alumnos
            WHERE escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE
              AND mensualidad IS NOT NULL
              AND mensualidad > 0
              AND (fecha_inicio IS NULL OR p_hoy >= fecha_inicio)
        ) LOOP

            SELECT id, sucursal_id, mensualidad, fecha_inicio INTO v_alumno
            FROM public.alumnos
            WHERE id = v_alumno.id AND escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE AND mensualidad > 0
              AND (fecha_inicio IS NULL OR p_hoy >= fecha_inicio)
            FOR UPDATE SKIP LOCKED;
            IF NOT FOUND THEN CONTINUE; END IF;

            SELECT COALESCE(ciclo_inicio, fecha_ingreso) INTO v_inicio_ingreso
            FROM public.mensualidades_ingreso WHERE alumno_id = v_alumno.id;

            SELECT GREATEST(
                (
                    SELECT cd.ciclo_fin
                    FROM public.cxc_detalle cd
                    JOIN public.cuentas_cobrar cc ON cc.id = cd.cuenta_cobrar_id
                    JOIN public.catalogo_items ci ON cd.catalogo_item_id = ci.id
                    WHERE cc.alumno_id = v_alumno.id
                      AND cc.escuela_id = v_config.escuela_id
                      AND cc.anulada IS NOT TRUE
                      AND lower(ci.nombre) = 'mensualidad'
                      AND cd.ciclo_fin IS NOT NULL
                    ORDER BY cd.ciclo_fin DESC
                    LIMIT 1
                ),
                (
                    SELECT cc.ciclo_fin
                    FROM public.cuentas_cobrar cc
                    WHERE cc.alumno_id = v_alumno.id
                      AND cc.escuela_id = v_config.escuela_id
                      AND cc.anulada IS NOT TRUE
                      AND cc.es_anticipo IS NOT TRUE
                      AND lower(btrim(cc.descripcion)) = 'mensualidad'
                      AND cc.ciclo_fin IS NOT NULL
                    ORDER BY cc.ciclo_fin DESC
                    LIMIT 1
                )
            ) INTO v_ultimo_ciclo_fin;

            v_sin_ciclo_previo := (v_ultimo_ciclo_fin IS NULL);

            IF v_inicio_ingreso IS NOT NULL THEN
                v_ultimo_ciclo_fin := GREATEST(v_ultimo_ciclo_fin, v_inicio_ingreso - 1);
            END IF;

            IF v_ultimo_ciclo_fin IS NULL THEN
                CONTINUE;
            END IF;

            FOR v_iter IN 1..12 LOOP
                v_ciclo_inicio := v_ultimo_ciclo_fin + INTERVAL '1 day';
                v_ciclo_fin    := (v_ciclo_inicio + INTERVAL '1 month' - INTERVAL '1 day')::date;

                IF v_config.plan_momento_emision = 'adelantado' THEN
                    v_fecha_emision     := v_ciclo_inicio;
                    v_fecha_vencimiento := v_ciclo_inicio;
                ELSE
                    v_fecha_emision     := v_ciclo_fin;
                    v_fecha_vencimiento := v_ciclo_fin;
                END IF;

                IF v_fecha_emision > p_hoy THEN
                    EXIT;
                END IF;

                v_periodo := public.calcular_periodo_estadistico(v_ciclo_inicio, v_ciclo_fin);

                IF EXISTS (
                    SELECT 1 FROM public.ciclos_omitidos
                    WHERE alumno_id = v_alumno.id
                      AND periodo_estadistico = v_periodo
                ) THEN
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    v_sin_ciclo_previo := FALSE;
                    CONTINUE;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM public.cuentas_cobrar
                    WHERE escuela_id = v_config.escuela_id
                      AND alumno_id = v_alumno.id
                      AND anulada IS NOT TRUE
                      AND es_anticipo IS NOT TRUE
                      AND (
                          periodo_estadistico = v_periodo
                          OR (periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(id, v_periodo))
                      )
                ) THEN
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    v_sin_ciclo_previo := FALSE;
                    CONTINUE;
                END IF;

                IF v_config.plan_calculo_monto = 'fijo' THEN
                    v_monto := v_alumno.mensualidad;

                ELSIF v_config.plan_calculo_monto = 'asistencia' THEN
                    SELECT count(*)::INTEGER,
                           count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER
                    INTO v_registros, v_presentes
                    FROM (
                        SELECT estado FROM public.asistencias_normales
                        WHERE alumno_id = v_alumno.id
                          AND fecha >= v_ciclo_inicio AND fecha <= v_ciclo_fin
                        UNION ALL
                        SELECT estado FROM public.asistencias_arqueros
                        WHERE alumno_id = v_alumno.id
                          AND fecha >= v_ciclo_inicio AND fecha <= v_ciclo_fin
                    ) x;

                    IF v_registros = 0 THEN
                        IF v_ciclo_fin <= p_hoy THEN
                            INSERT INTO public.ciclos_omitidos
                                (escuela_id, alumno_id, periodo_estadistico, motivo)
                            VALUES
                                (v_config.escuela_id, v_alumno.id, v_periodo, 'sin_registros_asistencia')
                            ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                            v_ultimo_ciclo_fin := v_ciclo_fin;
                            v_sin_ciclo_previo := FALSE;
                            CONTINUE;
                        ELSE
                            EXIT;
                        END IF;
                    END IF;

                    v_monto := round(CASE
                        WHEN v_presentes >= v_config.asistencias_minimo_completo
                            THEN v_alumno.mensualidad
                        WHEN v_presentes >= v_config.asistencias_minimo_parcial
                            THEN v_alumno.mensualidad * v_config.porcentaje_monto_parcial / 100
                        ELSE 0
                    END, 2);
                ELSE
                    v_monto := NULL;
                END IF;

                IF v_monto IS NULL OR v_monto <= 0 THEN
                    IF v_ciclo_fin <= p_hoy THEN
                        INSERT INTO public.ciclos_omitidos
                            (escuela_id, alumno_id, periodo_estadistico, motivo)
                        VALUES
                            (v_config.escuela_id, v_alumno.id, v_periodo, 'baja_asistencia')
                        ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                        v_ultimo_ciclo_fin := v_ciclo_fin;
                        v_sin_ciclo_previo := FALSE;
                        CONTINUE;
                    ELSE
                        EXIT;
                    END IF;
                END IF;

                IF v_fecha_emision < (p_hoy - v_ventana_dias) THEN
                    INSERT INTO public.ciclos_omitidos
                        (escuela_id, alumno_id, periodo_estadistico, motivo)
                    VALUES
                        (v_config.escuela_id, v_alumno.id, v_periodo, 'mes_vencido')
                    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    v_sin_ciclo_previo := FALSE;
                    CONTINUE;
                END IF;

                IF v_ejecucion_id IS NULL THEN
                    INSERT INTO public.ejecuciones_facturacion (escuela_id, fecha_ejecucion, facturas_generadas)
                    VALUES (v_config.escuela_id, p_hoy, 0)
                    RETURNING id INTO v_ejecucion_id;
                END IF;

                IF EXTRACT(DAY FROM v_ciclo_inicio) = 1 THEN
                    v_detalle_extra := '';
                ELSE
                    v_detalle_extra := 'Ciclo ' || to_char(v_ciclo_inicio, 'DD/MM/YYYY')
                                    || ' - ' || to_char(v_ciclo_fin, 'DD/MM/YYYY');
                END IF;

                v_es_ingreso := (v_sin_ciclo_previo AND v_inicio_ingreso IS NOT NULL AND v_ciclo_inicio = v_inicio_ingreso);

                INSERT INTO public.cuentas_cobrar (
                    escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                    fecha_emision, fecha_vencimiento, estado, es_anticipo,
                    origen_facturacion, ejecucion_facturacion_id, es_mensualidad_ingreso
                ) VALUES (
                    v_config.escuela_id, v_alumno.sucursal_id, v_alumno.id,
                    v_monto, 'Mensualidad',
                    to_char(v_periodo, 'YYYY-MM'), v_periodo,
                    v_ciclo_inicio, v_ciclo_fin,
                    v_fecha_emision, v_fecha_vencimiento, 'borrador', FALSE,
                    'automatico', v_ejecucion_id, v_es_ingreso
                ) RETURNING id INTO v_cxc_id;

                INSERT INTO public.cxc_detalle (
                    escuela_id, cuenta_cobrar_id, catalogo_item_id,
                    cantidad, precio_unitario, periodo_meses, detalle_extra,
                    ciclo_inicio, ciclo_fin, periodo_estadistico
                ) VALUES (
                    v_config.escuela_id, v_cxc_id, v_item_id,
                    1, v_monto,
                    jsonb_build_array(
                        (ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
                            [EXTRACT(MONTH FROM v_periodo)::INTEGER]
                        || '-' || EXTRACT(YEAR FROM v_periodo)::INTEGER::TEXT
                    ),
                    v_detalle_extra,
                    v_ciclo_inicio, v_ciclo_fin, v_periodo
                );

                IF v_es_ingreso THEN
                    UPDATE public.mensualidades_ingreso
                    SET cuenta_id = v_cxc_id,
                        ciclo_inicio = v_ciclo_inicio,
                        ciclo_fin = v_ciclo_fin,
                        monto = v_monto,
                        motivo = NULL
                    WHERE alumno_id = v_alumno.id AND cuenta_id IS NULL;
                END IF;

                v_facturas_por_escuela := v_facturas_por_escuela + 1;
                v_ultimo_ciclo_fin := v_ciclo_fin;
                v_sin_ciclo_previo := FALSE;

            END LOOP;

        END LOOP;

        IF v_ejecucion_id IS NOT NULL THEN
            UPDATE public.ejecuciones_facturacion
            SET facturas_generadas = v_facturas_por_escuela
            WHERE id = v_ejecucion_id;
        END IF;

        v_resumen := jsonb_set(v_resumen, ARRAY[v_config.escuela_id::text], to_jsonb(v_facturas_por_escuela));
    END LOOP;

    v_resumen := jsonb_set(v_resumen, ARRAY['_borradores_depurados'], to_jsonb(v_borradores_depurados));
    RETURN v_resumen;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;

-- 9. Actualizar rpc_aprobar_notas_automaticas para rechazar escuelas inactivas y descartar expiradas (> 25 días)
CREATE OR REPLACE FUNCTION public.rpc_aprobar_notas_automaticas(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escuela_id UUID := (SELECT public.current_user_escuela_id());
  v_user_rol TEXT := (SELECT public.current_user_rol());
  v_escuela_activa BOOLEAN := FALSE;
  v_nota RECORD;
  v_aprobadas_count INTEGER := 0;
  v_descartadas_count INTEGER := 0;
  v_descartadas_info JSONB := '[]'::jsonb;
  v_existe_activa BOOLEAN;
BEGIN
  IF v_escuela_id IS NULL OR NOT COALESCE(
    v_user_rol IN ('Administrador', 'SuperAdministrador', 'Asistente'),
    FALSE
  ) THEN
    RAISE EXCEPTION 'No autorizado para aprobar notas automáticas.';
  END IF;

  SELECT e.activa INTO v_escuela_activa
  FROM public.escuelas e
  WHERE e.id = v_escuela_id;

  IF v_escuela_activa IS NOT TRUE THEN
    RAISE EXCEPTION 'La escuela no está activa para aprobar notas automáticas.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'aprobadas', 0,
      'descartadas', 0,
      'detalles_descartadas', '[]'::jsonb
    );
  END IF;

  FOR v_nota IN (
    SELECT cc.id, cc.alumno_id, cc.periodo_estadistico, cc.created_at,
           COALESCE(a.nombres || ' ' || a.apellidos, 'Alumno no identificado') AS nombre_completo
    FROM public.cuentas_cobrar cc
    LEFT JOIN public.alumnos a ON a.id = cc.alumno_id
    WHERE cc.id = ANY(p_ids)
      AND cc.escuela_id = v_escuela_id
      AND cc.estado = 'borrador'
      AND cc.origen_facturacion = 'automatico'
  ) LOOP
    IF v_nota.created_at <= now() - interval '25 days' THEN
      IF v_nota.alumno_id IS NOT NULL AND v_nota.periodo_estadistico IS NOT NULL THEN
        INSERT INTO public.ciclos_omitidos (escuela_id, alumno_id, periodo_estadistico, motivo)
        VALUES (v_escuela_id, v_nota.alumno_id, v_nota.periodo_estadistico, 'expirado_25_dias')
        ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
      END IF;
      DELETE FROM public.cuentas_cobrar WHERE id = v_nota.id;
      v_descartadas_count := v_descartadas_count + 1;
      v_descartadas_info := v_descartadas_info || jsonb_build_array(
        jsonb_build_object(
          'id', v_nota.id,
          'alumno', v_nota.nombre_completo,
          'periodo', v_nota.periodo_estadistico,
          'motivo', 'expirado_25_dias'
        )
      );
      CONTINUE;
    END IF;

    v_existe_activa := FALSE;
    IF v_nota.periodo_estadistico IS NOT NULL AND v_nota.alumno_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.cuentas_cobrar act
        WHERE act.escuela_id = v_escuela_id
          AND act.alumno_id = v_nota.alumno_id
          AND act.periodo_estadistico = v_nota.periodo_estadistico
          AND act.id <> v_nota.id
          AND act.estado <> 'borrador'
          AND act.anulada IS NOT TRUE
          AND act.es_anticipo IS NOT TRUE
      ) INTO v_existe_activa;
    END IF;

    IF v_existe_activa THEN
      DELETE FROM public.cuentas_cobrar WHERE id = v_nota.id;
      v_descartadas_count := v_descartadas_count + 1;
      v_descartadas_info := v_descartadas_info || jsonb_build_array(
        jsonb_build_object(
          'id', v_nota.id,
          'alumno', v_nota.nombre_completo,
          'periodo', v_nota.periodo_estadistico
        )
      );
    ELSE
      UPDATE public.cuentas_cobrar
      SET estado = 'pendiente',
          updated_at = now()
      WHERE id = v_nota.id;
      v_aprobadas_count := v_aprobadas_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'aprobadas', v_aprobadas_count,
    'descartadas', v_descartadas_count,
    'detalles_descartadas', v_descartadas_info
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_aprobar_notas_automaticas(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_aprobar_notas_automaticas(uuid[]) TO authenticated, service_role;

-- 10. RPC paginado (30 registros por página) para Mensualidades Por Aprobar
CREATE OR REPLACE FUNCTION public.rpc_listar_notas_automaticas_borrador(
  p_busqueda text DEFAULT ''::text,
  p_sucursal_filtro uuid DEFAULT NULL::uuid,
  p_pagina integer DEFAULT 1,
  p_limite integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_escuela_id uuid;
  v_escuela_activa boolean := false;
  v_sucursal_actor uuid;
  v_sucursal_efectiva uuid;
  v_rol text;
  v_busqueda text := NULLIF(btrim(unaccent(lower(COALESCE(p_busqueda, '')))), '');
  v_terminos text[];
  v_pagina integer := GREATEST(COALESCE(p_pagina, 1), 1);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 30), 1), 50);
  v_offset integer;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_ids_filtrados jsonb := '[]'::jsonb;
BEGIN
  SELECT u.escuela_id, u.sucursal_id, u.rol::text, COALESCE(e.activa, false)
    INTO v_escuela_id, v_sucursal_actor, v_rol, v_escuela_activa
  FROM public.usuarios AS u
  LEFT JOIN public.escuelas AS e ON e.id = u.escuela_id
  WHERE u.id = v_uid
    AND u.activo IS TRUE
  LIMIT 1;

  IF v_uid IS NULL
     OR v_escuela_id IS NULL
     OR v_rol IS NULL
     OR v_rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RAISE EXCEPTION 'No autorizado para consultar notas automáticas.' USING ERRCODE = '42501';
  END IF;

  IF v_rol IN ('Administrador', 'Asistente') AND v_sucursal_actor IS NOT NULL THEN
    IF p_sucursal_filtro IS NOT NULL AND p_sucursal_filtro <> v_sucursal_actor THEN
      RAISE EXCEPTION 'La sucursal solicitada está fuera del alcance autorizado.' USING ERRCODE = '42501';
    END IF;
    v_sucursal_efectiva := v_sucursal_actor;
  ELSE
    IF p_sucursal_filtro IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sucursales AS s
      WHERE s.id = p_sucursal_filtro AND s.escuela_id = v_escuela_id
    ) THEN
      RAISE EXCEPTION 'La sucursal solicitada está fuera de la escuela autorizada.' USING ERRCODE = '42501';
    END IF;
    v_sucursal_efectiva := p_sucursal_filtro;
  END IF;

  IF v_escuela_activa IS NOT TRUE THEN
    RETURN jsonb_build_object(
      'items', '[]'::jsonb,
      'total_resultados', 0,
      'pagina', v_pagina,
      'limite', v_limite,
      'ids_filtrados', '[]'::jsonb
    );
  END IF;

  v_terminos := CASE
    WHEN v_busqueda IS NULL THEN ARRAY[]::text[]
    ELSE regexp_split_to_array(v_busqueda, '\s+')
  END;
  v_offset := (v_pagina - 1) * v_limite;

  WITH filtradas AS MATERIALIZED (
    SELECT
      cc.id,
      cc.monto_total,
      cc.descripcion,
      cc.observaciones,
      cc.fecha_emision,
      cc.fecha_vencimiento,
      cc.estado,
      cc.ciclo_inicio,
      cc.ciclo_fin,
      cc.es_mensualidad_ingreso,
      cc.periodo,
      cc.created_at,
      (cc.created_at + interval '25 days') AS expira_at,
      GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM ((cc.created_at + interval '25 days') - now())) / 86400.0)::integer
      ) AS dias_restantes,
      CASE
        WHEN a.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', a.id,
          'nombres', a.nombres,
          'apellidos', a.apellidos,
          'mensualidad', a.mensualidad
        )
      END AS alumnos,
      CASE
        WHEN s.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', s.id,
          'nombre', s.nombre
        )
      END AS sucursales,
      COALESCE(
        (
          SELECT jsonb_agg(jsonb_build_object('monto_aplicado', ca.monto_aplicado))
          FROM public.cobros_aplicados ca
          WHERE ca.cuenta_cobrar_id = cc.id
        ),
        '[]'::jsonb
      ) AS cobros_aplicados
    FROM public.cuentas_cobrar cc
    LEFT JOIN public.alumnos a ON a.id = cc.alumno_id
    LEFT JOIN public.sucursales s ON s.id = cc.sucursal_id
    WHERE cc.escuela_id = v_escuela_id
      AND cc.origen_facturacion = 'automatico'
      AND cc.estado = 'borrador'
      AND cc.anulada IS NOT TRUE
      AND cc.created_at > now() - interval '25 days'
      AND (v_sucursal_efectiva IS NULL OR cc.sucursal_id = v_sucursal_efectiva)
      AND (
        cardinality(v_terminos) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(v_terminos) AS termino
          WHERE unaccent(lower(COALESCE(a.nombres, '') || ' ' || COALESCE(a.apellidos, '')))
                NOT LIKE '%' || termino || '%'
        )
      )
    ORDER BY cc.fecha_emision DESC, cc.created_at DESC, cc.id DESC
  ),
  paginadas AS (
    SELECT *
    FROM filtradas
    LIMIT v_limite OFFSET v_offset
  )
  SELECT
    (SELECT count(*)::integer FROM filtradas),
    COALESCE((SELECT jsonb_agg(to_jsonb(p)) FROM paginadas p), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(f.id) FROM filtradas f), '[]'::jsonb)
  INTO v_total, v_items, v_ids_filtrados;

  RETURN jsonb_build_object(
    'items', v_items,
    'total_resultados', v_total,
    'pagina', v_pagina,
    'limite', v_limite,
    'ids_filtrados', v_ids_filtrados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_listar_notas_automaticas_borrador(text, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_listar_notas_automaticas_borrador(text, uuid, integer, integer) TO authenticated;
