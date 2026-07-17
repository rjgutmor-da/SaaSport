-- La funcion se invoca exclusivamente desde triggers de cobros y pagos.
-- No debe exponerse como RPC para usuarios de la aplicacion.
REVOKE ALL ON FUNCTION public.fn_actualizar_saldo_caja_v2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_actualizar_saldo_caja_v2() FROM anon;
REVOKE ALL ON FUNCTION public.fn_actualizar_saldo_caja_v2() FROM authenticated;
