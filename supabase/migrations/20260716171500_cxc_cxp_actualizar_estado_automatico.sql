-- ==============================================================================
-- SaaSport: Sincronización Automática de Estado en CxC y CxP
-- Fecha: 2026-07-16
-- ==============================================================================

-- 1. Función y trigger para Cuentas por Cobrar (cobros_aplicados)
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_cxc()
RETURNS TRIGGER AS $$
DECLARE
    v_cxc_id UUID;
    v_monto_total DECIMAL;
    v_total_cobrado DECIMAL;
    v_nuevo_estado VARCHAR;
    v_es_anticipo BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_cxc_id := OLD.cuenta_cobrar_id;
    ELSE
        v_cxc_id := NEW.cuenta_cobrar_id;
    END IF;

    SELECT monto_total, es_anticipo INTO v_monto_total, v_es_anticipo
    FROM public.cuentas_cobrar
    WHERE id = v_cxc_id;

    IF FOUND THEN
        IF COALESCE(v_es_anticipo, false) THEN
            SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_cobrado
            FROM public.cobros_aplicados
            WHERE cuenta_cobrar_id = v_cxc_id AND es_aplicacion_anticipo IS NOT TRUE;
        ELSE
            SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_cobrado
            FROM public.cobros_aplicados
            WHERE cuenta_cobrar_id = v_cxc_id;
        END IF;

        IF v_total_cobrado >= v_monto_total THEN
            v_nuevo_estado := 'pagada';
        ELSIF v_total_cobrado > 0 THEN
            v_nuevo_estado := 'parcial';
        ELSE
            v_nuevo_estado := 'pendiente';
        END IF;

        UPDATE public.cuentas_cobrar
        SET estado = v_nuevo_estado, updated_at = NOW()
        WHERE id = v_cxc_id AND estado != 'anulada';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_estado_cxc ON public.cobros_aplicados;
CREATE TRIGGER trg_actualizar_estado_cxc
AFTER INSERT OR UPDATE OR DELETE ON public.cobros_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_estado_cxc();


-- 2. Función y trigger para Cuentas por Pagar (pagos_aplicados)
CREATE OR REPLACE FUNCTION public.fn_actualizar_estado_cxp()
RETURNS TRIGGER AS $$
DECLARE
    v_cxp_id UUID;
    v_monto_total DECIMAL;
    v_total_pagado DECIMAL;
    v_nuevo_estado VARCHAR;
    v_es_anticipo BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_cxp_id := OLD.cuenta_pagar_id;
    ELSE
        v_cxp_id := NEW.cuenta_pagar_id;
    END IF;

    SELECT monto_total, es_anticipo INTO v_monto_total, v_es_anticipo
    FROM public.cuentas_pagar
    WHERE id = v_cxp_id;

    IF FOUND THEN
        IF COALESCE(v_es_anticipo, false) THEN
            SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_pagado
            FROM public.pagos_aplicados
            WHERE cuenta_pagar_id = v_cxp_id AND es_aplicacion_anticipo IS NOT TRUE;
        ELSE
            SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_pagado
            FROM public.pagos_aplicados
            WHERE cuenta_pagar_id = v_cxp_id;
        END IF;

        IF v_total_pagado >= v_monto_total THEN
            v_nuevo_estado := 'pagada';
        ELSIF v_total_pagado > 0 THEN
            v_nuevo_estado := 'parcial';
        ELSE
            v_nuevo_estado := 'pendiente';
        END IF;

        UPDATE public.cuentas_pagar
        SET estado = v_nuevo_estado, updated_at = NOW()
        WHERE id = v_cxp_id AND estado != 'anulada';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_actualizar_estado_cxp ON public.pagos_aplicados;
CREATE TRIGGER trg_actualizar_estado_cxp
AFTER INSERT OR UPDATE OR DELETE ON public.pagos_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_estado_cxp();


-- 3. Corregir datos históricos que están fuera de sincronía

-- Cuentas por Cobrar
UPDATE public.cuentas_cobrar cc
SET estado = CASE
    WHEN cc.es_anticipo THEN
        CASE 
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.cobros_aplicados WHERE cuenta_cobrar_id = cc.id AND es_aplicacion_anticipo IS NOT TRUE), 0) >= cc.monto_total THEN 'pagada'
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.cobros_aplicados WHERE cuenta_cobrar_id = cc.id AND es_aplicacion_anticipo IS NOT TRUE), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END
    ELSE
        CASE 
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.cobros_aplicados WHERE cuenta_cobrar_id = cc.id), 0) >= cc.monto_total THEN 'pagada'
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.cobros_aplicados WHERE cuenta_cobrar_id = cc.id), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END
END
WHERE cc.anulada IS NOT TRUE;

-- Cuentas por Pagar
UPDATE public.cuentas_pagar cp
SET estado = CASE
    WHEN cp.es_anticipo THEN
        CASE 
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.pagos_aplicados WHERE cuenta_pagar_id = cp.id AND es_aplicacion_anticipo IS NOT TRUE), 0) >= cp.monto_total THEN 'pagada'
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.pagos_aplicados WHERE cuenta_pagar_id = cp.id AND es_aplicacion_anticipo IS NOT TRUE), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END
    ELSE
        CASE 
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.pagos_aplicados WHERE cuenta_pagar_id = cp.id), 0) >= cp.monto_total THEN 'pagada'
            WHEN COALESCE((SELECT SUM(monto_aplicado) FROM public.pagos_aplicados WHERE cuenta_pagar_id = cp.id), 0) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END
END
WHERE cp.anulada IS NOT TRUE;
