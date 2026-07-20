-- Migration: Corrección de facturación automática por Mes Completo y control de emisión sin fechas futuras

CREATE OR REPLACE FUNCTION public.obtener_rango_ciclo_alumno(
    p_fecha_inicio DATE,
    p_hoy DATE,
    p_momento TEXT,
    OUT p_ciclo_inicio DATE,
    OUT p_ciclo_fin DATE
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
    IF p_momento = 'adelantado' THEN
        -- Cobro adelantado: mes corriente (del 1ero al ultimo del mes actual)
        p_ciclo_inicio := date_trunc('month', p_hoy)::date;
        p_ciclo_fin := (date_trunc('month', p_hoy) + INTERVAL '1 month - 1 day')::date;
    ELSIF p_momento = 'atrasado' THEN
        -- Cobro a mes vencido: mes anterior recién finalizado
        p_ciclo_inicio := date_trunc('month', p_hoy - INTERVAL '1 month')::date;
        p_ciclo_fin := (date_trunc('month', p_hoy - INTERVAL '1 month') + INTERVAL '1 month - 1 day')::date;
    ELSE
        p_ciclo_inicio := date_trunc('month', p_hoy)::date;
        p_ciclo_fin := (date_trunc('month', p_hoy) + INTERVAL '1 month - 1 day')::date;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_rango_ciclo_alumno(DATE, DATE, TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_cron_facturacion_diaria(p_hoy DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_config RECORD;
    v_alumno RECORD;
    v_rango RECORD;
    v_periodo DATE;
    v_item_id UUID;
    v_cxc_id UUID;
    v_ejecucion_id UUID;
    v_monto NUMERIC;
    v_registros INTEGER;
    v_presentes INTEGER;
    v_facturas_por_escuela INTEGER;
    v_resumen JSONB := '{}'::jsonb;
    v_detalle_extra TEXT;
    v_fecha_emision DATE;
    v_fecha_vencimiento DATE;
BEGIN
    FOR v_config IN (
        SELECT escuela_id, plan_momento_emision, plan_calculo_monto,
               asistencias_minimo_completo, asistencias_minimo_parcial, porcentaje_monto_parcial
        FROM public.configuracion_facturacion
        WHERE activo = TRUE AND plan_momento_emision IN ('adelantado', 'atrasado')
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
              AND fecha_inicio IS NOT NULL
              AND p_hoy >= fecha_inicio
        ) LOOP
            -- Calcular ciclo
            SELECT p_ciclo_inicio, p_ciclo_fin INTO v_rango
            FROM public.obtener_rango_ciclo_alumno(v_alumno.fecha_inicio, p_hoy, v_config.plan_momento_emision);

            -- NO generar facturas si el fin del ciclo aún no ha llegado a la fecha p_hoy
            IF v_rango.p_ciclo_fin > p_hoy THEN
                CONTINUE;
            END IF;

            v_periodo := public.calcular_periodo_estadistico(v_rango.p_ciclo_inicio);

            -- Evitar duplicados (idempotencia en borrador, pendiente o pagada)
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

            -- Definir fecha de emisión y vencimiento según la regla de la escuela:
            -- Si es adelantado: fecha de emisión al inicio del ciclo
            -- Si es atrasado: fecha de emisión al fin del ciclo
            IF v_config.plan_momento_emision = 'adelantado' THEN
                v_fecha_emision := v_rango.p_ciclo_inicio;
                v_fecha_vencimiento := v_rango.p_ciclo_inicio;
            ELSE -- atrasado
                v_fecha_emision := v_rango.p_ciclo_fin;
                v_fecha_vencimiento := v_rango.p_ciclo_fin;
            END IF;

            -- Verificar de nuevo que la fecha de emisión no sea futura a p_hoy
            IF v_fecha_emision > p_hoy THEN
                CONTINUE;
            END IF;

            -- Calcular monto
            IF v_config.plan_calculo_monto = 'fijo' THEN
                v_monto := v_alumno.mensualidad;
            ELSIF v_config.plan_calculo_monto = 'asistencia' THEN
                SELECT count(*)::INTEGER,
                       count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER
                INTO v_registros, v_presentes
                FROM (
                    SELECT estado FROM public.asistencias_normales
                    WHERE alumno_id = v_alumno.id
                      AND fecha >= v_rango.p_ciclo_inicio AND fecha <= v_rango.p_ciclo_fin
                    UNION ALL
                    SELECT estado FROM public.asistencias_arqueros
                    WHERE alumno_id = v_alumno.id
                      AND fecha >= v_rango.p_ciclo_inicio AND fecha <= v_rango.p_ciclo_fin
                ) x;

                IF v_registros = 0 THEN
                    CONTINUE;
                END IF;

                v_monto := round(CASE
                    WHEN v_presentes >= v_config.asistencias_minimo_completo THEN v_alumno.mensualidad
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

                -- Si el ciclo es mes completo (día 1), detalle_extra va vacío
                IF EXTRACT(DAY FROM v_rango.p_ciclo_inicio) = 1 THEN
                    v_detalle_extra := '';
                ELSE
                    v_detalle_extra := 'Ciclo ' || to_char(v_rango.p_ciclo_inicio, 'DD/MM/YYYY') || ' - ' || to_char(v_rango.p_ciclo_fin, 'DD/MM/YYYY');
                END IF;

                -- Se crean con estado 'borrador'
                INSERT INTO public.cuentas_cobrar (
                    escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                    fecha_emision, fecha_vencimiento, estado, es_anticipo,
                    origen_facturacion, ejecucion_facturacion_id
                ) VALUES (
                    v_config.escuela_id, v_alumno.sucursal_id, v_alumno.id, v_monto, 'Mensualidad',
                    to_char(v_periodo, 'YYYY-MM'), v_periodo, v_rango.p_ciclo_inicio, v_rango.p_ciclo_fin,
                    v_fecha_emision, v_fecha_vencimiento, 'borrador', FALSE,
                    'automatico', v_ejecucion_id
                ) RETURNING id INTO v_cxc_id;

                INSERT INTO public.cxc_detalle (
                    escuela_id, cuenta_cobrar_id, catalogo_item_id,
                    cantidad, precio_unitario, periodo_meses, detalle_extra
                ) VALUES (
                    v_config.escuela_id, v_cxc_id, v_item_id,
                    1, v_monto,
                    jsonb_build_array(
                        (ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
                            [EXTRACT(MONTH FROM v_periodo)::INTEGER]
                        || '-' || EXTRACT(YEAR FROM v_periodo)::INTEGER::TEXT
                    ),
                    v_detalle_extra
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

GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;
