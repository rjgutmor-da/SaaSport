-- Barrera de integridad para cualquier cliente o proceso que inserte detalles.
-- Al bloquear la nota antes de sumar, dos solicitudes concurrentes se serializan
-- y ninguna puede dejar el detalle por encima del importe de la Nota de Servicio.
CREATE OR REPLACE FUNCTION public.validar_total_detalle_cxc()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_monto_total numeric;
  v_escuela_id uuid;
  v_total_existente numeric;
BEGIN
  SELECT cc.monto_total, cc.escuela_id
    INTO v_monto_total, v_escuela_id
  FROM public.cuentas_cobrar cc
  WHERE cc.id = NEW.cuenta_cobrar_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La Nota de Servicio indicada no existe.'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.escuela_id IS DISTINCT FROM v_escuela_id THEN
    RAISE EXCEPTION 'El detalle debe pertenecer a la misma escuela que la Nota de Servicio.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(cd.cantidad * cd.precio_unitario), 0)
    INTO v_total_existente
  FROM public.cxc_detalle cd
  WHERE cd.cuenta_cobrar_id = NEW.cuenta_cobrar_id
    AND cd.id IS DISTINCT FROM NEW.id;

  IF v_total_existente + (NEW.cantidad * NEW.precio_unitario) > v_monto_total THEN
    RAISE EXCEPTION 'El detalle excede el total de la Nota de Servicio (Bs %).', v_monto_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_total_detalle_cxc_trigger ON public.cxc_detalle;

CREATE TRIGGER validar_total_detalle_cxc_trigger
  BEFORE INSERT OR UPDATE OF cuenta_cobrar_id, escuela_id, cantidad, precio_unitario
  ON public.cxc_detalle
  FOR EACH ROW
  EXECUTE FUNCTION public.validar_total_detalle_cxc();
