-- La politica INSERT no puede validar de forma fiable el alumno que se esta
-- creando dentro del mismo comando. El trigger recibe NEW y valida ese alcance
-- antes de sincronizar la tabla puente con privilegios propios.
DROP POLICY IF EXISTS "Asistente asigna profesor a alumno de su sucursal"
ON public.alumnos_entrenadores;

DROP FUNCTION IF EXISTS private.asistente_puede_asignar_entrenador(uuid, uuid);

CREATE OR REPLACE FUNCTION private.sync_alumnos_entrenadores_autorizado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
$$;

REVOKE ALL ON FUNCTION private.sync_alumnos_entrenadores_autorizado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.sync_alumnos_entrenadores_autorizado() TO authenticated;

DROP TRIGGER IF EXISTS trigger_sync_alumnos_entrenadores ON public.alumnos;
CREATE TRIGGER trigger_sync_alumnos_entrenadores
AFTER INSERT OR UPDATE OF profesor_asignado_id ON public.alumnos
FOR EACH ROW EXECUTE FUNCTION private.sync_alumnos_entrenadores_autorizado();
