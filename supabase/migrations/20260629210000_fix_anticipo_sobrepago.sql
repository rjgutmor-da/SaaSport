-- ==============================================================================
-- SaaSport: Migración para corrección del trigger de sobrepago en Anticipos
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.fn_validar_sobrepago_cxc()
RETURNS TRIGGER AS $$
DECLARE
    v_monto_total DECIMAL;
    v_pagado_anterior DECIMAL;
    v_es_anticipo BOOLEAN := false;
BEGIN
    SELECT monto_total INTO v_monto_total FROM public.cuentas_cobrar WHERE id = NEW.cuenta_cobrar_id;
    
    -- Determinar si es un anticipo a través de la vista
    BEGIN
        SELECT es_anticipo INTO v_es_anticipo FROM public.v_cuentas_cobrar WHERE id = NEW.cuenta_cobrar_id;
    EXCEPTION WHEN OTHERS THEN
        v_es_anticipo := false;
    END;

    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior FROM public.cobros_aplicados 
    WHERE cuenta_cobrar_id = NEW.cuenta_cobrar_id AND id <> NEW.id;

    -- Validar que no se cobre de más
    IF (v_pagado_anterior + NEW.monto_aplicado) > v_monto_total THEN
        -- Si es anticipo, los consumos suman al monto_aplicado, por ende superan el monto_total inicial.
        -- Omitimos la validación estricta para anticipos, permitiendo que lleguen hasta el doble (pago + consumo).
        IF NOT COALESCE(v_es_anticipo, false) THEN
            RAISE EXCEPTION 'El abono de % excede la deuda restante de la Factura CxC.', NEW.monto_aplicado;
        ELSE
            IF (v_pagado_anterior + NEW.monto_aplicado) > (v_monto_total * 2) THEN
                RAISE EXCEPTION 'El consumo de % excede el saldo disponible del Anticipo.', NEW.monto_aplicado;
            END IF;
        END IF;
    END IF;

    -- Validar que no se devuelva más de lo cobrado
    IF (v_pagado_anterior + NEW.monto_aplicado) < 0 THEN
        RAISE EXCEPTION 'El abono negativo (devolución) de % excede el total pagado de la Factura CxC.', NEW.monto_aplicado;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
