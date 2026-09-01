-- Corrige la RPC heredada de Grupos y Horarios para el modelo de gestión anual.
-- entrenadores_grupos no usa rol_en_grupo y exige gestion_id.

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
  SELECT gd.id INTO v_gestion_id FROM public.gestiones_deportivas gd
  WHERE gd.escuela_id = v_actor.escuela_id AND gd.estado = 'activa' ORDER BY gd.created_at DESC LIMIT 1;
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
    IF p_entrenador_id IS NOT NULL THEN
      UPDATE public.alumnos SET profesor_asignado_id = p_entrenador_id, updated_at = v_now
      WHERE grupo_id = v_grupo_id AND escuela_id = v_actor.escuela_id AND archivado IS FALSE;
    END IF;
  END IF;
  RETURN jsonb_build_object('grupo_id', v_grupo_id, 'nombre', v_res_grupo.nombre, 'sucursal_id', v_res_grupo.sucursal_id, 'horario_id', p_horario_id, 'entrenador_id', p_entrenador_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_guardar_grupo_completo(uuid, character varying, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_grupo_completo(uuid, character varying, uuid, uuid, uuid) TO authenticated, service_role;
