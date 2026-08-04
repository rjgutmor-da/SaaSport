-- Un ingreso directo puede clasificarse como Mensualidad sin pertenecer a un alumno.
-- Las mensualidades asociadas a alumnos conservan la validacion de ciclo y duplicidad.
ALTER TABLE public.cuentas_cobrar
  ADD COLUMN IF NOT EXISTS es_ingreso_directo BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.cuentas_cobrar.es_ingreso_directo IS
  'Marca los ingresos directos de Caja y Bancos que no pertenecen a un alumno.';

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

  -- Los ingresos directos no se asignan a un alumno ni a un ciclo estadistico.
  IF v_alumno_id IS NULL AND v_es_ingreso_directo IS TRUE THEN
    NEW.ciclo_inicio := NULL;
    NEW.ciclo_fin := NULL;
    NEW.periodo_estadistico := NULL;
    RETURN NEW;
  END IF;

  IF v_alumno_id IS NULL THEN
    RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida del alumno.';
  END IF;

  -- Si es una cuenta de anticipo (desglose de consumo), no asigna ciclos ni valida duplicidad de periodo
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
      JOIN public.cuentas_cobrar cc ON cc.id = otro.cuenta_cobrar_id
      JOIN public.catalogo_items ci ON ci.id = otro.catalogo_item_id
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
          OR (cc.periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.cxc_detalle migrado
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
