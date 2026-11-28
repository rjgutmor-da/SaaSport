-- Migración Fase 2: RPCs para el módulo de Alumnos en SaaSport
-- 1) rpc_listar_alumnos_saasport: listado paginado en servidor (30 por página) con filtros, resumen y facetas
-- 2) rpc_archivar_alumno_saasport: archivo atómico que limpia borradores no aprobados y desvincula mensualidades_ingreso

CREATE OR REPLACE FUNCTION public.rpc_listar_alumnos_saasport(p_filtros jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
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

  -- Facetas de Sub (año de nacimiento) para el estado actual dentro del alcance
  SELECT COALESCE(jsonb_agg(sub_anio ORDER BY sub_anio DESC), '[]'::jsonb)
  INTO v_subs
  FROM (
    SELECT DISTINCT EXTRACT(YEAR FROM a.fecha_nacimiento)::integer AS sub_anio
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
    AND (v_sub IS NULL OR EXTRACT(YEAR FROM a.fecha_nacimiento)::integer = v_sub)
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

  -- Página actual y métricas financieras calculadas solo para los 30 registros visibles
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
        'saldo_pendiente', p.saldo_pendiente,
        'borradores_pendientes', p.borradores_pendientes
      )
      ORDER BY lower(p.nombres), lower(p.apellidos), p.id
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
      EXTRACT(YEAR FROM a.fecha_nacimiento)::integer AS sub,
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
      AND (v_sub IS NULL OR EXTRACT(YEAR FROM a.fecha_nacimiento)::integer = v_sub)
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
    ORDER BY lower(a.nombres), lower(a.apellidos), a.id
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

CREATE OR REPLACE FUNCTION public.rpc_archivar_alumno_saasport(p_alumno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_alumno public.alumnos%ROWTYPE;
  v_borrador_ids uuid[];
  v_borradores_eliminados integer := 0;
BEGIN
  IF p_alumno_id IS NULL THEN
    RAISE EXCEPTION 'El identificador del alumno es obligatorio.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;

  IF NOT FOUND OR v_actor.rol NOT IN ('SuperAdministrador', 'Administrador') THEN
    RAISE EXCEPTION 'Solo un Administrador o SuperAdministrador puede archivar alumnos.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_alumno
  FROM public.alumnos
  WHERE id = p_alumno_id
    AND escuela_id = v_actor.escuela_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Alumno no encontrado en tu escuela.' USING ERRCODE = 'P0002';
  END IF;

  IF v_actor.rol = 'Administrador'
     AND v_actor.sucursal_id IS NOT NULL
     AND v_alumno.sucursal_id IS NOT NULL
     AND v_alumno.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No autorizado para archivar un alumno de otra sucursal.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.alumnos
  SET archivado = true,
      archivado_at = now(),
      archivado_por = v_actor.id
  WHERE id = p_alumno_id;

  SELECT array_agg(cc.id)
  INTO v_borrador_ids
  FROM public.cuentas_cobrar cc
  WHERE cc.escuela_id = v_actor.escuela_id
    AND cc.alumno_id = p_alumno_id
    AND cc.estado = 'borrador';

  v_borradores_eliminados := COALESCE(array_length(v_borrador_ids, 1), 0);

  IF v_borradores_eliminados > 0 THEN
    UPDATE public.mensualidades_ingreso
    SET cuenta_id = NULL
    WHERE alumno_id = p_alumno_id
      AND cuenta_id = ANY(v_borrador_ids);

    DELETE FROM public.cxc_detalle
    WHERE cuenta_cobrar_id = ANY(v_borrador_ids);

    DELETE FROM public.cuentas_cobrar
    WHERE id = ANY(v_borrador_ids);
  END IF;

  RETURN jsonb_build_object(
    'archivado', true,
    'borradores_eliminados', v_borradores_eliminados
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_listar_alumnos_saasport(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_listar_alumnos_saasport(jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_archivar_alumno_saasport(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_archivar_alumno_saasport(uuid) TO authenticated;
