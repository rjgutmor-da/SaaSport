-- El grupo determina horario y profesor; NULL es una configuración válida.
-- No modifica alumnos durante la instalación. La auditoría/regularización es separada.
CREATE OR REPLACE FUNCTION private.configuracion_vigente_grupo(p_escuela_id uuid, p_grupo_id uuid)
RETURNS TABLE(horario_id uuid, entrenador_id uuid, grupo_gestion_id uuid, gestion_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.grupos g WHERE g.id=p_grupo_id AND g.escuela_id=p_escuela_id) THEN
    RAISE EXCEPTION 'El grupo no pertenece a la escuela del alumno.' USING ERRCODE='23514';
  END IF;
  -- Subconsultas escalares: si existe más de una configuración, fallar; nunca elegir al azar.
  horario_id := (SELECT gh.horario_id FROM public.grupos_horarios gh WHERE gh.grupo_id=p_grupo_id);
  gestion_id := (SELECT gd.id FROM public.gestiones_deportivas gd WHERE gd.escuela_id=p_escuela_id AND gd.estado='activa');
  grupo_gestion_id := (SELECT gg.id FROM public.grupos_gestion gg
    WHERE gg.escuela_id=p_escuela_id AND gg.gestion_id=configuracion_vigente_grupo.gestion_id
      AND gg.grupo_id=p_grupo_id AND gg.horario_id IS NOT DISTINCT FROM configuracion_vigente_grupo.horario_id);
  entrenador_id := (SELECT eg.entrenador_id FROM public.entrenadores_grupos eg
    JOIN public.usuarios u ON u.id=eg.entrenador_id AND u.escuela_id=p_escuela_id
    WHERE eg.escuela_id=p_escuela_id AND eg.grupo_gestion_id=configuracion_vigente_grupo.grupo_gestion_id
      AND eg.gestion_id=configuracion_vigente_grupo.gestion_id AND eg.estado='activa');
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION private.configuracion_vigente_grupo(uuid,uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.fn_sync_alumnos_grupo_cancha()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.grupo_id IS NOT NULL AND NEW.cancha_id IS NOT NULL AND NEW.grupo_id<>NEW.cancha_id THEN
      RAISE EXCEPTION 'Los identificadores del grupo no coinciden.' USING ERRCODE='23514';
    END IF;
    NEW.grupo_id := COALESCE(NEW.grupo_id,NEW.cancha_id);
    NEW.cancha_id := NEW.grupo_id;
  ELSIF NEW.grupo_id IS DISTINCT FROM OLD.grupo_id AND NEW.cancha_id IS DISTINCT FROM OLD.cancha_id THEN
    IF NEW.grupo_id IS DISTINCT FROM NEW.cancha_id THEN
      RAISE EXCEPTION 'Los identificadores del grupo no coinciden.' USING ERRCODE='23514';
    END IF;
  ELSIF NEW.grupo_id IS DISTINCT FROM OLD.grupo_id THEN
    NEW.cancha_id := NEW.grupo_id;
  ELSIF NEW.cancha_id IS DISTINCT FROM OLD.cancha_id THEN
    NEW.grupo_id := NEW.cancha_id;
  ELSE
    NEW.grupo_id := COALESCE(NEW.grupo_id,NEW.cancha_id);
    NEW.cancha_id := NEW.grupo_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION private.derivar_alumno_desde_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_config record;
BEGIN
  IF NEW.archivado IS TRUE THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id=auth.uid() AND u.activo IS TRUE AND u.escuela_id=NEW.escuela_id
  ) THEN
    RAISE EXCEPTION 'No autorizado para asignar el grupo de otra escuela.' USING ERRCODE='42501';
  END IF;
  IF NEW.grupo_id IS NULL THEN
    -- Mantener los datos legados sin grupo; nunca inferir un grupo.
    IF TG_OP='UPDATE' AND OLD.grupo_id IS NOT NULL THEN
      NEW.horario_id := NULL; NEW.profesor_asignado_id := NULL; NEW.grupo_gestion_id := NULL;
    END IF;
    RETURN NEW;
  END IF;
  -- El guardado del grupo bloquea esta misma fila antes de cambiar su configuración.
  -- NOWAIT evita el ciclo alumno -> grupo / grupo -> alumno: se pide reintentar.
  BEGIN
    PERFORM 1 FROM public.grupos g WHERE g.id=NEW.grupo_id AND g.escuela_id=NEW.escuela_id FOR SHARE NOWAIT;
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'El grupo se está actualizando. Vuelve a guardar la ficha.' USING ERRCODE='40001';
  END;
  SELECT * INTO v_config FROM private.configuracion_vigente_grupo(NEW.escuela_id,NEW.grupo_id);
  NEW.horario_id := v_config.horario_id;
  NEW.profesor_asignado_id := v_config.entrenador_id;
  NEW.grupo_gestion_id := v_config.grupo_gestion_id;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.derivar_alumno_desde_grupo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_sync_grupo_fuente_verdad
BEFORE INSERT OR UPDATE OF grupo_id,cancha_id,grupo_gestion_id,profesor_asignado_id,horario_id,archivado,escuela_id
ON public.alumnos FOR EACH ROW EXECUTE FUNCTION private.derivar_alumno_desde_grupo();

-- UPDATE OF no detecta columnas modificadas por otro BEFORE trigger.
-- Usar el valor final para mantener la relación de profesores sin ampliar permisos.
DROP TRIGGER IF EXISTS trigger_sync_alumnos_entrenadores ON public.alumnos;
CREATE TRIGGER trigger_sync_alumnos_entrenadores AFTER INSERT ON public.alumnos
FOR EACH ROW EXECUTE FUNCTION private.sync_alumnos_entrenadores_autorizado();
CREATE TRIGGER trigger_sync_alumnos_entrenadores_update AFTER UPDATE ON public.alumnos
FOR EACH ROW WHEN (OLD.profesor_asignado_id IS DISTINCT FROM NEW.profesor_asignado_id)
EXECUTE FUNCTION private.sync_alumnos_entrenadores_autorizado();

CREATE OR REPLACE FUNCTION private.sincronizar_membresia_alumno_grupo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_gestion uuid; v_now timestamptz := clock_timestamp();
BEGIN
  IF NEW.archivado IS TRUE THEN
    IF TG_OP='UPDATE' AND OLD.archivado IS NOT TRUE THEN
      UPDATE public.alumnos_grupos SET estado='cerrada',vigente_hasta=v_now,updated_at=v_now
      WHERE escuela_id=NEW.escuela_id AND alumno_id=NEW.id AND estado='activa';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.grupo_id IS NULL THEN
    IF TG_OP='UPDATE' AND OLD.grupo_id IS NOT NULL THEN
      UPDATE public.alumnos_grupos SET estado='cerrada',vigente_hasta=v_now,updated_at=v_now
      WHERE escuela_id=NEW.escuela_id AND alumno_id=NEW.id AND estado='activa';
    END IF;
    RETURN NEW;
  END IF;
  SELECT gg.gestion_id INTO v_gestion FROM public.grupos_gestion gg
  JOIN public.gestiones_deportivas gd ON gd.id=gg.gestion_id AND gd.estado='activa'
  WHERE gg.id=NEW.grupo_gestion_id AND gg.escuela_id=NEW.escuela_id AND gd.escuela_id=NEW.escuela_id;
  IF v_gestion IS NULL THEN RETURN NEW; END IF;
  UPDATE public.alumnos_grupos SET estado='cerrada',vigente_hasta=v_now,updated_at=v_now
  WHERE escuela_id=NEW.escuela_id AND alumno_id=NEW.id
    AND (estado='activa' OR (estado='planificada' AND gestion_id=v_gestion))
    AND (grupo_gestion_id IS DISTINCT FROM NEW.grupo_gestion_id OR gestion_id IS DISTINCT FROM v_gestion);
  UPDATE public.alumnos_grupos SET estado='activa',vigente_desde=v_now,vigente_hasta=NULL,updated_at=v_now
  WHERE escuela_id=NEW.escuela_id AND alumno_id=NEW.id AND gestion_id=v_gestion
    AND grupo_gestion_id=NEW.grupo_gestion_id AND estado='planificada';
  INSERT INTO public.alumnos_grupos(escuela_id,alumno_id,grupo_gestion_id,gestion_id,estado,decision,vigente_desde,motivo,creado_por)
  SELECT NEW.escuela_id,NEW.id,NEW.grupo_gestion_id,v_gestion,'activa','migrara',v_now,'sincronizacion_grupo',auth.uid()
  WHERE NOT EXISTS (SELECT 1 FROM public.alumnos_grupos ag WHERE ag.alumno_id=NEW.id
    AND ag.gestion_id=v_gestion AND ag.estado='activa' AND ag.grupo_gestion_id=NEW.grupo_gestion_id);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.sincronizar_membresia_alumno_grupo() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER trg_membresia_grupo_fuente_verdad
AFTER INSERT OR UPDATE OF grupo_id,cancha_id,grupo_gestion_id,profesor_asignado_id,horario_id,archivado
ON public.alumnos FOR EACH ROW EXECUTE FUNCTION private.sincronizar_membresia_alumno_grupo();

CREATE OR REPLACE FUNCTION private.propagar_configuracion_grupo(p_escuela_id uuid,p_grupo_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_config record;
BEGIN
  SELECT * INTO v_config FROM private.configuracion_vigente_grupo(p_escuela_id,p_grupo_id);
  UPDATE public.alumnos a SET horario_id=v_config.horario_id,profesor_asignado_id=v_config.entrenador_id,
    grupo_gestion_id=v_config.grupo_gestion_id,updated_at=clock_timestamp()
  WHERE a.escuela_id=p_escuela_id AND a.grupo_id=p_grupo_id AND a.archivado IS NOT TRUE
    AND (a.horario_id IS DISTINCT FROM v_config.horario_id OR a.profesor_asignado_id IS DISTINCT FROM v_config.entrenador_id
      OR a.grupo_gestion_id IS DISTINCT FROM v_config.grupo_gestion_id);
END;
$$;
REVOKE ALL ON FUNCTION private.propagar_configuracion_grupo(uuid,uuid) FROM PUBLIC, anon, authenticated;

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
    AND rol = 'Entrenador' AND activo IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El entrenador no es válido, está inactivo o pertenece a otra escuela.' USING ERRCODE = '22023'; END IF;
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
  v_config record;
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
  SELECT * INTO v_config FROM private.configuracion_vigente_grupo(v_actor.escuela_id,v_destino.grupo_id);
  IF v_destino.id IS DISTINCT FROM v_config.grupo_gestion_id THEN
    RAISE EXCEPTION 'Selecciona la configuración vigente del grupo.' USING ERRCODE='22023';
  END IF;

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
      profesor_asignado_id = v_entrenador,
      updated_at = v_now
  WHERE id = v_alumno.id;
  -- La sincronización del profesor se realiza mediante el trigger del alumno.
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

  IF EXISTS (SELECT 1 FROM public.grupos_gestion gg WHERE gg.gestion_id=v_target.id
    AND gg.grupo_id IS NOT NULL GROUP BY gg.grupo_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Cada grupo debe tener una sola configuración vigente.' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.grupos g WHERE g.escuela_id=v_actor.escuela_id ORDER BY g.id FOR UPDATE;
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

  UPDATE public.gestiones_deportivas
  SET estado = 'activa', activada_por = v_actor.id,
      activada_en = v_now, updated_at = v_now
  WHERE id = v_target.id;

  DELETE FROM public.grupos_horarios gh USING public.grupos_gestion gg
  WHERE gg.gestion_id=v_target.id AND gg.grupo_id=gh.grupo_id AND gg.escuela_id=v_actor.escuela_id;
  INSERT INTO public.grupos_horarios(grupo_id,horario_id)
  SELECT gg.grupo_id,gg.horario_id FROM public.grupos_gestion gg
  WHERE gg.gestion_id=v_target.id AND gg.escuela_id=v_actor.escuela_id AND gg.grupo_id IS NOT NULL AND gg.horario_id IS NOT NULL;
  UPDATE public.alumnos a
  SET archivado = TRUE, archivado_at = v_now,
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
      profesor_asignado_id = eg.entrenador_id,
      updated_at = v_now
  FROM public.alumnos_grupos ag
  JOIN public.grupos_gestion gg ON gg.id = ag.grupo_gestion_id
  LEFT JOIN public.entrenadores_grupos eg
    ON eg.grupo_gestion_id = gg.id AND eg.estado = 'activa'
  WHERE a.id = ag.alumno_id AND ag.gestion_id = v_target.id
    AND ag.estado = 'activa';
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


CREATE OR REPLACE FUNCTION public.rpc_obtener_grupos_con_entrenador(p_escuela_id uuid)
RETURNS TABLE(id uuid,nombre text,sucursal_id uuid,sucursal_nombre text,horario_id uuid,horario_hora text,entrenador_id uuid,entrenador_nombre text,activo boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id=auth.uid() AND u.activo IS TRUE AND u.escuela_id=p_escuela_id
  ) THEN
    IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
       AND session_user NOT IN ('postgres','supabase_admin') THEN
      RAISE EXCEPTION 'No autorizado para consultar grupos de otra escuela.' USING ERRCODE='42501';
    END IF;
    -- Un usuario autenticado no puede aprovechar una conexión administrativa.
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'No autorizado para consultar grupos de otra escuela.' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN QUERY
  SELECT g.id,g.nombre::text,g.sucursal_id,s.nombre::text,c.horario_id,h.hora::text,
    c.entrenador_id,(u.nombres||' '||u.apellidos)::text,g.activo
  FROM public.grupos g
  CROSS JOIN LATERAL private.configuracion_vigente_grupo(g.escuela_id,g.id) c
  LEFT JOIN public.sucursales s ON s.id=g.sucursal_id AND s.escuela_id=g.escuela_id
  LEFT JOIN public.horarios h ON h.id=c.horario_id AND h.escuela_id=g.escuela_id
  LEFT JOIN public.usuarios u ON u.id=c.entrenador_id AND u.escuela_id=g.escuela_id
  WHERE g.escuela_id=p_escuela_id ORDER BY g.nombre;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_obtener_grupos_con_entrenador(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_obtener_grupos_con_entrenador(uuid) TO authenticated,service_role;

