-- Migration: 20260903211500_corregir_calculo_anticipos_rpc_buscar_alumnos_cxc.sql
-- Corrige el cálculo de anticipos y deuda en rpc_buscar_alumnos_cxc
-- Problema resuelto:
-- 1. Los cobros_aplicados con es_aplicacion_anticipo = true se sumaban erróneamente
--    tanto en el cobro de la nota destino como en el anticipo origen, inflando el total cobrado.
-- 2. Para los anticipos consumidos, -(monto_total - total_cobrado) producía un saldo positivo (+159),
--    generando una deuda fantasma en alumnos como Augusto Ribera Torrico.
-- 3. Ahora se diferencia total_cobrado_efectivo (ingreso real a caja/banco) de total_consumo_anticipo,
--    garantizando que un anticipo consumido tenga impacto 0 y un anticipo disponible reste deuda.

CREATE OR REPLACE FUNCTION public.rpc_buscar_alumnos_cxc(
  p_busqueda text DEFAULT NULL,
  p_estado text DEFAULT 'activos',
  p_solo_con_deuda boolean DEFAULT false,
  p_sucursal_filtro uuid DEFAULT NULL,
  p_entrenador_id uuid DEFAULT NULL,
  p_grupo_id uuid DEFAULT NULL,
  p_horario_id uuid DEFAULT NULL,
  p_pagina integer DEFAULT 1,
  p_limite integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_escuela_id uuid;
  v_sucursal_actor uuid;
  v_sucursal_efectiva uuid;
  v_rol text;
  v_busqueda text := NULLIF(btrim(unaccent(lower(COALESCE(p_busqueda, '')))), '');
  v_terminos text[];
  v_estado text := lower(COALESCE(p_estado, 'activos'));
  v_pagina integer := GREATEST(COALESCE(p_pagina, 1), 1);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 30), 1), 50);
  v_offset integer;
  v_resultado jsonb;
BEGIN
  SELECT u.escuela_id, u.sucursal_id, u.rol::text
    INTO v_escuela_id, v_sucursal_actor, v_rol
  FROM public.usuarios AS u
  WHERE u.id = v_uid
    AND u.activo IS TRUE
  LIMIT 1;

  IF v_uid IS NULL
     OR v_escuela_id IS NULL
     OR v_rol IS NULL
     OR v_rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RAISE EXCEPTION 'No autorizado para consultar CxC.' USING ERRCODE = '42501';
  END IF;

  IF v_estado NOT IN ('activos', 'archivados', 'todos') THEN
    RAISE EXCEPTION 'Estado de alumnos invalido.' USING ERRCODE = '22023';
  END IF;

  IF v_busqueda IS NOT NULL AND char_length(v_busqueda) < 2 THEN
    RAISE EXCEPTION 'La busqueda debe tener al menos 2 caracteres.' USING ERRCODE = '22023';
  END IF;

  IF v_rol IN ('Administrador', 'Asistente') AND v_sucursal_actor IS NOT NULL THEN
    IF p_sucursal_filtro IS NOT NULL AND p_sucursal_filtro <> v_sucursal_actor THEN
      RAISE EXCEPTION 'La sucursal solicitada esta fuera del alcance autorizado.' USING ERRCODE = '42501';
    END IF;
    v_sucursal_efectiva := v_sucursal_actor;
  ELSE
    IF p_sucursal_filtro IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sucursales AS s
      WHERE s.id = p_sucursal_filtro AND s.escuela_id = v_escuela_id
    ) THEN
      RAISE EXCEPTION 'La sucursal solicitada esta fuera de la escuela autorizada.' USING ERRCODE = '42501';
    END IF;
    v_sucursal_efectiva := p_sucursal_filtro;
  END IF;

  v_terminos := CASE
    WHEN v_busqueda IS NULL THEN ARRAY[]::text[]
    ELSE regexp_split_to_array(v_busqueda, '\\s+')
  END;
  v_offset := (v_pagina - 1) * v_limite;

  WITH candidatos AS MATERIALIZED (
    SELECT a.*
    FROM public.alumnos AS a
    WHERE a.escuela_id = v_escuela_id
      AND (v_sucursal_efectiva IS NULL OR a.sucursal_id = v_sucursal_efectiva)
      AND CASE v_estado
        WHEN 'activos' THEN a.archivado IS NOT TRUE
        WHEN 'archivados' THEN a.archivado IS TRUE
        ELSE TRUE
      END
      AND (p_entrenador_id IS NULL OR a.profesor_asignado_id = p_entrenador_id)
      AND (p_grupo_id IS NULL OR a.grupo_id = p_grupo_id)
      AND (p_horario_id IS NULL OR a.horario_id = p_horario_id)
      AND (
        cardinality(v_terminos) = 0
        OR NOT EXISTS (
          SELECT 1
          FROM unnest(v_terminos) AS termino
          WHERE COALESCE(a.terminos_busqueda, '') NOT LIKE '%' || termino || '%'
        )
      )
  ), pagos AS MATERIALIZED (
    SELECT 
      ca.cuenta_cobrar_id, 
      sum(ca.monto_aplicado)::numeric AS total_aplicado,
      sum(ca.monto_aplicado) FILTER (WHERE ca.es_aplicacion_anticipo IS NOT TRUE)::numeric AS total_cobrado_efectivo,
      sum(ca.monto_aplicado) FILTER (WHERE ca.es_aplicacion_anticipo IS TRUE)::numeric AS total_consumo_anticipo
    FROM public.cobros_aplicados AS ca
    JOIN public.cuentas_cobrar AS cc
      ON cc.id = ca.cuenta_cobrar_id
     AND cc.escuela_id = ca.escuela_id
    JOIN candidatos AS c ON c.id = cc.alumno_id AND c.escuela_id = cc.escuela_id
    GROUP BY ca.cuenta_cobrar_id
  ), deuda AS MATERIALIZED (
    SELECT
      c.id AS alumno_id,
      COALESCE(sum(cc.monto_total) FILTER (WHERE COALESCE(cc.es_anticipo, false) IS FALSE), 0)::numeric AS total_deuda,
      COALESCE(sum(COALESCE(pg.total_cobrado_efectivo, 0)), 0)::numeric AS total_cobrado,
      COALESCE(sum(
        CASE 
          WHEN COALESCE(cc.es_anticipo, false)
            THEN -(COALESCE(pg.total_cobrado_efectivo, 0) - COALESCE(pg.total_consumo_anticipo, 0))
          ELSE (cc.monto_total - COALESCE(pg.total_aplicado, 0))
        END
      ), 0)::numeric AS saldo_pendiente,
      count(cc.id) FILTER (
        WHERE COALESCE(cc.es_anticipo, false) IS FALSE
          AND (cc.monto_total - COALESCE(pg.total_aplicado, 0)) > 0
      )::integer AS cxc_pendientes,
      count(cc.id)::integer AS cxc_total,
      count(DISTINCT to_char(cc.fecha_emision, 'YYYY-MM'))::integer AS meses_saasport,
      min(cc.fecha_emision) AS primera_fecha_saasport
    FROM candidatos AS c
    LEFT JOIN public.cuentas_cobrar AS cc
      ON cc.escuela_id = c.escuela_id
     AND cc.alumno_id = c.id
     AND cc.anulada IS NOT TRUE
     AND cc.estado::text <> 'borrador'
    LEFT JOIN pagos AS pg ON pg.cuenta_cobrar_id = cc.id
    GROUP BY c.id
  ), enriquecidos AS MATERIALIZED (
    SELECT c.*, d.total_deuda, d.total_cobrado, d.saldo_pendiente,
           d.cxc_pendientes, d.cxc_total, d.meses_saasport, d.primera_fecha_saasport
    FROM candidatos AS c
    JOIN deuda AS d ON d.alumno_id = c.id
    WHERE c.archivado IS NOT TRUE OR d.saldo_pendiente <> 0
  ), resumen AS (
    SELECT count(*)::integer AS total_alumnos,
           count(*) FILTER (WHERE saldo_pendiente > 0)::integer AS con_deuda,
           COALESCE(sum(saldo_pendiente) FILTER (WHERE saldo_pendiente > 0), 0)::numeric AS total_pendiente
    FROM enriquecidos
  ), filtrados AS MATERIALIZED (
    SELECT *
    FROM enriquecidos
    WHERE NOT COALESCE(p_solo_con_deuda, false) OR saldo_pendiente > 0
  ), total AS (
    SELECT count(*)::integer AS total_resultados FROM filtrados
  ), pagina AS MATERIALIZED (
    SELECT *
    FROM filtrados
    ORDER BY unaccent(lower(nombres)), unaccent(lower(apellidos)), id
    LIMIT v_limite OFFSET v_offset
  ), asistencias AS (
    SELECT an.alumno_id,
      count(*) FILTER (
        WHERE an.fecha >= date_trunc('month', CURRENT_DATE)::date
          AND an.estado::text IN ('Presente', 'Licencia')
      )::integer AS actual,
      count(*) FILTER (
        WHERE an.fecha >= (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
          AND an.fecha < date_trunc('month', CURRENT_DATE)::date
          AND an.estado::text IN ('Presente', 'Licencia')
      )::integer AS anterior
    FROM public.asistencias_normales AS an
    JOIN pagina AS p ON p.id = an.alumno_id
    GROUP BY an.alumno_id
  ), ultima_mensualidad AS (
    SELECT DISTINCT ON (cc.alumno_id)
      cc.alumno_id,
      COALESCE(to_char(cd.ciclo_fin, 'YYYY-MM'), cd.periodo_meses ->> -1) AS ultima_mensualidad
    FROM pagina AS p
    JOIN public.cuentas_cobrar AS cc
      ON cc.alumno_id = p.id AND cc.escuela_id = p.escuela_id
    JOIN public.cxc_detalle AS cd ON cd.cuenta_cobrar_id = cc.id
    JOIN public.catalogo_items AS ci ON ci.id = cd.catalogo_item_id
    WHERE cc.anulada IS NOT TRUE
      AND cc.estado::text <> 'borrador'
      AND lower(btrim(ci.nombre)) = 'mensualidad'
    ORDER BY cc.alumno_id, COALESCE(cd.ciclo_fin, cc.fecha_emision) DESC, cd.id DESC
  ), items AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'alumno_id', p.id,
        'escuela_id', p.escuela_id,
        'nombres', p.nombres,
        'apellidos', p.apellidos,
        'fecha_nacimiento', p.fecha_nacimiento,
        'sucursal_id', p.sucursal_id,
        'grupo_id', p.grupo_id,
        'cancha_id', p.grupo_id,
        'horario_id', p.horario_id,
        'entrenador_id', p.profesor_asignado_id,
        'nombre_padre', p.nombre_padre,
        'telefono_padre', p.telefono_padre,
        'nombre_madre', p.nombre_madre,
        'telefono_madre', p.telefono_madre,
        'whatsapp_preferido', p.whatsapp_preferido,
        'sucursal_nombre', s.nombre,
        'grupo_nombre', g.nombre,
        'cancha_nombre', g.nombre,
        'horario_hora', h.hora,
        'entrenador_nombre', concat_ws(' ', ue.nombres, ue.apellidos),
        'total_deuda', p.total_deuda,
        'total_cobrado', p.total_cobrado,
        'saldo_pendiente', p.saldo_pendiente,
        'cxc_pendientes', p.cxc_pendientes,
        'cxc_total', p.cxc_total,
        'asistencias_actual', COALESCE(ast.actual, 0),
        'asistencias_anterior', COALESCE(ast.anterior, 0),
        'meses_permanencia_inicial', p.meses_permanencia_inicial,
        'ingresos_iniciales', p.ingresos_iniciales,
        'sub', CASE WHEN p.fecha_nacimiento IS NULL THEN NULL
          ELSE extract(year FROM age(CURRENT_DATE, p.fecha_nacimiento))::integer END,
        'total_ingresos_historico', p.total_cobrado + COALESCE(p.ingresos_iniciales, 0),
        'cantidad_meses_actividad', p.meses_saasport + COALESCE(p.meses_permanencia_inicial, 0),
        'fecha_inicio_consolidada', COALESCE(p.fecha_inicio, p.created_at::date, p.primera_fecha_saasport),
        'fecha_inicio', p.fecha_inicio,
        'ultima_mensualidad', um.ultima_mensualidad,
        'archivado', p.archivado
      ) ORDER BY unaccent(lower(p.nombres)), unaccent(lower(p.apellidos)), p.id
    ) AS data
    FROM pagina AS p
    LEFT JOIN public.sucursales AS s ON s.id = p.sucursal_id
    LEFT JOIN public.grupos AS g ON g.id = p.grupo_id
    LEFT JOIN public.horarios AS h ON h.id = p.horario_id
    LEFT JOIN public.usuarios AS ue ON ue.id = p.profesor_asignado_id
    LEFT JOIN asistencias AS ast ON ast.alumno_id = p.id
    LEFT JOIN ultima_mensualidad AS um ON um.alumno_id = p.id
  )
  SELECT jsonb_build_object(
    'items', COALESCE(items.data, '[]'::jsonb),
    'total_resultados', total.total_resultados,
    'pagina', v_pagina,
    'items_por_pagina', v_limite,
    'resumen', jsonb_build_object(
      'total_alumnos', resumen.total_alumnos,
      'con_deuda', resumen.con_deuda,
      'total_pendiente', resumen.total_pendiente
    )
  )
  INTO v_resultado
  FROM resumen CROSS JOIN total CROSS JOIN items;

  RETURN COALESCE(v_resultado, jsonb_build_object(
    'items', '[]'::jsonb,
    'total_resultados', 0,
    'pagina', v_pagina,
    'items_por_pagina', v_limite,
    'resumen', jsonb_build_object('total_alumnos', 0, 'con_deuda', 0, 'total_pendiente', 0)
  ));
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_buscar_alumnos_cxc(
  text, text, boolean, uuid, uuid, uuid, uuid, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_buscar_alumnos_cxc(
  text, text, boolean, uuid, uuid, uuid, uuid, integer, integer
) TO authenticated;
