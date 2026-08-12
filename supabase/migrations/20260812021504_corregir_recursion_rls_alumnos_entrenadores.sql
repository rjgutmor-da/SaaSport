-- Evita la recursión RLS alumnos -> alumnos_entrenadores -> alumnos.
-- La comprobación conserva el aislamiento por escuela y exige un actor activo.
CREATE OR REPLACE FUNCTION public.alumno_pertenece_escuela_actual(p_alumno_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.alumnos alumno
    JOIN public.usuarios actor
      ON actor.id = auth.uid()
     AND actor.activo IS TRUE
     AND actor.escuela_id = alumno.escuela_id
    WHERE alumno.id = p_alumno_id
  );
$$;

REVOKE ALL ON FUNCTION public.alumno_pertenece_escuela_actual(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.alumno_pertenece_escuela_actual(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.alumno_pertenece_escuela_actual(uuid) TO authenticated;

DROP POLICY IF EXISTS "Gestión para staff" ON public.alumnos_entrenadores;
CREATE POLICY "Gestión para staff" ON public.alumnos_entrenadores
FOR ALL TO authenticated
USING (
  current_user_rol() IN ('Entrenador', 'Administrador', 'SuperAdministrador')
  AND public.alumno_pertenece_escuela_actual(alumno_id)
)
WITH CHECK (
  current_user_rol() IN ('Entrenador', 'Administrador', 'SuperAdministrador')
  AND public.alumno_pertenece_escuela_actual(alumno_id)
);

NOTIFY pgrst, 'reload schema';
