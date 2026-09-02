-- Kill switches granulares (ejecutar solo la sentencia de la policy afectada).
DROP POLICY IF EXISTS alumnos_select_alcance_restrictivo ON public.alumnos;
DROP POLICY IF EXISTS cuentas_cobrar_select_alcance_restrictivo ON public.cuentas_cobrar;
DROP POLICY IF EXISTS cxc_detalle_select_alcance_restrictivo ON public.cxc_detalle;
DROP POLICY IF EXISTS cobros_aplicados_select_alcance_restrictivo ON public.cobros_aplicados;

-- Reversion completa del objeto de busqueda. No modifica v_alumnos_deuda.
DROP FUNCTION IF EXISTS public.rpc_buscar_alumnos_cxc(
  text, text, boolean, uuid, uuid, uuid, uuid, integer, integer
);
DROP INDEX IF EXISTS public.idx_alumnos_scope_sucursal_orden;
DROP FUNCTION IF EXISTS private.current_user_sucursal_id();
