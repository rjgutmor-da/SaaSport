-- Sincroniza mensualidades_ingreso cuando una nota de ingreso se edita con rpc_guardar_nota_cxc
-- y marca es_mensualidad_ingreso cuando el cron genera el primer ciclo de un alumno nuevo sin tarifa inicial.

CREATE OR REPLACE FUNCTION public.rpc_guardar_nota_cxc(
  p_nota_id uuid DEFAULT NULL::uuid,
  p_alumno_id uuid DEFAULT NULL::uuid,
  p_sucursal_id uuid DEFAULT NULL::uuid,
  p_monto_total numeric DEFAULT 0,
  p_descripcion text DEFAULT ''::text,
  p_observaciones text DEFAULT NULL::text,
  p_fecha_emision date DEFAULT CURRENT_DATE,
  p_fecha_vencimiento date DEFAULT NULL::date,
  p_es_anticipo boolean DEFAULT false,
  p_lineas jsonb DEFAULT '[]'::jsonb,
  p_nro_recibo text DEFAULT NULL::text,
  p_ciclo_inicio date DEFAULT NULL::date,
  p_ciclo_fin date DEFAULT NULL::date,
  p_operacion_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_usuario public.usuarios%rowtype;
  v_nota_id uuid := p_nota_id;
  v_nota_existente public.cuentas_cobrar%rowtype;
  v_sucursal_id uuid;
  v_alumno_sucursal_id uuid;
  v_tiene_productos boolean;
  v_abierto_at timestamptz;
  v_es_historica boolean := false;
  v_linea jsonb;
  v_item_id uuid;
  v_item_cat text;
  v_cant integer;
  v_op_id uuid := COALESCE(p_operacion_id, gen_random_uuid());

  v_monto_pagado numeric;
  v_rec record;
  v_es_anticipo boolean;
  v_periodo_est date;
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RAISE EXCEPTION 'No autorizado para guardar la nota.';
  END IF;

  -- Idempotencia al crear
  IF p_nota_id IS NULL AND p_operacion_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_usuario.escuela_id::text || ':nota-cxc:' || p_operacion_id::text, 0));
    SELECT id INTO v_nota_id FROM public.cuentas_cobrar
    WHERE escuela_id = v_usuario.escuela_id AND operacion_id = p_operacion_id;
    IF FOUND THEN
      RETURN v_nota_id;
    END IF;
  END IF;

  -- Resolución de permisos y sucursal
  IF p_nota_id IS NOT NULL THEN
    -- El Asistente no tiene permiso para editar notas existentes
    IF v_usuario.rol NOT IN ('SuperAdministrador', 'Administrador') THEN
      RAISE EXCEPTION 'No autorizado para editar notas.';
    END IF;

    -- Bloquear con FOR UPDATE antes de leer detalles para serializar ediciones simultáneas
    SELECT * INTO v_nota_existente FROM public.cuentas_cobrar
    WHERE id = p_nota_id AND escuela_id = v_usuario.escuela_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nota no encontrada.'; END IF;

    IF v_nota_existente.anulada IS TRUE THEN
      RAISE EXCEPTION 'No se puede editar una nota anulada.';
    END IF;

    -- Restringir al Administrador a su propia sucursal asignada
    IF v_usuario.rol = 'Administrador'
       AND v_usuario.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para editar notas de otra sucursal.';
    END IF;

    -- Conservar la sucursal original al editar
    v_sucursal_id := v_nota_existente.sucursal_id;
  END IF;

  v_es_anticipo := CASE
    WHEN p_nota_id IS NOT NULL THEN COALESCE(v_nota_existente.es_anticipo, false)
    ELSE COALESCE(p_es_anticipo, false)
  END;

  IF p_monto_total < 0 THEN
    RAISE EXCEPTION 'El monto total no puede ser negativo.';
  END IF;

  SELECT a.sucursal_id INTO v_alumno_sucursal_id
  FROM public.alumnos a
  WHERE a.id = p_alumno_id AND a.escuela_id = v_usuario.escuela_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alumno inválido para la escuela.'; END IF;

  IF p_nota_id IS NOT NULL AND p_alumno_id IS DISTINCT FROM v_nota_existente.alumno_id THEN
    RAISE EXCEPTION 'No se puede cambiar el alumno de una nota existente.';
  END IF;
  IF v_usuario.rol <> 'SuperAdministrador' AND v_usuario.sucursal_id IS NOT NULL
     AND v_alumno_sucursal_id IS NOT NULL
     AND v_alumno_sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
    RAISE EXCEPTION 'No autorizado para registrar notas del alumno de otra sucursal.';
  END IF;

  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las líneas de la nota deben enviarse como una lista.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lineas) l
    JOIN public.catalogo_items ci ON ci.id = (l->>'catalogo_item_id')::uuid
    WHERE ci.escuela_id = v_usuario.escuela_id AND ci.categoria = 'producto'
  ) AND NOT v_es_anticipo INTO v_tiene_productos;

  IF p_nota_id IS NULL THEN
    -- Servicios: sucursal del alumno. Productos: se permite otro origen autorizado.
    v_sucursal_id := CASE WHEN v_tiene_productos
      THEN COALESCE(p_sucursal_id, v_alumno_sucursal_id)
      ELSE COALESCE(v_alumno_sucursal_id, p_sucursal_id) END;
    IF v_sucursal_id IS NULL THEN
      RAISE EXCEPTION 'Selecciona una sucursal: el alumno no tiene sucursal asignada.';
    END IF;
    IF v_usuario.rol <> 'SuperAdministrador' AND v_usuario.sucursal_id IS NOT NULL
       AND v_sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para registrar notas en otra sucursal.';
    END IF;
  END IF;

  IF v_sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = v_sucursal_id AND escuela_id = v_usuario.escuela_id) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
  END IF;

  -- Una entrega desde otra sucursal no puede arrastrar servicios a esa sucursal.
  -- También se valida al editar para impedir añadir servicios a una venta externa.
  IF v_tiene_productos AND v_alumno_sucursal_id IS NOT NULL
     AND v_sucursal_id IS NOT NULL
     AND v_sucursal_id IS DISTINCT FROM v_alumno_sucursal_id
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lineas) l
       JOIN public.catalogo_items ci ON ci.id = (l->>'catalogo_item_id')::uuid
       WHERE ci.escuela_id = v_usuario.escuela_id
         AND ci.categoria IS DISTINCT FROM 'producto'
     ) THEN
    RAISE EXCEPTION 'No se pueden mezclar servicios y productos de otra sucursal. Registra los servicios en una nota separada en la sucursal del alumno.';
  END IF;

  -- Determinar si es nota histórica
  SELECT abierto_at INTO v_abierto_at FROM public.inventario_aperturas
  WHERE escuela_id = v_usuario.escuela_id AND sucursal_id = v_sucursal_id;

  IF p_nota_id IS NOT NULL THEN
    v_es_historica := (v_abierto_at IS NULL OR v_nota_existente.created_at < v_abierto_at);
  ELSE
    v_es_historica := false;
  END IF;

  -- Habilitar paso de RPC en los triggers de detalle
  PERFORM set_config('saasport.en_rpc_guardar_nota', 'true', true);

  CREATE TEMP TABLE IF NOT EXISTS temp_cxc_lineas_ant (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxc_lineas_ant WHERE true;

  CREATE TEMP TABLE IF NOT EXISTS temp_cxc_lineas_nue (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxc_lineas_nue WHERE true;

  IF p_nota_id IS NOT NULL AND NOT v_es_historica THEN
    INSERT INTO temp_cxc_lineas_ant (catalogo_item_id, cantidad)
    SELECT d.catalogo_item_id, sum(d.cantidad)::integer
    FROM public.cxc_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_cobrar_id = p_nota_id AND ci.categoria = 'producto'
    GROUP BY d.catalogo_item_id;
  END IF;

  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las líneas de la nota deben enviarse como una lista.';
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      v_item_id := (v_linea->>'catalogo_item_id')::uuid;
      v_cant := (v_linea->>'cantidad')::integer;
      SELECT categoria INTO v_item_cat FROM public.catalogo_items WHERE id = v_item_id AND escuela_id = v_usuario.escuela_id;
      IF v_item_cat IS NULL OR v_cant IS NULL OR v_cant <= 0
         OR (v_linea->>'precio_unitario') IS NULL
         OR (v_linea->>'precio_unitario')::numeric < 0 THEN
        RAISE EXCEPTION 'La nota contiene una línea inválida.';
      END IF;
      IF v_item_cat = 'producto' THEN
        INSERT INTO temp_cxc_lineas_nue (catalogo_item_id, cantidad)
        VALUES (v_item_id, v_cant)
        ON CONFLICT (catalogo_item_id) DO UPDATE SET cantidad = temp_cxc_lineas_nue.cantidad + EXCLUDED.cantidad;
      END IF;
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM temp_cxc_lineas_nue) AND v_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Las notas con productos requieren una sucursal.';
  END IF;

  v_periodo_est := public.calcular_periodo_estadistico(p_ciclo_inicio, p_ciclo_fin);

  -- Guardar o actualizar cabecera
  IF p_nota_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_monto_pagado
    FROM public.cobros_aplicados WHERE cuenta_cobrar_id = p_nota_id;

    UPDATE public.cuentas_cobrar SET
      monto_total = p_monto_total,
      descripcion = p_descripcion,
      observaciones = p_observaciones,
      fecha_emision = p_fecha_emision,
      fecha_vencimiento = p_fecha_vencimiento,
      estado = CASE
        WHEN estado = 'anulada' THEN 'anulada'
        WHEN v_monto_pagado >= p_monto_total AND p_monto_total > 0 THEN 'pagada'
        WHEN v_monto_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
      END,
      nro_recibo = COALESCE(p_nro_recibo, nro_recibo),
      ciclo_inicio = p_ciclo_inicio,
      ciclo_fin = p_ciclo_fin,
      periodo = CASE WHEN v_periodo_est IS NULL THEN NULL ELSE to_char(v_periodo_est, 'YYYY-MM') END,
      periodo_estadistico = v_periodo_est,
      editado = true,
      editado_por = v_usuario.id,
      editado_at = now(),
      updated_at = now()
    WHERE id = p_nota_id;
    v_nota_id := p_nota_id;

    -- Mantener sincronizado el registro de ingreso del alumno para encadenar futuros ciclos
    UPDATE public.mensualidades_ingreso
    SET ciclo_inicio = p_ciclo_inicio,
        ciclo_fin = p_ciclo_fin,
        monto = p_monto_total
    WHERE cuenta_id = p_nota_id;
  ELSE
    INSERT INTO public.cuentas_cobrar (
      escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
      observaciones, fecha_emision, fecha_vencimiento, es_anticipo,
      estado, nro_recibo, ciclo_inicio, ciclo_fin, periodo, periodo_estadistico,
      origen_facturacion, operacion_id
    ) VALUES (
      v_usuario.escuela_id, v_sucursal_id, p_alumno_id, p_monto_total, p_descripcion,
      p_observaciones, p_fecha_emision, p_fecha_vencimiento, v_es_anticipo,
      'pendiente', p_nro_recibo, p_ciclo_inicio, p_ciclo_fin,
      CASE WHEN v_periodo_est IS NULL THEN NULL ELSE to_char(v_periodo_est, 'YYYY-MM') END,
      v_periodo_est,
      'manual', v_op_id
    ) RETURNING id INTO v_nota_id;
  END IF;

  -- Reemplazar detalles
  IF p_nota_id IS NOT NULL THEN
    DELETE FROM public.cxc_detalle WHERE cuenta_cobrar_id = v_nota_id;
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      -- El trigger validar_ciclo_mensualidad_detalle deriva el periodo solo
      -- para Mensualidad. No propagar el ciclo de cabecera a productos/servicios.
      INSERT INTO public.cxc_detalle (
        escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad,
        precio_unitario, periodo_meses, detalle_extra,
        ciclo_inicio, ciclo_fin
      ) VALUES (
        v_usuario.escuela_id, v_nota_id,
        (v_linea->>'catalogo_item_id')::uuid,
        (v_linea->>'cantidad')::integer,
        (v_linea->>'precio_unitario')::numeric,
        CASE WHEN (v_linea->'periodo_meses') IS NOT NULL AND jsonb_typeof(v_linea->'periodo_meses') = 'array'
             THEN v_linea->'periodo_meses'
             ELSE NULL END,
        v_linea->>'detalle_extra',
        (v_linea->>'ciclo_inicio')::date,
        (v_linea->>'ciclo_fin')::date
      );
    END LOOP;
  END IF;

  -- Procesar inventario mediante cálculo de diferencias si no es histórica
  IF NOT v_es_historica AND NOT v_es_anticipo THEN
    FOR v_rec IN (
      SELECT COALESCE(n.catalogo_item_id, a.catalogo_item_id) AS item_id,
             COALESCE(n.cantidad, 0) - COALESCE(a.cantidad, 0) AS delta
      FROM temp_cxc_lineas_nue n
      FULL OUTER JOIN temp_cxc_lineas_ant a ON a.catalogo_item_id = n.catalogo_item_id
    ) LOOP
      IF v_rec.delta > 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'venta', -v_rec.delta, 'Venta: ' || v_nota_id,
          'cxc', v_nota_id, v_usuario.id, v_op_id
        );
      ELSIF v_rec.delta < 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'correccion', abs(v_rec.delta), 'Corrección de venta: ' || v_nota_id,
          'cxc', v_nota_id, v_usuario.id, v_op_id
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('saasport.en_rpc_guardar_nota', 'false', true);
  RETURN v_nota_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_guardar_nota_cxc(uuid, uuid, uuid, numeric, text, text, date, date, boolean, jsonb, text, date, date, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_nota_cxc(uuid, uuid, uuid, numeric, text, text, date, date, boolean, jsonb, text, date, date, uuid) TO authenticated;

-- También marcar es_mensualidad_ingreso cuando el cron genera la primera mensualidad
-- de un alumno nuevo que ingresó inicialmente sin tarifa (tarifa_cero / sin_tarifa).
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
    v_resumen        JSONB := '{}'::jsonb;
    v_detalle_extra  TEXT;
    v_fecha_emision  DATE;
    v_fecha_vencimiento DATE;
    v_ventana_dias   INTEGER := 7;
    v_iter           INTEGER;
BEGIN
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

    RETURN v_resumen;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;
