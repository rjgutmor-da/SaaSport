-- ============================================================================
-- SUITE DE PRUEBAS DE ACEPTACIÓN: INVENTARIO POR SUCURSAL EN SAASPORT
-- ============================================================================
-- Valida las pruebas de aceptación y reglas críticas definidas en
-- docs/Plan_Inventarios_SaaSport.md contra las funciones y triggers reales
-- implementados en 20260915131645_inventario_por_sucursal.sql.
--
-- Ejecutar únicamente en una base de prueba aislada, nunca en producción.
-- El bloque termina con ROLLBACK para retirar los datos de la prueba.
-- ============================================================================

BEGIN;
SET LOCAL plpgsql.check_asserts = on;

DO $$
DECLARE
    v_escuela_id uuid := gen_random_uuid();
    v_escuela_otra_id uuid := gen_random_uuid();
    v_sucursal_1 uuid := gen_random_uuid();
    v_sucursal_2 uuid := gen_random_uuid();
    v_sucursal_otra uuid := gen_random_uuid();

    v_usuario_super uuid := gen_random_uuid();
    v_usuario_admin1 uuid := gen_random_uuid();
    v_usuario_asistente uuid := gen_random_uuid();

    v_alumno_id uuid := gen_random_uuid();
    v_proveedor_id uuid := gen_random_uuid();

    v_prod_1 uuid := gen_random_uuid();
    v_prod_2 uuid := gen_random_uuid();
    v_prod_3 uuid := gen_random_uuid();
    v_prod_nuevo uuid;
    v_serv_1 uuid;

    v_saldo integer;
    v_nota_id uuid;
    v_nota_compra_id uuid;
    v_nota_pre_id uuid;
    v_nota_service_id uuid;
    v_nota_anticipo_id uuid;
    v_op_id uuid;
    v_cant_movs integer;
    v_i integer;
    v_error_ocurrido boolean;
    v_error_msg text;
    v_estado text;
    v_periodo_meses jsonb;
    v_periodo_estadistico date;
    v_sucursal_nota uuid;
    v_serv_otro uuid := gen_random_uuid();
    v_lineas_mixtas jsonb;
    v_saldo_antes integer;
    v_notas_antes integer;
BEGIN
    RAISE NOTICE '=======================================================';
    RAISE NOTICE 'INICIANDO SUITE DE PRUEBAS DEL MÓDULO DE INVENTARIOS';
    RAISE NOTICE '=======================================================';

    -- 0. Preparar datos base de prueba
    INSERT INTO public.escuelas (id, nombre, limite_productos_inventario)
    VALUES (v_escuela_id, 'Escuela Pruebas Inventario', 10),
           (v_escuela_otra_id, 'Escuela Externa', 10);

    INSERT INTO public.sucursales (id, escuela_id, nombre)
    VALUES (v_sucursal_1, v_escuela_id, 'Sucursal Central'),
           (v_sucursal_2, v_escuela_id, 'Sucursal Norte'),
           (v_sucursal_otra, v_escuela_otra_id, 'Sucursal Otra');

    -- El alta de escuela crea conceptos predeterminados. Reutilizar Mensualidad
    -- y desactivar sus productos semilla para mantener un escenario controlado.
    SELECT id INTO v_serv_1
    FROM public.catalogo_items
    WHERE escuela_id = v_escuela_id
      AND lower(btrim(nombre)) = 'mensualidad';

    ASSERT v_serv_1 IS NOT NULL,
      'FALLO PREPARACIÓN: No se creó el concepto predeterminado Mensualidad';

    UPDATE public.catalogo_items
    SET activo = false
    WHERE escuela_id = v_escuela_id
      AND categoria = 'producto';

    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password,
        email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    )
    VALUES
      (v_usuario_super, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'super@prueba.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
      (v_usuario_admin1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'admin1@prueba.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
      (v_usuario_asistente, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'asistente@prueba.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

    INSERT INTO public.usuarios (id, escuela_id, email, nombres, apellidos, rol, activo, sucursal_id)
    VALUES (v_usuario_super, v_escuela_id, 'super@prueba.com', 'Super', 'Prueba', 'SuperAdministrador', true, v_sucursal_1),
           (v_usuario_admin1, v_escuela_id, 'admin1@prueba.com', 'Admin', 'Prueba', 'Administrador', true, v_sucursal_1),
           (v_usuario_asistente, v_escuela_id, 'asistente@prueba.com', 'Asistente', 'Prueba', 'Asistente', true, v_sucursal_1);

    INSERT INTO public.alumnos (id, escuela_id, sucursal_id, nombres, apellidos, fecha_nacimiento, archivado)
    VALUES (v_alumno_id, v_escuela_id, v_sucursal_1, 'Alumno', 'Prueba', DATE '2015-01-01', false);

    INSERT INTO public.proveedores (id, escuela_id, nombre, activo)
    VALUES (v_proveedor_id, v_escuela_id, 'Proveedor Deportivo', true);

    -- Catálogo inicial
    INSERT INTO public.catalogo_items (id, escuela_id, nombre, tipo, categoria, precio_venta, activo)
    VALUES (v_prod_1, v_escuela_id, 'Balón No. 5', 'producto', 'producto', 120.00, true),
           (v_prod_2, v_escuela_id, 'Camiseta Oficial', 'producto', 'producto', 85.00, true),
           (v_prod_3, v_escuela_id, 'Conos de Entrenamiento', 'producto', 'producto', 15.00, true);

    -- Simular sesión de SuperAdministrador
    PERFORM set_config('request.jwt.claim.sub', v_usuario_super::text, true);

    -- ------------------------------------------------------------------------
    -- REGRESIÓN FINANCIERA: los servicios no requieren sucursal ni mueven stock
    -- ------------------------------------------------------------------------
    v_nota_service_id := public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := NULL,
        p_monto_total := 100.00,
        p_descripcion := 'Mensualidad sin sucursal',
        p_ciclo_inicio := DATE '2026-09-17',
        p_ciclo_fin := DATE '2026-10-16',
        p_lineas := jsonb_build_array(
            jsonb_build_object(
                'catalogo_item_id', v_serv_1,
                'cantidad', 1,
                'precio_unitario', 100.00,
                'periodo_meses', jsonb_build_array('2026-10'),
                'ciclo_inicio', '2026-09-17',
                'ciclo_fin', '2026-10-16'
            )
        ),
        p_operacion_id := gen_random_uuid()
    );

    SELECT sucursal_id, periodo_estadistico
      INTO v_sucursal_nota, v_periodo_estadistico
    FROM public.cuentas_cobrar
    WHERE id = v_nota_service_id;
    ASSERT v_sucursal_nota IS NULL,
      'FALLO REGRESIÓN: Una nota solo de servicios recibió una sucursal obligatoria';
    ASSERT v_periodo_estadistico = DATE '2026-10-01',
      format('FALLO REGRESIÓN: periodo_estadistico esperado 2026-10-01, obtenido %s', v_periodo_estadistico);

    SELECT periodo_meses, periodo_estadistico
      INTO v_periodo_meses, v_periodo_estadistico
    FROM public.cxc_detalle
    WHERE cuenta_cobrar_id = v_nota_service_id;
    ASSERT v_periodo_meses = '["2026-10"]'::jsonb,
      format('FALLO REGRESIÓN: periodo_meses JSONB incorrecto: %s', v_periodo_meses);
    ASSERT v_periodo_estadistico = DATE '2026-10-01',
      format('FALLO REGRESIÓN: periodo estadístico del detalle incorrecto: %s', v_periodo_estadistico);

    INSERT INTO public.cobros_aplicados (
        cuenta_cobrar_id, escuela_id, monto_aplicado, usuario_id
    ) VALUES (
        v_nota_service_id, v_escuela_id, 99.60, v_usuario_super
    );

    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := v_nota_service_id,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := NULL,
        p_monto_total := 100.00,
        p_descripcion := 'Mensualidad editada',
        p_ciclo_inicio := DATE '2026-09-17',
        p_ciclo_fin := DATE '2026-10-16',
        p_lineas := jsonb_build_array(
            jsonb_build_object(
                'catalogo_item_id', v_serv_1,
                'cantidad', 1,
                'precio_unitario', 100.00,
                'periodo_meses', jsonb_build_array('2026-10'),
                'ciclo_inicio', '2026-09-17',
                'ciclo_fin', '2026-10-16'
            )
        ),
        p_operacion_id := gen_random_uuid()
    );

    SELECT estado INTO v_estado
    FROM public.cuentas_cobrar
    WHERE id = v_nota_service_id;
    ASSERT v_estado = 'parcial',
      format('FALLO REGRESIÓN: Un cobro de 99.60 sobre 100 debe quedar parcial, obtuvo %s', v_estado);
    RAISE NOTICE 'PASADA: Servicios sin sucursal, periodos y precisión monetaria conservados.';

    -- Una nota nueva con productos sí exige una sucursal.
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_guardar_nota_cxc(
            p_nota_id := NULL,
            p_alumno_id := v_alumno_id,
            p_sucursal_id := NULL,
            p_monto_total := 120.00,
            p_descripcion := 'Producto sin sucursal',
            p_lineas := jsonb_build_array(
                jsonb_build_object(
                    'catalogo_item_id', v_prod_1,
                    'cantidad', 1,
                    'precio_unitario', 120.00
                )
            ),
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%requieren una sucursal%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO REGRESIÓN: Se permitió una nota nueva con productos sin sucursal';
    RAISE NOTICE 'PASADA: Las notas con productos requieren sucursal.';

    -- ------------------------------------------------------------------------
    -- REGLA PRE-APERTURA: Nota previa a apertura no debe mover existencias
    -- ------------------------------------------------------------------------
    v_op_id := gen_random_uuid();
    INSERT INTO public.cuentas_cobrar (
        id, escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
        fecha_emision, estado, operacion_id, created_at
    ) VALUES (
        gen_random_uuid(), v_escuela_id, v_sucursal_1, v_alumno_id, 240.00,
        'Venta histórica previa al inventario', CURRENT_DATE - 1, 'pendiente',
        v_op_id, now() - interval '1 day'
    ) RETURNING id INTO v_nota_pre_id;

    PERFORM set_config('saasport.en_rpc_guardar_nota', 'true', true);
    INSERT INTO public.cxc_detalle (
        escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario
    ) VALUES (v_escuela_id, v_nota_pre_id, v_prod_1, 2, 120.00);
    PERFORM set_config('saasport.en_rpc_guardar_nota', 'false', true);

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo IS NULL, 'FALLO PRE-APERTURA: La nota previa no debió crear saldo en inventario_saldos';
    RAISE NOTICE 'PASADA: Nota previa a apertura no genera saldo ni movimientos.';

    -- ------------------------------------------------------------------------
    -- APERTURA DE SUCURSAL (rpc_confirmar_apertura_inventario)
    -- ------------------------------------------------------------------------
    PERFORM public.rpc_confirmar_apertura_inventario(
        p_sucursal_id := v_sucursal_1,
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 0),
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 10),
            jsonb_build_object('catalogo_item_id', v_prod_3, 'cantidad', 5)
        )
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 0, format('FALLO APERTURA: Saldo esperado 0, obtenido %s', v_saldo);
    RAISE NOTICE 'PASADA: Conteo inicial de apertura registrado correctamente.';

    -- Una sucursal todavía no abierta no acepta notas nuevas con productos.
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_guardar_nota_cxc(
            p_nota_id := NULL,
            p_alumno_id := v_alumno_id,
            p_sucursal_id := v_sucursal_2,
            p_monto_total := 85.00,
            p_descripcion := 'Producto antes de apertura',
            p_lineas := jsonb_build_array(
                jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 1, 'precio_unitario', 85.00)
            ),
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%conteo inicial%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO APERTURA: Se permitió una nota con productos antes del conteo inicial';
    RAISE NOTICE 'PASADA: La apertura es obligatoria antes de operar productos.';

    -- Los anticipos se excluyen del inventario durante creación, edición y anulación.
    v_nota_anticipo_id := public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 170.00,
        p_descripcion := 'Anticipo con línea de producto',
        p_es_anticipo := true,
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 2, 'precio_unitario', 85.00)
        ),
        p_operacion_id := gen_random_uuid()
    );

    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := v_nota_anticipo_id,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 425.00,
        p_descripcion := 'Anticipo editado',
        p_es_anticipo := false,
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 5, 'precio_unitario', 85.00)
        ),
        p_operacion_id := gen_random_uuid()
    );

    UPDATE public.cuentas_cobrar
    SET anulada = true
    WHERE id = v_nota_anticipo_id;

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id
      AND sucursal_id = v_sucursal_1
      AND catalogo_item_id = v_prod_2;
    ASSERT v_saldo = 10,
      format('FALLO REGRESIÓN: El anticipo alteró el saldo del producto (%s != 10)', v_saldo);
    RAISE NOTICE 'PASADA: Los anticipos no mueven inventario al crear, editar o anular.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 1 & 2: Venta sin stock (0 -> -3) y acumulativa negativa (-3 -> -5)
    -- ------------------------------------------------------------------------
    v_op_id := gen_random_uuid();
    v_nota_id := public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 360.00,
        p_descripcion := 'Venta Balón No. 5',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 3, 'precio_unitario', 120.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = -3, format('FALLO PRUEBA 1: Saldo esperado -3, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 1 PASADA: Venta con saldo 0 genera saldo -3 exitosamente.';

    -- Venta acumulativa: 2 unidades adicionales
    v_op_id := gen_random_uuid();
    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 240.00,
        p_descripcion := 'Venta adicional Balón',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 2, 'precio_unitario', 120.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = -5, format('FALLO PRUEBA 2: Saldo esperado -5, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 2 PASADA: Venta adicional con saldo negativo genera saldo -5.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 3: Compra posterior (saldo -5 + compra 8 -> saldo +3)
    -- ------------------------------------------------------------------------
    v_op_id := gen_random_uuid();
    v_nota_compra_id := public.rpc_guardar_nota_cxp(
        p_nota_id := NULL,
        p_proveedor_id := v_proveedor_id,
        p_personal_id := NULL,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 640.00,
        p_descripcion := 'Compra balones',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 8, 'precio_unitario', 80.00, 'descripcion', 'Compra Balones')
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 3, format('FALLO PRUEBA 3: Saldo esperado 3, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 3 PASADA: Compra de 8 sobre saldo -5 resulta en saldo +3.';

    -- Reducir la compra de 8 a 4 retiraría 4 unidades, pero solo hay 3.
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_guardar_nota_cxp(
            p_nota_id := v_nota_compra_id,
            p_proveedor_id := v_proveedor_id,
            p_personal_id := NULL,
            p_sucursal_id := v_sucursal_1,
            p_monto_total := 320.00,
            p_descripcion := 'Reducción de compra sin disponibilidad',
            p_lineas := jsonb_build_array(
                jsonb_build_object(
                    'catalogo_item_id', v_prod_1,
                    'cantidad', 4,
                    'precio_unitario', 80.00,
                    'descripcion', 'Compra Balones'
                )
            ),
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%supera las existencias%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO PRUEBA 3: Se permitió reducir una compra sin unidades suficientes';

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id
      AND sucursal_id = v_sucursal_1
      AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 3,
      format('FALLO PRUEBA 3: La reducción fallida alteró el saldo (%s != 3)', v_saldo);
    RAISE NOTICE 'PASADA: Una reducción de compra sin disponibilidad se revierte completa.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 4: Cobro o pago posterior no altera inventario
    -- ------------------------------------------------------------------------
    INSERT INTO public.cobros_aplicados (cuenta_cobrar_id, escuela_id, monto_aplicado, usuario_id)
    VALUES (v_nota_id, v_escuela_id, 360.00, v_usuario_super);

    INSERT INTO public.pagos_aplicados (cuenta_pagar_id, escuela_id, monto_aplicado, usuario_id)
    VALUES (v_nota_compra_id, v_escuela_id, 100.00, v_usuario_super);

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 3, 'FALLO PRUEBA 4: Cobro alteró indebidamente el inventario';
    RAISE NOTICE 'PRUEBA 4 PASADA: Cobro/Pago posterior no modifica existencias.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 5: Edición con cambio de precio únicamente (delta = 0, sin movimientos)
    -- ------------------------------------------------------------------------
    SELECT count(*) INTO v_cant_movs FROM public.inventario_movimientos WHERE escuela_id = v_escuela_id;

    v_op_id := gen_random_uuid();
    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := v_nota_id,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 450.00,
        p_descripcion := 'Venta Balón con nuevo precio',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 3, 'precio_unitario', 150.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT count(*) INTO v_i FROM public.inventario_movimientos WHERE escuela_id = v_escuela_id;
    ASSERT v_cant_movs = v_i, 'FALLO PRUEBA 5: Edición de solo precio generó movimientos de inventario innecesarios';
    RAISE NOTICE 'PRUEBA 5 PASADA: Edición de solo precio no genera movimientos.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 6: Edición con cambio de cantidad (pasa de 3 a 5 unidades -> delta = 2)
    -- ------------------------------------------------------------------------
    v_op_id := gen_random_uuid();
    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := v_nota_id,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 750.00,
        p_descripcion := 'Venta Balón editado a 5 unidades',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 5, 'precio_unitario', 150.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    -- Saldo anterior era 3; venta aumentó en 2 -> saldo resultante debe ser 1.
    ASSERT v_saldo = 1, format('FALLO PRUEBA 6: Saldo esperado 1, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 6 PASADA: Edición de cantidad descuenta únicamente la diferencia (delta).';

    -- ------------------------------------------------------------------------
    -- PRUEBA 7: Anulación de venta (repone unidades exactas)
    -- ------------------------------------------------------------------------
    UPDATE public.cuentas_cobrar
    SET anulada = true
    WHERE id = v_nota_id;

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    -- Tenía 1, la nota anulada tenía 5 unidades -> saldo pasa a 6.
    ASSERT v_saldo = 6, format('FALLO PRUEBA 7: Saldo esperado 6, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 7 PASADA: Anulación de venta repone exactamente las unidades vendidas.';

    -- La compra original fue de 8 unidades y solo quedan 6: anularla debe fallar.
    v_error_ocurrido := false;
    BEGIN
        UPDATE public.cuentas_pagar
        SET anulada = true
        WHERE id = v_nota_compra_id;
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%supera las existencias%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO PRUEBA 7: Se permitió anular una compra sin existencias suficientes';

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id
      AND sucursal_id = v_sucursal_1
      AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 6,
      format('FALLO PRUEBA 7: La anulación fallida de compra alteró el saldo (%s != 6)', v_saldo);
    RAISE NOTICE 'PASADA: La anulación de compra se bloquea y revierte si falta disponibilidad.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 8: Regalo, ajuste de salida y traslado bloqueados por saldo insuficiente
    -- ------------------------------------------------------------------------
    -- v_prod_3 tiene 5 unidades en sucursal_1. Regalar 6 debe fallar.
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_registrar_movimiento_inventario(
            p_sucursal_id := v_sucursal_1,
            p_catalogo_item_id := v_prod_3,
            p_tipo := 'regalo',
            p_cantidad := 6,
            p_observacion := 'Regalo excesivo',
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('42883', '42703', '42P01') THEN
            v_error_msg := SQLERRM;
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Fallo estructural en rpc_registrar_movimiento_inventario: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 8: Regalo con saldo insuficiente debió ser bloqueado';
    ASSERT v_error_msg ILIKE '%supera las existencias%', format('Mensaje inesperado: %s', v_error_msg);

    -- Ajuste de salida de 6 unidades debe fallar
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_registrar_movimiento_inventario(
            p_sucursal_id := v_sucursal_1,
            p_catalogo_item_id := v_prod_3,
            p_tipo := 'ajuste_salida',
            p_cantidad := 6,
            p_observacion := 'Ajuste excesivo',
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('42883', '42703', '42P01') THEN
            v_error_msg := SQLERRM;
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Fallo estructural en rpc_registrar_movimiento_inventario: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 8: Ajuste de salida debió ser bloqueado';

    -- Abrir sucursal 2 para probar traslado
    PERFORM public.rpc_confirmar_apertura_inventario(
        p_sucursal_id := v_sucursal_2,
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 0),
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 0),
            jsonb_build_object('catalogo_item_id', v_prod_3, 'cantidad', 0)
        )
    );

    -- Traslado de 6 unidades debe fallar por falta de existencias en origen
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_trasladar_inventario(
            p_origen_id := v_sucursal_1,
            p_destino_id := v_sucursal_2,
            p_catalogo_item_id := v_prod_3,
            p_cantidad := 6,
            p_observacion := 'Traslado excesivo',
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE NOT IN ('42883', '42703', '42P01') THEN
            v_error_msg := SQLERRM;
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Fallo estructural en rpc_trasladar_inventario: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 8: Traslado con saldo insuficiente debió ser bloqueado';
    RAISE NOTICE 'PRUEBA 8 PASADA: Regalos, ajustes de salida y traslados se bloquean si falta stock.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 9: Traslado conserva balance total de la escuela
    -- ------------------------------------------------------------------------
    -- v_prod_3 tiene 5 en sucursal_1 y 0 en sucursal_2. Trasladar 3 unidades:
    PERFORM public.rpc_trasladar_inventario(
        p_origen_id := v_sucursal_1,
        p_destino_id := v_sucursal_2,
        p_catalogo_item_id := v_prod_3,
        p_cantidad := 3,
        p_observacion := 'Traslado de 3 conos',
        p_operacion_id := gen_random_uuid()
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_3;
    ASSERT v_saldo = 2, format('FALLO PRUEBA 9: Saldo origen esperado 2, obtenido %s', v_saldo);

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_2 AND catalogo_item_id = v_prod_3;
    ASSERT v_saldo = 3, format('FALLO PRUEBA 9: Saldo destino esperado 3, obtenido %s', v_saldo);
    RAISE NOTICE 'PRUEBA 9 PASADA: Traslado transaccional conserva balance total (2+3 = 5).';

    -- ------------------------------------------------------------------------
    -- PRUEBA 10: Idempotencia con operacion_id persistente (anti doble clic y reintentos)
    -- ------------------------------------------------------------------------
    v_op_id := gen_random_uuid();
    -- Intento 1 de venta
    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 85.00,
        p_descripcion := 'Camiseta Oficial',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 1, 'precio_unitario', 85.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_2;
    ASSERT v_saldo = 9, format('FALLO PRUEBA 10: Saldo esperado 9 tras venta, obtenido %s', v_saldo);

    -- Reintento idéntico con el MISMO operacion_id
    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 85.00,
        p_descripcion := 'Camiseta Oficial',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 1, 'precio_unitario', 85.00)
        ),
        p_operacion_id := v_op_id
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_2;
    ASSERT v_saldo = 9, format('FALLO PRUEBA 10: El reintento descontó stock duplicado (saldo %s)', v_saldo);
    RAISE NOTICE 'PRUEBA 10 PASADA: Reintento secuencial sin duplicar la nota ni su movimiento.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 11: Cupo de productos (límite 10 productos activos, producto 11 bloqueado)
    -- ------------------------------------------------------------------------
    -- El SuperAdministrador de la escuela no puede ampliar su propio cupo.
    v_error_ocurrido := false;
    BEGIN
        UPDATE public.escuelas
        SET limite_productos_inventario = 11
        WHERE id = v_escuela_id;
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%solo puede ser modificado por la administración de SaaSport%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO PRUEBA 11: El SuperAdministrador pudo modificar el cupo de su escuela';

    -- Actualmente hay 3 productos activos. Insertamos 7 más para completar el límite de 10.
    FOR v_i IN 4..10 LOOP
        v_prod_nuevo := gen_random_uuid();
        INSERT INTO public.catalogo_items (id, escuela_id, nombre, tipo, categoria, precio_venta, activo)
        VALUES (v_prod_nuevo, v_escuela_id, 'Producto ' || v_i, 'producto', 'producto', 10.00, true);

        IF v_i = 4 THEN
            SELECT count(*) INTO v_cant_movs
            FROM public.inventario_saldos
            WHERE escuela_id = v_escuela_id
              AND catalogo_item_id = v_prod_nuevo
              AND cantidad_disponible = 0;
            ASSERT v_cant_movs = 2,
              format('FALLO PRUEBA 11: Producto posterior a apertura no inició en cero en ambas sucursales (%s filas)', v_cant_movs);
        END IF;
    END LOOP;

    v_error_ocurrido := false;
    BEGIN
        INSERT INTO public.catalogo_items (id, escuela_id, nombre, tipo, categoria, precio_venta, activo)
        VALUES (gen_random_uuid(), v_escuela_id, 'Producto 11 Excedente', 'producto', 'producto', 10.00, true);
    EXCEPTION WHEN OTHERS THEN
        IF SQLSTATE = 'P0001' OR SQLERRM ILIKE '%límite de productos%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado al validar cupo: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 11: Se permitió crear el producto 11 superando el cupo';
    RAISE NOTICE 'PRUEBA 11 PASADA: Límite de 10 productos activos aplicado en ejecución secuencial.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 12: Bloqueo de archivo para productos con existencias distintas de cero
    -- ------------------------------------------------------------------------
    -- v_prod_2 tiene saldo 9. Intentar desactivarlo debe fallar.
    v_error_ocurrido := false;
    BEGIN
        UPDATE public.catalogo_items
        SET activo = false
        WHERE id = v_prod_2;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%existencias distintas de cero%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado al archivar: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 12: Se permitió archivar producto con existencias distintas de cero';
    RAISE NOTICE 'PRUEBA 12 PASADA: Archivo de productos con stock != 0 bloqueado exitosamente.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 13: Protección contra eliminación física de notas con historial
    -- ------------------------------------------------------------------------
    v_error_ocurrido := false;
    BEGIN
        DELETE FROM public.cuentas_cobrar WHERE id = v_nota_id;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%No se puede eliminar físicamente%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado al eliminar nota físicamente: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 13: Se permitió DELETE físico de nota con movimientos de inventario';
    RAISE NOTICE 'PRUEBA 13 PASADA: Eliminación física bloqueada para notas con movimientos de inventario.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 14: Restricciones de rol y sucursal al editar notas
    -- ------------------------------------------------------------------------
    -- A. Asistente NO puede editar notas existentes
    PERFORM set_config('request.jwt.claim.sub', v_usuario_asistente::text, true);
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_guardar_nota_cxc(
            p_nota_id := v_nota_pre_id,
            p_alumno_id := v_alumno_id,
            p_sucursal_id := v_sucursal_1,
            p_monto_total := 240.00,
            p_descripcion := 'Edición prohibida por asistente',
            p_lineas := jsonb_build_array(
                jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 2, 'precio_unitario', 120.00)
            ),
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%No autorizado para editar notas%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado en restricción de Asistente: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 14A: Se permitió al Asistente editar una nota';
    RAISE NOTICE 'PRUEBA 14A PASADA: Asistente bloqueado al intentar editar notas existentes.';

    -- B. Administrador de sucursal 1 NO puede editar nota de sucursal 2
    PERFORM set_config('request.jwt.claim.sub', v_usuario_super::text, true);
    -- Creamos una nota en sucursal 2 con SuperAdmin:
    v_op_id := gen_random_uuid();
    v_nota_id := public.rpc_guardar_nota_cxc(
        p_nota_id := NULL,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_2,
        p_monto_total := 85.00,
        p_descripcion := 'Nota sucursal 2',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 1, 'precio_unitario', 85.00)
        ),
        p_operacion_id := v_op_id
    );

    -- Cambiamos la sesión al Administrador asignado a sucursal 1
    PERFORM set_config('request.jwt.claim.sub', v_usuario_admin1::text, true);
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_guardar_nota_cxc(
            p_nota_id := v_nota_id,
            p_alumno_id := v_alumno_id,
            p_sucursal_id := v_sucursal_2,
            p_monto_total := 85.00,
            p_descripcion := 'Edición cruzada prohibida',
            p_lineas := jsonb_build_array(
                jsonb_build_object('catalogo_item_id', v_prod_2, 'cantidad', 1, 'precio_unitario', 85.00)
            ),
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%No autorizado para editar notas de otra sucursal%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado en restricción de sucursal de Administrador: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 14B: Se permitió al Administrador editar nota de otra sucursal';
    RAISE NOTICE 'PRUEBA 14B PASADA: Administrador restringido estrictamente a su sucursal.';

    -- C. Bloqueo de evasión de trigger al modificar directamente detalle convirtiendo producto a servicio
    v_error_ocurrido := false;
    BEGIN
        -- Intentar alterar directamente una línea con producto para cambiar su item a servicio
        UPDATE public.cxc_detalle
        SET catalogo_item_id = v_serv_1
        WHERE cuenta_cobrar_id = v_nota_id;
    EXCEPTION WHEN OTHERS THEN
        IF SQLERRM ILIKE '%Las notas con productos deben registrarse y editarse mediante las funciones transaccionales%' THEN
            v_error_ocurrido := true;
        ELSE
            RAISE EXCEPTION 'Error inesperado en evasión de trigger: %', SQLERRM;
        END IF;
    END;
    ASSERT v_error_ocurrido, 'FALLO PRUEBA 14C: Se permitió evadir el trigger cambiando producto a servicio';
    RAISE NOTICE 'PRUEBA 14C PASADA: Vector de evasión de trigger producto->servicio cerrado.';

    -- D. Un Administrador sin sucursal no puede registrar movimientos manuales.
    PERFORM set_config('request.jwt.claim.sub', v_usuario_super::text, true);
    UPDATE public.usuarios
    SET sucursal_id = NULL
    WHERE id = v_usuario_admin1;

    PERFORM set_config('request.jwt.claim.sub', v_usuario_admin1::text, true);
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_registrar_movimiento_inventario(
            p_sucursal_id := v_sucursal_1,
            p_catalogo_item_id := v_prod_3,
            p_tipo := 'ajuste_entrada',
            p_cantidad := 1,
            p_observacion := 'Movimiento prohibido sin sucursal',
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%Solo puedes operar tu sucursal%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO PRUEBA 14D: Administrador sin sucursal pudo registrar un movimiento manual';

    PERFORM set_config('request.jwt.claim.sub', v_usuario_super::text, true);
    UPDATE public.usuarios
    SET sucursal_id = v_sucursal_1
    WHERE id = v_usuario_admin1;
    RAISE NOTICE 'PRUEBA 14D PASADA: Administrador sin sucursal bloqueado en movimientos manuales.';

    -- E. Ninguna RPC de inventario acepta una sucursal de otra escuela.
    v_error_ocurrido := false;
    BEGIN
        PERFORM public.rpc_registrar_movimiento_inventario(
            p_sucursal_id := v_sucursal_otra,
            p_catalogo_item_id := v_prod_3,
            p_tipo := 'ajuste_entrada',
            p_cantidad := 1,
            p_observacion := 'Movimiento cruzado prohibido',
            p_operacion_id := gen_random_uuid()
        );
    EXCEPTION WHEN OTHERS THEN
        v_error_ocurrido := SQLERRM ILIKE '%La sucursal no pertenece a la escuela%';
    END;
    ASSERT v_error_ocurrido,
      'FALLO PRUEBA 14E: Se permitió un movimiento en una sucursal de otra escuela';
    RAISE NOTICE 'PRUEBA 14E PASADA: Aislamiento entre escuelas aplicado en el servidor.';

    -- ------------------------------------------------------------------------
    -- PRUEBA 15: Preservación de condición histórica al editar notas pre-apertura
    -- ------------------------------------------------------------------------
    PERFORM set_config('request.jwt.claim.sub', v_usuario_super::text, true);
    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    -- Saldo actual es 6.

    PERFORM public.rpc_guardar_nota_cxc(
        p_nota_id := v_nota_pre_id,
        p_alumno_id := v_alumno_id,
        p_sucursal_id := v_sucursal_1,
        p_monto_total := 1200.00,
        p_descripcion := 'Balón histórico editado a 10 unidades',
        p_lineas := jsonb_build_array(
            jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 10, 'precio_unitario', 120.00)
        ),
        p_operacion_id := gen_random_uuid()
    );

    SELECT cantidad_disponible INTO v_saldo
    FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    ASSERT v_saldo = 6, format('FALLO PRUEBA 15: Editar nota histórica alteró el saldo de inventario (%s != 6)', v_saldo);
    RAISE NOTICE 'PRUEBA 15 PASADA: Edición de nota previa a apertura respeta condición histórica.';

    -- PRUEBA 16: mensualidad + producto + otro servicio en la misma nota.
    -- El ciclo de cabecera solo se hereda en la línea de Mensualidad.
    INSERT INTO public.catalogo_items (id, escuela_id, nombre, tipo, categoria, precio_venta, activo)
    VALUES (v_serv_otro, v_escuela_id, 'Inscripción prueba mixta', 'servicio', 'servicio', 20, true);
    SELECT cantidad_disponible INTO v_saldo_antes FROM public.inventario_saldos
    WHERE escuela_id = v_escuela_id AND sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1;
    v_lineas_mixtas := jsonb_build_array(
      jsonb_build_object('catalogo_item_id', v_prod_1, 'cantidad', 2, 'precio_unitario', 120),
      jsonb_build_object('catalogo_item_id', v_serv_1, 'cantidad', 1, 'precio_unitario', 100),
      jsonb_build_object('catalogo_item_id', v_serv_otro, 'cantidad', 1, 'precio_unitario', 20)
    );
    v_nota_id := public.rpc_guardar_nota_cxc(
      p_alumno_id := v_alumno_id, p_sucursal_id := v_sucursal_1,
      p_monto_total := 360, p_descripcion := 'Nota mixta',
      p_ciclo_inicio := DATE '2026-11-17', p_ciclo_fin := DATE '2026-12-16',
      p_lineas := v_lineas_mixtas, p_operacion_id := gen_random_uuid()
    );
    ASSERT (SELECT periodo_estadistico = DATE '2026-12-01' FROM public.cuentas_cobrar WHERE id = v_nota_id),
      'FALLO 16: Periodo de cabecera de nota mixta incorrecto';
    ASSERT (SELECT count(*) = 1 FROM public.cxc_detalle WHERE cuenta_cobrar_id = v_nota_id
      AND catalogo_item_id = v_serv_1 AND ciclo_inicio = DATE '2026-11-17'
      AND ciclo_fin = DATE '2026-12-16' AND periodo_estadistico = DATE '2026-12-01'),
      'FALLO 16: La mensualidad no heredó su ciclo y periodo';
    ASSERT (SELECT count(*) = 2 FROM public.cxc_detalle WHERE cuenta_cobrar_id = v_nota_id
      AND catalogo_item_id IN (v_prod_1, v_serv_otro)
      AND ciclo_inicio IS NULL AND ciclo_fin IS NULL AND periodo_estadistico IS NULL),
      'FALLO 16: Se asignó ciclo o periodo a un producto u otro servicio';
    ASSERT (SELECT cantidad_disponible = v_saldo_antes - 2 FROM public.inventario_saldos
      WHERE sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1),
      'FALLO 16: La nota mixta no descontó exactamente dos productos';
    ASSERT (SELECT count(*) = 1 FROM public.inventario_movimientos WHERE referencia_id = v_nota_id),
      'FALLO 16: La nota mixta produjo movimientos ajenos al producto';

    -- El duplicado debe fallar atómicamente, incluso poniendo primero el producto.
    SELECT count(*) INTO v_notas_antes FROM public.cuentas_cobrar WHERE escuela_id = v_escuela_id;
    v_error_ocurrido := false;
    BEGIN
      PERFORM public.rpc_guardar_nota_cxc(
        p_alumno_id := v_alumno_id, p_sucursal_id := v_sucursal_1,
        p_monto_total := 360, p_descripcion := 'Mensualidad duplicada',
        p_ciclo_inicio := DATE '2026-11-17', p_ciclo_fin := DATE '2026-12-16',
        p_lineas := v_lineas_mixtas, p_operacion_id := gen_random_uuid()
      );
    EXCEPTION WHEN unique_violation THEN
      v_error_ocurrido := SQLERRM ILIKE '%Ya existe una mensualidad activa%';
    END;
    ASSERT v_error_ocurrido, 'FALLO 16: Se aceptó una mensualidad duplicada';
    ASSERT (SELECT count(*) = v_notas_antes FROM public.cuentas_cobrar WHERE escuela_id = v_escuela_id),
      'FALLO 16: El rechazo dejó una nota parcial';
    ASSERT (SELECT cantidad_disponible = v_saldo_antes - 2 FROM public.inventario_saldos
      WHERE sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1),
      'FALLO 16: El rechazo modificó el inventario';

    -- Cambio de cantidad: solo la diferencia; luego cambio de precio: cero movimientos.
    v_lineas_mixtas := jsonb_set(v_lineas_mixtas, '{0,cantidad}', '5');
    PERFORM public.rpc_guardar_nota_cxc(
      p_nota_id := v_nota_id, p_alumno_id := v_alumno_id, p_sucursal_id := v_sucursal_1,
      p_monto_total := 720, p_descripcion := 'Nota mixta editada',
      p_ciclo_inicio := DATE '2026-11-17', p_ciclo_fin := DATE '2026-12-16',
      p_lineas := v_lineas_mixtas, p_operacion_id := gen_random_uuid()
    );
    ASSERT (SELECT cantidad_disponible = v_saldo_antes - 5 FROM public.inventario_saldos
      WHERE sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1),
      'FALLO 16: La edición mixta no aplicó solamente la diferencia';
    SELECT count(*) INTO v_cant_movs FROM public.inventario_movimientos WHERE referencia_id = v_nota_id;
    v_lineas_mixtas := jsonb_set(v_lineas_mixtas, '{0,precio_unitario}', '125');
    PERFORM public.rpc_guardar_nota_cxc(
      p_nota_id := v_nota_id, p_alumno_id := v_alumno_id, p_sucursal_id := v_sucursal_1,
      p_monto_total := 745, p_descripcion := 'Solo precio modificado',
      p_ciclo_inicio := DATE '2026-11-17', p_ciclo_fin := DATE '2026-12-16',
      p_lineas := v_lineas_mixtas, p_operacion_id := gen_random_uuid()
    );
    ASSERT (SELECT count(*) = v_cant_movs FROM public.inventario_movimientos WHERE referencia_id = v_nota_id),
      'FALLO 16: El cambio de precio creó un movimiento';
    UPDATE public.cuentas_cobrar SET anulada = true WHERE id = v_nota_id;
    ASSERT (SELECT cantidad_disponible = v_saldo_antes FROM public.inventario_saldos
      WHERE sucursal_id = v_sucursal_1 AND catalogo_item_id = v_prod_1),
      'FALLO 16: La anulación mixta no devolvió exactamente los productos';
    ASSERT (SELECT count(*) = 3 FROM public.cxc_detalle WHERE cuenta_cobrar_id = v_nota_id),
      'FALLO 16: La anulación eliminó el detalle histórico';
    RAISE NOTICE 'PRUEBA 16 PASADA: Nota mixta, periodos, duplicados, diferencias, precios y anulación.';

    RAISE NOTICE '=======================================================';
    RAISE NOTICE '¡TODAS LAS PRUEBAS DE ESTA SUITE SQL PASARON CON ÉXITO!';
    RAISE NOTICE '=======================================================';
END $$;

-- Reversión total para no dejar datos de prueba
ROLLBACK;
