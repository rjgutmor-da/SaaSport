BEGIN;

DO $$
DECLARE
  v_escuela uuid := '10000000-0000-0000-0000-000000000001';
  v_otra_escuela uuid := '10000000-0000-0000-0000-000000000002';
  v_sucursal uuid := '20000000-0000-0000-0000-000000000001';
  v_actor uuid := '30000000-0000-0000-0000-000000000001';
  v_sin_historial uuid;
  v_con_historial uuid;
  v_con_saldo uuid;
  v_ajeno uuid;
  v_historial_cxc uuid;
  v_historial_cxp uuid;
  v_historial_legacy uuid;
  v_alumno uuid;
  v_cxc uuid;
  v_cxp uuid;
  v_error boolean;
  v_resultado text;
  v_estado record;
BEGIN
  INSERT INTO public.escuelas (id, nombre) VALUES
    (v_escuela, 'Escuela prueba catálogo'),
    (v_otra_escuela, 'Otra escuela');
  INSERT INTO public.sucursales (id, escuela_id, nombre)
    VALUES (v_sucursal, v_escuela, 'Central');
  INSERT INTO auth.users (id) VALUES (v_actor);
  INSERT INTO public.usuarios (id, escuela_id, rol, activo)
    VALUES (v_actor, v_escuela, 'SuperAdministrador', true);
  PERFORM set_config('request.jwt.claim.sub', v_actor::text, true);

  INSERT INTO public.inventario_aperturas (escuela_id, sucursal_id, abierto_por)
    VALUES (v_escuela, v_sucursal, v_actor);

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Servicio CxC histórico', 'servicio', 'servicio', true)
    RETURNING id INTO v_historial_cxc;
  INSERT INTO public.alumnos (escuela_id, sucursal_id, nombres, apellidos)
    VALUES (v_escuela, v_sucursal, 'Alumno', 'Prueba') RETURNING id INTO v_alumno;
  INSERT INTO public.cuentas_cobrar (
    escuela_id, sucursal_id, alumno_id, monto_total, fecha_emision
  ) VALUES (v_escuela, v_sucursal, v_alumno, 10, current_date) RETURNING id INTO v_cxc;
  INSERT INTO public.cxc_detalle (
    escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario
  ) VALUES (v_escuela, v_cxc, v_historial_cxc, 1, 10);

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Servicio CxP histórico', 'servicio', 'servicio', true)
    RETURNING id INTO v_historial_cxp;
  INSERT INTO public.cuentas_pagar (escuela_id, sucursal_id, monto_total, fecha_emision)
    VALUES (v_escuela, v_sucursal, 10, current_date) RETURNING id INTO v_cxp;
  INSERT INTO public.cxp_detalle (
    escuela_id, cuenta_pagar_id, catalogo_item_id, cantidad, precio_unitario
  ) VALUES (v_escuela, v_cxp, v_historial_cxp, 1, 10);

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Producto con movimiento anterior', 'producto', 'producto', true)
    RETURNING id INTO v_historial_legacy;
  INSERT INTO public.movimientos_stock (escuela_id, catalogo_item_id)
    VALUES (v_escuela, v_historial_legacy);

  IF (
    SELECT count(*) FROM public.rpc_estado_catalogo()
    WHERE catalogo_item_id IN (v_historial_cxc, v_historial_cxp, v_historial_legacy)
      AND tiene_movimientos
  ) <> 3 THEN
    RAISE EXCEPTION 'No se detectaron todas las fuentes de historial anteriores';
  END IF;

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Producto sin historial', 'producto', 'producto', true)
    RETURNING id INTO v_sin_historial;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventario_saldos
    WHERE catalogo_item_id = v_sin_historial AND cantidad_disponible = 0
  ) THEN
    RAISE EXCEPTION 'No se creó el saldo cero de preparación';
  END IF;

  SELECT * INTO v_estado FROM public.rpc_estado_catalogo()
  WHERE catalogo_item_id = v_sin_historial;
  IF v_estado.tiene_movimientos OR v_estado.tiene_saldo_no_cero THEN
    RAISE EXCEPTION 'El producto nuevo fue clasificado con historial o saldo';
  END IF;

  v_resultado := public.rpc_gestionar_catalogo_item(v_sin_historial, 'eliminar');
  IF v_resultado <> 'eliminado'
     OR EXISTS (SELECT 1 FROM public.catalogo_items WHERE id = v_sin_historial)
     OR EXISTS (SELECT 1 FROM public.inventario_saldos WHERE catalogo_item_id = v_sin_historial) THEN
    RAISE EXCEPTION 'No se eliminó atómicamente el producto sin historial';
  END IF;

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Producto con historial', 'producto', 'producto', true)
    RETURNING id INTO v_con_historial;
  INSERT INTO public.inventario_movimientos (
    escuela_id, sucursal_id, catalogo_item_id, tipo, cantidad, direccion,
    saldo_resultante, creado_por
  ) VALUES (
    v_escuela, v_sucursal, v_con_historial, 'correccion', 1, 'entrada', 0, v_actor
  );

  v_resultado := public.rpc_gestionar_catalogo_item(v_con_historial, 'desactivar');
  IF v_resultado <> 'desactivado'
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_items WHERE id = v_con_historial AND NOT activo)
     OR NOT EXISTS (SELECT 1 FROM public.inventario_movimientos WHERE catalogo_item_id = v_con_historial) THEN
    RAISE EXCEPTION 'La desactivación no conservó producto e historial';
  END IF;

  v_resultado := public.rpc_gestionar_catalogo_item(v_con_historial, 'reactivar');
  IF v_resultado <> 'reactivado'
     OR NOT EXISTS (SELECT 1 FROM public.catalogo_items WHERE id = v_con_historial AND activo)
     OR (SELECT count(*) FROM public.inventario_saldos WHERE catalogo_item_id = v_con_historial) <> 1 THEN
    RAISE EXCEPTION 'La reactivación duplicó saldos o no activó el producto';
  END IF;

  INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, activo)
    VALUES (v_escuela, 'Producto con saldo', 'producto', 'producto', true)
    RETURNING id INTO v_con_saldo;
  UPDATE public.inventario_saldos SET cantidad_disponible = -1
  WHERE catalogo_item_id = v_con_saldo;

  v_error := false;
  BEGIN
    PERFORM public.rpc_gestionar_catalogo_item(v_con_saldo, 'eliminar');
  EXCEPTION WHEN OTHERS THEN
    v_error := position('existencias distintas de cero' in SQLERRM) > 0;
  END;
  IF NOT v_error OR NOT EXISTS (
    SELECT 1 FROM public.catalogo_items WHERE id = v_con_saldo AND activo
  ) THEN
    RAISE EXCEPTION 'Se permitió eliminar un producto con saldo no cero';
  END IF;

  INSERT INTO public.inventario_movimientos (
    escuela_id, sucursal_id, catalogo_item_id, tipo, cantidad, direccion,
    saldo_resultante, creado_por
  ) VALUES (
    v_escuela, v_sucursal, v_con_saldo, 'correccion', 1, 'salida', -1, v_actor
  );

  v_error := false;
  BEGIN
    PERFORM public.rpc_gestionar_catalogo_item(v_con_saldo, 'desactivar');
  EXCEPTION WHEN OTHERS THEN
    v_error := position('existencias distintas de cero' in SQLERRM) > 0;
  END;
  IF NOT v_error OR NOT EXISTS (
    SELECT 1 FROM public.catalogo_items WHERE id = v_con_saldo AND activo
  ) THEN
    RAISE EXCEPTION 'Se permitió desactivar un producto con saldo no cero';
  END IF;

  SELECT id INTO v_ajeno FROM public.catalogo_items
  WHERE escuela_id = v_otra_escuela LIMIT 1;
  v_error := false;
  BEGIN
    PERFORM public.rpc_gestionar_catalogo_item(v_ajeno, 'eliminar');
  EXCEPTION WHEN OTHERS THEN
    v_error := position('otra escuela' in SQLERRM) > 0;
  END;
  IF NOT v_error OR NOT EXISTS (SELECT 1 FROM public.catalogo_items WHERE id = v_ajeno) THEN
    RAISE EXCEPTION 'Falló el aislamiento entre escuelas';
  END IF;
END;
$$;

ROLLBACK;
