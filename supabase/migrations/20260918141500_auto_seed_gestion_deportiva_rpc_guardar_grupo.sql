-- Auto-seed de gestión deportiva activa y corrección de persistencia de entrenador en rpc_guardar_grupo_completo

-- 1. Función para sembrar o asegurar la gestión deportiva activa de una escuela
CREATE OR REPLACE FUNCTION public.fn_seed_gestion_escuela(p_escuela_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anio smallint;
  v_zona text;
  v_gestion_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Si ya existe una gestión activa, retornarla
  SELECT id INTO v_gestion_id 
  FROM public.gestiones_deportivas 
  WHERE escuela_id = p_escuela_id AND estado = 'activa' 
  ORDER BY created_at DESC 
  LIMIT 1;

  IF v_gestion_id IS NOT NULL THEN
    RETURN v_gestion_id;
  END IF;

  SELECT COALESCE(zona_horaria, 'America/La_Paz') INTO v_zona 
  FROM public.escuelas 
  WHERE id = p_escuela_id;
  
  v_anio := EXTRACT(YEAR FROM timezone(COALESCE(v_zona, 'America/La_Paz'), v_now))::smallint;

  INSERT INTO public.gestiones_deportivas (escuela_id, anio, estado, activada_en)
  VALUES (p_escuela_id, v_anio, 'activa', v_now)
  ON CONFLICT (escuela_id, anio) DO UPDATE
    SET estado = 'activa', activada_en = COALESCE(public.gestiones_deportivas.activada_en, v_now)
  RETURNING id INTO v_gestion_id;

  RETURN v_gestion_id;
END;
$$;

-- 2. Actualizar el trigger de creación de escuelas para sembrar también la gestión deportiva activa
CREATE OR REPLACE FUNCTION public.fn_after_insert_escuela()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.fn_seed_torneos_escuela(NEW.id);
  PERFORM public.fn_seed_catalogo_escuela(NEW.id);
  PERFORM public.fn_seed_gestion_escuela(NEW.id);
  RETURN NEW;
END;
$$;

-- 3. Actualizar rpc_guardar_grupo_completo para auto-recuperar o inicializar gestión deportiva si falta
CREATE OR REPLACE FUNCTION public.rpc_guardar_grupo_completo(
  p_grupo_id uuid DEFAULT NULL,
  p_nombre character varying DEFAULT NULL,
  p_sucursal_id uuid DEFAULT NULL,
  p_horario_id uuid DEFAULT NULL,
  p_entrenador_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_guardar_grupo_completo(uuid, character varying, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_grupo_completo(uuid, character varying, uuid, uuid, uuid) TO authenticated, service_role;

-- 4. Backfill de gestiones deportivas para escuelas existentes que no tengan una activa
DO $$
DECLARE
  r RECORD;
  v_gid uuid;
BEGIN
  FOR r IN 
    SELECT e.id, e.nombre
    FROM public.escuelas e
    LEFT JOIN public.gestiones_deportivas gd ON gd.escuela_id = e.id AND gd.estado = 'activa'
    WHERE gd.id IS NULL
  LOOP
    v_gid := public.fn_seed_gestion_escuela(r.id);
    
    -- Asociar grupos existentes en grupos_gestion
    INSERT INTO public.grupos_gestion (
      escuela_id, gestion_id, sucursal_id, grupo_id, horario_id,
      nombre_snapshot, hora_snapshot
    )
    SELECT DISTINCT
      gr.escuela_id,
      v_gid,
      gr.sucursal_id,
      gr.id,
      gh.horario_id,
      gr.nombre,
      h.hora
    FROM public.grupos gr
    LEFT JOIN public.grupos_horarios gh ON gh.grupo_id = gr.id
    LEFT JOIN public.horarios h ON h.id = gh.horario_id
    WHERE gr.escuela_id = r.id
    ON CONFLICT (gestion_id, grupo_id, horario_id) DO NOTHING;

    -- Asociar alumnos existentes al grupo_gestion_id
    UPDATE public.alumnos a
    SET grupo_gestion_id = gg.id
    FROM public.grupos_gestion gg
    WHERE gg.grupo_id = a.grupo_id
      AND gg.gestion_id = v_gid
      AND a.escuela_id = r.id
      AND a.grupo_gestion_id IS NULL;

    -- Sincronizar alumnos_grupos
    INSERT INTO public.alumnos_grupos (
      escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
      decision, vigente_desde, motivo
    )
    SELECT a.escuela_id, a.id, a.grupo_gestion_id, v_gid, 'activa',
           'migrara', now(), 'backfill_gestion'
    FROM public.alumnos a
    WHERE a.escuela_id = r.id
      AND a.grupo_gestion_id IS NOT NULL
      AND a.archivado IS NOT TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.alumnos_grupos ag 
        WHERE ag.alumno_id = a.id AND ag.gestion_id = v_gid AND ag.estado IN ('planificada', 'activa')
      );
  END LOOP;
END;
$$;
