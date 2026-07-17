-- =============================================================================
-- SaaSport: Reconciliacion automatica de saldos de cajas y bancos
-- Fecha: 2026-07-17
--
-- El saldo de una caja se deriva siempre de sus cobros menos sus pagos. Recalcular
-- las cajas afectadas en cada cambio evita desfases al reemplazar cobros durante
-- la edicion de notas.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fn_actualizar_saldo_caja_v2()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_cajas_afectadas UUID[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_cajas_afectadas := ARRAY[NEW.caja_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_cajas_afectadas := ARRAY[OLD.caja_id];
    ELSE
        -- En una edicion se recalculan tanto la caja anterior como la nueva.
        v_cajas_afectadas := ARRAY[OLD.caja_id, NEW.caja_id];
    END IF;

    UPDATE public.cajas_bancos AS cb
    SET saldo_actual =
        COALESCE((
            SELECT SUM(c.monto_aplicado)
            FROM public.cobros_aplicados AS c
            WHERE c.caja_id = cb.id
        ), 0)
        - COALESCE((
            SELECT SUM(p.monto_aplicado)
            FROM public.pagos_aplicados AS p
            WHERE p.caja_id = cb.id
        ), 0)
    WHERE cb.id = ANY(v_cajas_afectadas);

    RETURN NULL;
END;
$$;

-- Reconciliar los saldos existentes una sola vez al desplegar la correccion.
UPDATE public.cajas_bancos AS cb
SET saldo_actual =
    COALESCE((
        SELECT SUM(c.monto_aplicado)
        FROM public.cobros_aplicados AS c
        WHERE c.caja_id = cb.id
    ), 0)
    - COALESCE((
        SELECT SUM(p.monto_aplicado)
        FROM public.pagos_aplicados AS p
        WHERE p.caja_id = cb.id
    ), 0);
