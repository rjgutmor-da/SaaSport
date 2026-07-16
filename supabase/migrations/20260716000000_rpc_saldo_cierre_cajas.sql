-- ==============================================================================
-- SaaSport: Módulo de Finanzas - OBTENER SALDO DE CIERRE POR CAJA
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.obtener_saldo_cierre_cajas(p_caja_ids UUID[], p_hasta TIMESTAMPTZ)
RETURNS TABLE (caja_id UUID, saldo_cierre NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id AS caja_id,
    COALESCE(
      (SELECT SUM(ca.monto_aplicado) FROM public.cobros_aplicados ca WHERE ca.caja_id = c.id AND (ca.fecha < p_hasta OR (ca.fecha IS NULL AND ca.created_at < p_hasta)))
    , 0)::NUMERIC - COALESCE(
      (SELECT SUM(pa.monto_aplicado) FROM public.pagos_aplicados pa WHERE pa.caja_id = c.id AND (pa.fecha < p_hasta OR (pa.fecha IS NULL AND pa.created_at < p_hasta)))
    , 0)::NUMERIC AS saldo_cierre
  FROM public.cajas_bancos c
  WHERE c.id = ANY(p_caja_ids);
END;
$$;
