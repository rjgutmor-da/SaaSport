-- Planes de facturacion, periodo estadistico canonico e idempotencia.
-- No programa ningun cron: el despliegue y la activacion se realizan por separado.

CREATE TABLE public.configuracion_facturacion (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    plan_momento_emision TEXT NOT NULL DEFAULT 'manual',
    plan_calculo_monto TEXT NOT NULL DEFAULT 'manual',
    asistencias_minimo_completo INTEGER,
    asistencias_minimo_parcial INTEGER,
    porcentaje_monto_parcial NUMERIC(5,2) NOT NULL DEFAULT 50.00,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT configuracion_facturacion_escuela_key UNIQUE (escuela_id),
    CONSTRAINT configuracion_facturacion_momento_check
        CHECK (plan_momento_emision IN ('manual', 'adelantado', 'atrasado')),
    CONSTRAINT configuracion_facturacion_calculo_check
        CHECK (plan_calculo_monto IN ('manual', 'fijo', 'asistencia')),
    CONSTRAINT configuracion_facturacion_porcentaje_check
        CHECK (porcentaje_monto_parcial BETWEEN 0 AND 100),
    CONSTRAINT configuracion_facturacion_asistencias_check CHECK (
        (plan_calculo_monto = 'asistencia'
            AND asistencias_minimo_completo IS NOT NULL
            AND asistencias_minimo_parcial IS NOT NULL
            AND asistencias_minimo_completo > asistencias_minimo_parcial
            AND asistencias_minimo_parcial >= 0)
        OR
        (plan_calculo_monto <> 'asistencia'
            AND asistencias_minimo_completo IS NULL
            AND asistencias_minimo_parcial IS NULL)
    ),
    CONSTRAINT configuracion_facturacion_adelantado_asistencia_check
        CHECK (NOT (plan_momento_emision = 'adelantado' AND plan_calculo_monto = 'asistencia'))
);

COMMENT ON TABLE public.configuracion_facturacion IS
    'Configuracion unica de emision y calculo de mensualidades por escuela.';

ALTER TABLE public.configuracion_facturacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY configuracion_facturacion_select
ON public.configuracion_facturacion
FOR SELECT TO authenticated
USING (escuela_id = (SELECT public.current_user_escuela_id()));

CREATE POLICY configuracion_facturacion_insert
ON public.configuracion_facturacion
FOR INSERT TO authenticated
WITH CHECK (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador')
);

CREATE POLICY configuracion_facturacion_update
ON public.configuracion_facturacion
FOR UPDATE TO authenticated
USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador')
)
WITH CHECK (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador')
);

GRANT SELECT, INSERT, UPDATE ON public.configuracion_facturacion TO authenticated;

CREATE OR REPLACE FUNCTION public.set_configuracion_facturacion_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
    NEW.updated_at := now();
    NEW.updated_by := (SELECT auth.uid());
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.set_configuracion_facturacion_updated_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER configuracion_facturacion_updated_at
BEFORE UPDATE ON public.configuracion_facturacion
FOR EACH ROW EXECUTE FUNCTION public.set_configuracion_facturacion_updated_at();

ALTER TABLE public.cuentas_cobrar
    ADD COLUMN periodo_estadistico DATE,
    ADD COLUMN ciclo_inicio DATE,
    ADD COLUMN ciclo_fin DATE,
    ADD COLUMN origen_facturacion TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN ejecucion_facturacion_id UUID;

ALTER TABLE public.cuentas_cobrar
    ADD CONSTRAINT cuentas_cobrar_periodo_primer_dia_check
        CHECK (periodo_estadistico IS NULL OR periodo_estadistico = date_trunc('month', periodo_estadistico)::date),
    ADD CONSTRAINT cuentas_cobrar_ciclo_check
        CHECK (
            (ciclo_inicio IS NULL AND ciclo_fin IS NULL AND periodo_estadistico IS NULL)
            OR
            (ciclo_inicio IS NOT NULL AND ciclo_fin IS NOT NULL
                AND periodo_estadistico IS NOT NULL AND ciclo_fin >= ciclo_inicio)
        ),
    ADD CONSTRAINT cuentas_cobrar_origen_facturacion_check
        CHECK (origen_facturacion IN ('manual', 'automatico'));

-- Backfill conservador: solo notas no anuladas con una unica mensualidad y un
-- unico mes reconocible. En duplicados historicos se canoniza solo la primera
-- nota; las demas quedan sin periodo para no alterar su historial financiero.
WITH meses_unicos AS (
    SELECT DISTINCT cc.id, cc.escuela_id, cc.alumno_id,
           CASE lower(left(cd.periodo_meses ->> 0, 3))
               WHEN 'ene' THEN 1 WHEN 'feb' THEN 2 WHEN 'mar' THEN 3
               WHEN 'abr' THEN 4 WHEN 'may' THEN 5 WHEN 'jun' THEN 6
               WHEN 'jul' THEN 7 WHEN 'ago' THEN 8 WHEN 'sep' THEN 9
               WHEN 'oct' THEN 10 WHEN 'nov' THEN 11 WHEN 'dic' THEN 12
           END AS mes_numero,
           CASE
               WHEN (cd.periodo_meses ->> 0) ~ '-[0-9]{4}$'
                   THEN right(cd.periodo_meses ->> 0, 4)::INTEGER
               ELSE EXTRACT(YEAR FROM cc.fecha_emision)::INTEGER
           END AS anio
    FROM public.cuentas_cobrar cc
    JOIN public.cxc_detalle cd ON cd.cuenta_cobrar_id = cc.id
    JOIN public.catalogo_items ci ON ci.id = cd.catalogo_item_id
    WHERE cc.anulada IS NOT TRUE
      AND cc.es_anticipo IS NOT TRUE
      AND cc.alumno_id IS NOT NULL
      AND lower(ci.nombre) = 'mensualidad'
      AND jsonb_typeof(cd.periodo_meses) = 'array'
      AND jsonb_array_length(cd.periodo_meses) = 1
), candidatos AS (
    SELECT id, escuela_id, alumno_id, make_date(anio, mes_numero, 1) AS periodo
    FROM meses_unicos
    WHERE mes_numero IS NOT NULL AND anio BETWEEN 2000 AND 2100
), priorizados AS (
    SELECT c.*,
           row_number() OVER (
               PARTITION BY escuela_id, alumno_id, periodo ORDER BY id
           ) AS prioridad
    FROM candidatos c
)
UPDATE public.cuentas_cobrar cc
SET periodo_estadistico = p.periodo,
    periodo = to_char(p.periodo, 'YYYY-MM'),
    ciclo_inicio = p.periodo,
    ciclo_fin = (p.periodo + INTERVAL '1 month - 1 day')::date
FROM priorizados p
WHERE cc.id = p.id AND p.prioridad = 1;

CREATE UNIQUE INDEX cuentas_cobrar_mensualidad_periodo_activo_key
ON public.cuentas_cobrar (escuela_id, alumno_id, periodo_estadistico)
WHERE periodo_estadistico IS NOT NULL
  AND alumno_id IS NOT NULL
  AND anulada IS NOT TRUE
  AND es_anticipo IS NOT TRUE;

CREATE INDEX cuentas_cobrar_ejecucion_facturacion_idx
ON public.cuentas_cobrar (ejecucion_facturacion_id)
WHERE ejecucion_facturacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.calcular_periodo_estadistico(p_fecha_inicio DATE)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN EXTRACT(DAY FROM p_fecha_inicio) <= 16
            THEN date_trunc('month', p_fecha_inicio)::date
        ELSE (date_trunc('month', p_fecha_inicio) + INTERVAL '1 month')::date
    END;
$$;

REVOKE ALL ON FUNCTION public.calcular_periodo_estadistico(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calcular_periodo_estadistico(DATE) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cxc_legacy_cubre_periodo(
    p_cuenta_cobrar_id UUID,
    p_periodo DATE
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.cuentas_cobrar cc
        JOIN public.cxc_detalle cd ON cd.cuenta_cobrar_id = cc.id
        JOIN public.catalogo_items ci ON ci.id = cd.catalogo_item_id
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(cd.periodo_meses, '[]'::jsonb)) mes(valor)
        WHERE cc.id = p_cuenta_cobrar_id
          AND lower(ci.nombre) = 'mensualidad'
          AND lower(left(mes.valor, 3)) =
              (ARRAY['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])
                  [EXTRACT(MONTH FROM p_periodo)::INTEGER]
          AND CASE
              WHEN mes.valor ~ '-[0-9]{4}$' THEN right(mes.valor, 4)::INTEGER
              ELSE EXTRACT(YEAR FROM cc.fecha_emision)::INTEGER
          END = EXTRACT(YEAR FROM p_periodo)::INTEGER
    );
$$;

REVOKE ALL ON FUNCTION public.cxc_legacy_cubre_periodo(UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cxc_legacy_cubre_periodo(UUID, DATE)
TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_crear_nota_mensualidad(
    p_alumno_id UUID,
    p_sucursal_id UUID,
    p_monto_total NUMERIC,
    p_descripcion TEXT,
    p_observaciones TEXT,
    p_fecha_emision DATE,
    p_fecha_vencimiento DATE,
    p_ciclo_inicio DATE,
    p_ciclo_fin DATE,
    p_lineas JSONB,
    p_nro_recibo TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_escuela_id UUID := (SELECT public.current_user_escuela_id());
    v_periodo DATE;
    v_nota_id UUID;
    v_lineas_esperadas INTEGER;
    v_lineas_insertadas INTEGER;
BEGIN
    IF v_escuela_id IS NULL OR NOT COALESCE(
        (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador', 'Asistente'),
        FALSE
    ) THEN
        RAISE EXCEPTION 'No autorizado para crear la mensualidad.';
    END IF;

    IF p_ciclo_inicio IS NULL OR p_ciclo_fin IS NULL OR p_ciclo_fin < p_ciclo_inicio THEN
        RAISE EXCEPTION 'El rango del ciclo no es valido.';
    END IF;

    IF p_monto_total <= 0 OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RAISE EXCEPTION 'La nota no contiene lineas validas.';
    END IF;
    v_lineas_esperadas := jsonb_array_length(p_lineas);

    IF NOT EXISTS (
        SELECT 1 FROM public.alumnos a
        WHERE a.id = p_alumno_id AND a.escuela_id = v_escuela_id
    ) THEN
        RAISE EXCEPTION 'El alumno no pertenece a la escuela.';
    END IF;

    v_periodo := public.calcular_periodo_estadistico(p_ciclo_inicio);

    IF EXISTS (
        SELECT 1 FROM public.cuentas_cobrar cc
        WHERE cc.escuela_id = v_escuela_id
          AND cc.alumno_id = p_alumno_id
          AND cc.anulada IS NOT TRUE
          AND cc.es_anticipo IS NOT TRUE
          AND (
              cc.periodo_estadistico = v_periodo
              OR (cc.periodo_estadistico IS NULL
                  AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo))
          )
    ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23505',
            MESSAGE = 'Ya existe una mensualidad activa para el alumno y periodo.';
    END IF;

    INSERT INTO public.cuentas_cobrar (
        escuela_id, sucursal_id, alumno_id, monto_total, descripcion, observaciones,
        periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
        fecha_emision, fecha_vencimiento, estado, nro_recibo,
        es_anticipo, origen_facturacion
    ) VALUES (
        v_escuela_id, p_sucursal_id, p_alumno_id, p_monto_total, p_descripcion, p_observaciones,
        to_char(v_periodo, 'YYYY-MM'), v_periodo, p_ciclo_inicio, p_ciclo_fin,
        p_fecha_emision, p_fecha_vencimiento, 'pendiente', p_nro_recibo,
        FALSE, 'manual'
    ) RETURNING id INTO v_nota_id;

    INSERT INTO public.cxc_detalle (
        escuela_id, cuenta_cobrar_id, catalogo_item_id,
        cantidad, precio_unitario, periodo_meses, detalle_extra
    )
    SELECT v_escuela_id, v_nota_id, l.catalogo_item_id,
           l.cantidad, l.precio_unitario, l.periodo_meses, l.detalle_extra
    FROM jsonb_to_recordset(p_lineas) AS l(
        catalogo_item_id UUID,
        cantidad INTEGER,
        precio_unitario NUMERIC,
        periodo_meses JSONB,
        detalle_extra TEXT
    )
    JOIN public.catalogo_items ci
      ON ci.id = l.catalogo_item_id AND ci.escuela_id = v_escuela_id;

    GET DIAGNOSTICS v_lineas_insertadas = ROW_COUNT;
    IF v_lineas_insertadas <> v_lineas_esperadas THEN
        RAISE EXCEPTION 'Una o mas lineas no pertenecen al catalogo de la escuela.';
    END IF;

    RETURN v_nota_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_crear_nota_mensualidad(
    UUID, UUID, NUMERIC, TEXT, TEXT, DATE, DATE, DATE, DATE, JSONB, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_crear_nota_mensualidad(
    UUID, UUID, NUMERIC, TEXT, TEXT, DATE, DATE, DATE, DATE, JSONB, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_calcular_mensualidad_alumno(
    p_alumno_id UUID,
    p_ciclo_inicio DATE,
    p_ciclo_fin DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = ''
AS $$
DECLARE
    v_escuela_id UUID := (SELECT public.current_user_escuela_id());
    v_config public.configuracion_facturacion%ROWTYPE;
    v_mensualidad NUMERIC;
    v_registros INTEGER;
    v_presentes INTEGER;
    v_monto NUMERIC;
BEGIN
    IF v_escuela_id IS NULL OR p_ciclo_inicio IS NULL OR p_ciclo_fin IS NULL
       OR p_ciclo_fin < p_ciclo_inicio THEN
        RAISE EXCEPTION 'Datos de calculo no validos.';
    END IF;

    SELECT mensualidad INTO v_mensualidad
    FROM public.alumnos
    WHERE id = p_alumno_id AND escuela_id = v_escuela_id AND archivado IS NOT TRUE;

    IF v_mensualidad IS NULL OR v_mensualidad <= 0 THEN
        RAISE EXCEPTION 'El alumno no tiene una mensualidad valida en su ficha.';
    END IF;

    SELECT * INTO v_config
    FROM public.configuracion_facturacion
    WHERE escuela_id = v_escuela_id AND activo = TRUE;

    IF NOT FOUND OR v_config.plan_calculo_monto <> 'asistencia' THEN
        RAISE EXCEPTION 'La escuela no tiene activo el calculo por asistencia.';
    END IF;

    SELECT count(*)::INTEGER,
           count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER
    INTO v_registros, v_presentes
    FROM (
        SELECT estado FROM public.asistencias_normales
        WHERE alumno_id = p_alumno_id
          AND fecha >= p_ciclo_inicio AND fecha <= p_ciclo_fin
        UNION ALL
        SELECT estado FROM public.asistencias_arqueros
        WHERE alumno_id = p_alumno_id
          AND fecha >= p_ciclo_inicio AND fecha <= p_ciclo_fin
    ) x;

    IF v_registros = 0 THEN
        RETURN jsonb_build_object(
            'estado', 'sin_asistencia', 'registros', 0, 'presentes', 0,
            'monto', NULL, 'mensualidad_base', v_mensualidad
        );
    END IF;

    v_monto := round(CASE
        WHEN v_presentes >= v_config.asistencias_minimo_completo THEN v_mensualidad
        WHEN v_presentes >= v_config.asistencias_minimo_parcial
            THEN v_mensualidad * v_config.porcentaje_monto_parcial / 100
        ELSE 0
    END, 2);

    RETURN jsonb_build_object(
        'estado', CASE
            WHEN v_presentes >= v_config.asistencias_minimo_completo THEN 'completo'
            WHEN v_presentes >= v_config.asistencias_minimo_parcial THEN 'parcial'
            ELSE 'sin_cobro'
        END,
        'registros', v_registros,
        'presentes', v_presentes,
        'monto', v_monto,
        'mensualidad_base', v_mensualidad,
        'porcentaje_parcial', v_config.porcentaje_monto_parcial
    );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_calcular_mensualidad_alumno(UUID, DATE, DATE)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_calcular_mensualidad_alumno(UUID, DATE, DATE)
TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_generar_facturacion_ciclo(
    p_ciclo_inicio DATE,
    p_ciclo_fin DATE,
    p_solo_simular BOOLEAN DEFAULT TRUE,
    p_ejecucion_id UUID DEFAULT gen_random_uuid(),
    p_escuela_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
    v_escuela_usuario UUID := (SELECT public.current_user_escuela_id());
    v_escuela_id UUID := COALESCE(p_escuela_id, v_escuela_usuario);
    v_rol TEXT := (SELECT public.current_user_rol());
    v_es_service_role BOOLEAN := COALESCE(
        current_setting('request.jwt.claim.role', TRUE) = 'service_role',
        FALSE
    );
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
$$;

REVOKE ALL ON FUNCTION public.rpc_generar_facturacion_ciclo(DATE, DATE, BOOLEAN, UUID, UUID)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_generar_facturacion_ciclo(DATE, DATE, BOOLEAN, UUID, UUID)
TO authenticated, service_role;
