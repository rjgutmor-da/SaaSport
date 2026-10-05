ALTER POLICY cuentas_cobrar_select_alcance_restrictivo ON public.cuentas_cobrar
USING (
  (SELECT public.current_user_rol()) IN ('SuperAdministrador', 'Administrador', 'Asistente')
  AND escuela_id = (SELECT public.current_user_escuela_id())
  AND (
    (SELECT public.current_user_rol()) NOT IN ('Administrador', 'Asistente')
    OR (SELECT private.current_user_sucursal_id()) IS NULL
    OR EXISTS (
      SELECT 1
      FROM public.alumnos AS a_scope
      WHERE a_scope.id = cuentas_cobrar.alumno_id
        AND a_scope.escuela_id = cuentas_cobrar.escuela_id
        AND a_scope.sucursal_id = (SELECT private.current_user_sucursal_id())
    )
  )
);
