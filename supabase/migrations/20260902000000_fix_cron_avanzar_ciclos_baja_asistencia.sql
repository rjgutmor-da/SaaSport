-- Migración: Fix cron facturación - avanzar ciclos con baja asistencia
--
-- Problema: el cron se bloqueaba permanentemente cuando un alumno tenía baja
-- asistencia (o sin registros) en un mes intermedio. La lógica solo intentaba
-- un ciclo por alumno por ejecución, y si ese ciclo no generaba nota (monto = 0),
-- nunca avanzaba al siguiente mes. Además, la ventana de 7 días hacía que el
-- ciclo eventualmente expirara y quedara bloqueado para siempre.
--
-- Solución:
--   1. Reemplazar la lógica de un solo ciclo por un LOOP que avanza hasta 12
--      meses atrasados por alumno por ejecución.
--   2. Cuando el monto es 0 (baja asistencia) o no hay registros, se inserta
--      en ciclos_omitidos y se avanza al siguiente ciclo.
--   3. Cuando un ciclo con monto > 0 está fuera de la ventana de 7 días
--      (mes vencido), se registra como omitido en lugar de bloquearse.
--   4. Los motivos de omisión son: 'baja_asistencia', 'sin_registros_asistencia',
--      'mes_vencido'.

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
    -- Iterar por cada escuela con facturación automática activa
    FOR v_config IN (
        SELECT escuela_id, plan_momento_emision, plan_calculo_monto,
               asistencias_minimo_completo, asistencias_minimo_parcial, porcentaje_monto_parcial
        FROM public.configuracion_facturacion
        WHERE activo = TRUE AND plan_momento_emision IN ('adelantado', 'atrasado')
    ) LOOP
        v_facturas_por_escuela := 0;
        v_ejecucion_id := NULL;

        -- Obtener el ítem "Mensualidad" activo del catálogo de la escuela
        SELECT id INTO v_item_id
        FROM public.catalogo_items
        WHERE escuela_id = v_config.escuela_id
          AND lower(nombre) = 'mensualidad'
          AND activo = TRUE
        LIMIT 1;

        IF v_item_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Iterar alumnos elegibles: activos, con mensualidad configurada
        FOR v_alumno IN (
            SELECT id, sucursal_id, mensualidad, fecha_inicio
            FROM public.alumnos
            WHERE escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE
              AND mensualidad IS NOT NULL
              AND mensualidad > 0
              AND (fecha_inicio IS NULL OR p_hoy >= fecha_inicio)
        ) LOOP

            -- Buscar el último ciclo_fin de mensualidad del alumno usando DOS fuentes:
            --   1. cuentas_cobrar con JOIN a cxc_detalle (notas modernas con detalle)
            --   2. cuentas_cobrar.ciclo_fin directamente (notas sin detalle o con detalle tardío)
            -- Se toma el MAYOR de ambos para garantizar que no se regenere un período ya cubierto.
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

            -- Sin nota previa = no se genera nada
            IF v_ultimo_ciclo_fin IS NULL THEN
                CONTINUE;
            END IF;

            -- ============================================================
            -- LOOP DE AVANCE: procesar hasta 12 ciclos atrasados por alumno.
            -- Esto permite al cron "saltar" meses con baja asistencia
            -- en lugar de quedarse bloqueado en ellos.
            -- ============================================================
            FOR v_iter IN 1..12 LOOP
                v_ciclo_inicio := v_ultimo_ciclo_fin + INTERVAL '1 day';
                v_ciclo_fin    := (v_ciclo_inicio + INTERVAL '1 month' - INTERVAL '1 day')::date;

                -- Definir fecha de emisión según la modalidad de la escuela
                IF v_config.plan_momento_emision = 'adelantado' THEN
                    v_fecha_emision     := v_ciclo_inicio;
                    v_fecha_vencimiento := v_ciclo_inicio;
                ELSE
                    v_fecha_emision     := v_ciclo_fin;
                    v_fecha_vencimiento := v_ciclo_fin;
                END IF;

                -- Si la fecha de emisión está en el futuro, ya no hay más por hacer
                IF v_fecha_emision > p_hoy THEN
                    EXIT; -- Sale del LOOP de avance
                END IF;

                v_periodo := public.calcular_periodo_estadistico(v_ciclo_inicio);

                -- Verificar si este periodo fue omitido (borrado/anulado manualmente)
                IF EXISTS (
                    SELECT 1 FROM public.ciclos_omitidos
                    WHERE alumno_id = v_alumno.id
                      AND periodo_estadistico = v_periodo
                ) THEN
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    CONTINUE; -- Avanzar al siguiente ciclo
                END IF;

                -- Evitar duplicados (idempotencia):
                -- No generar si ya existe cualquier nota de mensualidad activa para este periodo
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
                    CONTINUE; -- Ya existe nota, avanzar
                END IF;

                -- Calcular monto desde la ficha del alumno
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

                    -- Sin registros de asistencia
                    IF v_registros = 0 THEN
                        -- Si el ciclo ya terminó, omitir definitivamente
                        IF v_ciclo_fin <= p_hoy THEN
                            INSERT INTO public.ciclos_omitidos
                                (escuela_id, alumno_id, periodo_estadistico, motivo)
                            VALUES
                                (v_config.escuela_id, v_alumno.id, v_periodo, 'sin_registros_asistencia')
                            ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                            v_ultimo_ciclo_fin := v_ciclo_fin;
                            CONTINUE; -- Avanzar al siguiente ciclo
                        ELSE
                            EXIT; -- Ciclo aún en curso, esperar a que se registren asistencias
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

                -- Si el monto es 0 o NULL (baja asistencia), omitir y avanzar
                IF v_monto IS NULL OR v_monto <= 0 THEN
                    -- Solo omitir si el ciclo ya terminó
                    IF v_ciclo_fin <= p_hoy THEN
                        INSERT INTO public.ciclos_omitidos
                            (escuela_id, alumno_id, periodo_estadistico, motivo)
                        VALUES
                            (v_config.escuela_id, v_alumno.id, v_periodo, 'baja_asistencia')
                        ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                        v_ultimo_ciclo_fin := v_ciclo_fin;
                        CONTINUE; -- Avanzar al siguiente ciclo
                    ELSE
                        EXIT; -- Ciclo aún en curso, las asistencias pueden cambiar
                    END IF;
                END IF;

                -- Si el ciclo está vencido (fuera de ventana de 7 días) pero monto > 0,
                -- omitir en lugar de generar nota retroactiva (solo de aquí para adelante)
                IF v_fecha_emision < (p_hoy - v_ventana_dias) THEN
                    INSERT INTO public.ciclos_omitidos
                        (escuela_id, alumno_id, periodo_estadistico, motivo)
                    VALUES
                        (v_config.escuela_id, v_alumno.id, v_periodo, 'mes_vencido')
                    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    CONTINUE; -- Avanzar al siguiente ciclo
                END IF;

                -- ========================================
                -- GENERAR NOTA DE MENSUALIDAD (borrador)
                -- ========================================
                IF v_ejecucion_id IS NULL THEN
                    INSERT INTO public.ejecuciones_facturacion (escuela_id, fecha_ejecucion, facturas_generadas)
                    VALUES (v_config.escuela_id, p_hoy, 0)
                    RETURNING id INTO v_ejecucion_id;
                END IF;

                -- detalle_extra: vacío si ciclo es mes completo (día 1)
                IF EXTRACT(DAY FROM v_ciclo_inicio) = 1 THEN
                    v_detalle_extra := '';
                ELSE
                    v_detalle_extra := 'Ciclo ' || to_char(v_ciclo_inicio, 'DD/MM/YYYY')
                                    || ' - ' || to_char(v_ciclo_fin, 'DD/MM/YYYY');
                END IF;

                -- Crear nota en estado 'borrador'
                INSERT INTO public.cuentas_cobrar (
                    escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                    fecha_emision, fecha_vencimiento, estado, es_anticipo,
                    origen_facturacion, ejecucion_facturacion_id
                ) VALUES (
                    v_config.escuela_id, v_alumno.sucursal_id, v_alumno.id,
                    v_monto, 'Mensualidad',
                    to_char(v_periodo, 'YYYY-MM'), v_periodo,
                    v_ciclo_inicio, v_ciclo_fin,
                    v_fecha_emision, v_fecha_vencimiento, 'borrador', FALSE,
                    'automatico', v_ejecucion_id
                ) RETURNING id INTO v_cxc_id;

                -- Crear detalle con ciclo en cxc_detalle
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

                v_facturas_por_escuela := v_facturas_por_escuela + 1;
                v_ultimo_ciclo_fin := v_ciclo_fin;

            END LOOP; -- Fin LOOP de avance por alumno

        END LOOP; -- Fin loop alumnos

        IF v_ejecucion_id IS NOT NULL THEN
            UPDATE public.ejecuciones_facturacion
            SET facturas_generadas = v_facturas_por_escuela
            WHERE id = v_ejecucion_id;
        END IF;

        v_resumen := jsonb_set(v_resumen, ARRAY[v_config.escuela_id::text], to_jsonb(v_facturas_por_escuela));
    END LOOP; -- Fin loop escuelas

    RETURN v_resumen;
END;
$$;

-- Mantener permisos
REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;
