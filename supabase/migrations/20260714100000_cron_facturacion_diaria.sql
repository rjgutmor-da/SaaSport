-- Migration: Facturación Automática Diaria por Ciclos Individuales

-- 1. Crear tabla de ejecuciones de facturación
CREATE TABLE IF NOT EXISTS public.ejecuciones_facturacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    fecha_ejecucion DATE NOT NULL DEFAULT CURRENT_DATE,
    facturas_generadas INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index para búsquedas rápidas por escuela
CREATE INDEX IF NOT EXISTS ejecuciones_facturacion_escuela_idx ON public.ejecuciones_facturacion(escuela_id);

-- Habilitar RLS en ejecuciones_facturacion
ALTER TABLE public.ejecuciones_facturacion ENABLE ROW LEVEL SECURITY;

-- Política de lectura para usuarios autenticados de la misma escuela
CREATE POLICY ejecuciones_facturacion_select
ON public.ejecuciones_facturacion
FOR SELECT TO authenticated
USING (escuela_id = (SELECT public.current_user_escuela_id()));

GRANT SELECT ON public.ejecuciones_facturacion TO authenticated;

-- 2. Vincular cuentas_cobrar con ejecuciones_facturacion
ALTER TABLE public.cuentas_cobrar
    DROP CONSTRAINT IF EXISTS fk_cuentas_cobrar_ejecucion_facturacion,
    ADD CONSTRAINT fk_cuentas_cobrar_ejecucion_facturacion
    FOREIGN KEY (ejecucion_facturacion_id) REFERENCES public.ejecuciones_facturacion(id) ON DELETE SET NULL;

-- 3. Función auxiliar para verificar si hoy es el día de facturación del alumno
CREATE OR REPLACE FUNCTION public.es_dia_inicio_ciclo_alumno(p_fecha_inicio DATE, p_hoy DATE)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
    v_dia_inicio INTEGER;
    v_ultimo_dia_mes INTEGER;
BEGIN
    IF p_fecha_inicio IS NULL OR p_hoy IS NULL THEN
        RETURN FALSE;
    END IF;
    
    v_dia_inicio := EXTRACT(DAY FROM p_fecha_inicio)::INTEGER;
    -- Último día del mes de p_hoy
    v_ultimo_dia_mes := EXTRACT(DAY FROM (date_trunc('month', p_hoy) + INTERVAL '1 month - 1 day')::date)::INTEGER;
    
    -- Retorna true si el día de hoy es el correspondiente al inicio del ciclo
    -- (O si el alumno inició un día 31 y hoy es 30 de un mes de 30 días, etc.)
    RETURN EXTRACT(DAY FROM p_hoy)::INTEGER = LEAST(v_dia_inicio, v_ultimo_dia_mes);
END;
$$;

GRANT EXECUTE ON FUNCTION public.es_dia_inicio_ciclo_alumno(DATE, DATE) TO authenticated, service_role;

-- 4. Función auxiliar para calcular el rango de fechas del ciclo del alumno
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
DECLARE
    v_dia_inicio INTEGER;
    v_mes_anterior DATE;
    v_dia_anterior INTEGER;
BEGIN
    v_dia_inicio := EXTRACT(DAY FROM p_fecha_inicio)::INTEGER;
    
    IF p_momento = 'adelantado' THEN
        -- El ciclo inicia hoy y corre por 1 mes
        p_ciclo_inicio := p_hoy;
        p_ciclo_fin := (p_hoy + INTERVAL '1 month - 1 day')::date;
    ELSIF p_momento = 'atrasado' THEN
        -- El ciclo acaba de terminar ayer
        p_ciclo_fin := (p_hoy - INTERVAL '1 day')::date;
        -- El ciclo comenzó hace 1 mes
        v_mes_anterior := (p_hoy - INTERVAL '1 month')::date;
        v_dia_anterior := LEAST(v_dia_inicio, EXTRACT(DAY FROM (date_trunc('month', v_mes_anterior) + INTERVAL '1 month - 1 day')::date)::INTEGER);
        p_ciclo_inicio := make_date(EXTRACT(YEAR FROM v_mes_anterior)::INTEGER, EXTRACT(MONTH FROM v_mes_anterior)::INTEGER, v_dia_anterior);
    ELSE
        p_ciclo_inicio := NULL;
        p_ciclo_fin := NULL;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_rango_ciclo_alumno(DATE, DATE, TEXT) TO authenticated, service_role;

-- 5. Función principal que ejecuta la facturación masiva programada (cron job)
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
BEGIN
    -- Iterar por todas las escuelas que tengan la facturación automática configurada y activa
    FOR v_config IN (
        SELECT escuela_id, plan_momento_emision, plan_calculo_monto,
               asistencias_minimo_completo, asistencias_minimo_parcial, porcentaje_monto_parcial
        FROM public.configuracion_facturacion
        WHERE activo = TRUE AND plan_momento_emision IN ('adelantado', 'atrasado')
    ) LOOP
        v_facturas_por_escuela := 0;
        v_ejecucion_id := NULL;

        -- Obtener el catálogo item "Mensualidad" activo de la escuela
        SELECT id INTO v_item_id
        FROM public.catalogo_items
        WHERE escuela_id = v_config.escuela_id
          AND lower(nombre) = 'mensualidad'
          AND activo = TRUE
        LIMIT 1;

        IF v_item_id IS NULL THEN
            -- Si la escuela no tiene mensualidad en catálogo, saltar
            CONTINUE;
        END IF;

        -- Buscar alumnos de la escuela elegibles para facturación automática hoy
        FOR v_alumno IN (
            SELECT id, sucursal_id, mensualidad, fecha_inicio
            FROM public.alumnos
            WHERE escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE
              AND mensualidad IS NOT NULL
              AND mensualidad > 0
              AND fecha_inicio IS NOT NULL
              AND p_hoy >= fecha_inicio
              AND public.es_dia_inicio_ciclo_alumno(fecha_inicio, p_hoy) = TRUE
        ) LOOP
            -- Calcular ciclo
            SELECT p_ciclo_inicio, p_ciclo_fin INTO v_rango
            FROM public.obtener_rango_ciclo_alumno(v_alumno.fecha_inicio, p_hoy, v_config.plan_momento_emision);

            v_periodo := public.calcular_periodo_estadistico(v_rango.p_ciclo_inicio);

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

            -- Calcular monto
            IF v_config.plan_calculo_monto = 'fijo' THEN
                v_monto := v_alumno.mensualidad;
            ELSIF v_config.plan_calculo_monto = 'asistencia' THEN
                -- Obtener asistencias
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
                    -- Sin registros de asistencia, queda para revisión (no se genera factura automática)
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

            -- Crear factura solo si hay monto válido
            IF v_monto IS NOT NULL AND v_monto > 0 THEN
                -- Inicializar el registro de ejecución si es la primera factura de esta escuela hoy
                IF v_ejecucion_id IS NULL THEN
                    INSERT INTO public.ejecuciones_facturacion (escuela_id, fecha_ejecucion, facturas_generadas)
                    VALUES (v_config.escuela_id, p_hoy, 0)
                    RETURNING id INTO v_ejecucion_id;
                END IF;

                -- Crear Nota de Servicio
                INSERT INTO public.cuentas_cobrar (
                    escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                    fecha_emision, fecha_vencimiento, estado, es_anticipo,
                    origen_facturacion, ejecucion_facturacion_id
                ) VALUES (
                    v_config.escuela_id, v_alumno.sucursal_id, v_alumno.id, v_monto, 'Mensualidad',
                    to_char(v_periodo, 'YYYY-MM'), v_periodo, v_rango.p_ciclo_inicio, v_rango.p_ciclo_fin,
                    p_hoy, p_hoy, 'pendiente', FALSE,
                    'automatico', v_ejecucion_id
                ) RETURNING id INTO v_cxc_id;

                -- Crear el detalle de la cuenta por cobrar
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
                    'Ciclo ' || to_char(v_rango.p_ciclo_inicio, 'DD/MM/YYYY') || ' - ' || to_char(v_rango.p_ciclo_fin, 'DD/MM/YYYY')
                );

                v_facturas_por_escuela := v_facturas_por_escuela + 1;
            END IF;
        END LOOP;

        -- Actualizar la cantidad final de facturas generadas en la ejecución de la escuela
        IF v_ejecucion_id IS NOT NULL THEN
            UPDATE public.ejecuciones_facturacion
            SET facturas_generadas = v_facturas_por_escuela
            WHERE id = v_ejecucion_id;
            
            v_resumen := v_resumen || jsonb_build_object(v_config.escuela_id::text, v_facturas_por_escuela);
        END IF;
    END LOOP;

    RETURN v_resumen;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO service_role;

-- 6. Programar pg_cron para ejecutar todas las noches a las 02:00 AM
-- Primero cargamos la extensión si es necesario
CREATE EXTENSION IF NOT EXISTS pg_cron SCHEMA pg_catalog;

-- Desprogramar de forma segura si ya existía
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'facturacion_diaria';

-- Programar nueva ejecución usando el esquema cron directamente
SELECT cron.schedule(
    'facturacion_diaria',
    '0 2 * * *',
    $$SELECT public.rpc_cron_facturacion_diaria()$$
);
