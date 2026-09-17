-- Estado y gestión segura de conceptos del catálogo.
-- Los saldos en cero creados al inicializar inventario no son historial y pueden
-- retirarse al eliminar un concepto que nunca fue utilizado.

CREATE OR REPLACE FUNCTION public.rpc_estado_catalogo()
RETURNS TABLE (
  catalogo_item_id uuid,
  tiene_movimientos boolean,
  tiene_saldo_no_cero boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid() AND activo;

  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo el SuperAdministrador puede gestionar el catálogo.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    ci.id,
    (
      EXISTS (SELECT 1 FROM public.cxc_detalle d WHERE d.catalogo_item_id = ci.id)
      OR EXISTS (SELECT 1 FROM public.cxp_detalle d WHERE d.catalogo_item_id = ci.id)
      OR EXISTS (SELECT 1 FROM public.movimientos_stock m WHERE m.catalogo_item_id = ci.id)
      OR EXISTS (SELECT 1 FROM public.inventario_movimientos m WHERE m.catalogo_item_id = ci.id)
    ) AS tiene_movimientos,
    EXISTS (
      SELECT 1
      FROM public.inventario_saldos s
      WHERE s.catalogo_item_id = ci.id
        AND s.escuela_id = v_actor.escuela_id
        AND s.cantidad_disponible <> 0
    ) AS tiene_saldo_no_cero
  FROM public.catalogo_items ci
  WHERE ci.escuela_id = v_actor.escuela_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_gestionar_catalogo_item(
  p_catalogo_item_id uuid,
  p_accion text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_item public.catalogo_items%ROWTYPE;
  v_tiene_movimientos boolean;
  v_tiene_saldo_no_cero boolean;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid() AND activo;

  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo el SuperAdministrador puede gestionar el catálogo.'
      USING ERRCODE = '42501';
  END IF;

  IF p_accion IS NULL OR p_accion NOT IN ('eliminar', 'desactivar', 'reactivar') THEN
    RAISE EXCEPTION 'La acción solicitada no es válida.'
      USING ERRCODE = '22023';
  END IF;

  -- El bloqueo evita que aparezcan nuevas referencias entre la comprobación y
  -- el DELETE/UPDATE. Las claves foráneas concurrentes esperan esta transacción.
  SELECT * INTO v_item
  FROM public.catalogo_items
  WHERE id = p_catalogo_item_id
    AND escuela_id = v_actor.escuela_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El concepto no existe o pertenece a otra escuela.'
      USING ERRCODE = '42501';
  END IF;

  IF lower(btrim(v_item.nombre)) = 'mensualidad' THEN
    RAISE EXCEPTION 'El ítem Mensualidad está protegido y no puede eliminarse ni desactivarse.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT
    (
      EXISTS (SELECT 1 FROM public.cxc_detalle d WHERE d.catalogo_item_id = v_item.id)
      OR EXISTS (SELECT 1 FROM public.cxp_detalle d WHERE d.catalogo_item_id = v_item.id)
      OR EXISTS (SELECT 1 FROM public.movimientos_stock m WHERE m.catalogo_item_id = v_item.id)
      OR EXISTS (SELECT 1 FROM public.inventario_movimientos m WHERE m.catalogo_item_id = v_item.id)
    ),
    EXISTS (
      SELECT 1
      FROM public.inventario_saldos s
      WHERE s.catalogo_item_id = v_item.id
        AND s.escuela_id = v_actor.escuela_id
        AND s.cantidad_disponible <> 0
    )
  INTO v_tiene_movimientos, v_tiene_saldo_no_cero;

  IF p_accion = 'eliminar' THEN
    IF v_tiene_movimientos THEN
      RAISE EXCEPTION 'El concepto ya tiene movimientos. Actualiza el catálogo y desactívalo en su lugar.'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_tiene_saldo_no_cero THEN
      RAISE EXCEPTION 'No se puede eliminar mientras tenga existencias distintas de cero en alguna sucursal.'
        USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.inventario_saldos
    WHERE catalogo_item_id = v_item.id
      AND escuela_id = v_actor.escuela_id
      AND cantidad_disponible = 0;

    DELETE FROM public.catalogo_items
    WHERE id = v_item.id AND escuela_id = v_actor.escuela_id;

    RETURN 'eliminado';
  END IF;

  IF p_accion = 'desactivar' THEN
    IF NOT v_item.activo THEN
      RETURN 'desactivado';
    END IF;
    IF NOT v_tiene_movimientos THEN
      RAISE EXCEPTION 'El concepto no tiene movimientos y puede eliminarse.'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_tiene_saldo_no_cero THEN
      RAISE EXCEPTION 'No se puede desactivar mientras tenga existencias distintas de cero en alguna sucursal.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.catalogo_items
    SET activo = false
    WHERE id = v_item.id AND escuela_id = v_actor.escuela_id;

    RETURN 'desactivado';
  END IF;

  IF v_item.activo THEN
    RETURN 'reactivado';
  END IF;

  UPDATE public.catalogo_items
  SET activo = true
  WHERE id = v_item.id AND escuela_id = v_actor.escuela_id;

  RETURN 'reactivado';
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_estado_catalogo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_gestionar_catalogo_item(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_estado_catalogo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_gestionar_catalogo_item(uuid, text) TO authenticated;
