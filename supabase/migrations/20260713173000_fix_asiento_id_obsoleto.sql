-- ==============================================================================
-- SaaSport: Corrección de Funciones RPC para eliminar asiento_id
-- Esta migración redefine las funciones rpc_cobrar_multiple_cxc y rpc_pagar_multiple_cxp
-- para evitar la inserción de la columna asiento_id que fue eliminada.
-- ==============================================================================

-- 1. Eliminar columnas asiento_id restantes de cuentas_cobrar y cuentas_pagar si existen
ALTER TABLE public.cuentas_cobrar DROP COLUMN IF EXISTS asiento_id;
ALTER TABLE public.cuentas_pagar DROP COLUMN IF EXISTS asiento_id;

-- 2. Redefinir rpc_cobrar_multiple_cxc sin usar asiento_id en cobros_aplicados
CREATE OR REPLACE FUNCTION public.rpc_cobrar_multiple_cxc(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_escuela_id    UUID;
    v_sucursal_id   UUID;
    v_usuario_id    UUID;
    v_caja_id       UUID;
    v_doc_ref       VARCHAR;
    v_fecha         TIMESTAMP WITH TIME ZONE;
    v_item          RECORD;
    
    v_cxc_id        UUID;
    v_monto         DECIMAL;
    v_monto_total   DECIMAL;
    v_pagado_anterior DECIMAL;
    v_nuevo_estado  VARCHAR;
    
    v_grupo_id      UUID;
BEGIN
    v_escuela_id    := (p_payload->>'escuela_id')::UUID;
    v_sucursal_id   := (p_payload->>'sucursal_id')::UUID;
    v_usuario_id    := (p_payload->>'usuario_id')::UUID;
    v_caja_id       := (p_payload->>'cuenta_cobro_id')::UUID;
    v_doc_ref       := p_payload->>'nro_comprobante';
    v_fecha         := COALESCE((p_payload->>'fecha')::TIMESTAMP WITH TIME ZONE, CURRENT_TIMESTAMP);

    -- Generar un identificador de grupo para el cobro múltiple
    v_grupo_id      := gen_random_uuid();

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'cobros')
    LOOP
        v_cxc_id := (v_item.value->>'cuenta_cobrar_id')::UUID;
        v_monto  := (v_item.value->>'monto')::DECIMAL;
        
        -- Validar la existencia de la cuenta por cobrar
        SELECT monto_total INTO v_monto_total
        FROM public.cuentas_cobrar WHERE id = v_cxc_id AND escuela_id = v_escuela_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Nota de CxC no encontrada.';
        END IF;

        -- Calcular saldo anterior
        SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior
        FROM public.cobros_aplicados WHERE cuenta_cobrar_id = v_cxc_id;
        
        IF (v_pagado_anterior + v_monto) > v_monto_total THEN
            RAISE EXCEPTION 'El cobro excede la deuda en una de las notas.';
        END IF;

        -- Insertar el cobro aplicado (sin la columna obsoleta asiento_id)
        INSERT INTO public.cobros_aplicados (
            escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, caja_id, documento_referencia
        ) VALUES (
            v_escuela_id, v_cxc_id, v_monto, v_fecha, v_caja_id, v_doc_ref
        );

        -- Actualizar el estado de la cuenta por cobrar
        SELECT CASE
            WHEN (v_pagado_anterior + v_monto) >= v_monto_total THEN 'pagada'
            WHEN (v_pagado_anterior + v_monto) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END INTO v_nuevo_estado;
        
        UPDATE public.cuentas_cobrar SET estado = v_nuevo_estado, updated_at = NOW()
        WHERE id = v_cxc_id;
    END LOOP;

    RETURN jsonb_build_object('grupo_id', v_grupo_id);
END;
$function$;

-- 3. Redefinir rpc_pagar_multiple_cxp sin usar asiento_id en pagos_aplicados
CREATE OR REPLACE FUNCTION public.rpc_pagar_multiple_cxp(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_escuela_id    UUID;
    v_sucursal_id   UUID;
    v_usuario_id    UUID;
    v_caja_id       UUID;
    v_doc_ref       VARCHAR;
    v_fecha         TIMESTAMP WITH TIME ZONE;
    v_item          RECORD;
    
    v_cxp_id        UUID;
    v_monto         DECIMAL;
    v_monto_total   DECIMAL;
    v_pagado_anterior DECIMAL;
    v_nuevo_estado  VARCHAR;
    
    v_grupo_id      UUID;
BEGIN
    v_escuela_id    := (p_payload->>'escuela_id')::UUID;
    v_sucursal_id   := (p_payload->>'sucursal_id')::UUID;
    v_usuario_id    := (p_payload->>'usuario_id')::UUID;
    v_caja_id       := (p_payload->>'cuenta_pago_id')::UUID;
    v_doc_ref       := p_payload->>'nro_comprobante';
    v_fecha         := COALESCE((p_payload->>'fecha')::TIMESTAMP WITH TIME ZONE, CURRENT_TIMESTAMP);

    -- Generar un identificador de grupo para el pago múltiple
    v_grupo_id      := gen_random_uuid();

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'pagos')
    LOOP
        v_cxp_id := (v_item.value->>'cuenta_pagar_id')::UUID;
        v_monto  := (v_item.value->>'monto')::DECIMAL;
        
        -- Validar la existencia de la cuenta por pagar
        SELECT monto_total INTO v_monto_total
        FROM public.cuentas_pagar WHERE id = v_cxp_id AND escuela_id = v_escuela_id;
        
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Nota de CxP no encontrada.';
        END IF;

        -- Calcular saldo anterior
        SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior
        FROM public.pagos_aplicados WHERE cuenta_pagar_id = v_cxp_id;
        
        IF (v_pagado_anterior + v_monto) > v_monto_total THEN
            RAISE EXCEPTION 'El pago excede la deuda en una de las notas.';
        END IF;

        -- Insertar el pago aplicado (sin la columna obsoleta asiento_id)
        INSERT INTO public.pagos_aplicados (
            escuela_id, cuenta_pagar_id, monto_aplicado, fecha, caja_id, referencia
        ) VALUES (
            v_escuela_id, v_cxp_id, v_monto, v_fecha, v_caja_id, v_doc_ref
        );

        -- Actualizar el estado de la cuenta por pagar
        SELECT CASE
            WHEN (v_pagado_anterior + v_monto) >= v_monto_total THEN 'pagada'
            WHEN (v_pagado_anterior + v_monto) > 0 THEN 'parcial'
            ELSE 'pendiente'
        END INTO v_nuevo_estado;
        
        UPDATE public.cuentas_pagar SET estado = v_nuevo_estado, updated_at = NOW()
        WHERE id = v_cxp_id;
    END LOOP;

    RETURN jsonb_build_object('grupo_id', v_grupo_id);
END;
$function$;

-- 4. Redefinir rpc_anular_cuenta_cobrar sin usar la columna asiento_id
CREATE OR REPLACE FUNCTION public.rpc_anular_cuenta_cobrar(p_id uuid, p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- 1. Borrar registros de cobros aplicados
    -- Esto dispara trg_actualizar_saldo_pago que llama a fn_actualizar_saldo_caja_v2()
    -- lo cual revierte el monto en la caja/banco correspondiente automáticamente.
    DELETE FROM public.cobros_aplicados WHERE cuenta_cobrar_id = p_id;

    -- 2. Marcar la nota como anulada y limpiar el estado (sin usar la columna asiento_id)
    UPDATE public.cuentas_cobrar
    SET anulada = true,
        anulada_por = p_usuario_id,
        anulada_at = NOW(),
        estado = 'anulada'
    WHERE id = p_id;
END;
$function$;

-- 5. Redefinir rpc_anular_cuenta_pagar sin usar la columna asiento_id
CREATE OR REPLACE FUNCTION public.rpc_anular_cuenta_pagar(p_id uuid, p_usuario_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- 1. Borrar registros de pagos aplicados
    -- Esto dispara trg_actualizar_saldo_pago que llama a fn_actualizar_saldo_caja_v2()
    -- lo cual revierte el monto en la caja/banco correspondiente automáticamente.
    DELETE FROM public.pagos_aplicados WHERE cuenta_pagar_id = p_id;

    -- 2. Marcar la nota como anulada y limpiar el estado (sin usar la columna asiento_id)
    UPDATE public.cuentas_pagar
    SET anulada = true,
        anulada_por = p_usuario_id,
        anulada_at = NOW(),
        estado = 'anulada'
    WHERE id = p_id;
END;
$function$;

-- 6. Eliminar funciones obsoletas relacionadas con asientos contables que ya no existen
DROP FUNCTION IF EXISTS public.rpc_editar_cuenta_cobro(jsonb);
DROP FUNCTION IF EXISTS public.rpc_editar_movimiento_financiero(jsonb);
DROP FUNCTION IF EXISTS public.rpc_editar_saldo_inicial_cxc(jsonb);
