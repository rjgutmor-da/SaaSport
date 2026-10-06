CREATE OR REPLACE FUNCTION public.fn_actualizar_saldo_caja_v2()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_cajas_afectadas UUID[];
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_cajas_afectadas := ARRAY[NEW.caja_id];
    ELSIF TG_OP = 'DELETE' THEN
        v_cajas_afectadas := ARRAY[OLD.caja_id];
    ELSE
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
$function$;

CREATE OR REPLACE FUNCTION public.rpc_eliminar_movimiento_aplicado(p_id uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old_monto NUMERIC;
    v_old_caja_id UUID;
    v_parent_id UUID;
    v_parent_total NUMERIC;
    v_total_aplicado NUMERIC;
    v_es_aplicacion_anticipo BOOLEAN;
BEGIN
    IF p_tipo = 'pago' THEN
        SELECT monto_aplicado, caja_id, cuenta_pagar_id, es_aplicacion_anticipo 
        INTO v_old_monto, v_old_caja_id, v_parent_id, v_es_aplicacion_anticipo
        FROM pagos_aplicados WHERE id = p_id;
        
        IF v_parent_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Pago no encontrado'); END IF;

        -- Si no es aplicación de anticipo (es decir, es dinero real), devolver saldo a la caja
        IF v_es_aplicacion_anticipo IS NOT TRUE THEN
            UPDATE cajas_bancos SET saldo_actual = saldo_actual + v_old_monto WHERE id = v_old_caja_id;
        END IF;
        
        DELETE FROM pagos_aplicados WHERE id = p_id;

        -- Recalcular estado de la nota
        SELECT monto_total INTO v_parent_total FROM cuentas_pagar WHERE id = v_parent_id;
        SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_aplicado FROM pagos_aplicados WHERE cuenta_pagar_id = v_parent_id;
        
        UPDATE cuentas_pagar 
        SET estado = CASE WHEN v_total_aplicado >= v_parent_total THEN 'pagada' WHEN v_total_aplicado > 0 THEN 'parcial' ELSE 'pendiente' END
        WHERE id = v_parent_id;

    ELSIF p_tipo = 'cobro' THEN
        SELECT monto_aplicado, caja_id, cuenta_cobrar_id, es_aplicacion_anticipo 
        INTO v_old_monto, v_old_caja_id, v_parent_id, v_es_aplicacion_anticipo
        FROM cobros_aplicados WHERE id = p_id;
        
        IF v_parent_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Cobro no encontrado'); END IF;

        -- Si no es aplicación de anticipo, restar saldo de la caja
        IF v_es_aplicacion_anticipo IS NOT TRUE THEN
            UPDATE cajas_bancos SET saldo_actual = saldo_actual - v_old_monto WHERE id = v_old_caja_id;
        END IF;
        
        DELETE FROM cobros_aplicados WHERE id = p_id;

        -- Recalcular estado de la nota
        SELECT monto_total INTO v_parent_total FROM cuentas_cobrar WHERE id = v_parent_id;
        SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_aplicado FROM cobros_aplicados WHERE cuenta_cobrar_id = v_parent_id;
        
        UPDATE cuentas_cobrar 
        SET estado = CASE WHEN v_total_aplicado >= v_parent_total THEN 'pagada' WHEN v_total_aplicado > 0 THEN 'parcial' ELSE 'pendiente' END
        WHERE id = v_parent_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'message', 'Movimiento eliminado correctamente');
END;
$function$;

DROP TRIGGER IF EXISTS validar_saldo_inicial_caja ON public.cajas_bancos;
DROP FUNCTION IF EXISTS private.validar_saldo_inicial_caja();
GRANT UPDATE ON public.cajas_bancos TO authenticated,anon;
