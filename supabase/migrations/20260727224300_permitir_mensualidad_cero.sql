-- Permite cerrar un ciclo de Mensualidad en Bs 0 sin dejar una deuda pendiente.
-- La nota sigue participando de la restricción por alumno/período para evitar duplicados.
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

    IF p_monto_total < 0 OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
        RAISE EXCEPTION 'La nota no contiene lineas validas.';
    END IF;
    v_lineas_esperadas := jsonb_array_length(p_lineas);

    -- Bs 0 se reserva exclusivamente para una línea real de Mensualidad.
    IF p_monto_total = 0 AND NOT EXISTS (
        SELECT 1
        FROM jsonb_to_recordset(p_lineas) AS l(catalogo_item_id UUID, precio_unitario NUMERIC)
        JOIN public.catalogo_items ci
          ON ci.id = l.catalogo_item_id AND ci.escuela_id = v_escuela_id
        WHERE lower(btrim(ci.nombre)) = 'mensualidad'
          AND l.precio_unitario = 0
    ) THEN
        RAISE EXCEPTION 'Solo se permite registrar Bs 0 para el concepto Mensualidad.';
    END IF;

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
        p_fecha_emision, p_fecha_vencimiento,
        CASE WHEN p_monto_total = 0 THEN 'pagada' ELSE 'pendiente' END,
        p_nro_recibo, FALSE, 'manual'
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
