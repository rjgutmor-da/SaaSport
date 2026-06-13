-- Asegurar que solo pueda haber un SuperAdministrador activo por escuela
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_unique_active_superadmin_per_escuela
ON public.usuarios (escuela_id)
WHERE (rol = 'SuperAdministrador' AND activo = true);
