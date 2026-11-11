-- Añade permiso solo a administradores activos sin restricción de sucursal.
CREATE POLICY insertar_cobranza_admin_global ON public.configuracion_cobranza
FOR INSERT TO authenticated
WITH CHECK (
  escuela_id = (SELECT public.current_user_escuela_id())
  AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = (SELECT auth.uid()) AND u.activo IS TRUE
      AND u.rol = 'Administrador' AND u.sucursal_id IS NULL
  )
);

CREATE POLICY actualizar_cobranza_admin_global ON public.configuracion_cobranza
FOR UPDATE TO authenticated
USING (
  escuela_id = (SELECT public.current_user_escuela_id())
  AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = (SELECT auth.uid()) AND u.activo IS TRUE
      AND u.rol = 'Administrador' AND u.sucursal_id IS NULL
  )
)
WITH CHECK (
  escuela_id = (SELECT public.current_user_escuela_id())
  AND EXISTS (
    SELECT 1 FROM public.usuarios u
    WHERE u.id = (SELECT auth.uid()) AND u.activo IS TRUE
      AND u.rol = 'Administrador' AND u.sucursal_id IS NULL
  )
);
