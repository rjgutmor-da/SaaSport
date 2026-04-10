-- Migración para arreglar la partida doble en los pagos y compras
CREATE OR REPLACE FUNCTION public.rpc_registrar_pago_cxp(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_cxp_id UUID;
    v_asiento_id UUID;
    v_escuela_id UUID;
    v_sucursal_id UUID;
    v_usuario_id UUID;
    v_monto DECIMAL;
    v_metodo VARCHAR;
    v_cuenta_pago_id UUID; -- cuenta caja/banco desde donde sale el dinero
    v_cuenta_pasivo_id UUID; -- La cuenta de Cuentas por Pagar (2.1.1 o 2.1.2) que se va a reducir
    v_descripcion TEXT;
    v_doc_ref VARCHAR;
    v_nuevo_estado VARCHAR;
    v_pagado_anterior DECIMAL;
    v_monto_total DECIMAL;
BEGIN
    -- Extraer parámetros del payload
    v_cxp_id        := (p_payload->>'cuenta_pagar_id')::UUID;
    v_escuela_id    := (p_payload->>'escuela_id')::UUID;
    v_sucursal_id   := (p_payload->>'sucursal_id')::UUID;
    v_usuario_id    := (p_payload->>'usuario_id')::UUID;
    v_monto         := (p_payload->>'monto')::DECIMAL;
    v_metodo        := p_payload->>'metodo_pago';
    v_cuenta_pago_id := (p_payload->>'cuenta_pago_id')::UUID; -- Caja/Banco que "paga"
    v_descripcion   := COALESCE(p_payload->>'descripcion', 'Pago de Nota CxP');
    v_doc_ref       := p_payload->>'nro_comprobante';

    -- Validar que la CxP existe y obtener su monto total y su cuenta contable (la de Pasivo)
    SELECT monto_total, cuenta_contable_id INTO v_monto_total, v_cuenta_pasivo_id
    FROM public.cuentas_pagar WHERE id = v_cxp_id AND escuela_id = v_escuela_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota de Pago no encontrada o no pertenece a esta escuela.';
    END IF;

    -- Calcular total ya pagado
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior
    FROM public.pagos_aplicados WHERE cuenta_pagar_id = v_cxp_id;
    
    -- Validar que no sobrepase el total
    IF (v_pagado_anterior + v_monto) > v_monto_total THEN
        RAISE EXCEPTION 'El pago de % excede la deuda restante de %.', v_monto, (v_monto_total - v_pagado_anterior);
    END IF;

    -- 1. Crear asiento contable
    INSERT INTO public.asientos_contables (
        escuela_id, sucursal_id, usuario_id, descripcion, metodo_pago, documento_referencia
    ) VALUES (
        v_escuela_id, v_sucursal_id, v_usuario_id, v_descripcion, v_metodo, v_doc_ref
    ) RETURNING id INTO v_asiento_id;

    -- 2. Partida doble: Reducción de Pasivo (DEBE) / Caja-Banco (HABER)
    --    El pasivo se debita (se paga la deuda), la caja/banco se acredita (sale dinero)
    INSERT INTO public.movimientos_contables (escuela_id, asiento_id, cuenta_contable_id, debe, haber)
    VALUES
        -- Débito a la cuenta de Pasivo (2.1.1 o 2.1.2) que estaba en la CxP
        (v_escuela_id, v_asiento_id, v_cuenta_pasivo_id, v_monto, 0.00),
        -- Crédito a la caja/banco (1.1.1 o 1.1.2)
        (v_escuela_id, v_asiento_id, v_cuenta_pago_id, 0.00, v_monto);

    -- 3. Registrar el pago aplicado a la CxP
    INSERT INTO public.pagos_aplicados (escuela_id, cuenta_pagar_id, asiento_id, monto_aplicado)
    VALUES (v_escuela_id, v_cxp_id, v_asiento_id, v_monto);

    -- 4. Recalcular estado de la CxP
    SELECT CASE
        WHEN (v_pagado_anterior + v_monto) >= v_monto_total THEN 'pagada'
        WHEN (v_pagado_anterior + v_monto) > 0 THEN 'parcial'
        ELSE 'pendiente'
    END INTO v_nuevo_estado;
    
    UPDATE public.cuentas_pagar SET estado = v_nuevo_estado, updated_at = NOW()
    WHERE id = v_cxp_id;

    RETURN jsonb_build_object(
        'asiento_id', v_asiento_id,
        'nuevo_estado', v_nuevo_estado,
        'pagado_total', v_pagado_anterior + v_monto
    );
END;
$function$;
