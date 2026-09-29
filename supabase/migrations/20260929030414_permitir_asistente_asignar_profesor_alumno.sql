-- El alta de un alumno con profesor dispara sync_alumnos_entrenadores().
-- El Asistente puede crear el alumno de su sucursal, pero la tabla puente
-- necesita una politica INSERT con el mismo alcance.
CREATE OR REPLACE FUNCTION private.asistente_puede_asignar_entrenador(
  p_alumno_id uuid,
  p_entrenador_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.alumnos a
    JOIN public.usuarios actor ON actor.id = auth.uid()
    JOIN public.usuarios entrenador ON entrenador.id = p_entrenador_id
    WHERE a.id = p_alumno_id
      AND actor.activo IS TRUE
      AND actor.rol = 'Asistente'
      AND actor.escuela_id = a.escuela_id
      AND (actor.sucursal_id IS NULL OR actor.sucursal_id = a.sucursal_id)
      AND a.profesor_asignado_id = p_entrenador_id
      AND entrenador.activo IS TRUE
      AND entrenador.escuela_id = a.escuela_id
      AND entrenador.rol IN ('Entrenador', 'Entrenarqueros')
  );
$$;

REVOKE ALL ON FUNCTION private.asistente_puede_asignar_entrenador(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.asistente_puede_asignar_entrenador(uuid, uuid) TO authenticated;

CREATE POLICY "Asistente asigna profesor a alumno de su sucursal"
ON public.alumnos_entrenadores
FOR INSERT TO authenticated
WITH CHECK (private.asistente_puede_asignar_entrenador(alumno_id, entrenador_id));
