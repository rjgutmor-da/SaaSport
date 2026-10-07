-- Migración: Fix periodo estadístico para prorrateos y ciclos en el mismo mes
-- Problema: calcular_periodo_estadistico sólo evaluaba el día de inicio (> 16).
-- Si un alumno tenía un prorrateo de fin de mes (ej. 23/07 al 31/07), se asignaba al mes siguiente (Agosto),
-- consumiendo indebidamente el período estadístico y bloqueando la mensualidad regular del mes siguiente.
-- Solución: Si ciclo_inicio y ciclo_fin caen en el mismo mes calendario, el período estadístico pertenece a ese mismo mes.

-- 1. Reemplazar función calcular_periodo_estadistico con soporte para fecha_fin
DROP FUNCTION IF EXISTS public.calcular_periodo_estadistico(DATE);

CREATE OR REPLACE FUNCTION public.calcular_periodo_estadistico(p_fecha_inicio DATE, p_fecha_fin DATE DEFAULT NULL)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_fecha_inicio IS NULL THEN NULL
        WHEN p_fecha_fin IS NOT NULL AND date_trunc('month', p_fecha_inicio) = date_trunc('month', p_fecha_fin)
            THEN date_trunc('month', p_fecha_inicio)::date
        WHEN EXTRACT(DAY FROM p_fecha_inicio) <= 16
            THEN date_trunc('month', p_fecha_inicio)::date
        ELSE (date_trunc('month', p_fecha_inicio) + INTERVAL '1 month')::date
    END;
$$;

-- 2. Actualizar trigger validar_ciclo_mensualidad_detalle
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
  v_es_ingreso_directo BOOLEAN;
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

  SELECT cc.alumno_id, cc.anulada, cc.es_anticipo, cc.es_ingreso_directo,
         cc.ciclo_inicio, cc.ciclo_fin
  INTO v_alumno_id, v_nota_anulada, v_es_anticipo, v_es_ingreso_directo,
       v_ciclo_inicio_nota, v_ciclo_fin_nota
  FROM public.cuentas_cobrar cc
  WHERE cc.id = NEW.cuenta_cobrar_id
    AND cc.escuela_id = NEW.escuela_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida.';
  END IF;

  IF v_alumno_id IS NULL AND v_es_ingreso_directo IS TRUE THEN
    NEW.ciclo_inicio := NULL;
    NEW.ciclo_fin := NULL;
    NEW.periodo_estadistico := NULL;
    RETURN NEW;
  END IF;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida del alumno.';
  END IF;

  IF v_es_anticipo IS TRUE THEN
    NEW.ciclo_inicio := NULL;
    NEW.ciclo_fin := NULL;
    NEW.periodo_estadistico := NULL;
    RETURN NEW;
  END IF;

  NEW.ciclo_inicio := COALESCE(NEW.ciclo_inicio, v_ciclo_inicio_nota);
  NEW.ciclo_fin := COALESCE(NEW.ciclo_fin, v_ciclo_fin_nota);

  IF NEW.ciclo_inicio IS NULL
     OR NEW.ciclo_fin IS NULL
     OR NEW.ciclo_fin < NEW.ciclo_inicio THEN
    RAISE EXCEPTION 'Cada mensualidad debe tener un ciclo valido.';
  END IF;

  v_periodo := public.calcular_periodo_estadistico(NEW.ciclo_inicio, NEW.ciclo_fin);
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
