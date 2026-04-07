-- ==============================================================================
-- SaaSport: Módulo de Finanzas - TRANSACCIONES ATÓMICAS (RPC)
-- Función para insertar Flujos Complejos (Asiento + Movimientos + Cobros/Pagos)
-- ==============================================================================

CREATE OR REPLACE FUNCTION rpc_procesar_transaccion_financiera(p_payload JSONB)
RETURNS UUID AS $$
DECLARE
    v_asiento_id UUID;
    v_mov RECORD;
    v_cobro RECORD;
    v_pago RECORD;
BEGIN
    -- Todo el bloque dentro de esta función se ejecuta de forma ATÓMICA (BEGIN / COMMIT implícito).
    -- Si falla algo (ej. sobrepago, restricción de partida doble), TODO se revierte ("Rollback" automático).

    -- 1. Crear Asiento Contable
    INSERT INTO public.asientos_contables (
        escuela_id, sucursal_id, usuario_id, descripcion, metodo_pago
    ) VALUES (
        (p_payload->>'escuela_id')::UUID,
        (p_payload->>'sucursal_id')::UUID,
        (p_payload->>'usuario_id')::UUID,
        p_payload->>'descripcion',
        p_payload->>'metodo_pago'
    ) RETURNING id INTO v_asiento_id;

    -- 2. Insertar Detalle del Libro Mayor (Partida Doble)
    -- La base de datos validará DEBE=HABER en bloque cuando esta función termine, gracias al Constraint Trigger Diferido.
    FOR v_mov IN SELECT * FROM jsonb_array_elements(p_payload->'movimientos')
    LOOP
        INSERT INTO public.movimientos_contables (
            escuela_id, asiento_id, cuenta_contable_id, debe, haber
        ) VALUES (
            (p_payload->>'escuela_id')::UUID,
            v_asiento_id,
            (v_mov.value->>'cuenta_contable_id')::UUID,
            COALESCE((v_mov.value->>'debe')::DECIMAL, 0.00),
            COALESCE((v_mov.value->>'haber')::DECIMAL, 0.00)
        );
    END LOOP;

    -- 3. Vincular Cobros a Facturas (Si el cliente mandó arreglo de cobros)
    IF p_payload ? 'cobros' THEN
        FOR v_cobro IN SELECT * FROM jsonb_array_elements(p_payload->'cobros')
        LOOP
            INSERT INTO public.cobros_aplicados (
                escuela_id, cuenta_cobrar_id, asiento_id, monto_aplicado
            ) VALUES (
                (p_payload->>'escuela_id')::UUID,
                (v_cobro.value->>'cuenta_cobrar_id')::UUID,
                v_asiento_id,
                (v_cobro.value->>'monto_aplicado')::DECIMAL
            );
        END LOOP;
    END IF;

    -- 4. Vincular Pagos a Facturas de Proveedores (Si el cliente mandó arreglo de pagos)
    IF p_payload ? 'pagos' THEN
        FOR v_pago IN SELECT * FROM jsonb_array_elements(p_payload->'pagos')
        LOOP
            INSERT INTO public.pagos_aplicados (
                escuela_id, cuenta_pagar_id, asiento_id, monto_aplicado
            ) VALUES (
                (p_payload->>'escuela_id')::UUID,
                (v_pago.value->>'cuenta_pagar_id')::UUID,
                v_asiento_id,
                (v_pago.value->>'monto_aplicado')::DECIMAL
            );
        END LOOP;
    END IF;

    -- Retornamos el ID exitoso.
    RETURN v_asiento_id;
END;
$$ LANGUAGE plpgsql;
