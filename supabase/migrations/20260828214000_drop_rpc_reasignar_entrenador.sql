-- Migración para limpiar la función RPC obsoleta de reasignación de entrenadores
-- ya que ahora se maneja todo mediante la configuración de grupos.

DROP FUNCTION IF EXISTS public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb);
