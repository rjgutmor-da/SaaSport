CREATE OR REPLACE FUNCTION public.rpc_editar_movimiento_simple(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_movimiento_id UUID;
    v_tipo_origen TEXT;
    v_cuenta_id UUID;
    v_monto NUMERIC;
    v_fecha TIMESTAMP;
    v_descripcion TEXT;
    v_nro_transaccion TEXT;
    v_parent_id UUID;
    v_movimiento_count INT;
    v_concepto_id UUID;
BEGIN
    -- 1. Extraer datos del payload
    v_movimiento_id := (p_payload->>'movimiento_id')::UUID;
    v_tipo_origen := p_payload->>'tipo_origen';
    v_cuenta_id := (p_payload->>'cuenta_id')::UUID;
    v_monto := (p_payload->>'monto')::NUMERIC;
    v_fecha := (p_payload->>'fecha')::TIMESTAMP;
    v_descripcion := p_payload->>'descripcion';
    v_nro_transaccion := p_payload->>'nro_transaccion';
    v_concepto_id := (p_payload->>'concepto_id')::UUID;

    -- 2. Identificar y actualizar según origen
    IF v_tipo_origen IN ('ingreso', 'cobro') THEN
        SELECT cuenta_cobrar_id INTO v_parent_id FROM cobros_aplicados WHERE id = v_movimiento_id;
        
        UPDATE cobros_aplicados 
        SET monto_aplicado = v_monto,
            fecha = v_fecha,
            caja_id = v_cuenta_id,
            documento_referencia = v_nro_transaccion
        WHERE id = v_movimiento_id;

        SELECT count(*) INTO v_movimiento_count FROM cobros_aplicados WHERE cuenta_cobrar_id = v_parent_id;
        
        UPDATE cuentas_cobrar 
        SET descripcion = v_descripcion,
            nro_recibo = v_nro_transaccion,
            fecha_emision = v_fecha::date,
            monto_total = CASE WHEN v_movimiento_count = 1 THEN v_monto ELSE monto_total END
        WHERE id = v_parent_id;

        IF v_concepto_id IS NOT NULL THEN
            IF (SELECT count(*) FROM cxc_detalle WHERE cuenta_cobrar_id = v_parent_id) = 1 THEN
                UPDATE cxc_detalle
                SET catalogo_item_id = v_concepto_id,
                    precio_unitario = CASE WHEN v_movimiento_count = 1 THEN v_monto ELSE precio_unitario END
                WHERE cuenta_cobrar_id = v_parent_id;
            END IF;
        END IF;

    ELSIF v_tipo_origen IN ('egreso', 'pago') THEN
        SELECT cuenta_pagar_id INTO v_parent_id FROM pagos_aplicados WHERE id = v_movimiento_id;
        
        UPDATE pagos_aplicados 
        SET monto_aplicado = v_monto,
            fecha = v_fecha,
            caja_id = v_cuenta_id,
            referencia = v_nro_transaccion
        WHERE id = v_movimiento_id;

        SELECT count(*) INTO v_movimiento_count FROM pagos_aplicados WHERE cuenta_pagar_id = v_parent_id;
        
        UPDATE cuentas_pagar 
        SET descripcion = v_descripcion,
            fecha_emision = v_fecha::date,
            monto_total = CASE WHEN v_movimiento_count = 1 THEN v_monto ELSE monto_total END
        WHERE id = v_parent_id;

        IF v_concepto_id IS NOT NULL THEN
            IF (SELECT count(*) FROM cxp_detalle WHERE cuenta_pagar_id = v_parent_id) = 1 THEN
                UPDATE cxp_detalle
                SET catalogo_item_id = v_concepto_id,
                    precio_unitario = CASE WHEN v_movimiento_count = 1 THEN v_monto ELSE precio_unitario END
                WHERE cuenta_pagar_id = v_parent_id;
            END IF;
        END IF;

    ELSE
        RETURN jsonb_build_object('success', false, 'message', 'Tipo de origen no soportado (' || v_tipo_origen || ')');
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Movimiento actualizado correctamente');
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$function$;
