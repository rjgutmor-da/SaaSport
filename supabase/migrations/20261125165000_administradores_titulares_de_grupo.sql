-- Mostrar al administrador en los filtros docentes cuando tenga una titularidad vigente.
CREATE OR REPLACE FUNCTION public.rpc_catalogos_asisport(p_sucursal_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_escuela_id uuid;
  v_rol varchar;
  v_user_sucursal_id uuid;
  v_activo boolean;
  v_sucursal_efectiva uuid;
  v_gestiones jsonb;
  v_entrenadores jsonb;
  v_canchas jsonb;
  v_horarios jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Sesión no autenticada';
  END IF;

  SELECT u.escuela_id, u.rol, u.sucursal_id, u.activo
  INTO v_escuela_id, v_rol, v_user_sucursal_id, v_activo
  FROM public.usuarios u
  WHERE u.id = v_user_id;

  IF v_activo IS NOT TRUE OR v_escuela_id IS NULL THEN
    RAISE EXCEPTION 'Usuario inactivo o sin escuela asociada';
  END IF;

  -- Determinación de sucursal efectiva
  IF v_rol IN ('Administrador', 'Asistente') AND v_user_sucursal_id IS NOT NULL THEN
    v_sucursal_efectiva := v_user_sucursal_id;
  ELSIF p_sucursal_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.sucursales s WHERE s.id = p_sucursal_id AND s.escuela_id = v_escuela_id) THEN
      v_sucursal_efectiva := p_sucursal_id;
    END IF;
  END IF;

  -- 1. Gestiones de la escuela
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'anio', g.anio,
      'estado', g.estado,
      'es_activa', (g.estado = 'activa')
    ) ORDER BY g.anio DESC
  ), '[]'::jsonb)
  INTO v_gestiones
  FROM public.gestiones_deportivas g
  WHERE g.escuela_id = v_escuela_id;

  -- 2. CTE de relaciones vigentes entre entrenador y grupo dentro de la escuela
  WITH relaciones_eg AS (
    SELECT DISTINCT
      eg.entrenador_id,
      gg.grupo_id
    FROM public.entrenadores_grupos eg
    JOIN public.grupos_gestion gg ON gg.id = eg.grupo_gestion_id
    JOIN public.grupos gr ON gr.id = gg.grupo_id
    JOIN public.gestiones_deportivas gd ON gd.id = eg.gestion_id
    WHERE eg.escuela_id = v_escuela_id
      AND eg.estado = 'activa'
      AND gr.activo IS TRUE
      AND (gd.estado = 'activa' OR NOT EXISTS (SELECT 1 FROM public.gestiones_deportivas gdx WHERE gdx.escuela_id = v_escuela_id AND gdx.estado = 'activa'))
      AND (eg.vigente_hasta IS NULL OR eg.vigente_hasta >= CURRENT_TIMESTAMP)
  ),
  relaciones_alumnos_fallback AS (
    SELECT DISTINCT
      a.profesor_asignado_id AS entrenador_id,
      COALESCE(a.grupo_id, a.cancha_id) AS grupo_id
    FROM public.alumnos a
    JOIN public.grupos gr ON gr.id = COALESCE(a.grupo_id, a.cancha_id)
    WHERE a.escuela_id = v_escuela_id
      AND a.estado <> 'ELIMINADO SISTEMA'
      AND a.archivado IS FALSE
      AND a.profesor_asignado_id IS NOT NULL
      AND COALESCE(a.grupo_id, a.cancha_id) IS NOT NULL
      AND gr.activo IS TRUE
      -- Solo aplica como respaldo si el entrenador no cuenta con asignación activa en entrenadores_grupos
      AND NOT EXISTS (
        SELECT 1 FROM relaciones_eg reg WHERE reg.entrenador_id = a.profesor_asignado_id
      )
  ),
  relaciones_base AS (
    SELECT entrenador_id, grupo_id FROM relaciones_eg
    UNION
    SELECT entrenador_id, grupo_id FROM relaciones_alumnos_fallback
  )
  -- 3. Entrenadores autorizados con sus respectivos grupo_ids vigentes
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', u.id,
      'value', u.id,
      'label', (u.nombres || ' ' || u.apellidos),
      'nombres', u.nombres,
      'apellidos', u.apellidos,
      'rol', u.rol,
      'sucursal_id', u.sucursal_id,
      'grupo_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT r.grupo_id)
        FROM relaciones_base r
        WHERE r.entrenador_id = u.id
      ), '[]'::jsonb)
    ) ORDER BY u.nombres, u.apellidos
  ), '[]'::jsonb)
  INTO v_entrenadores
  FROM public.usuarios u
  WHERE (
    CASE
      WHEN v_rol IN ('Entrenador', 'Entrenarqueros') THEN u.id = v_user_id
      ELSE u.escuela_id = v_escuela_id
           AND u.activo IS TRUE
           AND (u.rol IN ('Entrenador', 'Entrenarqueros') OR (
             u.rol = 'Administrador' AND EXISTS (
               SELECT 1 FROM relaciones_eg r WHERE r.entrenador_id = u.id
             )
           ))
           AND (v_sucursal_efectiva IS NULL OR u.sucursal_id IS NULL OR u.sucursal_id = v_sucursal_efectiva)
    END
  );

  -- 4. Canchas / Grupos autorizados con total_alumnos y entrenador_ids vigentes
  WITH relaciones_eg AS (
    SELECT DISTINCT
      eg.entrenador_id,
      gg.grupo_id
    FROM public.entrenadores_grupos eg
    JOIN public.grupos_gestion gg ON gg.id = eg.grupo_gestion_id
    JOIN public.grupos gr ON gr.id = gg.grupo_id
    JOIN public.gestiones_deportivas gd ON gd.id = eg.gestion_id
    WHERE eg.escuela_id = v_escuela_id
      AND eg.estado = 'activa'
      AND gr.activo IS TRUE
      AND (gd.estado = 'activa' OR NOT EXISTS (SELECT 1 FROM public.gestiones_deportivas gdx WHERE gdx.escuela_id = v_escuela_id AND gdx.estado = 'activa'))
      AND (eg.vigente_hasta IS NULL OR eg.vigente_hasta >= CURRENT_TIMESTAMP)
  ),
  relaciones_alumnos_fallback AS (
    SELECT DISTINCT
      a.profesor_asignado_id AS entrenador_id,
      COALESCE(a.grupo_id, a.cancha_id) AS grupo_id
    FROM public.alumnos a
    JOIN public.grupos gr ON gr.id = COALESCE(a.grupo_id, a.cancha_id)
    WHERE a.escuela_id = v_escuela_id
      AND a.estado <> 'ELIMINADO SISTEMA'
      AND a.archivado IS FALSE
      AND a.profesor_asignado_id IS NOT NULL
      AND COALESCE(a.grupo_id, a.cancha_id) IS NOT NULL
      AND gr.activo IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM relaciones_eg reg WHERE reg.entrenador_id = a.profesor_asignado_id
      )
  ),
  relaciones_base AS (
    SELECT entrenador_id, grupo_id FROM relaciones_eg
    UNION
    SELECT entrenador_id, grupo_id FROM relaciones_alumnos_fallback
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', g.id,
      'value', g.id,
      'label', (g.nombre || ' (' || COALESCE(ca.total, 0)::text || ')'),
      'nombre', g.nombre,
      'total_alumnos', COALESCE(ca.total, 0),
      'sucursal_id', g.sucursal_id,
      'entrenador_ids', COALESCE((
        SELECT jsonb_agg(DISTINCT r.entrenador_id)
        FROM relaciones_base r
        WHERE r.grupo_id = g.id
      ), '[]'::jsonb)
    ) ORDER BY g.nombre
  ), '[]'::jsonb)
  INTO v_canchas
  FROM public.grupos g
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS total
    FROM public.alumnos a
    WHERE (a.cancha_id = g.id OR a.grupo_id = g.id)
      AND a.escuela_id = v_escuela_id
      AND a.estado <> 'ELIMINADO SISTEMA'
      AND a.archivado IS FALSE
  ) ca ON true
  WHERE g.escuela_id = v_escuela_id
    AND g.activo IS TRUE
    AND (v_sucursal_efectiva IS NULL OR g.sucursal_id IS NULL OR g.sucursal_id = v_sucursal_efectiva)
    AND (
      v_rol NOT IN ('Entrenador', 'Entrenarqueros')
      OR (v_rol = 'Entrenador' AND EXISTS (
        SELECT 1 FROM relaciones_base rb
        WHERE rb.grupo_id = g.id AND rb.entrenador_id = v_user_id
      ))
      OR (v_rol = 'Entrenarqueros' AND (
        EXISTS (
          SELECT 1 FROM public.alumnos a
          WHERE (a.cancha_id = g.id OR a.grupo_id = g.id)
            AND a.es_arquero IS TRUE
            AND a.escuela_id = v_escuela_id
            AND a.estado <> 'ELIMINADO SISTEMA'
            AND a.archivado IS FALSE
        )
        OR EXISTS (
          SELECT 1 FROM relaciones_base rb
          WHERE rb.grupo_id = g.id AND rb.entrenador_id = v_user_id
        )
      ))
    );

  -- 5. Horarios autorizados
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', h.id,
      'value', h.id,
      'label', h.hora,
      'hora', h.hora
    ) ORDER BY h.hora
  ), '[]'::jsonb)
  INTO v_horarios
  FROM public.horarios h
  WHERE h.escuela_id = v_escuela_id
    AND h.activo IS TRUE;

  RETURN jsonb_build_object(
    'gestiones', v_gestiones,
    'entrenadores', v_entrenadores,
    'canchas', v_canchas,
    'horarios', v_horarios,
    'sucursal_efectiva', v_sucursal_efectiva
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_catalogos_asisport(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_catalogos_asisport(uuid) TO authenticated, service_role;

-- La asignación pertenece al grupo. El rol del usuario conserva sus permisos.
CREATE OR REPLACE FUNCTION public.rpc_guardar_grupo_completo(p_grupo_id uuid DEFAULT NULL::uuid, p_nombre character varying DEFAULT NULL::character varying, p_sucursal_id uuid DEFAULT NULL::uuid, p_horario_id uuid DEFAULT NULL::uuid, p_entrenador_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_grupo_id uuid := p_grupo_id;
  v_gestion_id uuid;
  v_grupo_gestion_id uuid;
  v_hora_snapshot varchar;
  v_entrenador_actual_id uuid;
  v_res_grupo public.grupos%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('SuperAdministrador', 'Administrador') THEN
    RAISE EXCEPTION 'Solo un Administrador o SuperAdministrador puede gestionar grupos.' USING ERRCODE = '42501';
  END IF;

  IF p_nombre IS NULL OR trim(p_nombre) = '' THEN
    RAISE EXCEPTION 'El nombre del grupo es obligatorio.' USING ERRCODE = '22023';
  END IF;

  IF p_sucursal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sucursales s WHERE s.id = p_sucursal_id AND s.escuela_id = v_actor.escuela_id
  ) THEN
    RAISE EXCEPTION 'La sucursal seleccionada no pertenece a tu escuela.' USING ERRCODE = '22023';
  END IF;

  IF p_horario_id IS NOT NULL THEN
    SELECT h.hora INTO v_hora_snapshot FROM public.horarios h
    WHERE h.id = p_horario_id AND h.escuela_id = v_actor.escuela_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El horario seleccionado no pertenece a tu escuela.' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_entrenador_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id = p_entrenador_id AND u.escuela_id = v_actor.escuela_id
      AND u.activo IS TRUE
      AND (u.rol = 'Entrenador' OR (u.rol = 'Administrador'
        AND (u.sucursal_id IS NULL OR u.sucursal_id = p_sucursal_id)
        AND (v_actor.rol = 'SuperAdministrador' OR v_actor.sucursal_id IS NULL OR (
          v_actor.sucursal_id = p_sucursal_id AND (p_grupo_id IS NULL OR EXISTS (
            SELECT 1 FROM public.grupos origen
            WHERE origen.id = p_grupo_id AND origen.escuela_id = v_actor.escuela_id
              AND origen.sucursal_id = v_actor.sucursal_id
          ))
        ))))
  ) THEN
    RAISE EXCEPTION 'Selecciona un profesor titular activo y habilitado para la sucursal del grupo.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.grupos g WHERE g.escuela_id = v_actor.escuela_id
      AND g.nombre ILIKE trim(p_nombre) AND (v_grupo_id IS NULL OR g.id <> v_grupo_id)
  ) THEN
    RAISE EXCEPTION 'Ya existe un grupo con este nombre en tu escuela.' USING ERRCODE = '23505';
  END IF;

  IF v_grupo_id IS NULL THEN
    INSERT INTO public.grupos (nombre, escuela_id, sucursal_id, activo)
    VALUES (trim(p_nombre), v_actor.escuela_id, p_sucursal_id, true)
    RETURNING * INTO v_res_grupo;
    v_grupo_id := v_res_grupo.id;
  ELSE
    UPDATE public.grupos SET nombre = trim(p_nombre), sucursal_id = p_sucursal_id, updated_at = v_now
    WHERE id = v_grupo_id AND escuela_id = v_actor.escuela_id RETURNING * INTO v_res_grupo;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE = '42501';
    END IF;
  END IF;

  DELETE FROM public.grupos_horarios WHERE grupo_id = v_grupo_id;
  IF p_horario_id IS NOT NULL THEN
    INSERT INTO public.grupos_horarios (grupo_id, horario_id) VALUES (v_grupo_id, p_horario_id);
  END IF;

  -- 4. Obtener o auto-crear la gestión deportiva activa
  SELECT gd.id INTO v_gestion_id FROM public.gestiones_deportivas gd
  WHERE gd.escuela_id = v_actor.escuela_id AND gd.estado = 'activa' ORDER BY gd.created_at DESC LIMIT 1;

  IF v_gestion_id IS NULL THEN
    v_gestion_id := public.fn_seed_gestion_escuela(v_actor.escuela_id);
  END IF;

  IF v_gestion_id IS NOT NULL THEN
    SELECT gg.id INTO v_grupo_gestion_id FROM public.grupos_gestion gg
    WHERE gg.gestion_id = v_gestion_id AND gg.grupo_id = v_grupo_id
      AND gg.horario_id IS NOT DISTINCT FROM p_horario_id
    FOR UPDATE;

    IF v_grupo_gestion_id IS NULL THEN
      INSERT INTO public.grupos_gestion (escuela_id, gestion_id, grupo_id, horario_id, sucursal_id, nombre_snapshot, hora_snapshot)
      VALUES (v_actor.escuela_id, v_gestion_id, v_grupo_id, p_horario_id, p_sucursal_id, trim(p_nombre), COALESCE(v_hora_snapshot, ''))
      RETURNING id INTO v_grupo_gestion_id;
    ELSE
      UPDATE public.grupos_gestion SET horario_id = p_horario_id, sucursal_id = p_sucursal_id,
        nombre_snapshot = trim(p_nombre), hora_snapshot = COALESCE(v_hora_snapshot, ''), updated_at = v_now
      WHERE id = v_grupo_gestion_id;
    END IF;

    -- Cerrar asignaciones de horarios anteriores, conservando sus filas históricas.
    UPDATE public.entrenadores_grupos eg SET estado='cerrada',vigente_hasta=v_now,updated_at=v_now
    FROM public.grupos_gestion anterior
    WHERE anterior.id=eg.grupo_gestion_id AND anterior.grupo_id=v_grupo_id
      AND anterior.gestion_id=v_gestion_id AND anterior.escuela_id=v_actor.escuela_id
      AND anterior.id<>v_grupo_gestion_id AND eg.estado='activa';

    SELECT eg.entrenador_id INTO v_entrenador_actual_id FROM public.entrenadores_grupos eg
    WHERE eg.grupo_gestion_id = v_grupo_gestion_id AND eg.estado = 'activa' FOR UPDATE;

    IF p_entrenador_id IS DISTINCT FROM v_entrenador_actual_id THEN
      UPDATE public.entrenadores_grupos SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
      WHERE grupo_gestion_id = v_grupo_gestion_id AND estado = 'activa';
      IF p_entrenador_id IS NOT NULL THEN
        INSERT INTO public.entrenadores_grupos (escuela_id, entrenador_id, grupo_gestion_id, gestion_id, estado, vigente_desde, motivo, creado_por)
        VALUES (v_actor.escuela_id, p_entrenador_id, v_grupo_gestion_id, v_gestion_id, 'activa', v_now, 'edicion_grupo', v_actor.id);
      END IF;
    END IF;

    PERFORM private.propagar_configuracion_grupo(v_actor.escuela_id,v_grupo_id);
  END IF;

  RETURN jsonb_build_object(
    'grupo_id', v_grupo_id,
    'nombre', v_res_grupo.nombre,
    'sucursal_id', v_res_grupo.sucursal_id,
    'horario_id', p_horario_id,
    'entrenador_id', p_entrenador_id
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_asignar_entrenador_grupo(p_grupo_gestion_id uuid, p_entrenador_id uuid, p_motivo text DEFAULT 'asignacion'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_grupo public.grupos_gestion%ROWTYPE;
  v_entrenador public.usuarios%ROWTYPE;
  v_estado varchar;
  v_config record;
  v_gestion_estado varchar;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador puede asignar profesores a grupos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_grupo FROM public.grupos_gestion
  WHERE id=p_grupo_gestion_id AND escuela_id=v_actor.escuela_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM public.grupos WHERE id=v_grupo.grupo_id AND escuela_id=v_actor.escuela_id FOR UPDATE;
  SELECT * INTO v_grupo FROM public.grupos_gestion WHERE id=p_grupo_gestion_id FOR UPDATE;
  SELECT estado INTO v_gestion_estado FROM public.gestiones_deportivas
  WHERE id=v_grupo.gestion_id AND escuela_id=v_actor.escuela_id;
  IF v_gestion_estado NOT IN ('activa','planificacion') THEN
    RAISE EXCEPTION 'La gestión está cerrada.' USING ERRCODE='22023';
  END IF;
  IF v_gestion_estado='activa' THEN
    SELECT * INTO v_config FROM private.configuracion_vigente_grupo(v_actor.escuela_id,v_grupo.grupo_id);
    IF v_config.grupo_gestion_id IS DISTINCT FROM v_grupo.id THEN
      RAISE EXCEPTION 'Selecciona la configuración vigente del grupo.' USING ERRCODE='22023';
    END IF;
  END IF;
  IF p_entrenador_id IS NOT NULL THEN
  SELECT * INTO v_entrenador FROM public.usuarios
  WHERE id = p_entrenador_id AND escuela_id = v_actor.escuela_id
    AND activo IS TRUE
    AND (rol = 'Entrenador' OR (rol = 'Administrador'
      AND (sucursal_id IS NULL OR sucursal_id = v_grupo.sucursal_id)));
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona un profesor titular activo y habilitado para la sucursal del grupo.' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_grupo.id IS NULL THEN RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  v_estado := CASE WHEN EXISTS (SELECT 1 FROM public.gestiones_deportivas WHERE id = v_grupo.gestion_id AND estado = 'activa') THEN 'activa' ELSE 'planificada' END;
  UPDATE public.entrenadores_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE grupo_gestion_id = v_grupo.id AND estado IN ('activa', 'planificada');
  IF p_entrenador_id IS NOT NULL THEN
  INSERT INTO public.entrenadores_grupos (
    escuela_id, entrenador_id, grupo_gestion_id, gestion_id,
    estado, vigente_desde, motivo, creado_por
  ) VALUES (
    v_actor.escuela_id, v_entrenador.id, v_grupo.id, v_grupo.gestion_id,
    v_estado, CASE WHEN v_estado = 'activa' THEN v_now ELSE NULL END,
    COALESCE(NULLIF(p_motivo, ''), 'asignacion'), v_actor.id
  );
  END IF;
  IF v_estado = 'activa' THEN
    PERFORM private.propagar_configuracion_grupo(v_actor.escuela_id,v_grupo.grupo_id);
  END IF;
  RETURN jsonb_build_object('grupo_gestion_id', v_grupo.id, 'entrenador_id', v_entrenador.id, 'estado', v_estado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_guardar_planificacion_gestion(p_gestion_id uuid, p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_gestion public.gestiones_deportivas%ROWTYPE;
  v_row record;
  v_grupos integer := 0;
  v_alumnos integer := 0;
  v_entrenadores integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede editar una planificación.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_gestion FROM public.gestiones_deportivas
  WHERE id = p_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND OR v_gestion.estado <> 'planificacion' THEN
    RAISE EXCEPTION 'La gestión no está disponible para planificación.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_plan, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'La planificación debe enviarse como un objeto JSON.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'grupos', p_plan->'canchas', '[]'::jsonb)) AS x(
    id uuid, nombre_snapshot varchar, hora_snapshot varchar,
    sucursal_id uuid, grupo_id uuid, cancha_id uuid, horario_id uuid
  ) LOOP
    IF v_row.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo de la planificación no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.grupos_gestion
    SET nombre_snapshot = COALESCE(v_row.nombre_snapshot, nombre_snapshot),
        hora_snapshot = COALESCE(v_row.hora_snapshot, hora_snapshot),
        sucursal_id = COALESCE(v_row.sucursal_id, sucursal_id),
        grupo_id = COALESCE(v_row.grupo_id, v_row.cancha_id, grupo_id),
        horario_id = COALESCE(v_row.horario_id, horario_id),
        updated_at = now()
    WHERE id = v_row.id AND gestion_id = v_gestion.id;
    v_grupos := v_grupos + 1;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'alumnos', '[]'::jsonb)) AS x(
    alumno_id uuid, grupo_gestion_id uuid, decision varchar
  ) LOOP
    IF v_row.decision NOT IN ('migrara', 'no_continua', 'pendiente') THEN
      RAISE EXCEPTION 'Decisión de migración inválida.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.alumnos
      WHERE id = v_row.alumno_id AND escuela_id = v_actor.escuela_id
    ) THEN
      RAISE EXCEPTION 'El alumno de la planificación no pertenece a la escuela.' USING ERRCODE = '42501';
    END IF;
    IF v_row.decision <> 'no_continua' AND v_row.grupo_gestion_id IS NULL THEN
      RAISE EXCEPTION 'Cada alumno que continúa debe tener un grupo destino.' USING ERRCODE = '22023';
    END IF;
    IF v_row.grupo_gestion_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.grupo_gestion_id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo destino del alumno no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.alumnos_grupos
    SET grupo_gestion_id = COALESCE(v_row.grupo_gestion_id, grupo_gestion_id),
        decision = v_row.decision,
        updated_at = now()
    WHERE alumno_id = v_row.alumno_id
      AND gestion_id = v_gestion.id;
    IF NOT FOUND AND v_row.decision <> 'no_continua' THEN
      INSERT INTO public.alumnos_grupos (
        escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
        decision, motivo, creado_por
      ) VALUES (
        v_actor.escuela_id, v_row.alumno_id, v_row.grupo_gestion_id,
        v_gestion.id, 'planificada', v_row.decision,
        'planificacion_manual', v_actor.id
      );
    END IF;
    v_alumnos := v_alumnos + 1;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'entrenadores', '[]'::jsonb)) AS x(
    grupo_gestion_id uuid, entrenador_id uuid
  ) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.grupo_gestion_id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo del entrenador no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios u
      JOIN public.grupos_gestion gg ON gg.id = v_row.grupo_gestion_id
      WHERE u.id = v_row.entrenador_id AND u.escuela_id = v_actor.escuela_id
        AND u.activo IS TRUE
        AND (u.rol = 'Entrenador' OR (u.rol = 'Administrador'
          AND (u.sucursal_id IS NULL OR u.sucursal_id = gg.sucursal_id)))
    ) THEN
      RAISE EXCEPTION 'El entrenador de la planificación no es válido.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.entrenadores_grupos
               WHERE grupo_gestion_id = v_row.grupo_gestion_id
                 AND estado = 'planificada') THEN
      UPDATE public.entrenadores_grupos
      SET entrenador_id = v_row.entrenador_id, updated_at = now()
      WHERE grupo_gestion_id = v_row.grupo_gestion_id AND estado = 'planificada';
    ELSE
      INSERT INTO public.entrenadores_grupos (
        escuela_id, entrenador_id, grupo_gestion_id, gestion_id,
        estado, motivo, creado_por
      ) VALUES (
        v_actor.escuela_id, v_row.entrenador_id, v_row.grupo_gestion_id,
        v_gestion.id, 'planificada', 'planificacion_manual', v_actor.id
      );
    END IF;
    v_entrenadores := v_entrenadores + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'gestion_id', v_gestion.id,
    'grupos_actualizados', v_grupos,
    'alumnos_actualizados', v_alumnos,
    'entrenadores_actualizados', v_entrenadores
  );
END;
$function$;

CREATE OR REPLACE FUNCTION private.sync_alumnos_entrenadores_autorizado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
BEGIN
  -- Las operaciones de servicio sin usuario siguen disponibles para migraciones.
  IF auth.uid() IS NOT NULL THEN
    SELECT * INTO v_actor
    FROM public.usuarios
    WHERE id = auth.uid() AND activo IS TRUE;

    IF NOT FOUND
       OR v_actor.escuela_id IS DISTINCT FROM NEW.escuela_id
       OR v_actor.rol NOT IN ('Entrenador', 'Administrador', 'SuperAdministrador', 'Asistente') THEN
      RAISE EXCEPTION 'No autorizado para asignar entrenador al alumno' USING ERRCODE = '42501';
    END IF;

    IF v_actor.rol = 'Asistente' THEN
      IF (v_actor.sucursal_id IS NOT NULL AND v_actor.sucursal_id IS DISTINCT FROM NEW.sucursal_id)
         OR (NEW.profesor_asignado_id IS NOT NULL AND NOT EXISTS (
           SELECT 1 FROM public.usuarios entrenador
           WHERE entrenador.id = NEW.profesor_asignado_id
             AND entrenador.activo IS TRUE
             AND entrenador.escuela_id = NEW.escuela_id
             AND (entrenador.rol IN ('Entrenador', 'Entrenarqueros') OR (
               entrenador.rol = 'Administrador' AND NEW.grupo_id IS NOT NULL
               AND EXISTS (
                 SELECT 1 FROM public.grupos g
                 CROSS JOIN LATERAL private.configuracion_vigente_grupo(g.escuela_id, g.id) c
                 WHERE g.id = NEW.grupo_id AND g.escuela_id = NEW.escuela_id
                   AND (entrenador.sucursal_id IS NULL OR entrenador.sucursal_id = g.sucursal_id)
                   AND c.entrenador_id = entrenador.id
               )
             ))
         )) THEN
        RAISE EXCEPTION 'Profesor fuera del alcance del asistente' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.profesor_asignado_id IS DISTINCT FROM NEW.profesor_asignado_id THEN
    IF OLD.profesor_asignado_id IS NOT NULL AND NEW.profesor_asignado_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.alumnos_entrenadores ae
        WHERE ae.alumno_id = NEW.id AND ae.entrenador_id = NEW.profesor_asignado_id
      ) THEN
        DELETE FROM public.alumnos_entrenadores
        WHERE alumno_id = NEW.id AND entrenador_id = OLD.profesor_asignado_id;
      ELSE
        UPDATE public.alumnos_entrenadores
        SET entrenador_id = NEW.profesor_asignado_id
        WHERE alumno_id = NEW.id AND entrenador_id = OLD.profesor_asignado_id;

        IF NOT FOUND THEN
          INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
          VALUES (NEW.id, NEW.profesor_asignado_id)
          ON CONFLICT (alumno_id, entrenador_id) DO NOTHING;
        END IF;
      END IF;
    ELSIF NEW.profesor_asignado_id IS NOT NULL THEN
      INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
      VALUES (NEW.id, NEW.profesor_asignado_id)
      ON CONFLICT (alumno_id, entrenador_id) DO NOTHING;
    ELSIF OLD.profesor_asignado_id IS NOT NULL THEN
      DELETE FROM public.alumnos_entrenadores
      WHERE alumno_id = OLD.id AND entrenador_id = OLD.profesor_asignado_id;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.profesor_asignado_id IS NOT NULL THEN
    INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
    VALUES (NEW.id, NEW.profesor_asignado_id)
    ON CONFLICT (alumno_id, entrenador_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;
