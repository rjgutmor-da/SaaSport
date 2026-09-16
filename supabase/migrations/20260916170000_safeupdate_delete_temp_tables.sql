-- Migración: Asegurar compatibilidad con extensión safeupdate en tablas temporales de notas CxC y CxP
-- Corrige el error "21000: DELETE requires a WHERE clause" agregando "WHERE true" en los DELETE de tablas temporales.

BEGIN;

-- 1. rpc_guardar_nota_cxc con WHERE true en tablas temporales
CREATE OR REPLACE FUNCTION public.rpc_guardar_nota_cxc(
  p_nota_id uuid DEFAULT NULL,
  p_alumno_id uuid DEFAULT NULL,
  p_sucursal_id uuid DEFAULT NULL,
  p_monto_total numeric DEFAULT 0,
  p_descripcion text DEFAULT '',
  p_observaciones text DEFAULT NULL,
  p_fecha_emision date DEFAULT CURRENT_DATE,
  p_fecha_vencimiento date DEFAULT NULL,
  p_es_anticipo boolean DEFAULT false,
  p_lineas jsonb DEFAULT '[]'::jsonb,
  p_nro_recibo text DEFAULT NULL,
  p_ciclo_inicio date DEFAULT NULL,
  p_ciclo_fin date DEFAULT NULL,
  p_operacion_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario public.usuarios%rowtype;
  v_nota_id uuid := p_nota_id;
  v_nota_existente public.cuentas_cobrar%rowtype;
  v_sucursal_id uuid;
  v_alumno_sucursal_id uuid;
  v_tiene_productos boolean;
  v_abierto_at timestamptz;
  v_es_historica boolean := false;
  v_linea jsonb;
  v_item_id uuid;
  v_item_cat text;
  v_cant integer;
  v_op_id uuid := COALESCE(p_operacion_id, gen_random_uuid());

  v_monto_pagado numeric;
  v_rec record;
  v_es_anticipo boolean;
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RAISE EXCEPTION 'No autorizado para guardar la nota.';
  END IF;

  -- Idempotencia al crear
  IF p_nota_id IS NULL AND p_operacion_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_usuario.escuela_id::text || ':nota-cxc:' || p_operacion_id::text, 0));
    SELECT id INTO v_nota_id FROM public.cuentas_cobrar
    WHERE escuela_id = v_usuario.escuela_id AND operacion_id = p_operacion_id;
    IF FOUND THEN
      RETURN v_nota_id;
    END IF;
  END IF;

  -- Resolución de permisos y sucursal
  IF p_nota_id IS NOT NULL THEN
    -- El Asistente no tiene permiso para editar notas existentes
    IF v_usuario.rol NOT IN ('SuperAdministrador', 'Administrador') THEN
      RAISE EXCEPTION 'No autorizado para editar notas.';
    END IF;

    -- Bloquear con FOR UPDATE antes de leer detalles para serializar ediciones simultáneas
    SELECT * INTO v_nota_existente FROM public.cuentas_cobrar
    WHERE id = p_nota_id AND escuela_id = v_usuario.escuela_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nota no encontrada.'; END IF;

    IF v_nota_existente.anulada IS TRUE THEN
      RAISE EXCEPTION 'No se puede editar una nota anulada.';
    END IF;

    -- Restringir al Administrador a su propia sucursal asignada
    IF v_usuario.rol = 'Administrador'
       AND v_usuario.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para editar notas de otra sucursal.';
    END IF;

    -- Conservar la sucursal original al editar
    v_sucursal_id := v_nota_existente.sucursal_id;
  END IF;

  v_es_anticipo := CASE
    WHEN p_nota_id IS NOT NULL THEN COALESCE(v_nota_existente.es_anticipo, false)
    ELSE COALESCE(p_es_anticipo, false)
  END;

  IF p_monto_total < 0 THEN
    RAISE EXCEPTION 'El monto total no puede ser negativo.';
  END IF;

  SELECT a.sucursal_id INTO v_alumno_sucursal_id
  FROM public.alumnos a
  WHERE a.id = p_alumno_id AND a.escuela_id = v_usuario.escuela_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Alumno inválido para la escuela.'; END IF;

  IF p_nota_id IS NOT NULL AND p_alumno_id IS DISTINCT FROM v_nota_existente.alumno_id THEN
    RAISE EXCEPTION 'No se puede cambiar el alumno de una nota existente.';
  END IF;
  IF v_usuario.rol <> 'SuperAdministrador' AND v_usuario.sucursal_id IS NOT NULL
     AND v_alumno_sucursal_id IS NOT NULL
     AND v_alumno_sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
    RAISE EXCEPTION 'No autorizado para registrar notas del alumno de otra sucursal.';
  END IF;

  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las líneas de la nota deben enviarse como una lista.';
  END IF;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lineas) l
    JOIN public.catalogo_items ci ON ci.id = (l->>'catalogo_item_id')::uuid
    WHERE ci.escuela_id = v_usuario.escuela_id AND ci.categoria = 'producto'
  ) AND NOT v_es_anticipo INTO v_tiene_productos;

  IF p_nota_id IS NULL THEN
    -- Servicios: sucursal del alumno. Productos: se permite otro origen autorizado.
    v_sucursal_id := CASE WHEN v_tiene_productos
      THEN COALESCE(p_sucursal_id, v_alumno_sucursal_id)
      ELSE COALESCE(v_alumno_sucursal_id, p_sucursal_id) END;
    IF v_sucursal_id IS NULL THEN
      RAISE EXCEPTION 'Selecciona una sucursal: el alumno no tiene sucursal asignada.';
    END IF;
    IF v_usuario.rol <> 'SuperAdministrador' AND v_usuario.sucursal_id IS NOT NULL
       AND v_sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para registrar notas en otra sucursal.';
    END IF;
  END IF;

  IF v_sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = v_sucursal_id AND escuela_id = v_usuario.escuela_id) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
  END IF;

  -- Una entrega desde otra sucursal no puede arrastrar servicios a esa sucursal.
  -- También se valida al editar para impedir añadir servicios a una venta externa.
  IF v_tiene_productos AND v_alumno_sucursal_id IS NOT NULL
     AND v_sucursal_id IS NOT NULL
     AND v_sucursal_id IS DISTINCT FROM v_alumno_sucursal_id
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(p_lineas) l
       JOIN public.catalogo_items ci ON ci.id = (l->>'catalogo_item_id')::uuid
       WHERE ci.escuela_id = v_usuario.escuela_id
         AND ci.categoria IS DISTINCT FROM 'producto'
     ) THEN
    RAISE EXCEPTION 'No se pueden mezclar servicios y productos de otra sucursal. Registra los servicios en una nota separada en la sucursal del alumno.';
  END IF;

  -- Determinar si es nota histórica
  SELECT abierto_at INTO v_abierto_at FROM public.inventario_aperturas
  WHERE escuela_id = v_usuario.escuela_id AND sucursal_id = v_sucursal_id;

  IF p_nota_id IS NOT NULL THEN
    v_es_historica := (v_abierto_at IS NULL OR v_nota_existente.created_at < v_abierto_at);
  ELSE
    v_es_historica := false;
  END IF;

  -- Habilitar paso de RPC en los triggers de detalle
  PERFORM set_config('saasport.en_rpc_guardar_nota', 'true', true);

  CREATE TEMP TABLE IF NOT EXISTS temp_cxc_lineas_ant (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxc_lineas_ant WHERE true;

  CREATE TEMP TABLE IF NOT EXISTS temp_cxc_lineas_nue (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxc_lineas_nue WHERE true;

  IF p_nota_id IS NOT NULL AND NOT v_es_historica THEN
    INSERT INTO temp_cxc_lineas_ant (catalogo_item_id, cantidad)
    SELECT d.catalogo_item_id, sum(d.cantidad)::integer
    FROM public.cxc_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_cobrar_id = p_nota_id AND ci.categoria = 'producto'
    GROUP BY d.catalogo_item_id;
  END IF;

  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las líneas de la nota deben enviarse como una lista.';
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      v_item_id := (v_linea->>'catalogo_item_id')::uuid;
      v_cant := (v_linea->>'cantidad')::integer;
      SELECT categoria INTO v_item_cat FROM public.catalogo_items WHERE id = v_item_id AND escuela_id = v_usuario.escuela_id;
      IF v_item_cat IS NULL OR v_cant IS NULL OR v_cant <= 0
         OR (v_linea->>'precio_unitario') IS NULL
         OR (v_linea->>'precio_unitario')::numeric < 0 THEN
        RAISE EXCEPTION 'La nota contiene una línea inválida.';
      END IF;
      IF v_item_cat = 'producto' THEN
        INSERT INTO temp_cxc_lineas_nue (catalogo_item_id, cantidad)
        VALUES (v_item_id, v_cant)
        ON CONFLICT (catalogo_item_id) DO UPDATE SET cantidad = temp_cxc_lineas_nue.cantidad + EXCLUDED.cantidad;
      END IF;
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM temp_cxc_lineas_nue) AND v_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Las notas con productos requieren una sucursal.';
  END IF;

  -- Guardar o actualizar cabecera
  IF p_nota_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_monto_pagado
    FROM public.cobros_aplicados WHERE cuenta_cobrar_id = p_nota_id;

    UPDATE public.cuentas_cobrar SET
      monto_total = p_monto_total,
      descripcion = p_descripcion,
      observaciones = p_observaciones,
      fecha_emision = p_fecha_emision,
      fecha_vencimiento = p_fecha_vencimiento,
      estado = CASE
        WHEN estado = 'anulada' THEN 'anulada'
        WHEN v_monto_pagado >= p_monto_total AND p_monto_total > 0 THEN 'pagada'
        WHEN v_monto_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
      END,
      nro_recibo = COALESCE(p_nro_recibo, nro_recibo),
      ciclo_inicio = p_ciclo_inicio,
      ciclo_fin = p_ciclo_fin,
      periodo_estadistico = CASE
        WHEN p_ciclo_inicio IS NULL THEN NULL
        WHEN extract(day FROM p_ciclo_inicio) <= 16
          THEN date_trunc('month', p_ciclo_inicio)::date
        ELSE (date_trunc('month', p_ciclo_inicio) + interval '1 month')::date
      END,
      editado = true,
      editado_por = v_usuario.id,
      editado_at = now(),
      updated_at = now()
    WHERE id = p_nota_id;
    v_nota_id := p_nota_id;
  ELSE
    INSERT INTO public.cuentas_cobrar (
      escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
      observaciones, fecha_emision, fecha_vencimiento, es_anticipo,
      estado, nro_recibo, ciclo_inicio, ciclo_fin, periodo_estadistico,
      origen_facturacion, operacion_id
    ) VALUES (
      v_usuario.escuela_id, v_sucursal_id, p_alumno_id, p_monto_total, p_descripcion,
      p_observaciones, p_fecha_emision, p_fecha_vencimiento, v_es_anticipo,
      'pendiente', p_nro_recibo, p_ciclo_inicio, p_ciclo_fin,
      CASE
        WHEN p_ciclo_inicio IS NULL THEN NULL
        WHEN extract(day FROM p_ciclo_inicio) <= 16
          THEN date_trunc('month', p_ciclo_inicio)::date
        ELSE (date_trunc('month', p_ciclo_inicio) + interval '1 month')::date
      END,
      'manual', v_op_id
    ) RETURNING id INTO v_nota_id;
  END IF;

  -- Reemplazar detalles
  IF p_nota_id IS NOT NULL THEN
    DELETE FROM public.cxc_detalle WHERE cuenta_cobrar_id = v_nota_id;
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      -- El trigger validar_ciclo_mensualidad_detalle deriva el periodo solo
      -- para Mensualidad. No propagar el ciclo de cabecera a productos/servicios.
      INSERT INTO public.cxc_detalle (
        escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad,
        precio_unitario, periodo_meses, detalle_extra,
        ciclo_inicio, ciclo_fin
      ) VALUES (
        v_usuario.escuela_id, v_nota_id,
        (v_linea->>'catalogo_item_id')::uuid,
        (v_linea->>'cantidad')::integer,
        (v_linea->>'precio_unitario')::numeric,
        CASE WHEN (v_linea->'periodo_meses') IS NOT NULL AND jsonb_typeof(v_linea->'periodo_meses') = 'array'
             THEN v_linea->'periodo_meses'
             ELSE NULL END,
        v_linea->>'detalle_extra',
        (v_linea->>'ciclo_inicio')::date,
        (v_linea->>'ciclo_fin')::date
      );
    END LOOP;
  END IF;

  -- Procesar inventario mediante cálculo de diferencias si no es histórica
  IF NOT v_es_historica AND NOT v_es_anticipo THEN
    FOR v_rec IN (
      SELECT COALESCE(n.catalogo_item_id, a.catalogo_item_id) AS item_id,
             COALESCE(n.cantidad, 0) - COALESCE(a.cantidad, 0) AS delta
      FROM temp_cxc_lineas_nue n
      FULL OUTER JOIN temp_cxc_lineas_ant a ON a.catalogo_item_id = n.catalogo_item_id
    ) LOOP
      IF v_rec.delta > 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'venta', -v_rec.delta, 'Venta: ' || v_nota_id,
          'cxc', v_nota_id, v_usuario.id, v_op_id
        );
      ELSIF v_rec.delta < 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'correccion', abs(v_rec.delta), 'Corrección de venta: ' || v_nota_id,
          'cxc', v_nota_id, v_usuario.id, v_op_id
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('saasport.en_rpc_guardar_nota', 'false', true);
  RETURN v_nota_id;
END;
$$;

-- 2. rpc_guardar_nota_cxp con WHERE true en tablas temporales
CREATE OR REPLACE FUNCTION public.rpc_guardar_nota_cxp(
  p_nota_id uuid DEFAULT NULL,
  p_proveedor_id uuid DEFAULT NULL,
  p_personal_id uuid DEFAULT NULL,
  p_sucursal_id uuid DEFAULT NULL,
  p_monto_total numeric DEFAULT 0,
  p_descripcion text DEFAULT '',
  p_observaciones text DEFAULT NULL,
  p_fecha_emision date DEFAULT CURRENT_DATE,
  p_fecha_vencimiento date DEFAULT NULL,
  p_es_anticipo boolean DEFAULT false,
  p_lineas jsonb DEFAULT '[]'::jsonb,
  p_nro_factura text DEFAULT NULL,
  p_tipo_gasto text DEFAULT 'proveedor',
  p_periodo text DEFAULT NULL,
  p_operacion_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario public.usuarios%rowtype;
  v_nota_id uuid := p_nota_id;
  v_nota_existente public.cuentas_pagar%rowtype;
  v_sucursal_id uuid;
  v_abierto_at timestamptz;
  v_es_historica boolean := false;
  v_linea jsonb;
  v_item_id uuid;
  v_item_cat text;
  v_cant integer;
  v_op_id uuid := COALESCE(p_operacion_id, gen_random_uuid());

  v_monto_pagado numeric;
  v_rec record;
  v_es_anticipo boolean;
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol NOT IN ('SuperAdministrador', 'Administrador') THEN
    RAISE EXCEPTION 'No autorizado para guardar la compra.';
  END IF;

  -- Idempotencia al crear
  IF p_nota_id IS NULL AND p_operacion_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_usuario.escuela_id::text || ':nota-cxp:' || p_operacion_id::text, 0));
    SELECT id INTO v_nota_id FROM public.cuentas_pagar
    WHERE escuela_id = v_usuario.escuela_id AND operacion_id = p_operacion_id;
    IF FOUND THEN
      RETURN v_nota_id;
    END IF;
  END IF;

  -- Resolución de permisos y sucursal
  IF p_nota_id IS NOT NULL THEN
    -- Bloquear con FOR UPDATE antes de leer detalles para serializar ediciones simultáneas
    SELECT * INTO v_nota_existente FROM public.cuentas_pagar
    WHERE id = p_nota_id AND escuela_id = v_usuario.escuela_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Nota de compra no encontrada.'; END IF;

    IF v_nota_existente.anulada IS TRUE THEN
      RAISE EXCEPTION 'No se puede editar una nota anulada.';
    END IF;

    -- Restringir al Administrador a su propia sucursal asignada
    IF v_usuario.rol = 'Administrador'
       AND v_nota_existente.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para editar notas de otra sucursal.';
    END IF;

    v_sucursal_id := v_nota_existente.sucursal_id;
  ELSE
    IF v_usuario.rol = 'SuperAdministrador' THEN
      v_sucursal_id := p_sucursal_id;
    ELSE
      v_sucursal_id := v_usuario.sucursal_id;
    END IF;
  END IF;

  v_es_anticipo := CASE
    WHEN p_nota_id IS NOT NULL THEN COALESCE(v_nota_existente.es_anticipo, false)
    ELSE COALESCE(p_es_anticipo, false)
  END;

  IF p_monto_total < 0 THEN
    RAISE EXCEPTION 'El monto total no puede ser negativo.';
  END IF;

  IF p_proveedor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.proveedores p
    WHERE p.id = p_proveedor_id AND p.escuela_id = v_usuario.escuela_id
  ) THEN
    RAISE EXCEPTION 'Proveedor inválido para la escuela.';
  END IF;

  IF p_personal_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.personal p
    WHERE p.id = p_personal_id AND p.escuela_id = v_usuario.escuela_id
  ) THEN
    RAISE EXCEPTION 'Personal inválido para la escuela.';
  END IF;

  IF v_sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = v_sucursal_id AND escuela_id = v_usuario.escuela_id) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
  END IF;

  SELECT abierto_at INTO v_abierto_at FROM public.inventario_aperturas
  WHERE escuela_id = v_usuario.escuela_id AND sucursal_id = v_sucursal_id;

  IF p_nota_id IS NOT NULL THEN
    v_es_historica := (v_abierto_at IS NULL OR v_nota_existente.created_at < v_abierto_at);
  ELSE
    v_es_historica := false;
  END IF;

  PERFORM set_config('saasport.en_rpc_guardar_nota', 'true', true);

  CREATE TEMP TABLE IF NOT EXISTS temp_cxp_lineas_ant (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxp_lineas_ant WHERE true;

  CREATE TEMP TABLE IF NOT EXISTS temp_cxp_lineas_nue (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxp_lineas_nue WHERE true;

  IF p_nota_id IS NOT NULL AND NOT v_es_historica THEN
    INSERT INTO temp_cxp_lineas_ant (catalogo_item_id, cantidad)
    SELECT d.catalogo_item_id, sum(d.cantidad)::integer
    FROM public.cxp_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_pagar_id = p_nota_id AND ci.categoria = 'producto'
    GROUP BY d.catalogo_item_id;
  END IF;

  IF jsonb_typeof(p_lineas) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Las líneas de la nota deben enviarse como una lista.';
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      v_item_id := (v_linea->>'catalogo_item_id')::uuid;
      v_cant := (v_linea->>'cantidad')::integer;
      SELECT categoria INTO v_item_cat FROM public.catalogo_items WHERE id = v_item_id AND escuela_id = v_usuario.escuela_id;
      IF v_item_cat IS NULL OR v_cant IS NULL OR v_cant <= 0
         OR (v_linea->>'precio_unitario') IS NULL
         OR (v_linea->>'precio_unitario')::numeric < 0 THEN
        RAISE EXCEPTION 'La nota contiene una línea inválida.';
      END IF;
      IF v_item_cat = 'producto' THEN
        INSERT INTO temp_cxp_lineas_nue (catalogo_item_id, cantidad)
        VALUES (v_item_id, v_cant)
        ON CONFLICT (catalogo_item_id) DO UPDATE SET cantidad = temp_cxp_lineas_nue.cantidad + EXCLUDED.cantidad;
      END IF;
    END LOOP;
  END IF;

  IF EXISTS (SELECT 1 FROM temp_cxp_lineas_nue) AND v_sucursal_id IS NULL THEN
    RAISE EXCEPTION 'Las notas con productos requieren una sucursal.';
  END IF;

  IF p_nota_id IS NOT NULL THEN
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_monto_pagado
    FROM public.pagos_aplicados WHERE cuenta_pagar_id = p_nota_id;

    UPDATE public.cuentas_pagar SET
      monto_total = p_monto_total,
      descripcion = p_descripcion,
      observaciones = p_observaciones,
      fecha_emision = p_fecha_emision,
      fecha_vencimiento = p_fecha_vencimiento,
      proveedor_id = p_proveedor_id,
      personal_id = p_personal_id,
      tipo_gasto = COALESCE(p_tipo_gasto, tipo_gasto, 'proveedor'),
      periodo = p_periodo,
      estado = CASE
        WHEN estado = 'anulada' THEN 'anulada'
        WHEN v_monto_pagado >= p_monto_total AND p_monto_total > 0 THEN 'pagada'
        WHEN v_monto_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
      END,
      nro_factura = COALESCE(p_nro_factura, nro_factura),
      editado = true,
      editado_por = v_usuario.id,
      editado_at = now(),
      updated_at = now()
    WHERE id = p_nota_id;
    v_nota_id := p_nota_id;
  ELSE
    INSERT INTO public.cuentas_pagar (
      escuela_id, sucursal_id, proveedor_id, personal_id, monto_total, descripcion,
      observaciones, fecha_emision, fecha_vencimiento, es_anticipo,
      estado, nro_factura, tipo_gasto, periodo, operacion_id
    ) VALUES (
      v_usuario.escuela_id, v_sucursal_id, p_proveedor_id, p_personal_id, p_monto_total, p_descripcion,
      p_observaciones, p_fecha_emision, p_fecha_vencimiento, v_es_anticipo,
      'pendiente', p_nro_factura, COALESCE(p_tipo_gasto, 'proveedor'), p_periodo, v_op_id
    ) RETURNING id INTO v_nota_id;
  END IF;

  IF p_nota_id IS NOT NULL THEN
    DELETE FROM public.cxp_detalle WHERE cuenta_pagar_id = v_nota_id;
  END IF;

  IF jsonb_typeof(p_lineas) = 'array' THEN
    FOR v_linea IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
      INSERT INTO public.cxp_detalle (
        escuela_id, cuenta_pagar_id, catalogo_item_id, cantidad,
        precio_unitario, descripcion
      ) VALUES (
        v_usuario.escuela_id, v_nota_id,
        (v_linea->>'catalogo_item_id')::uuid,
        (v_linea->>'cantidad')::integer,
        (v_linea->>'precio_unitario')::numeric,
        COALESCE(v_linea->>'descripcion', v_linea->>'detalle_extra')
      );
    END LOOP;
  END IF;

  IF NOT v_es_historica AND NOT v_es_anticipo THEN
    FOR v_rec IN (
      SELECT COALESCE(n.catalogo_item_id, a.catalogo_item_id) AS item_id,
             COALESCE(n.cantidad, 0) - COALESCE(a.cantidad, 0) AS delta
      FROM temp_cxp_lineas_nue n
      FULL OUTER JOIN temp_cxp_lineas_ant a ON a.catalogo_item_id = n.catalogo_item_id
    ) LOOP
      IF v_rec.delta > 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'compra', v_rec.delta, 'Compra en nota CxP ' || COALESCE(p_nro_factura, v_nota_id::text),
          'cxp', v_nota_id, v_usuario.id, v_op_id
        );
      ELSIF v_rec.delta < 0 THEN
        PERFORM public.fn_inventario_registrar(
          v_usuario.escuela_id, v_sucursal_id, v_rec.item_id,
          'correccion', -abs(v_rec.delta), 'Corrección por reducción en compra ' || COALESCE(p_nro_factura, v_nota_id::text),
          'cxp', v_nota_id, v_usuario.id, v_op_id
        );
      END IF;
    END LOOP;
  END IF;

  PERFORM set_config('saasport.en_rpc_guardar_nota', 'false', true);
  RETURN v_nota_id;
END;
$$;

COMMIT;
