-- La configuración de privilegios predeterminados del proyecto concede EXECUTE
-- explícitamente a anon. Esta RPC solo debe estar disponible para sesiones
-- autenticadas y para operaciones internas con service_role.
REVOKE ALL ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
