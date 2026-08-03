-- Migración: Refactorizar cron de facturación para encadenar desde la nota anterior
-- La nota de mensualidad automática siguiente siempre se basa en la última nota
-- existente del alumno: ciclo_inicio = último ciclo_fin + 1 día.
-- Si no existe nota previa, no se genera nota automática.
-- Si alumnos.mensualidad IS NULL, no se genera nota automática.

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

            -- El ciclo SOLO se calcula a partir de la ULTIMA nota de mensualidad.
            -- Sin nota previa = no se genera nada.
            SELECT cc.ciclo_fin INTO v_ultimo_ciclo_fin
            FROM public.cuentas_cobrar cc
            JOIN public.cxc_detalle cd ON cc.id = cd.cuenta_cobrar_id
            JOIN public.catalogo_items ci ON cd.catalogo_item_id = ci.id
            WHERE cc.alumno_id = v_alumno.id
              AND cc.anulada IS NOT TRUE
              AND lower(ci.nombre) = 'mensualidad'
              AND cc.ciclo_fin IS NOT NULL
            ORDER BY cc.ciclo_fin DESC
            LIMIT 1;

            IF v_ultimo_ciclo_fin IS NULL THEN
                CONTINUE;
            END IF;

            -- Siguiente ciclo: inicia el día después del fin del ciclo anterior
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

            -- No generar si la fecha de emisión aún no llega (es en el futuro)
            IF v_fecha_emision > p_hoy THEN
                CONTINUE;
            END IF;

            -- No generar si la fecha de emisión fue hace más de 7 días
            IF v_fecha_emision < (p_hoy - v_ventana_dias) THEN
                CONTINUE;
            END IF;

            v_periodo := public.calcular_periodo_estadistico(v_ciclo_inicio);

            -- Verificar si este periodo fue omitido (borrado/anulado manualmente)
            IF EXISTS (
                SELECT 1 FROM public.ciclos_omitidos
                WHERE alumno_id = v_alumno.id
                  AND periodo_estadistico = v_periodo
            ) THEN
                CONTINUE;
            END IF;

            -- Evitar duplicados (idempotencia)
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
                CONTINUE;
            END IF;

            -- Calcular monto desde la ficha del alumno (alumnos.mensualidad)
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
                    CONTINUE;
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

            IF v_monto IS NOT NULL AND v_monto > 0 THEN
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
            END IF;
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

-- Mantener permisos
REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;
