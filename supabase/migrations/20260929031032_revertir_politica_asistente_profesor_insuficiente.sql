-- La politica no resuelve la insercion hecha por el trigger en el mismo alta.
-- Se retira hasta que la sincronizacion pueda validarse y aplicarse aparte.
DROP POLICY IF EXISTS "Asistente asigna profesor a alumno de su sucursal"
ON public.alumnos_entrenadores;

DROP FUNCTION IF EXISTS private.asistente_puede_asignar_entrenador(uuid, uuid);
