-- "Ult. Mes." representa el periodo facturado, no la fecha en que termina el ciclo.
-- Conserva los respaldos para notas históricas que todavía no tienen periodo_estadistico.
DO $$
DECLARE
  v_definicion text;
  v_origen CONSTANT text :=
    'COALESCE(to_char(cd.ciclo_fin, ''YYYY-MM''), cd.periodo_meses ->> -1) AS ultima_mensualidad';
  v_destino CONSTANT text :=
    'COALESCE(to_char(cd.periodo_estadistico, ''YYYY-MM''), to_char(cc.periodo_estadistico, ''YYYY-MM''), to_char(cd.ciclo_inicio, ''YYYY-MM''), cd.periodo_meses ->> -1) AS ultima_mensualidad';
BEGIN
  SELECT pg_get_functiondef(
    'public.rpc_buscar_alumnos_cxc(text,text,boolean,uuid,uuid,uuid,uuid,integer,integer)'::regprocedure
  )
  INTO v_definicion;

  IF position(v_origen IN v_definicion) = 0 THEN
    RAISE EXCEPTION
      'No se encontró la definición esperada de ultima_mensualidad en rpc_buscar_alumnos_cxc';
  END IF;

  EXECUTE replace(v_definicion, v_origen, v_destino);
END;
$$;
