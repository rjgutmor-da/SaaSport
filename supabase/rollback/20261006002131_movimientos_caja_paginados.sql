-- Revertir primero el frontend a la version previa a la paginacion.
DROP FUNCTION IF EXISTS public.rpc_listar_movimientos_caja(uuid,timestamptz,timestamptz,text,jsonb,integer);
DROP FUNCTION IF EXISTS private.saldos_movimientos_caja(uuid,jsonb);
DROP FUNCTION IF EXISTS private.movimientos_caja_base(uuid,uuid);
