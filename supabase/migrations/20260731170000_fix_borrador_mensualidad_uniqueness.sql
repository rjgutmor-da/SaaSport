-- Migration: Fix borrador status conflict when creating manual monthly fees
-- Reason: Automatic billing inserts draft notes (estado = 'borrador') which previously blocked manual creation of monthly fees.

-- 1. Recrear el índice único en cuentas_cobrar excluyendo las notas en estado 'borrador'
DROP INDEX IF EXISTS public.cuentas_cobrar_mensualidad_periodo_activo_key;

CREATE UNIQUE INDEX cuentas_cobrar_mensualidad_periodo_activo_key 
ON public.cuentas_cobrar (escuela_id, alumno_id, periodo_estadistico) 
WHERE (
  periodo_estadistico IS NOT NULL 
  AND alumno_id IS NOT NULL 
  AND (anulada IS NOT TRUE) 
  AND (es_anticipo IS NOT TRUE)
  AND (estado <> 'borrador')
);

-- 2. Actualizar función trigger validar_ciclo_mensualidad_detalle para excluir 'borrador'
CREATE OR REPLACE FUNCTION public.validar_ciclo_mensualidad_detalle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_nombre_item TEXT;
  v_alumno_id UUID;
  v_nota_anulada BOOLEAN;
  v_es_anticipo BOOLEAN;
  v_ciclo_inicio_nota DATE;
  v_ciclo_fin_nota DATE;
  v_periodo DATE;
BEGIN
  SELECT lower(btrim(ci.nombre))
  INTO v_nombre_item
  FROM public.catalogo_items ci
  WHERE ci.id = NEW.catalogo_item_id
    AND ci.escuela_id = NEW.escuela_id;

  IF v_nombre_item IS DISTINCT FROM 'mensualidad' THEN
    IF NEW.ciclo_inicio IS NOT NULL
       OR NEW.ciclo_fin IS NOT NULL
       OR NEW.periodo_estadistico IS NOT NULL THEN
      RAISE EXCEPTION 'Solo una linea de Mensualidad puede tener ciclo.';
    END IF;
    RETURN NEW;
  END IF;

  SELECT cc.alumno_id, cc.anulada, cc.es_anticipo,
         cc.ciclo_inicio, cc.ciclo_fin
  INTO v_alumno_id, v_nota_anulada, v_es_anticipo,
       v_ciclo_inicio_nota, v_ciclo_fin_nota
  FROM public.cuentas_cobrar cc
  WHERE cc.id = NEW.cuenta_cobrar_id
    AND cc.escuela_id = NEW.escuela_id;

  IF NOT FOUND OR v_alumno_id IS NULL OR v_es_anticipo IS TRUE THEN
    RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida del alumno.';
  END IF;

  NEW.ciclo_inicio := COALESCE(NEW.ciclo_inicio, v_ciclo_inicio_nota);
  NEW.ciclo_fin := COALESCE(NEW.ciclo_fin, v_ciclo_fin_nota);

  IF NEW.ciclo_inicio IS NULL
     OR NEW.ciclo_fin IS NULL
     OR NEW.ciclo_fin < NEW.ciclo_inicio THEN
    RAISE EXCEPTION 'Cada mensualidad debe tener un ciclo valido.';
  END IF;

  v_periodo := public.calcular_periodo_estadistico(NEW.ciclo_inicio);
  NEW.periodo_estadistico := v_periodo;

  IF v_nota_anulada IS NOT TRUE THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW.escuela_id::TEXT || ':' || v_alumno_id::TEXT || ':' || v_periodo::TEXT,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.cxc_detalle otro
      JOIN public.cuentas_cobrar cc
        ON cc.id = otro.cuenta_cobrar_id
      JOIN public.catalogo_items ci
        ON ci.id = otro.catalogo_item_id
      WHERE otro.escuela_id = NEW.escuela_id
        AND cc.alumno_id = v_alumno_id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado <> 'borrador'
        AND lower(btrim(ci.nombre)) = 'mensualidad'
        AND otro.periodo_estadistico = v_periodo
        AND otro.id IS DISTINCT FROM NEW.id
    ) OR EXISTS (
      SELECT 1
      FROM public.cuentas_cobrar cc
      WHERE cc.escuela_id = NEW.escuela_id
        AND cc.alumno_id = v_alumno_id
        AND cc.id <> NEW.cuenta_cobrar_id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado <> 'borrador'
        AND (
          cc.periodo_estadistico = v_periodo
          OR (
            cc.periodo_estadistico IS NULL
            AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo)
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.cxc_detalle migrado
          WHERE migrado.cuenta_cobrar_id = cc.id
            AND migrado.periodo_estadistico IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Ya existe una mensualidad activa para el alumno y periodo.';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. Actualizar función trigger validar_reactivacion_periodos_mensualidad para excluir 'borrador'
CREATE OR REPLACE FUNCTION public.validar_reactivacion_periodos_mensualidad()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_detalle RECORD;
BEGIN
  IF NEW.anulada IS TRUE OR NEW.es_anticipo IS TRUE OR NEW.alumno_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.anulada IS NOT DISTINCT FROM NEW.anulada
     AND OLD.alumno_id IS NOT DISTINCT FROM NEW.alumno_id
     AND OLD.escuela_id IS NOT DISTINCT FROM NEW.escuela_id THEN
    RETURN NEW;
  END IF;

  FOR v_detalle IN
    SELECT d.periodo_estadistico
    FROM public.cxc_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_cobrar_id = NEW.id
      AND d.periodo_estadistico IS NOT NULL
      AND lower(btrim(ci.nombre)) = 'mensualidad'
    ORDER BY d.periodo_estadistico
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        NEW.escuela_id::TEXT || ':' || NEW.alumno_id::TEXT || ':' || v_detalle.periodo_estadistico::TEXT,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.cxc_detalle otro
      JOIN public.cuentas_cobrar cc ON cc.id = otro.cuenta_cobrar_id
      JOIN public.catalogo_items ci ON ci.id = otro.catalogo_item_id
      WHERE cc.id <> NEW.id
        AND cc.escuela_id = NEW.escuela_id
        AND cc.alumno_id = NEW.alumno_id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado <> 'borrador'
        AND lower(btrim(ci.nombre)) = 'mensualidad'
        AND otro.periodo_estadistico = v_detalle.periodo_estadistico
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Ya existe una mensualidad activa para el alumno y periodo.';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 4. Actualizar RPC rpc_crear_nota_mensualidad para limpiar borradores automáticos al crear nota manual
CREATE OR REPLACE FUNCTION public.rpc_crear_nota_mensualidad(
    p_alumno_id uuid,
    p_sucursal_id uuid,
    p_monto_total numeric,
    p_descripcion text,
    p_observaciones text,
    p_fecha_emision date,
    p_fecha_vencimiento date,
    p_ciclo_inicio date,
    p_ciclo_fin date,
    p_lineas jsonb,
    p_nro_recibo text DEFAULT NULL::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_escuela_id UUID := (SELECT public.current_user_escuela_id());
  v_nota_id UUID;
  v_linea JSONB;
  v_lineas_normalizadas JSONB := '[]'::JSONB;
  v_item_nombre TEXT;
  v_cantidad INTEGER;
  v_precio NUMERIC;
  v_suma NUMERIC := 0;
  v_ciclo_inicio DATE;
  v_ciclo_fin DATE;
  v_periodo DATE;
  v_periodos DATE[] := ARRAY[]::DATE[];
  v_mensualidades INTEGER := 0;
  v_primera_fecha_inicio DATE;
  v_primera_fecha_fin DATE;
  v_primera_fecha_periodo DATE;
  v_lineas_insertadas INTEGER;
BEGIN
  IF v_escuela_id IS NULL OR NOT COALESCE(
    (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador', 'Asistente'),
    FALSE
  ) THEN
    RAISE EXCEPTION 'No autorizado para crear la mensualidad.';
  END IF;

  IF jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) = 0 THEN
    RAISE EXCEPTION 'La nota no contiene lineas validas.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.alumnos a
    WHERE a.id = p_alumno_id
      AND a.escuela_id = v_escuela_id
  ) THEN
    RAISE EXCEPTION 'El alumno no pertenece a la escuela.';
  END IF;

  FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas)
  LOOP
    SELECT lower(btrim(ci.nombre))
    INTO v_item_nombre
    FROM public.catalogo_items ci
    WHERE ci.id = (v_linea->>'catalogo_item_id')::UUID
      AND ci.escuela_id = v_escuela_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Una o mas lineas no pertenecen al catalogo de la escuela.';
    END IF;

    v_cantidad := COALESCE((v_linea->>'cantidad')::INTEGER, 0);
    v_precio := COALESCE((v_linea->>'precio_unitario')::NUMERIC, -1);

    IF v_cantidad <= 0 OR v_precio < 0 THEN
      RAISE EXCEPTION 'La nota contiene cantidades o precios invalidos.';
    END IF;

    IF v_item_nombre = 'mensualidad' THEN
      v_mensualidades := v_mensualidades + 1;
      v_ciclo_inicio := COALESCE(
        NULLIF(v_linea->>'ciclo_inicio', '')::DATE,
        p_ciclo_inicio
      );
      v_ciclo_fin := COALESCE(
        NULLIF(v_linea->>'ciclo_fin', '')::DATE,
        p_ciclo_fin
      );

      IF v_ciclo_inicio IS NULL OR v_ciclo_fin IS NULL OR v_ciclo_fin < v_ciclo_inicio THEN
        RAISE EXCEPTION 'Cada mensualidad debe tener un ciclo valido.';
      END IF;

      v_periodo := public.calcular_periodo_estadistico(v_ciclo_inicio);
      IF v_periodo = ANY(v_periodos) THEN
        RAISE EXCEPTION 'Las mensualidades de una nota deben tener ciclos distintos.';
      END IF;
      v_periodos := array_append(v_periodos, v_periodo);

      IF v_mensualidades = 1 THEN
        v_primera_fecha_inicio := v_ciclo_inicio;
        v_primera_fecha_fin := v_ciclo_fin;
        v_primera_fecha_periodo := v_periodo;
      END IF;

      v_linea := v_linea || jsonb_build_object(
        'ciclo_inicio', v_ciclo_inicio,
        'ciclo_fin', v_ciclo_fin,
        'periodo_estadistico', v_periodo
      );
    ELSE
      IF v_precio = 0 THEN
        RAISE EXCEPTION 'Solo se permite registrar Bs 0 para el concepto Mensualidad.';
      END IF;
      v_linea := v_linea || jsonb_build_object(
        'ciclo_inicio', NULL,
        'ciclo_fin', NULL,
        'periodo_estadistico', NULL
      );
    END IF;

    v_suma := v_suma + (v_cantidad * v_precio);
    v_lineas_normalizadas := v_lineas_normalizadas || jsonb_build_array(v_linea);
  END LOOP;

  IF v_mensualidades = 0 THEN
    RAISE EXCEPTION 'La nota no contiene una linea de Mensualidad.';
  END IF;

  IF p_monto_total < 0 OR round(v_suma, 2) <> round(p_monto_total, 2) THEN
    RAISE EXCEPTION 'El total de la nota no coincide con sus lineas.';
  END IF;

  v_periodos := ARRAY(SELECT unnest(v_periodos) ORDER BY 1);

  FOREACH v_periodo IN ARRAY v_periodos
  LOOP
    PERFORM pg_advisory_xact_lock(
      hashtextextended(
        v_escuela_id::TEXT || ':' || p_alumno_id::TEXT || ':' || v_periodo::TEXT,
        0
      )
    );

    IF EXISTS (
      SELECT 1
      FROM public.cxc_detalle d
      JOIN public.cuentas_cobrar cc ON cc.id = d.cuenta_cobrar_id
      JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE cc.escuela_id = v_escuela_id
        AND cc.alumno_id = p_alumno_id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado <> 'borrador'
        AND lower(btrim(ci.nombre)) = 'mensualidad'
        AND d.periodo_estadistico = v_periodo
    ) OR EXISTS (
      SELECT 1
      FROM public.cuentas_cobrar cc
      WHERE cc.escuela_id = v_escuela_id
        AND cc.alumno_id = p_alumno_id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado <> 'borrador'
        AND (
          cc.periodo_estadistico = v_periodo
          OR (
            cc.periodo_estadistico IS NULL
            AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo)
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.cxc_detalle migrado
          WHERE migrado.cuenta_cobrar_id = cc.id
            AND migrado.periodo_estadistico IS NOT NULL
        )
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23505',
        MESSAGE = 'Ya existe una mensualidad activa para el alumno y periodo.';
    END IF;

    -- Limpiar borradores automáticos para este alumno y período
    DELETE FROM public.cxc_detalle
    WHERE cuenta_cobrar_id IN (
      SELECT id FROM public.cuentas_cobrar
      WHERE escuela_id = v_escuela_id
        AND alumno_id = p_alumno_id
        AND estado = 'borrador'
        AND (
          periodo_estadistico = v_periodo
          OR (periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(id, v_periodo))
        )
    );

    DELETE FROM public.cuentas_cobrar
    WHERE escuela_id = v_escuela_id
      AND alumno_id = p_alumno_id
      AND estado = 'borrador'
      AND (
        periodo_estadistico = v_periodo
        OR (periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(id, v_periodo))
      );
  END LOOP;

  INSERT INTO public.cuentas_cobrar (
    escuela_id, sucursal_id, alumno_id, monto_total, descripcion, observaciones,
    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
    fecha_emision, fecha_vencimiento, estado, nro_recibo,
    es_anticipo, origen_facturacion
  ) VALUES (
    v_escuela_id, p_sucursal_id, p_alumno_id, p_monto_total, p_descripcion, p_observaciones,
    CASE WHEN v_mensualidades = 1 THEN to_char(v_primera_fecha_periodo, 'YYYY-MM') ELSE NULL END,
    CASE WHEN v_mensualidades = 1 THEN v_primera_fecha_periodo ELSE NULL END,
    CASE WHEN v_mensualidades = 1 THEN v_primera_fecha_inicio ELSE NULL END,
    CASE WHEN v_mensualidades = 1 THEN v_primera_fecha_fin ELSE NULL END,
    p_fecha_emision, p_fecha_vencimiento,
    CASE WHEN p_monto_total = 0 THEN 'pagada' ELSE 'pendiente' END,
    p_nro_recibo, FALSE, 'manual'
  )
  RETURNING id INTO v_nota_id;

  INSERT INTO public.cxc_detalle (
    escuela_id, cuenta_cobrar_id, catalogo_item_id,
    cantidad, precio_unitario, periodo_meses, detalle_extra,
    ciclo_inicio, ciclo_fin, periodo_estadistico
  )
  SELECT v_escuela_id, v_nota_id, l.catalogo_item_id,
         l.cantidad, l.precio_unitario, l.periodo_meses, l.detalle_extra,
         l.ciclo_inicio, l.ciclo_fin, l.periodo_estadistico
  FROM jsonb_to_recordset(v_lineas_normalizadas) AS l(
    catalogo_item_id UUID,
    cantidad INTEGER,
    precio_unitario NUMERIC,
    periodo_meses JSONB,
    detalle_extra TEXT,
    ciclo_inicio DATE,
    ciclo_fin DATE,
    periodo_estadistico DATE
  );

  GET DIAGNOSTICS v_lineas_insertadas = ROW_COUNT;
  IF v_lineas_insertadas <> jsonb_array_length(v_lineas_normalizadas) THEN
    RAISE EXCEPTION 'No se pudieron guardar todas las lineas de la nota.';
  END IF;

  RETURN v_nota_id;
END;
$function$;
