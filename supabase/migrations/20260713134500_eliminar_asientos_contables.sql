-- ==============================================================================
-- SaaSport: Módulo de Finanzas - ELIMINACIÓN DE ASIENTOS CONTABLES
-- Migración para remover la contabilidad de partida doble y simplificar flujos
-- ==============================================================================

-- 1. Eliminar vista obsoleta si existe
DROP VIEW IF EXISTS public.v_saldos_cajas_bancos CASCADE;

-- 2. Eliminar columnas asiento_id de las tablas de aplicación
ALTER TABLE public.cobros_aplicados DROP COLUMN IF EXISTS asiento_id;
ALTER TABLE public.pagos_aplicados DROP COLUMN IF EXISTS asiento_id;

-- 3. Eliminar tablas del Libro Mayor contable
DROP TABLE IF EXISTS public.movimientos_contables CASCADE;
DROP TABLE IF EXISTS public.asientos_contables CASCADE;

-- 4. Redefinir rpc_registrar_pago_cxp sin asientos contables y guardando caja_id/referencia
CREATE OR REPLACE FUNCTION public.rpc_registrar_pago_cxp(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_cxp_id UUID;
    v_escuela_id UUID;
    v_sucursal_id UUID;
    v_usuario_id UUID;
    v_monto DECIMAL;
    v_metodo VARCHAR;
    v_cuenta_pago_id UUID; -- caja_id
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
    v_cuenta_pago_id := (p_payload->>'cuenta_pago_id')::UUID; -- Caja/Banco que paga
    v_descripcion   := COALESCE(p_payload->>'descripcion', 'Pago de Nota CxP');
    v_doc_ref       := p_payload->>'nro_comprobante';

    -- Validar que la CxP existe y obtener su monto total
    SELECT monto_total INTO v_monto_total
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

    -- Registrar el pago aplicado a la CxP (asociando caja y referencia directamente)
    INSERT INTO public.pagos_aplicados (escuela_id, cuenta_pagar_id, monto_aplicado, caja_id, referencia)
    VALUES (v_escuela_id, v_cxp_id, v_monto, v_cuenta_pago_id, v_doc_ref);

    -- Recalcular estado de la CxP
    SELECT CASE
        WHEN (v_pagado_anterior + v_monto) >= v_monto_total THEN 'pagada'
        WHEN (v_pagado_anterior + v_monto) > 0 THEN 'parcial'
        ELSE 'pendiente'
    END INTO v_nuevo_estado;
    
    UPDATE public.cuentas_pagar SET estado = v_nuevo_estado, updated_at = NOW()
    WHERE id = v_cxp_id;

    RETURN jsonb_build_object(
        'nuevo_estado', v_nuevo_estado,
        'pagado_total', v_pagado_anterior + v_monto
    );
END;
$function$;

-- 5. Redefinir rpc_aplicar_anticipo_cxc sin asientos contables
CREATE OR REPLACE FUNCTION public.rpc_aplicar_anticipo_cxc(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_nota_id       UUID    := (p_payload->>'nota_id')::UUID;
    v_anticipo_id   UUID    := (p_payload->>'anticipo_id')::UUID;
    v_monto         NUMERIC := (p_payload->>'monto')::NUMERIC;
    v_usuario_id    UUID    := (p_payload->>'usuario_id')::UUID;
    v_escuela_id    UUID    := (p_payload->>'escuela_id')::UUID;
    v_sucursal_id   UUID    := (p_payload->>'sucursal_id')::UUID;
    v_fecha         TIMESTAMP WITH TIME ZONE := COALESCE((p_payload->>'fecha')::TIMESTAMP WITH TIME ZONE, CURRENT_TIMESTAMP);

    v_deuda_nota            NUMERIC;
    v_disponible_anticipo   NUMERIC;
    v_nuevo_saldo_nota      NUMERIC;
    v_nuevo_saldo_anticipo  NUMERIC;

    v_id_item_anticipo      UUID;
    v_total_concepto_anticipo NUMERIC;
    v_pagado_anterior       NUMERIC;
    v_acumulado_lineas      NUMERIC := 0;
    v_monto_distribuir      NUMERIC := v_monto;
    r_linea                 RECORD;
    v_pagado_linea_anterior NUMERIC;
    v_saldo_pendiente_linea NUMERIC;
    v_monto_linea           NUMERIC;
    v_residuo_anticipo      NUMERIC;
BEGIN
    -- Verificar saldo de la nota
    SELECT saldo_pendiente INTO v_deuda_nota
    FROM public.v_cuentas_cobrar WHERE id = v_nota_id;

    IF v_deuda_nota IS NULL THEN
        RAISE EXCEPTION 'Nota de servicio no encontrada o ya pagada: %', v_nota_id;
    END IF;

    -- Verificar saldo del anticipo
    SELECT saldo_pendiente INTO v_disponible_anticipo
    FROM public.v_cuentas_cobrar WHERE id = v_anticipo_id AND es_anticipo = true;

    IF v_disponible_anticipo IS NULL THEN
        RAISE EXCEPTION 'Anticipo no encontrado o sin saldo disponible: %', v_anticipo_id;
    END IF;

    -- Validaciones de montos
    IF v_deuda_nota < v_monto THEN
        RAISE EXCEPTION 'El monto a aplicar (%) excede el saldo de la nota (%)', v_monto, v_deuda_nota;
    END IF;

    IF v_disponible_anticipo < v_monto THEN
        RAISE EXCEPTION 'El anticipo solo tiene un saldo disponible de %', v_disponible_anticipo;
    END IF;

    -- Obtener o crear concepto 'Anticipo' para la escuela
    SELECT id INTO v_id_item_anticipo 
    FROM public.catalogo_items 
    WHERE escuela_id = v_escuela_id AND nombre = 'Anticipo';

    IF v_id_item_anticipo IS NULL THEN
        INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
        VALUES (v_escuela_id, 'Anticipo', 'servicio', 'servicio', 'ingreso', 0.00, true, true, false)
        RETURNING id INTO v_id_item_anticipo;
    END IF;

    -- Obtener la suma del concepto 'Anticipo' en los detalles del anticipo
    SELECT COALESCE(SUM(precio_unitario * cantidad), 0) INTO v_total_concepto_anticipo 
    FROM public.cxc_detalle 
    WHERE cuenta_cobrar_id = v_anticipo_id AND catalogo_item_id = v_id_item_anticipo;

    -- Calcular el acumulado pagado anterior de la nota destino
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior 
    FROM public.cobros_aplicados 
    WHERE cuenta_cobrar_id = v_nota_id;

    -- Borrar los detalles de tipo 'Anticipo' de la nota del anticipo
    DELETE FROM public.cxc_detalle 
    WHERE cuenta_cobrar_id = v_anticipo_id AND catalogo_item_id = v_id_item_anticipo;

    -- Distribuir el monto del anticipo aplicado en los detalles de la nota de destino
    FOR r_linea IN 
        SELECT catalogo_item_id, subtotal, detalle_extra
        FROM public.cxc_detalle
        WHERE cuenta_cobrar_id = v_nota_id
        ORDER BY created_at ASC, id ASC
    LOOP
        IF v_monto_distribuir <= 0 THEN
            EXIT;
        END IF;

        v_pagado_linea_anterior := GREATEST(0, LEAST(r_linea.subtotal, v_pagado_anterior - v_acumulado_lineas));
        v_saldo_pendiente_linea := r_linea.subtotal - v_pagado_linea_anterior;
        v_acumulado_lineas := v_acumulado_lineas + r_linea.subtotal;

        IF v_saldo_pendiente_linea > 0 THEN
            v_monto_linea := LEAST(v_monto_distribuir, v_saldo_pendiente_linea);
            v_monto_distribuir := v_monto_distribuir - v_monto_linea;

            INSERT INTO public.cxc_detalle (
                escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, detalle_extra
            ) VALUES (
                v_escuela_id, v_anticipo_id, r_linea.catalogo_item_id, 1, v_monto_linea, 
                COALESCE(r_linea.detalle_extra, 'Aplicación de anticipo')
            );
        END IF;
    END LOOP;

    -- Si queda algún residuo del anticipo original, mantenerlo
    v_residuo_anticipo := v_total_concepto_anticipo - v_monto + v_monto_distribuir;
    IF v_residuo_anticipo > 0 THEN
        INSERT INTO public.cxc_detalle (
            escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, detalle_extra
        ) VALUES (
            v_escuela_id, v_anticipo_id, v_id_item_anticipo, 1, v_residuo_anticipo, 'Anticipo restante'
        );
    END IF;

    -- Registrar consumo del anticipo (es_aplicacion_anticipo = true) sin asiento contable
    INSERT INTO public.cobros_aplicados (escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, es_aplicacion_anticipo)
    VALUES (v_escuela_id, v_anticipo_id, v_monto, v_fecha, true);

    -- Registrar aplicación a la nota (es_aplicacion_anticipo = true) sin asiento contable
    INSERT INTO public.cobros_aplicados (escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, es_aplicacion_anticipo)
    VALUES (v_escuela_id, v_nota_id, v_monto, v_fecha, true);

    -- Actualizar estado del anticipo si queda en 0
    SELECT saldo_pendiente INTO v_nuevo_saldo_anticipo
    FROM public.v_cuentas_cobrar WHERE id = v_anticipo_id;

    IF v_nuevo_saldo_anticipo <= 0 THEN
        UPDATE public.cuentas_cobrar SET estado = 'pagada', updated_at = NOW()
        WHERE id = v_anticipo_id;
    END IF;

    -- Actualizar estado de la nota de destino
    SELECT saldo_pendiente INTO v_nuevo_saldo_nota
    FROM public.v_cuentas_cobrar WHERE id = v_nota_id;

    IF v_nuevo_saldo_nota <= 0 THEN
        UPDATE public.cuentas_cobrar SET estado = 'pagada', updated_at = NOW()
        WHERE id = v_nota_id;
    ELSIF v_nuevo_saldo_nota < (SELECT monto_total FROM public.cuentas_cobrar WHERE id = v_nota_id) THEN
        UPDATE public.cuentas_cobrar SET estado = 'parcial', updated_at = NOW()
        WHERE id = v_nota_id AND estado NOT IN ('pagada', 'anulada');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'saldo_anticipo_restante', v_nuevo_saldo_anticipo,
        'saldo_nota_restante', v_nuevo_saldo_nota
    );
END;
$function$;

-- 6. Eliminar rpc_procesar_transaccion_financiera ya que es obsoleta
DROP FUNCTION IF EXISTS public.rpc_procesar_transaccion_financiera(jsonb);
