-- ==============================================================================
-- SaaSport: Migración para el Registro de Devoluciones (CxC) - Corrección Opción B
-- Ubicación Oficial: SaaSport/supabase/migrations/20260619173000_cxc_devoluciones_fix.sql
-- ==============================================================================

-- ACTUALIZAR LA FUNCIÓN RPC PARA REGISTRAR DEVOLUCIONES DECREMENTANDO EL MONTO TOTAL DE LA NOTA (OPCIÓN B)
CREATE OR REPLACE FUNCTION public.rpc_registrar_devolucion_cxc(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_cxc_id UUID;
    v_escuela_id UUID;
    v_sucursal_id UUID;
    v_usuario_id UUID;
    v_monto DECIMAL;
    v_caja_id UUID;
    v_descripcion TEXT;
    v_doc_ref VARCHAR;
    v_fecha TIMESTAMP WITH TIME ZONE;
    
    v_monto_total DECIMAL;
    v_anulada BOOLEAN;
    v_pagado_anterior DECIMAL;
    v_nuevo_estado VARCHAR;
    v_cobro_id UUID;
    v_total_pagado DECIMAL;
    v_nuevo_monto_total DECIMAL;
BEGIN
    v_cxc_id        := (p_payload->>'cuenta_cobrar_id')::UUID;
    v_escuela_id    := (p_payload->>'escuela_id')::UUID;
    v_sucursal_id   := (p_payload->>'sucursal_id')::UUID;
    v_usuario_id    := (p_payload->>'usuario_id')::UUID;
    v_monto         := (p_payload->>'monto')::DECIMAL; -- Monto positivo a devolver
    v_caja_id       := (p_payload->>'cuenta_cobro_id')::UUID; -- Caja/Banco de donde sale el dinero
    v_descripcion   := COALESCE(p_payload->>'descripcion', 'Devolución de Cobro CxC');
    v_doc_ref       := p_payload->>'nro_comprobante';
    v_fecha         := COALESCE((p_payload->>'fecha')::TIMESTAMP WITH TIME ZONE, CURRENT_TIMESTAMP);

    -- Validaciones iniciales
    IF v_cxc_id IS NULL THEN
        RAISE EXCEPTION 'Debe especificar el ID de la cuenta por cobrar.';
    END IF;
    IF v_caja_id IS NULL THEN
        RAISE EXCEPTION 'Debe especificar la caja/banco para procesar la devolución.';
    END IF;
    IF v_monto <= 0 THEN
        RAISE EXCEPTION 'El monto de la devolución debe ser mayor a cero.';
    END IF;

    -- Obtener datos de la nota
    SELECT monto_total, anulada INTO v_monto_total, v_anulada
    FROM public.cuentas_cobrar WHERE id = v_cxc_id AND escuela_id = v_escuela_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Nota de Servicio no encontrada o no pertenece a esta escuela.';
    END IF;

    IF v_anulada THEN
        RAISE EXCEPTION 'No se puede registrar una devolución para una nota anulada.';
    END IF;

    -- Calcular total cobrado hasta el momento
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior
    FROM public.cobros_aplicados WHERE cuenta_cobrar_id = v_cxc_id;
    
    -- Validar que la devolución no exceda lo pagado
    IF v_monto > v_pagado_anterior THEN
        RAISE EXCEPTION 'El monto a devolver (%) excede el total cobrado de la nota (%).', v_monto, v_pagado_anterior;
    END IF;

    -- Insertar el cobro aplicado con valor negativo
    -- Esto disminuirá el saldo de la caja mediante el trigger trg_actualizar_saldo_cobro
    INSERT INTO public.cobros_aplicados (
        escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, caja_id, documento_referencia
    ) VALUES (
        v_escuela_id, v_cxc_id, -v_monto, v_fecha, v_caja_id, v_doc_ref
    ) RETURNING id INTO v_cobro_id;

    -- Recalcular el total pagado acumulado
    v_total_pagado := v_pagado_anterior - v_monto;
    
    -- Disminuir el monto_total de la cuenta por cobrar en el monto de la devolución (Opción B)
    v_nuevo_monto_total := v_monto_total - v_monto;
    UPDATE public.cuentas_cobrar 
    SET monto_total = v_nuevo_monto_total,
        updated_at = NOW()
    WHERE id = v_cxc_id;

    -- Recalcular y actualizar estado de la CxC
    SELECT CASE
        WHEN v_total_pagado >= v_nuevo_monto_total THEN 'pagada'
        WHEN v_total_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
    END INTO v_nuevo_estado;
    
    UPDATE public.cuentas_cobrar SET estado = v_nuevo_estado, updated_at = NOW()
    WHERE id = v_cxc_id;

    RETURN jsonb_build_object(
        'cobro_id', v_cobro_id,
        'nuevo_estado', v_nuevo_estado,
        'pagado_total', v_total_pagado,
        'monto_total', v_nuevo_monto_total
    );
END;
$$;
