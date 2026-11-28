-- Ordenar Cuentas por Cobrar (rpc_buscar_alumnos_cxc) y Alumnos (rpc_listar_alumnos_saasport)
-- por orden de inscripción (últimos inscritos primero: created_at DESC NULLS LAST, id DESC)
-- y unificar el cálculo de Sub con la edad deportiva anual de la escuela.

CREATE OR REPLACE FUNCTION public.rpc_buscar_alumnos_cxc(
  p_busqueda text DEFAULT NULL::text,
  p_estado text DEFAULT 'activos'::text,
  p_solo_con_deuda boolean DEFAULT false,
  p_sucursal_filtro uuid DEFAULT NULL::uuid,
  p_entrenador_id uuid DEFAULT NULL::uuid,
  p_grupo_id uuid DEFAULT NULL::uuid,
  p_horario_id uuid DEFAULT NULL::uuid,
  p_pagina integer DEFAULT 1,
  p_limite integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := (SELECT auth.uid());
  v_escuela_id uuid;
  v_sucursal_actor uuid;
  v_sucursal_efectiva uuid;
  v_zona_horaria text;
  v_rol text;
  v_busqueda text := NULLIF(btrim(unaccent(lower(COALESCE(p_busqueda, '')))), '');
  v_terminos text[];
  v_estado text := lower(COALESCE(p_estado, 'activos'));
  v_pagina integer := GREATEST(COALESCE(p_pagina, 1), 1);
  v_limite integer := LEAST(GREATEST(COALESCE(p_limite, 30), 1), 50);
  v_offset integer;
  v_resultado jsonb;
BEGIN
  SELECT u.escuela_id, u.sucursal_id, u.rol::text, COALESCE(e.zona_horaria, 'America/La_Paz')
    INTO v_escuela_id, v_sucursal_actor, v_rol, v_zona_horaria
  FROM public.usuarios AS u
  LEFT JOIN public.escuelas AS e ON e.id = u.escuela_id
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
    ELSE regexp_split_to_array(v_busqueda, '\s+')
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
    LEFT JOIN LATERAL (
      SELECT
        sum(ca.monto_aplicado)::numeric AS total_aplicado,
        sum(ca.monto_aplicado) FILTER (WHERE ca.es_aplicacion_anticipo IS NOT TRUE)::numeric AS total_cobrado_efectivo,
        sum(ca.monto_aplicado) FILTER (WHERE ca.es_aplicacion_anticipo IS TRUE)::numeric AS total_consumo_anticipo
      FROM public.cobros_aplicados AS ca
      WHERE ca.cuenta_cobrar_id = cc.id
        AND ca.escuela_id = cc.escuela_id
    ) AS pg ON true
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
    ORDER BY created_at DESC NULLS LAST, id DESC
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
    WHERE an.fecha >= (date_trunc('month', CURRENT_DATE) - interval '1 month')::date
      AND an.estado::text IN ('Presente', 'Licencia')
    GROUP BY an.alumno_id
  ), ultima_mensualidad AS (
    SELECT DISTINCT ON (cc.alumno_id)
      cc.alumno_id,
      COALESCE(to_char(cd.periodo_estadistico, 'YYYY-MM'), to_char(cc.periodo_estadistico, 'YYYY-MM'), to_char(cd.ciclo_inicio, 'YYYY-MM'), cd.periodo_meses ->> -1) AS ultima_mensualidad
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
          ELSE (EXTRACT(year FROM timezone(COALESCE(v_zona_horaria, 'America/La_Paz'), now())::date)::integer - EXTRACT(year FROM p.fecha_nacimiento)::integer) END,
        'total_ingresos_historico', p.total_cobrado + COALESCE(p.ingresos_iniciales, 0),
        'cantidad_meses_actividad', p.meses_saasport + COALESCE(p.meses_permanencia_inicial, 0),
        'fecha_inicio_consolidada', COALESCE(p.fecha_inicio, p.created_at::date, p.primera_fecha_saasport),
        'fecha_inicio', p.fecha_inicio,
        'ultima_mensualidad', um.ultima_mensualidad,
        'archivado', p.archivado
      ) ORDER BY p.created_at DESC NULLS LAST, p.id DESC
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
$function$;

CREATE OR REPLACE FUNCTION public.rpc_listar_alumnos_saasport(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_zona_horaria text;
  v_anio_actual integer;
  v_sucursal_fija uuid;
  v_estado text;
  v_busqueda text;
  v_like text;
  v_sucursal_filtro uuid;
  v_grupo_id uuid;
  v_sub integer;
  v_pagina integer;
  v_limite integer;
  v_offset integer;
  v_total_activos integer := 0;
  v_total_archivados integer := 0;
  v_total_resultados integer := 0;
  v_subs jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;

  IF NOT FOUND OR v_actor.rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RAISE EXCEPTION 'No autorizado para consultar el padrón de alumnos.' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(e.zona_horaria, 'America/La_Paz')
  INTO v_zona_horaria
  FROM public.escuelas e
  WHERE e.id = v_actor.escuela_id;

  v_anio_actual := EXTRACT(YEAR FROM timezone(COALESCE(v_zona_horaria, 'America/La_Paz'), now())::date)::integer;

  v_sucursal_fija := CASE
    WHEN v_actor.rol IN ('Administrador', 'Asistente') THEN v_actor.sucursal_id
    ELSE NULL
  END;

  v_estado := CASE
    WHEN lower(COALESCE(p_filtros->>'estado', 'activos')) = 'archivados' THEN 'archivados'
    ELSE 'activos'
  END;

  v_busqueda := NULLIF(btrim(COALESCE(p_filtros->>'busqueda', '')), '');
  IF v_busqueda IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_busqueda, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  END IF;

  v_sucursal_filtro := COALESCE(
    v_sucursal_fija,
    NULLIF(btrim(COALESCE(p_filtros->>'sucursal_id', '')), '')::uuid
  );
  v_grupo_id := NULLIF(btrim(COALESCE(p_filtros->>'grupo_id', '')), '')::uuid;
  v_sub := NULLIF(btrim(COALESCE(p_filtros->>'sub', '')), '')::integer;
  v_pagina := GREATEST(1, COALESCE(NULLIF(btrim(COALESCE(p_filtros->>'pagina', '')), '')::integer, 1));
  v_limite := LEAST(50, GREATEST(1, COALESCE(NULLIF(btrim(COALESCE(p_filtros->>'limite', '')), '')::integer, 30)));
  v_offset := (v_pagina - 1) * v_limite;

  -- Conteos globales dentro del alcance de escuela/sucursal del actor
  SELECT
    count(*) FILTER (WHERE a.archivado IS NOT TRUE)::integer,
    count(*) FILTER (WHERE a.archivado IS TRUE)::integer
  INTO v_total_activos, v_total_archivados
  FROM public.alumnos a
  WHERE a.escuela_id = v_actor.escuela_id
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
    AND (v_sucursal_fija IS NULL OR a.sucursal_id = v_sucursal_fija);

  -- Facetas de Sub para el estado actual dentro del alcance
  SELECT COALESCE(jsonb_agg(sub_val ORDER BY sub_val ASC), '[]'::jsonb)
  INTO v_subs
  FROM (
    SELECT DISTINCT (v_anio_actual - EXTRACT(YEAR FROM a.fecha_nacimiento)::integer) AS sub_val
    FROM public.alumnos a
    WHERE a.escuela_id = v_actor.escuela_id
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
      AND (v_sucursal_fija IS NULL OR a.sucursal_id = v_sucursal_fija)
      AND (
        (v_estado = 'activos' AND a.archivado IS NOT TRUE)
        OR (v_estado = 'archivados' AND a.archivado IS TRUE)
      )
      AND a.fecha_nacimiento IS NOT NULL
  ) s;

  -- Total filtrado para paginación
  SELECT count(*)::integer
  INTO v_total_resultados
  FROM public.alumnos a
  WHERE a.escuela_id = v_actor.escuela_id
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
    AND (
      (v_estado = 'activos' AND a.archivado IS NOT TRUE)
      OR (v_estado = 'archivados' AND a.archivado IS TRUE)
    )
    AND (v_sucursal_filtro IS NULL OR a.sucursal_id = v_sucursal_filtro)
    AND (v_grupo_id IS NULL OR COALESCE(a.cancha_id, a.grupo_id) = v_grupo_id)
    AND (v_sub IS NULL OR (v_anio_actual - EXTRACT(YEAR FROM a.fecha_nacimiento)::integer) = v_sub)
    AND (
      v_like IS NULL
      OR concat_ws(' ', a.nombres, a.apellidos) ILIKE v_like ESCAPE '\'
      OR concat_ws(' ', a.apellidos, a.nombres) ILIKE v_like ESCAPE '\'
      OR COALESCE(a.carnet_identidad, '') ILIKE v_like ESCAPE '\'
      OR COALESCE(a.nombre_padre, '') ILIKE v_like ESCAPE '\'
      OR COALESCE(a.nombre_madre, '') ILIKE v_like ESCAPE '\'
      OR COALESCE(a.telefono_padre, '') ILIKE v_like ESCAPE '\'
      OR COALESCE(a.telefono_madre, '') ILIKE v_like ESCAPE '\'
      OR COALESCE(a.terminos_busqueda, '') ILIKE v_like ESCAPE '\'
    );

  -- Página actual ordenada por inscripción (últimos inscritos primero) y métricas financieras
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'nombres', p.nombres,
        'apellidos', p.apellidos,
        'fecha_nacimiento', p.fecha_nacimiento,
        'carnet_identidad', p.carnet_identidad,
        'sub', p.sub,
        'nombre_padre', p.nombre_padre,
        'telefono_padre', p.telefono_padre,
        'nombre_madre', p.nombre_madre,
        'telefono_madre', p.telefono_madre,
        'whatsapp_preferido', p.whatsapp_preferido,
        'colegio', p.colegio,
        'direccion', p.direccion,
        'mensualidad', p.mensualidad,
        'sucursal_id', p.sucursal_id,
        'sucursal_nombre', p.sucursal_nombre,
        'cancha_id', p.cancha_id,
        'grupo_nombre', p.grupo_nombre,
        'observaciones', p.observaciones,
        'archivado', p.archivado,
        'archivado_at', p.archivado_at,
        'created_at', p.created_at,
        'saldo_pendiente', p.saldo_pendiente,
        'borradores_pendientes', p.borradores_pendientes
      )
      ORDER BY p.created_at DESC NULLS LAST, p.id DESC
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM (
    SELECT
      a.id,
      a.nombres,
      a.apellidos,
      a.fecha_nacimiento,
      a.carnet_identidad,
      CASE
        WHEN a.fecha_nacimiento IS NULL THEN NULL
        ELSE (v_anio_actual - EXTRACT(YEAR FROM a.fecha_nacimiento)::integer)
      END AS sub,
      a.nombre_padre,
      a.telefono_padre,
      a.nombre_madre,
      a.telefono_madre,
      COALESCE(a.whatsapp_preferido, 'padre') AS whatsapp_preferido,
      a.colegio,
      a.direccion,
      a.mensualidad,
      a.sucursal_id,
      s.nombre AS sucursal_nombre,
      COALESCE(a.cancha_id, a.grupo_id) AS cancha_id,
      g.nombre AS grupo_nombre,
      a.observaciones,
      COALESCE(a.archivado, false) AS archivado,
      a.archivado_at,
      a.created_at,
      COALESCE(deuda.saldo_pendiente, 0) AS saldo_pendiente,
      COALESCE(borr.borradores_pendientes, 0) AS borradores_pendientes
    FROM public.alumnos a
    LEFT JOIN public.sucursales s
      ON s.id = a.sucursal_id
     AND s.escuela_id = a.escuela_id
    LEFT JOIN public.grupos g
      ON g.id = COALESCE(a.cancha_id, a.grupo_id)
     AND g.escuela_id = a.escuela_id
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(GREATEST(0, cc.monto_total - COALESCE(pagado.total, 0))), 0)::numeric AS saldo_pendiente
      FROM public.cuentas_cobrar cc
      LEFT JOIN (
        SELECT ca.cuenta_cobrar_id, COALESCE(SUM(ca.monto_aplicado), 0)::numeric AS total
        FROM public.cobros_aplicados ca
        GROUP BY ca.cuenta_cobrar_id
      ) pagado ON pagado.cuenta_cobrar_id = cc.id
      WHERE cc.escuela_id = v_actor.escuela_id
        AND cc.alumno_id = a.id
        AND cc.anulada IS NOT TRUE
        AND cc.es_anticipo IS NOT TRUE
        AND cc.estado IN ('pendiente', 'parcial')
    ) deuda ON TRUE
    LEFT JOIN LATERAL (
      SELECT count(*)::integer AS borradores_pendientes
      FROM public.cuentas_cobrar cc
      WHERE cc.escuela_id = v_actor.escuela_id
        AND cc.alumno_id = a.id
        AND cc.estado = 'borrador'
        AND cc.anulada IS NOT TRUE
    ) borr ON TRUE
    WHERE a.escuela_id = v_actor.escuela_id
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
      AND (
        (v_estado = 'activos' AND a.archivado IS NOT TRUE)
        OR (v_estado = 'archivados' AND a.archivado IS TRUE)
      )
      AND (v_sucursal_filtro IS NULL OR a.sucursal_id = v_sucursal_filtro)
      AND (v_grupo_id IS NULL OR COALESCE(a.cancha_id, a.grupo_id) = v_grupo_id)
      AND (v_sub IS NULL OR (v_anio_actual - EXTRACT(YEAR FROM a.fecha_nacimiento)::integer) = v_sub)
      AND (
        v_like IS NULL
        OR concat_ws(' ', a.nombres, a.apellidos) ILIKE v_like ESCAPE '\'
        OR concat_ws(' ', a.apellidos, a.nombres) ILIKE v_like ESCAPE '\'
        OR COALESCE(a.carnet_identidad, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(a.nombre_padre, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(a.nombre_madre, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(a.telefono_padre, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(a.telefono_madre, '') ILIKE v_like ESCAPE '\'
        OR COALESCE(a.terminos_busqueda, '') ILIKE v_like ESCAPE '\'
      )
    ORDER BY a.created_at DESC NULLS LAST, a.id DESC
    LIMIT v_limite
    OFFSET v_offset
  ) p;

  RETURN jsonb_build_object(
    'items', v_items,
    'total_resultados', v_total_resultados,
    'pagina', v_pagina,
    'limite', v_limite,
    'resumen', jsonb_build_object(
      'total_activos', v_total_activos,
      'total_archivados', v_total_archivados
    ),
    'facetas', jsonb_build_object(
      'subs', v_subs
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_listar_alumnos_saasport(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_listar_alumnos_saasport(jsonb) TO authenticated;
