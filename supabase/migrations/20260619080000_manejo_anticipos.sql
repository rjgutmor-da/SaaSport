-- ==============================================================================
-- SaaSport: Migración para el Manejo Automático de Anticipos
-- Ubicación Oficial: SaaSport/supabase/migrations/20260619080000_manejo_anticipos.sql
-- ==============================================================================

-- 1. ACTUALIZAR FUNCIÓN SEED PARA NUEVAS ESCUELAS
CREATE OR REPLACE FUNCTION fn_seed_catalogo_escuela(p_escuela_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.catalogo_items
    (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
  VALUES
    (p_escuela_id, 'ACF',                     'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Alquiler de Grupo',      'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Ayuda Social',            'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Gastos de Oficinas',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Gastos de Transporte',    'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Inscripción a Torneos',   'servicio', 'servicio', 'ambos',   150.00, true, true,  true),
    (p_escuela_id, 'Intereses Bancarios',     'servicio', 'servicio', 'ambos',     null, true, true,  true),
    (p_escuela_id, 'Licencias Software',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Limpieza',                'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Mantenimiento Grupos',   'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Material Deportivo',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Material Medico',         'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Medias',                  'producto', 'producto', 'ambos',    55.00, true, true,  true),
    (p_escuela_id, 'Mensualidad',             'servicio', 'servicio', 'ingreso',   0.00, true, true,  false),
    (p_escuela_id, 'Refrigerios y Agasajos',  'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Saldo Inicial',           'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Servicios Básicos',       'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Servicios Profesionales', 'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Sueldos y Salarios',      'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Uniformes',               'producto', 'producto', 'ambos',   170.00, true, true,  true),
    -- Nuevo concepto temporario de Anticipo
    (p_escuela_id, 'Anticipo',                'servicio', 'servicio', 'ingreso',   0.00, true, true,  false)
  ON CONFLICT (escuela_id, nombre) DO NOTHING;
END;
$$;

-- 2. SEMBRAR EL NUEVO CONCEPTO 'Anticipo' EN TODAS LAS ESCUELAS EXISTENTES
INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
SELECT id, 'Anticipo', 'servicio', 'servicio', 'ingreso', 0.00, true, true, false
FROM public.escuelas
ON CONFLICT (escuela_id, nombre) DO NOTHING;

-- 3. REDEFINIR rpc_aplicar_anticipo_cxc PARA DISTRIBUCIÓN Y RECLASIFICACIÓN DE CONCEPTOS
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
    v_cta_cxc_nota          UUID;
    v_cta_anticipo          UUID;
    v_asiento_id            UUID;
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
    -- 1. Verificar saldo de la nota (desde la vista)
    SELECT saldo_pendiente INTO v_deuda_nota
    FROM public.v_cuentas_cobrar WHERE id = v_nota_id;

    IF v_deuda_nota IS NULL THEN
        RAISE EXCEPTION 'Nota de servicio no encontrada o ya pagada: %', v_nota_id;
    END IF;

    -- 2. Obtener cuenta contable de la nota (desde la tabla base)
    SELECT cuenta_contable_id INTO v_cta_cxc_nota
    FROM public.cuentas_cobrar WHERE id = v_nota_id;

    -- 3. Verificar saldo del anticipo (desde la vista)
    SELECT saldo_pendiente INTO v_disponible_anticipo
    FROM public.v_cuentas_cobrar WHERE id = v_anticipo_id AND es_anticipo = true;

    IF v_disponible_anticipo IS NULL THEN
        RAISE EXCEPTION 'Anticipo no encontrado o sin saldo disponible: %', v_anticipo_id;
    END IF;

    -- 4. Obtener cuenta contable del anticipo (desde la tabla base)
    SELECT cuenta_contable_id INTO v_cta_anticipo
    FROM public.cuentas_cobrar WHERE id = v_anticipo_id;

    -- 5. Validaciones de montos
    IF v_deuda_nota < v_monto THEN
        RAISE EXCEPTION 'El monto a aplicar (%) excede el saldo de la nota (%)', v_monto, v_deuda_nota;
    END IF;

    IF v_disponible_anticipo < v_monto THEN
        RAISE EXCEPTION 'El anticipo solo tiene un saldo disponible de %', v_disponible_anticipo;
    END IF;

    -- 6. Obtener o crear concepto 'Anticipo' para la escuela
    SELECT id INTO v_id_item_anticipo 
    FROM public.catalogo_items 
    WHERE escuela_id = v_escuela_id AND nombre = 'Anticipo';

    IF v_id_item_anticipo IS NULL THEN
        INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
        VALUES (v_escuela_id, 'Anticipo', 'servicio', 'servicio', 'ingreso', 0.00, true, true, false)
        RETURNING id INTO v_id_item_anticipo;
    END IF;

    -- 7. Obtener la suma del concepto 'Anticipo' en los detalles del anticipo antes de borrarlo
    SELECT COALESCE(SUM(precio_unitario * cantidad), 0) INTO v_total_concepto_anticipo 
    FROM public.cxc_detalle 
    WHERE cuenta_cobrar_id = v_anticipo_id AND catalogo_item_id = v_id_item_anticipo;

    -- 8. Calcular el acumulado pagado anterior de la nota destino (todos los cobros_aplicados previos)
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior 
    FROM public.cobros_aplicados 
    WHERE cuenta_cobrar_id = v_nota_id;

    -- 9. Borrar los detalles de tipo 'Anticipo' de la nota del anticipo
    DELETE FROM public.cxc_detalle 
    WHERE cuenta_cobrar_id = v_anticipo_id AND catalogo_item_id = v_id_item_anticipo;

    -- 10. Distribuir el monto del anticipo aplicado en los detalles de la nota de destino (de arriba a abajo)
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

            -- Insertar nueva línea en cxc_detalle del anticipo con el concepto real (se omite subtotal por ser columna generada)
            INSERT INTO public.cxc_detalle (
                escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, detalle_extra
            ) VALUES (
                v_escuela_id, v_anticipo_id, r_linea.catalogo_item_id, 1, v_monto_linea, 
                COALESCE(r_linea.detalle_extra, 'Aplicación de anticipo')
            );
        END IF;
    END LOOP;

    -- Si queda algún residuo del anticipo original o no se pudo distribuir del todo, mantenerlo como concepto 'Anticipo'
    v_residuo_anticipo := v_total_concepto_anticipo - v_monto + v_monto_distribuir;
    IF v_residuo_anticipo > 0 THEN
        INSERT INTO public.cxc_detalle (
            escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, detalle_extra
        ) VALUES (
            v_escuela_id, v_anticipo_id, v_id_item_anticipo, 1, v_residuo_anticipo, 'Anticipo restante'
        );
    END IF;

    -- 11. Crear asiento contable (solo si hay cuenta contable en ambos extremos)
    -- NOTA: Se mantiene por retrocompatibilidad, aunque en esta versión las tablas contables no existan.
    IF v_cta_anticipo IS NOT NULL AND v_cta_cxc_nota IS NOT NULL THEN
        INSERT INTO public.asientos_contables (
            escuela_id, sucursal_id, usuario_id, fecha, descripcion, documento_referencia
        ) VALUES (
            v_escuela_id, v_sucursal_id, v_usuario_id, v_fecha,
            'Aplicación de anticipo a nota de servicio', 'ANT-CXC-' || v_anticipo_id
        ) RETURNING id INTO v_asiento_id;

        INSERT INTO public.movimientos_contables (asiento_id, cuenta_contable_id, debe, haber)
        VALUES (v_asiento_id, v_cta_anticipo, v_monto, 0);

        INSERT INTO public.movimientos_contables (asiento_id, cuenta_contable_id, debe, haber)
        VALUES (v_asiento_id, v_cta_cxc_nota, 0, v_monto);
    END IF;

    -- 12. Registrar consumo del anticipo (es_aplicacion_anticipo = true)
    INSERT INTO public.cobros_aplicados (escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, asiento_id, es_aplicacion_anticipo)
    VALUES (v_escuela_id, v_anticipo_id, v_monto, v_fecha, v_asiento_id, true);

    -- 13. Registrar aplicación a la nota (es_aplicacion_anticipo = true)
    INSERT INTO public.cobros_aplicados (escuela_id, cuenta_cobrar_id, monto_aplicado, fecha, asiento_id, es_aplicacion_anticipo)
    VALUES (v_escuela_id, v_nota_id, v_monto, v_fecha, v_asiento_id, true);

    -- 14. Actualizar estado del anticipo si queda en 0
    SELECT saldo_pendiente INTO v_nuevo_saldo_anticipo
    FROM public.v_cuentas_cobrar WHERE id = v_anticipo_id;

    IF v_nuevo_saldo_anticipo <= 0 THEN
        UPDATE public.cuentas_cobrar SET estado = 'pagada', updated_at = NOW()
        WHERE id = v_anticipo_id;
    END IF;

    -- 15. Actualizar estado de la nota de destino
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
        'asiento_id', v_asiento_id,
        'saldo_anticipo_restante', v_nuevo_saldo_anticipo,
        'saldo_nota_restante', v_nuevo_saldo_nota
    );
END;
$function$;
