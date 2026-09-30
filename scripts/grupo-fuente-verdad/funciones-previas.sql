CREATE OR REPLACE FUNCTION public.fn_sync_alumnos_grupo_cancha()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.grupo_id IS NOT NULL AND (NEW.cancha_id IS NULL OR (OLD.grupo_id IS NOT NULL AND NEW.grupo_id IS DISTINCT FROM OLD.grupo_id)) THEN
    NEW.cancha_id := NEW.grupo_id;
  ELSIF NEW.cancha_id IS NOT NULL AND (NEW.grupo_id IS NULL OR (OLD.cancha_id IS NOT NULL AND NEW.cancha_id IS DISTINCT FROM OLD.cancha_id)) THEN
    NEW.grupo_id := NEW.cancha_id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_activar_gestion(p_gestion_id uuid)
 RETURNS TABLE(alumnos_migrados integer, alumnos_no_continuan integer, grupos_activados integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_target public.gestiones_deportivas%ROWTYPE;
  v_actual public.gestiones_deportivas%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_pendientes integer;
  v_sin_entrenador integer;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede activar una gestión.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.gestiones_deportivas
  WHERE id = p_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND OR v_target.estado <> 'planificacion' THEN
    RAISE EXCEPTION 'La gestión no está en planificación.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actual FROM public.gestiones_deportivas
  WHERE escuela_id = v_actor.escuela_id AND estado = 'activa'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La escuela no tiene una gestión activa para cerrar.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_pendientes
  FROM public.alumnos a
  WHERE a.escuela_id = v_actor.escuela_id
    AND a.archivado IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.alumnos_grupos ag
      WHERE ag.alumno_id = a.id AND ag.gestion_id = v_target.id
        AND ag.estado = 'planificada' AND ag.decision IN ('migrara', 'no_continua')
    );
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'Hay % alumno(s) sin decisión de migración.', v_pendientes USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_sin_entrenador
  FROM public.grupos_gestion gg
  WHERE gg.gestion_id = v_target.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.entrenadores_grupos eg
      JOIN public.usuarios u ON u.id = eg.entrenador_id
      WHERE eg.grupo_gestion_id = gg.id
        AND eg.estado = 'planificada'
        AND u.escuela_id = v_actor.escuela_id
        AND u.rol = 'Entrenador'
        AND u.activo IS TRUE
    );
  IF v_sin_entrenador > 0 THEN
    RAISE EXCEPTION 'Hay % grupo(s) sin profesor principal.', v_sin_entrenador USING ERRCODE = '22023';
  END IF;

  UPDATE public.gestiones_deportivas
  SET estado = 'cerrada', updated_at = v_now
  WHERE id = v_actual.id;
  UPDATE public.alumnos_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE gestion_id = v_actual.id AND estado = 'activa';
  UPDATE public.entrenadores_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE gestion_id = v_actual.id AND estado = 'activa';

  UPDATE public.alumnos_grupos
  SET estado = CASE WHEN decision = 'migrara' THEN 'activa' ELSE 'cerrada' END,
      vigente_desde = CASE WHEN decision = 'migrara' THEN v_now ELSE vigente_desde END,
      vigente_hasta = CASE WHEN decision = 'migrara' THEN NULL ELSE v_now END,
      updated_at = v_now
  WHERE gestion_id = v_target.id AND estado = 'planificada';

  UPDATE public.entrenadores_grupos
  SET estado = 'activa', vigente_desde = v_now, updated_at = v_now
  WHERE gestion_id = v_target.id AND estado = 'planificada';

  UPDATE public.alumnos a
  SET archivado = TRUE, archivado_at = v_now, grupo_gestion_id = NULL,
      updated_at = v_now
  WHERE a.escuela_id = v_actor.escuela_id
    AND a.archivado IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM public.alumnos_grupos ag
      WHERE ag.alumno_id = a.id AND ag.gestion_id = v_target.id
        AND ag.estado = 'cerrada' AND ag.decision = 'no_continua'
    );

  UPDATE public.alumnos a
  SET grupo_gestion_id = ag.grupo_gestion_id,
      grupo_id = gg.grupo_id,
      horario_id = gg.horario_id,
      sucursal_id = gg.sucursal_id,
      profesor_asignado_id = eg.entrenador_id,
      updated_at = v_now
  FROM public.alumnos_grupos ag
  JOIN public.grupos_gestion gg ON gg.id = ag.grupo_gestion_id
  JOIN public.entrenadores_grupos eg
    ON eg.grupo_gestion_id = gg.id AND eg.estado = 'activa'
  WHERE a.id = ag.alumno_id AND ag.gestion_id = v_target.id
    AND ag.estado = 'activa';
  DELETE FROM public.alumnos_entrenadores ae
  USING public.alumnos a
  WHERE a.id = ae.alumno_id
    AND (a.archivado IS TRUE OR a.escuela_id = v_actor.escuela_id);
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
  SELECT a.id, eg.entrenador_id
  FROM public.alumnos a
  JOIN public.alumnos_grupos ag ON ag.alumno_id = a.id AND ag.gestion_id = v_target.id AND ag.estado = 'activa'
  JOIN public.entrenadores_grupos eg ON eg.grupo_gestion_id = ag.grupo_gestion_id AND eg.estado = 'activa'
  WHERE a.escuela_id = v_actor.escuela_id AND a.archivado IS NOT TRUE
  ON CONFLICT DO NOTHING;

  UPDATE public.gestiones_deportivas
  SET estado = 'activa', activada_por = v_actor.id,
      activada_en = v_now, updated_at = v_now
  WHERE id = v_target.id;

  SELECT COUNT(*) INTO alumnos_migrados
  FROM public.alumnos_grupos WHERE gestion_id = v_target.id AND estado = 'activa';
  SELECT COUNT(*) INTO alumnos_no_continuan
  FROM public.alumnos_grupos WHERE gestion_id = v_target.id AND decision = 'no_continua';
  SELECT COUNT(*) INTO grupos_activados
  FROM public.grupos_gestion WHERE gestion_id = v_target.id;

  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle
  ) VALUES (
    v_actor.escuela_id, v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'ACTIVAR_GESTION_DEPORTIVA', 'gestiones_deportivas', v_target.id::text,
    jsonb_build_object(
      'anio', v_target.anio,
      'alumnos_migrados', alumnos_migrados,
      'alumnos_no_continuan', alumnos_no_continuan,
      'grupos_activados', grupos_activados
    )
  );
  RETURN QUERY SELECT alumnos_migrados, alumnos_no_continuan, grupos_activados;
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
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador puede asignar profesores a grupos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_grupo FROM public.grupos_gestion
  WHERE id = p_grupo_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  SELECT * INTO v_entrenador FROM public.usuarios
  WHERE id = p_entrenador_id AND escuela_id = v_actor.escuela_id
    AND rol = 'Entrenador' AND activo IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El entrenador no es válido, está inactivo o pertenece a otra escuela.' USING ERRCODE = '22023'; END IF;
  IF v_grupo.id IS NULL THEN RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  v_estado := CASE WHEN EXISTS (SELECT 1 FROM public.gestiones_deportivas WHERE id = v_grupo.gestion_id AND estado = 'activa') THEN 'activa' ELSE 'planificada' END;
  UPDATE public.entrenadores_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE grupo_gestion_id = v_grupo.id AND estado IN ('activa', 'planificada');
  INSERT INTO public.entrenadores_grupos (
    escuela_id, entrenador_id, grupo_gestion_id, gestion_id,
    estado, vigente_desde, motivo, creado_por
  ) VALUES (
    v_actor.escuela_id, v_entrenador.id, v_grupo.id, v_grupo.gestion_id,
    v_estado, CASE WHEN v_estado = 'activa' THEN v_now ELSE NULL END,
    COALESCE(NULLIF(p_motivo, ''), 'asignacion'), v_actor.id
  );
  IF v_estado = 'activa' THEN
    UPDATE public.alumnos a
    SET profesor_asignado_id = v_entrenador.id, updated_at = v_now
    WHERE a.grupo_gestion_id = v_grupo.id AND a.archivado IS NOT TRUE;
    DELETE FROM public.alumnos_entrenadores ae
    USING public.alumnos a
    WHERE a.id = ae.alumno_id
      AND a.grupo_gestion_id = v_grupo.id;
    INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
    SELECT a.id, v_entrenador.id
    FROM public.alumnos a
    WHERE a.grupo_gestion_id = v_grupo.id AND a.archivado IS NOT TRUE
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('grupo_gestion_id', v_grupo.id, 'entrenador_id', v_entrenador.id, 'estado', v_estado);
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_cambiar_entrenador_grupo(p_grupo_gestion_id uuid, p_entrenador_id uuid, p_motivo text DEFAULT 'cambio_profesor'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  RETURN public.rpc_asignar_entrenador_grupo(p_grupo_gestion_id, p_entrenador_id, p_motivo);
END;
$function$;

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
      AND u.rol = 'Entrenador' AND u.activo IS TRUE
  ) THEN
    RAISE EXCEPTION 'El entrenador seleccionado no es válido, está inactivo o pertenece a otra escuela.' USING ERRCODE = '22023';
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
    ORDER BY (gg.horario_id IS NOT DISTINCT FROM p_horario_id) DESC, gg.updated_at DESC
    LIMIT 1 FOR UPDATE;

    IF v_grupo_gestion_id IS NULL THEN
      INSERT INTO public.grupos_gestion (escuela_id, gestion_id, grupo_id, horario_id, sucursal_id, nombre_snapshot, hora_snapshot)
      VALUES (v_actor.escuela_id, v_gestion_id, v_grupo_id, p_horario_id, p_sucursal_id, trim(p_nombre), COALESCE(v_hora_snapshot, ''))
      RETURNING id INTO v_grupo_gestion_id;
    ELSE
      UPDATE public.grupos_gestion SET horario_id = p_horario_id, sucursal_id = p_sucursal_id,
        nombre_snapshot = trim(p_nombre), hora_snapshot = COALESCE(v_hora_snapshot, hora_snapshot), updated_at = v_now
      WHERE id = v_grupo_gestion_id;
    END IF;

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

    -- Mantener sincronizado alumnos
    IF p_entrenador_id IS NOT NULL THEN
      UPDATE public.alumnos SET 
        profesor_asignado_id = p_entrenador_id,
        grupo_gestion_id = COALESCE(v_grupo_gestion_id, grupo_gestion_id),
        updated_at = v_now
      WHERE grupo_id = v_grupo_id AND escuela_id = v_actor.escuela_id AND archivado IS FALSE;
    ELSE
      UPDATE public.alumnos SET 
        grupo_gestion_id = COALESCE(v_grupo_gestion_id, grupo_gestion_id),
        updated_at = v_now
      WHERE grupo_id = v_grupo_id AND escuela_id = v_actor.escuela_id AND archivado IS FALSE;
    END IF;

    -- Sincronizar membresía de alumnos a la gestión activa
    INSERT INTO public.alumnos_grupos (
      escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
      decision, vigente_desde, motivo, creado_por
    )
    SELECT a.escuela_id, a.id, v_grupo_gestion_id, v_gestion_id, 'activa',
           'migrara', v_now, 'edicion_grupo', v_actor.id
    FROM public.alumnos a
    WHERE a.grupo_id = v_grupo_id 
      AND a.escuela_id = v_actor.escuela_id 
      AND a.archivado IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.alumnos_grupos ag 
        WHERE ag.alumno_id = a.id AND ag.gestion_id = v_gestion_id AND ag.estado IN ('planificada', 'activa')
      );
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

CREATE OR REPLACE FUNCTION public.rpc_obtener_grupos_con_entrenador(p_escuela_id uuid)
 RETURNS TABLE(id uuid, nombre text, sucursal_id uuid, sucursal_nombre text, horario_id uuid, horario_hora text, entrenador_id uuid, entrenador_nombre text, activo boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  WITH gestion_activa AS (
    SELECT ga.id FROM public.gestiones_deportivas ga
    WHERE ga.escuela_id = p_escuela_id AND ga.estado = 'activa'
    ORDER BY ga.created_at DESC
    LIMIT 1
  ),
  entrenador_titular AS (
    SELECT DISTINCT ON (eg.grupo_gestion_id)
      eg.grupo_gestion_id,
      eg.entrenador_id,
      (u.nombres || ' ' || u.apellidos)::text AS entrenador_nombre
    FROM public.entrenadores_grupos eg
    JOIN public.usuarios u ON u.id = eg.entrenador_id
    WHERE eg.escuela_id = p_escuela_id AND eg.estado = 'activa'
    ORDER BY eg.grupo_gestion_id, eg.created_at DESC
  ),
  grupos_base AS (
    SELECT DISTINCT ON (g.id)
      g.id,
      g.nombre::text AS nombre,
      g.sucursal_id,
      s.nombre::text AS sucursal_nombre,
      gh.horario_id AS horario_id,
      h.hora::text AS horario_hora,
      COALESCE(et_gg.entrenador_id, et_any.entrenador_id) AS entrenador_id,
      COALESCE(et_gg.entrenador_nombre, et_any.entrenador_nombre) AS entrenador_nombre,
      g.activo
    FROM public.grupos g
    LEFT JOIN public.sucursales s ON g.sucursal_id = s.id
    LEFT JOIN public.grupos_horarios gh ON gh.grupo_id = g.id
    LEFT JOIN public.horarios h ON gh.horario_id = h.id
    LEFT JOIN gestion_activa ga ON true
    LEFT JOIN public.grupos_gestion gg ON gg.grupo_id = g.id AND gg.gestion_id = ga.id AND (gg.horario_id = gh.horario_id OR gh.horario_id IS NULL)
    LEFT JOIN entrenador_titular et_gg ON et_gg.grupo_gestion_id = gg.id
    LEFT JOIN LATERAL (
      SELECT et2.entrenador_id, et2.entrenador_nombre
      FROM public.grupos_gestion gg2
      JOIN entrenador_titular et2 ON et2.grupo_gestion_id = gg2.id
      WHERE gg2.grupo_id = g.id AND gg2.gestion_id = ga.id
      LIMIT 1
    ) et_any ON true
    WHERE g.escuela_id = p_escuela_id
    ORDER BY g.id
  )
  SELECT * FROM grupos_base
  ORDER BY grupos_base.nombre ASC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_trasladar_alumno(p_alumno_id uuid, p_grupo_destino_id uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_alumno public.alumnos%ROWTYPE;
  v_destino public.grupos_gestion%ROWTYPE;
  v_gestion public.gestiones_deportivas%ROWTYPE;
  v_entrenador uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('Administrador', 'SuperAdministrador') THEN
    RAISE EXCEPTION 'No tienes permiso para trasladar alumnos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_alumno FROM public.alumnos WHERE id = p_alumno_id FOR UPDATE;
  IF NOT FOUND OR v_alumno.escuela_id <> v_actor.escuela_id THEN
    RAISE EXCEPTION 'El alumno no pertenece a tu escuela.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL
     AND v_alumno.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes trasladar alumnos de otra sucursal.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_destino FROM public.grupos_gestion
  WHERE id = p_grupo_destino_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo destino no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_gestion FROM public.gestiones_deportivas
  WHERE id = v_destino.gestion_id AND estado = 'activa';
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo destino no está activo.' USING ERRCODE = '22023'; END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL
     AND v_destino.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes trasladar a otra sucursal.' USING ERRCODE = '42501';
  END IF;
  SELECT entrenador_id INTO v_entrenador FROM public.entrenadores_grupos
  WHERE grupo_gestion_id = v_destino.id AND estado = 'activa';
  IF v_entrenador IS NULL THEN RAISE EXCEPTION 'El grupo destino no tiene profesor principal.' USING ERRCODE = '22023'; END IF;

  PERFORM 1
  FROM public.alumnos_grupos
  WHERE alumno_id = v_alumno.id AND gestion_id = v_gestion.id AND estado = 'activa'
  FOR UPDATE;
  UPDATE public.alumnos_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, motivo = COALESCE(NULLIF(p_motivo, ''), 'traslado'), updated_at = v_now
  WHERE alumno_id = v_alumno.id AND gestion_id = v_gestion.id AND estado = 'activa';
  INSERT INTO public.alumnos_grupos (
    escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
    decision, vigente_desde, motivo, creado_por
  ) VALUES (
    v_alumno.escuela_id, v_alumno.id, v_destino.id, v_gestion.id, 'activa',
    'migrara', v_now, COALESCE(NULLIF(p_motivo, ''), 'traslado'), v_actor.id
  );
  UPDATE public.alumnos
  SET grupo_gestion_id = v_destino.id,
      grupo_id = v_destino.grupo_id,
      horario_id = v_destino.horario_id,
      sucursal_id = v_destino.sucursal_id,
      profesor_asignado_id = v_entrenador,
      updated_at = v_now
  WHERE id = v_alumno.id;
  DELETE FROM public.alumnos_entrenadores WHERE alumno_id = v_alumno.id;
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
  VALUES (v_alumno.id, v_entrenador)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle
  ) VALUES (
    v_actor.escuela_id, v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'TRASLADO_ALUMNO_GRUPO', 'alumnos', v_alumno.id::text,
    jsonb_build_object('grupo_destino', v_destino.id, 'entrenador_destino', v_entrenador, 'motivo', p_motivo)
  );
  RETURN jsonb_build_object('alumno_id', v_alumno.id, 'grupo_gestion_id', v_destino.id, 'entrenador_id', v_entrenador);
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
             AND entrenador.rol IN ('Entrenador', 'Entrenarqueros')
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

