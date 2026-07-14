-- Migration: Remover estatus de facturación automática cuando la cuenta por cobrar es pagada.

CREATE OR REPLACE FUNCTION public.fn_cxc_perder_estatus_automatico()
RETURNS TRIGGER AS $$
BEGIN
    -- Si el estado pasa a ser 'pagada' y el origen era 'automatico'
    IF NEW.estado = 'pagada' AND OLD.origen_facturacion = 'automatico' THEN
        NEW.origen_facturacion := 'manual';
        NEW.ejecucion_facturacion_id := NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger BEFORE UPDATE
DROP TRIGGER IF EXISTS trg_cxc_perder_estatus_automatico ON public.cuentas_cobrar;

CREATE TRIGGER trg_cxc_perder_estatus_automatico
BEFORE UPDATE ON public.cuentas_cobrar
FOR EACH ROW
EXECUTE FUNCTION public.fn_cxc_perder_estatus_automatico();
