-- Baja segura de entrenadores con reasignación completa por grupo.
-- No elimina cuentas ni historial: cambia el entrenador principal, conserva
-- las asistencias y deja al usuario saliente inactivo.

-- La sincronización anterior insertaba el nuevo entrenador antes de remover el
-- anterior. Con un alumno que ya tenía tres entrenadores eso fallaba por el
-- límite máximo. Reemplazar la fila puente conserva el límite en todo momento.
CREATE OR REPLACE FUNCTION public.sync_alumnos_entrenadores()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.profesor_asignado_id IS DISTINCT FROM NEW.profesor_asignado_id THEN
    IF OLD.profesor_asignado_id IS NOT NULL AND NEW.profesor_asignado_id IS NOT NULL THEN
      IF EXISTS (
        SELECT 1
        FROM public.alumnos_entrenadores ae
        WHERE ae.alumno_id = NEW.id
          AND ae.entrenador_id = NEW.profesor_asignado_id
      ) THEN
        DELETE FROM public.alumnos_entrenadores
        WHERE alumno_id = NEW.id
          AND entrenador_id = OLD.profesor_asignado_id;
      ELSE
        UPDATE public.alumnos_entrenadores
        SET entrenador_id = NEW.profesor_asignado_id
        WHERE alumno_id = NEW.id
          AND entrenador_id = OLD.profesor_asignado_id;

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
      WHERE alumno_id = OLD.id
        AND entrenador_id = OLD.profesor_asignado_id;
    END IF;
  ELSIF TG_OP = 'INSERT' AND NEW.profesor_asignado_id IS NOT NULL THEN
    INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
    VALUES (NEW.id, NEW.profesor_asignado_id)
    ON CONFLICT (alumno_id, entrenador_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Los permisos de RLS dejan de reconocer una cuenta inactiva inmediatamente.
CREATE OR REPLACE FUNCTION public.current_user_rol()
RETURNS character varying
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT rol
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;
$$;

CREATE OR REPLACE FUNCTION public.current_user_escuela_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT escuela_id
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;
$$;

-- Un usuario autenticado no puede reactivarse ni cambiar su propio alcance
-- mediante las políticas heredadas de actualización de perfil.
CREATE OR REPLACE FUNCTION public.proteger_campos_sensibles_usuario()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.rol = 'Entrenador'
     AND OLD.activo IS TRUE
     AND NEW.activo IS FALSE
     AND current_setting('app.reasignacion_entrenador', true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'La baja de un entrenador debe realizarse con la reasignación de sus grupos.'
      USING ERRCODE = '22023';
  END IF;

  IF auth.uid() = OLD.id
     AND (
       OLD.rol IS DISTINCT FROM NEW.rol
       OR OLD.activo IS DISTINCT FROM NEW.activo
       OR OLD.escuela_id IS DISTINCT FROM NEW.escuela_id
       OR OLD.sucursal_id IS DISTINCT FROM NEW.sucursal_id
     ) THEN
    RAISE EXCEPTION 'No puedes modificar los permisos, estado o alcance de tu propia cuenta.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS proteger_campos_sensibles_usuario ON public.usuarios;
CREATE TRIGGER proteger_campos_sensibles_usuario
BEFORE UPDATE OF rol, activo, escuela_id, sucursal_id ON public.usuarios
FOR EACH ROW EXECUTE FUNCTION public.proteger_campos_sensibles_usuario();

CREATE OR REPLACE FUNCTION public.rpc_reasignar_y_desactivar_entrenador(
  p_entrenador_saliente uuid,
  p_asignaciones jsonb
)
RETURNS TABLE (
  alumnos_reasignados integer,
  grupos_reasignados integer,
  sesiones_revocadas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_saliente public.usuarios%ROWTYPE;
  v_alumnos integer := 0;
  v_grupos integer := 0;
  v_sesiones integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Debes iniciar sesión para realizar esta operación.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;

  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede dar de baja y reasignar entrenadores.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_saliente
  FROM public.usuarios
  WHERE id = p_entrenador_saliente
  FOR UPDATE;

  IF NOT FOUND OR v_saliente.escuela_id <> v_actor.escuela_id THEN
    RAISE EXCEPTION 'El entrenador no pertenece a tu escuela.' USING ERRCODE = '42501';
  END IF;

  IF v_saliente.rol <> 'Entrenador' OR v_saliente.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo se puede dar de baja a un entrenador activo.' USING ERRCODE = '22023';
  END IF;

  IF p_asignaciones IS NULL OR jsonb_typeof(p_asignaciones) <> 'array' THEN
    RAISE EXCEPTION 'Las asignaciones deben enviarse como una lista de grupos.' USING ERRCODE = '22023';
  END IF;

  -- Bloquea los alumnos actuales antes de validar los grupos y ejecutar el cambio.
  PERFORM 1
  FROM public.alumnos
  WHERE escuela_id = v_actor.escuela_id
    AND profesor_asignado_id = p_entrenador_saliente
  FOR UPDATE;

  IF EXISTS (
    WITH asignaciones AS (
      SELECT *
      FROM jsonb_to_recordset(p_asignaciones) AS x(
        sucursal_id uuid,
        grupo_id uuid,
        horario_id uuid,
        entrenador_destino_id uuid
      )
    )
    SELECT 1
    FROM asignaciones
    GROUP BY sucursal_id, grupo_id, horario_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cada grupo solo puede tener un entrenador destino.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    WITH asignaciones AS (
      SELECT *
      FROM jsonb_to_recordset(p_asignaciones) AS x(
        sucursal_id uuid,
        grupo_id uuid,
        horario_id uuid,
        entrenador_destino_id uuid
      )
    )
    SELECT 1
    FROM asignaciones a
    LEFT JOIN public.usuarios destino ON destino.id = a.entrenador_destino_id
    WHERE a.entrenador_destino_id IS NULL
       OR destino.id IS NULL
       OR destino.id = p_entrenador_saliente
       OR destino.escuela_id <> v_actor.escuela_id
       OR destino.rol <> 'Entrenador'
       OR destino.activo IS NOT TRUE
       OR (destino.sucursal_id IS NOT NULL AND destino.sucursal_id IS DISTINCT FROM a.sucursal_id)
  ) THEN
    RAISE EXCEPTION 'Hay un entrenador destino inválido, inactivo o fuera de la sucursal del grupo.' USING ERRCODE = '22023';
  END IF;

  WITH grupos_actuales AS (
    SELECT sucursal_id, grupo_id, horario_id, count(*) AS total
    FROM public.alumnos
    WHERE escuela_id = v_actor.escuela_id
      AND profesor_asignado_id = p_entrenador_saliente
    GROUP BY sucursal_id, grupo_id, horario_id
  ), asignaciones AS (
    SELECT *
    FROM jsonb_to_recordset(p_asignaciones) AS x(
      sucursal_id uuid,
      grupo_id uuid,
      horario_id uuid,
      entrenador_destino_id uuid
    )
  )
  SELECT count(*) INTO v_grupos FROM grupos_actuales;

  IF EXISTS (
    WITH grupos_actuales AS (
      SELECT sucursal_id, grupo_id, horario_id
      FROM public.alumnos
      WHERE escuela_id = v_actor.escuela_id
        AND profesor_asignado_id = p_entrenador_saliente
      GROUP BY sucursal_id, grupo_id, horario_id
    ), asignaciones AS (
      SELECT *
      FROM jsonb_to_recordset(p_asignaciones) AS x(
        sucursal_id uuid,
        grupo_id uuid,
        horario_id uuid,
        entrenador_destino_id uuid
      )
    )
    SELECT 1
    FROM grupos_actuales g
    LEFT JOIN asignaciones a
      ON a.sucursal_id IS NOT DISTINCT FROM g.sucursal_id
     AND a.grupo_id IS NOT DISTINCT FROM g.grupo_id
     AND a.horario_id IS NOT DISTINCT FROM g.horario_id
    WHERE a.entrenador_destino_id IS NULL
  ) OR EXISTS (
    WITH grupos_actuales AS (
      SELECT sucursal_id, grupo_id, horario_id, count(*) AS total
      FROM public.alumnos
      WHERE escuela_id = v_actor.escuela_id
        AND profesor_asignado_id = p_entrenador_saliente
      GROUP BY sucursal_id, grupo_id, horario_id
    ), asignaciones AS (
      SELECT *
      FROM jsonb_to_recordset(p_asignaciones) AS x(
        sucursal_id uuid,
        grupo_id uuid,
        horario_id uuid,
        entrenador_destino_id uuid
      )
    )
    SELECT 1
    FROM asignaciones a
    LEFT JOIN grupos_actuales g
      ON g.sucursal_id IS NOT DISTINCT FROM a.sucursal_id
     AND g.grupo_id IS NOT DISTINCT FROM a.grupo_id
     AND g.horario_id IS NOT DISTINCT FROM a.horario_id
    WHERE g.total IS NULL
  ) THEN
    RAISE EXCEPTION 'Las asignaciones no cubren exactamente todos los grupos actuales del entrenador.' USING ERRCODE = '22023';
  END IF;

  WITH asignaciones AS (
    SELECT *
    FROM jsonb_to_recordset(p_asignaciones) AS x(
      sucursal_id uuid,
      grupo_id uuid,
      horario_id uuid,
      entrenador_destino_id uuid
    )
  ), actualizados AS (
    UPDATE public.alumnos alumno
    SET profesor_asignado_id = a.entrenador_destino_id
    FROM asignaciones a
    WHERE alumno.escuela_id = v_actor.escuela_id
      AND alumno.profesor_asignado_id = p_entrenador_saliente
      AND alumno.sucursal_id IS NOT DISTINCT FROM a.sucursal_id
      AND alumno.grupo_id IS NOT DISTINCT FROM a.grupo_id
      AND alumno.horario_id IS NOT DISTINCT FROM a.horario_id
    RETURNING alumno.id
  )
  SELECT count(*) INTO v_alumnos FROM actualizados;

  PERFORM set_config('app.reasignacion_entrenador', 'true', true);

  UPDATE public.usuarios
  SET activo = false
  WHERE id = p_entrenador_saliente;

  UPDATE public.user_app_sessions
  SET revoked_at = now(),
      revoked_reason = 'baja_entrenador_reasignacion'
  WHERE user_id = p_entrenador_saliente
    AND revoked_at IS NULL;
  GET DIAGNOSTICS v_sesiones = ROW_COUNT;

  INSERT INTO public.audit_log (
    escuela_id,
    usuario_id,
    usuario_nombre,
    accion,
    modulo,
    entidad_id,
    detalle
  ) VALUES (
    v_actor.escuela_id,
    v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'BAJA_ENTRENADOR_REASIGNACION',
    'usuarios',
    p_entrenador_saliente::text,
    jsonb_build_object(
      'alumnos_reasignados', v_alumnos,
      'grupos_reasignados', v_grupos,
      'sesiones_revocadas', v_sesiones
    )
  );

  RETURN QUERY SELECT v_alumnos, v_grupos, v_sesiones;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) TO authenticated;

-- Algunas políticas heredadas consultaban `usuarios` directamente. Se reemplazan
-- por comprobaciones que también requieren que la cuenta siga activa.
DROP POLICY IF EXISTS "Gestión para staff" ON public.alumnos_entrenadores;
CREATE POLICY "Gestión para staff" ON public.alumnos_entrenadores
FOR ALL TO authenticated
USING (
  current_user_rol() IN ('Entrenador', 'Administrador', 'SuperAdministrador')
  AND EXISTS (
    SELECT 1
    FROM public.alumnos alumno
    WHERE alumno.id = alumnos_entrenadores.alumno_id
      AND alumno.escuela_id = current_user_escuela_id()
  )
)
WITH CHECK (
  current_user_rol() IN ('Entrenador', 'Administrador', 'SuperAdministrador')
  AND EXISTS (
    SELECT 1
    FROM public.alumnos alumno
    WHERE alumno.id = alumnos_entrenadores.alumno_id
      AND alumno.escuela_id = current_user_escuela_id()
  )
);

DROP POLICY IF EXISTS "entrenador_edita_su_asistencia_normal" ON public.asistencias_normales;
CREATE POLICY "entrenador_edita_su_asistencia_normal" ON public.asistencias_normales
FOR UPDATE TO authenticated
USING (entrenador_id = auth.uid() AND fecha = CURRENT_DATE AND current_user_rol() IS NOT NULL)
WITH CHECK (entrenador_id = auth.uid() AND current_user_rol() IS NOT NULL);

DROP POLICY IF EXISTS "entrenador_edita_su_asistencia_arquero" ON public.asistencias_arqueros;
CREATE POLICY "entrenador_edita_su_asistencia_arquero" ON public.asistencias_arqueros
FOR UPDATE TO authenticated
USING (entrenador_id = auth.uid() AND fecha = CURRENT_DATE AND current_user_rol() IS NOT NULL)
WITH CHECK (entrenador_id = auth.uid() AND current_user_rol() IS NOT NULL);

DROP POLICY IF EXISTS "Permitir ALL a admins en asistencias_normales" ON public.asistencias_normales;
CREATE POLICY "Permitir ALL a admins en asistencias_normales" ON public.asistencias_normales
FOR ALL TO authenticated
USING (
  current_user_rol() IN ('Administrador', 'SuperAdministrador')
)
WITH CHECK (
  current_user_rol() IN ('Administrador', 'SuperAdministrador')
);

DROP POLICY IF EXISTS "Usuarios pueden insertar logs de su escuela" ON public.audit_log;
CREATE POLICY "Usuarios pueden insertar logs de su escuela" ON public.audit_log
FOR INSERT TO authenticated
WITH CHECK (escuela_id = current_user_escuela_id());

DROP POLICY IF EXISTS "Usuarios pueden ver logs de su escuela" ON public.audit_log;
CREATE POLICY "Usuarios pueden ver logs de su escuela" ON public.audit_log
FOR SELECT TO authenticated
USING (escuela_id = current_user_escuela_id());

DROP POLICY IF EXISTS ciclos_omitidos_select ON public.ciclos_omitidos;
CREATE POLICY ciclos_omitidos_select ON public.ciclos_omitidos
FOR SELECT TO authenticated
USING (escuela_id = current_user_escuela_id());
DROP POLICY IF EXISTS ciclos_omitidos_insert ON public.ciclos_omitidos;
CREATE POLICY ciclos_omitidos_insert ON public.ciclos_omitidos
FOR INSERT TO authenticated
WITH CHECK (escuela_id = current_user_escuela_id());
DROP POLICY IF EXISTS ciclos_omitidos_delete ON public.ciclos_omitidos;
CREATE POLICY ciclos_omitidos_delete ON public.ciclos_omitidos
FOR DELETE TO authenticated
USING (escuela_id = current_user_escuela_id());

DROP POLICY IF EXISTS cxc_detalle_sel ON public.cxc_detalle;
CREATE POLICY cxc_detalle_sel ON public.cxc_detalle
FOR SELECT TO authenticated
USING (escuela_id = current_user_escuela_id());
DROP POLICY IF EXISTS cxc_detalle_ins ON public.cxc_detalle;
CREATE POLICY cxc_detalle_ins ON public.cxc_detalle
FOR INSERT TO authenticated
WITH CHECK (escuela_id = current_user_escuela_id());
DROP POLICY IF EXISTS cxc_detalle_upd ON public.cxc_detalle;
CREATE POLICY cxc_detalle_upd ON public.cxc_detalle
FOR UPDATE TO authenticated
USING (escuela_id = current_user_escuela_id())
WITH CHECK (escuela_id = current_user_escuela_id());

DROP POLICY IF EXISTS "Solo SuperAdmin puede ver login_attempts" ON public.login_attempts;
CREATE POLICY "Solo SuperAdmin puede ver login_attempts" ON public.login_attempts
FOR SELECT TO authenticated
USING (current_user_rol() = 'SuperAdministrador');

DROP POLICY IF EXISTS "Administradores pueden actualizar sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden actualizar sucursales" ON public.sucursales
FOR UPDATE TO authenticated
USING (escuela_id = current_user_escuela_id() AND current_user_rol() IN ('Administrador', 'SuperAdministrador'))
WITH CHECK (escuela_id = current_user_escuela_id() AND current_user_rol() IN ('Administrador', 'SuperAdministrador'));
DROP POLICY IF EXISTS "Administradores pueden crear sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden crear sucursales" ON public.sucursales
FOR INSERT TO authenticated
WITH CHECK (escuela_id = current_user_escuela_id() AND current_user_rol() IN ('Administrador', 'SuperAdministrador'));
DROP POLICY IF EXISTS "Administradores pueden eliminar sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden eliminar sucursales" ON public.sucursales
FOR DELETE TO authenticated
USING (escuela_id = current_user_escuela_id() AND current_user_rol() IN ('Administrador', 'SuperAdministrador'));
DROP POLICY IF EXISTS "Usuarios asisport pueden ver sucursales de su escuela" ON public.sucursales;
CREATE POLICY "Usuarios asisport pueden ver sucursales de su escuela" ON public.sucursales
FOR SELECT TO authenticated
USING (escuela_id = current_user_escuela_id());

DROP POLICY IF EXISTS user_app_sessions_select_own_or_school_admin ON public.user_app_sessions;
CREATE POLICY user_app_sessions_select_own_or_school_admin ON public.user_app_sessions
FOR SELECT TO authenticated
USING (
  current_user_rol() IS NOT NULL
  AND (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.usuarios actor
      JOIN public.usuarios target ON target.id = user_app_sessions.user_id
      WHERE actor.id = auth.uid()
        AND actor.activo IS TRUE
        AND actor.rol IN ('SuperAdministrador', 'Administrador')
        AND actor.escuela_id = target.escuela_id
    )
  )
);

DROP POLICY IF EXISTS "Allow update own profile" ON public.usuarios;
CREATE POLICY "Allow update own profile" ON public.usuarios
FOR UPDATE TO authenticated
USING (auth.uid() = id AND activo IS TRUE)
WITH CHECK (auth.uid() = id AND activo IS TRUE);
DROP POLICY IF EXISTS "Usuarios pueden actualizar su propio perfil" ON public.usuarios;
CREATE POLICY "Usuarios pueden actualizar su propio perfil" ON public.usuarios
FOR UPDATE TO authenticated
USING (auth.uid() = id AND activo IS TRUE)
WITH CHECK (auth.uid() = id AND activo IS TRUE);
DROP POLICY IF EXISTS "Usuarios pueden ver su propio perfil" ON public.usuarios;
CREATE POLICY "Usuarios pueden ver su propio perfil" ON public.usuarios
FOR SELECT TO authenticated
USING (auth.uid() = id AND activo IS TRUE);
