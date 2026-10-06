-- Cambiar el saldo y eliminar los ajustes manuales en una misma migracion.
CREATE OR REPLACE FUNCTION public.fn_actualizar_saldo_caja_v2()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_old_caja uuid; v_new_caja uuid;
  v_old numeric:=0; v_new numeric:=0;
  v_signo numeric:=CASE WHEN TG_TABLE_NAME='cobros_aplicados' THEN 1 ELSE -1 END;
  v_caja record;
BEGIN
  IF TG_OP<>'INSERT' THEN v_old_caja:=OLD.caja_id; v_old:=OLD.monto_aplicado*v_signo; END IF;
  IF TG_OP<>'DELETE' THEN v_new_caja:=NEW.caja_id; v_new:=NEW.monto_aplicado*v_signo; END IF;
  IF v_old_caja IS NOT DISTINCT FROM v_new_caja AND v_old=v_new THEN RETURN NULL; END IF;
  -- Bloqueos en orden estable; suma atomica sobre la ultima version de cada fila.
  FOR v_caja IN SELECT cb.id FROM public.cajas_bancos cb
    WHERE cb.id IN (v_old_caja,v_new_caja) ORDER BY cb.id FOR NO KEY UPDATE
  LOOP
    UPDATE public.cajas_bancos cb SET saldo_actual=COALESCE(cb.saldo_actual,0)
      + CASE WHEN cb.id=v_new_caja THEN v_new ELSE 0 END
      - CASE WHEN cb.id=v_old_caja THEN v_old ELSE 0 END
    WHERE cb.id=v_caja.id;
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_actualizar_saldo_caja_v2() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rpc_eliminar_movimiento_aplicado(p_id uuid, p_tipo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_old_monto NUMERIC;
    v_old_caja_id UUID;
    v_parent_id UUID;
    v_parent_total NUMERIC;
    v_total_aplicado NUMERIC;
    v_es_aplicacion_anticipo BOOLEAN;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id=(SELECT auth.uid()) AND activo IS TRUE AND rol='SuperAdministrador') THEN
        RAISE EXCEPTION 'Solo SuperAdministrador puede eliminar movimientos' USING ERRCODE='42501';
    END IF;
    IF p_tipo NOT IN ('pago','cobro') OR p_tipo IS NULL THEN
        RAISE EXCEPTION 'Tipo de movimiento invalido';
    END IF;
    IF p_tipo = 'pago' THEN
        SELECT monto_aplicado, caja_id, cuenta_pagar_id, es_aplicacion_anticipo 
        INTO v_old_monto, v_old_caja_id, v_parent_id, v_es_aplicacion_anticipo
        FROM pagos_aplicados WHERE id = p_id FOR UPDATE;
        
        IF v_parent_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Pago no encontrado'); END IF;

        -- El trigger aplica exactamente una vez el efecto del borrado.
        DELETE FROM pagos_aplicados WHERE id = p_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo eliminar el pago'; END IF;

        -- Recalcular estado de la nota
        SELECT monto_total INTO v_parent_total FROM cuentas_pagar WHERE id = v_parent_id;
        SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_total_aplicado FROM pagos_aplicados WHERE cuenta_pagar_id = v_parent_id;
        
        UPDATE cuentas_pagar 
        SET estado = CASE WHEN v_total_aplicado >= v_parent_total THEN 'pagada' WHEN v_total_aplicado > 0 THEN 'parcial' ELSE 'pendiente' END
        WHERE id = v_parent_id;

    ELSIF p_tipo = 'cobro' THEN
        SELECT monto_aplicado, caja_id, cuenta_cobrar_id, es_aplicacion_anticipo 
        INTO v_old_monto, v_old_caja_id, v_parent_id, v_es_aplicacion_anticipo
        FROM cobros_aplicados WHERE id = p_id FOR UPDATE;
        
        IF v_parent_id IS NULL THEN RETURN jsonb_build_object('success', false, 'message', 'Cobro no encontrado'); END IF;

        -- El trigger aplica exactamente una vez el efecto del borrado.
        DELETE FROM cobros_aplicados WHERE id = p_id;
        IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo eliminar el cobro'; END IF;

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


REVOKE ALL ON FUNCTION public.rpc_eliminar_movimiento_aplicado(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_eliminar_movimiento_aplicado(uuid,text) TO authenticated;

-- El cliente conserva la edicion de metadatos, nunca del saldo derivado.
REVOKE UPDATE ON public.cajas_bancos FROM authenticated,anon;
GRANT UPDATE(escuela_id,sucursal_id,cuenta_contable_id,nombre,tipo,activo,responsable,orden,es_predeterminada)
  ON public.cajas_bancos TO authenticated;
CREATE OR REPLACE FUNCTION private.validar_saldo_inicial_caja()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF current_user IN ('authenticated','anon') AND COALESCE(NEW.saldo_actual,0)<>0 THEN
    RAISE EXCEPTION 'El saldo se registra mediante movimientos' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validar_saldo_inicial_caja() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER validar_saldo_inicial_caja BEFORE INSERT ON public.cajas_bancos
FOR EACH ROW EXECUTE FUNCTION private.validar_saldo_inicial_caja();
