-- ==============================================================================
-- Migración: Inventario por Sucursal (SaaSport)
-- Archivo: supabase/migrations/20260915131645_inventario_por_sucursal.sql
-- ==============================================================================

-- 1. Cupo de inventario por escuela
ALTER TABLE public.escuelas
  ADD COLUMN IF NOT EXISTS limite_productos_inventario integer NOT NULL DEFAULT 10
  CHECK (limite_productos_inventario >= 0);

-- 2. Idempotencia en notas
ALTER TABLE public.cuentas_cobrar
  ADD COLUMN IF NOT EXISTS operacion_id uuid;

ALTER TABLE public.cuentas_pagar
  ADD COLUMN IF NOT EXISTS operacion_id uuid;

ALTER TABLE public.cuentas_pagar
  ADD COLUMN IF NOT EXISTS nro_factura text;

CREATE UNIQUE INDEX IF NOT EXISTS ix_cuentas_cobrar_operacion_id
  ON public.cuentas_cobrar (escuela_id, operacion_id)
  WHERE operacion_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ix_cuentas_pagar_operacion_id
  ON public.cuentas_pagar (escuela_id, operacion_id)
  WHERE operacion_id IS NOT NULL;

-- 3. Aperturas de inventario por sucursal (conteo físico inicial)
CREATE TABLE IF NOT EXISTS public.inventario_aperturas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE RESTRICT,
  abierto_por uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  abierto_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escuela_id, sucursal_id)
);

CREATE INDEX IF NOT EXISTS ix_inventario_aperturas_sucursal
  ON public.inventario_aperturas (sucursal_id);
CREATE INDEX IF NOT EXISTS ix_inventario_aperturas_responsable
  ON public.inventario_aperturas (abierto_por);

-- 4. Saldos de inventario por escuela, sucursal y producto (admite saldos negativos)
CREATE TABLE IF NOT EXISTS public.inventario_saldos (
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE RESTRICT,
  catalogo_item_id uuid NOT NULL REFERENCES public.catalogo_items(id) ON DELETE RESTRICT,
  cantidad_disponible integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (escuela_id, sucursal_id, catalogo_item_id)
);

CREATE INDEX IF NOT EXISTS ix_inventario_saldos_sucursal
  ON public.inventario_saldos (sucursal_id);
CREATE INDEX IF NOT EXISTS ix_inventario_saldos_producto
  ON public.inventario_saldos (catalogo_item_id);

-- 5. Historial inmutable de movimientos de inventario
CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES public.sucursales(id) ON DELETE RESTRICT,
  catalogo_item_id uuid NOT NULL REFERENCES public.catalogo_items(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN (
    'apertura', 'compra', 'venta', 'regalo',
    'ajuste_entrada', 'ajuste_salida',
    'traslado_entrada', 'traslado_salida',
    'correccion', 'anulacion_compra', 'anulacion_venta'
  )),
  cantidad integer NOT NULL CHECK (cantidad > 0),
  direccion text NOT NULL CHECK (direccion IN ('entrada', 'salida')),
  saldo_resultante integer NOT NULL,
  observacion text,
  referencia_tipo text,
  referencia_id uuid,
  operacion_id uuid NOT NULL DEFAULT gen_random_uuid(),
  creado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_historial
  ON public.inventario_movimientos (escuela_id, sucursal_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_producto
  ON public.inventario_movimientos (escuela_id, sucursal_id, catalogo_item_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_sucursal
  ON public.inventario_movimientos (sucursal_id);

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_producto_fk
  ON public.inventario_movimientos (catalogo_item_id);

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_responsable
  ON public.inventario_movimientos (creado_por)
  WHERE creado_por IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_inventario_movimientos_referencia
  ON public.inventario_movimientos (
    escuela_id, referencia_tipo, referencia_id, catalogo_item_id
  )
  WHERE referencia_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ix_inventario_movimientos_idempotencia
  ON public.inventario_movimientos (escuela_id, operacion_id, catalogo_item_id, tipo)
  WHERE operacion_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.fn_inventario_historial_inmutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'El historial de inventario es inmutable.';
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_movimientos_inmutables ON public.inventario_movimientos;
CREATE TRIGGER trg_inventario_movimientos_inmutables
  BEFORE UPDATE OR DELETE ON public.inventario_movimientos
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_historial_inmutable();

-- 6. Auditoría de cambios de cupo
CREATE TABLE IF NOT EXISTS public.inventario_cambios_cupo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id) ON DELETE RESTRICT,
  limite_anterior integer NOT NULL,
  limite_nuevo integer NOT NULL,
  cambiado_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_inventario_cambios_cupo_escuela
  ON public.inventario_cambios_cupo (escuela_id);
CREATE INDEX IF NOT EXISTS ix_inventario_cambios_cupo_responsable
  ON public.inventario_cambios_cupo (cambiado_por)
  WHERE cambiado_por IS NOT NULL;

DROP TRIGGER IF EXISTS trg_inventario_cambios_cupo_inmutables ON public.inventario_cambios_cupo;
CREATE TRIGGER trg_inventario_cambios_cupo_inmutables
  BEFORE UPDATE OR DELETE ON public.inventario_cambios_cupo
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_historial_inmutable();

-- 7. Trigger de auditoría y protección del cupo en escuelas
CREATE OR REPLACE FUNCTION public.fn_inventario_auditar_cupo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.limite_productos_inventario IS DISTINCT FROM OLD.limite_productos_inventario THEN
    IF auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.escuela_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'El cupo de inventario solo puede ser modificado por la administración de SaaSport.';
    END IF;

    IF NEW.limite_productos_inventario < (
      SELECT count(*) FROM public.catalogo_items
      WHERE escuela_id = NEW.id AND categoria = 'producto' AND activo
    ) THEN
      RAISE EXCEPTION 'El nuevo cupo es menor que los productos activos de la escuela.';
    END IF;

    INSERT INTO public.inventario_cambios_cupo (escuela_id, limite_anterior, limite_nuevo, cambiado_por)
    VALUES (NEW.id, OLD.limite_productos_inventario, NEW.limite_productos_inventario, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_auditar_cupo ON public.escuelas;
CREATE TRIGGER trg_inventario_auditar_cupo
  BEFORE UPDATE OF limite_productos_inventario ON public.escuelas
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_auditar_cupo();

-- 8. Validaciones de catálogo (cupo concurrente, archivo y bloqueo de categoría)
CREATE OR REPLACE FUNCTION public.fn_inventario_validar_catalogo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limite integer;
  v_activos integer;
BEGIN
  -- Impedir cambiar categoría de producto si tiene historial de movimientos
  IF TG_OP = 'UPDATE' AND OLD.categoria = 'producto' AND NEW.categoria <> 'producto'
     AND (
       EXISTS (
         SELECT 1 FROM public.inventario_movimientos m
         WHERE m.escuela_id = OLD.escuela_id AND m.catalogo_item_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.movimientos_stock m
         WHERE m.escuela_id = OLD.escuela_id AND m.catalogo_item_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.cxc_detalle d
         WHERE d.escuela_id = OLD.escuela_id AND d.catalogo_item_id = OLD.id
       )
       OR EXISTS (
         SELECT 1 FROM public.cxp_detalle d
         WHERE d.escuela_id = OLD.escuela_id AND d.catalogo_item_id = OLD.id
       )
     ) THEN
    RAISE EXCEPTION 'No se puede cambiar la categoría de un producto con historial de inventario.';
  END IF;

  -- Impedir archivar si tiene existencias distintas de cero en cualquier sucursal
  IF TG_OP = 'UPDATE' AND OLD.categoria = 'producto' AND OLD.activo
     AND (NEW.categoria <> 'producto' OR NOT NEW.activo) THEN
    IF EXISTS (
      SELECT 1 FROM public.inventario_saldos s
      WHERE s.escuela_id = OLD.escuela_id AND s.catalogo_item_id = OLD.id
        AND s.cantidad_disponible <> 0
    ) THEN
      RAISE EXCEPTION 'No se puede archivar el producto mientras tenga existencias distintas de cero en alguna sucursal.';
    END IF;
  END IF;

  -- Validación concurrente de cupo al crear o reactivar producto
  IF NEW.categoria = 'producto' AND NEW.activo
     AND (TG_OP = 'INSERT' OR OLD.categoria <> 'producto' OR NOT OLD.activo) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.escuela_id::text || ':inventario-cupo', 0));
    SELECT limite_productos_inventario INTO v_limite FROM public.escuelas WHERE id = NEW.escuela_id FOR UPDATE;
    SELECT count(*) INTO v_activos FROM public.catalogo_items
      WHERE escuela_id = NEW.escuela_id AND categoria = 'producto' AND activo
        AND (TG_OP = 'INSERT' OR id <> NEW.id);
    IF v_activos >= v_limite THEN
      RAISE EXCEPTION 'Alcanzaste el límite de productos. Solicita una ampliación a SaaSport.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_validar_catalogo ON public.catalogo_items;
CREATE TRIGGER trg_inventario_validar_catalogo
  BEFORE INSERT OR UPDATE OF categoria, activo ON public.catalogo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_validar_catalogo();

-- Los productos creados o reactivados después de la apertura comienzan en cero.
CREATE OR REPLACE FUNCTION public.fn_inventario_inicializar_producto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.categoria = 'producto' AND NEW.activo
     AND (
       TG_OP = 'INSERT'
       OR OLD.categoria IS DISTINCT FROM 'producto'
       OR OLD.activo IS DISTINCT FROM true
     ) THEN
    INSERT INTO public.inventario_saldos (
      escuela_id, sucursal_id, catalogo_item_id, cantidad_disponible
    )
    SELECT a.escuela_id, a.sucursal_id, NEW.id, 0
    FROM public.inventario_aperturas a
    WHERE a.escuela_id = NEW.escuela_id
    ON CONFLICT (escuela_id, sucursal_id, catalogo_item_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_inicializar_producto ON public.catalogo_items;
CREATE TRIGGER trg_inventario_inicializar_producto
  AFTER INSERT OR UPDATE OF categoria, activo ON public.catalogo_items
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_inicializar_producto();

-- 9. Función central de registro con idempotencia (fn_inventario_registrar)
CREATE OR REPLACE FUNCTION public.fn_inventario_registrar(
  p_escuela_id uuid,
  p_sucursal_id uuid,
  p_catalogo_item_id uuid,
  p_tipo text,
  p_delta integer,
  p_observacion text,
  p_referencia_tipo text,
  p_referencia_id uuid,
  p_usuario_id uuid DEFAULT NULL,
  p_operacion_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_saldo integer;
  v_saldo_nuevo integer;
  v_categoria text;
  v_op_id uuid := COALESCE(p_operacion_id, gen_random_uuid());
  v_existente integer;
BEGIN
  IF p_delta = 0 THEN
    RAISE EXCEPTION 'El movimiento de inventario debe tener una cantidad distinta de cero.';
  END IF;

  -- Protección de idempotencia por operación
  IF p_operacion_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(
      p_escuela_id::text || ':inventario:' || p_operacion_id::text || ':' ||
      p_catalogo_item_id::text || ':' || p_tipo,
      0
    ));
    SELECT saldo_resultante INTO v_existente
    FROM public.inventario_movimientos
    WHERE escuela_id = p_escuela_id
      AND operacion_id = p_operacion_id
      AND catalogo_item_id = p_catalogo_item_id
      AND tipo = p_tipo;
    IF FOUND THEN
      RETURN v_existente;
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = p_sucursal_id AND escuela_id = p_escuela_id) THEN
    RAISE EXCEPTION 'La sucursal no pertenece a la escuela.';
  END IF;

  SELECT categoria INTO v_categoria
  FROM public.catalogo_items
  WHERE id = p_catalogo_item_id AND escuela_id = p_escuela_id;
  IF v_categoria IS DISTINCT FROM 'producto' THEN
    RAISE EXCEPTION 'El ítem no es un producto inventariable.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.inventario_aperturas WHERE escuela_id = p_escuela_id AND sucursal_id = p_sucursal_id) THEN
    RAISE EXCEPTION 'Confirma el conteo inicial de esta sucursal antes de operar productos.';
  END IF;

  -- Bloqueo y actualización de saldo
  INSERT INTO public.inventario_saldos (escuela_id, sucursal_id, catalogo_item_id)
  VALUES (p_escuela_id, p_sucursal_id, p_catalogo_item_id)
  ON CONFLICT DO NOTHING;

  SELECT cantidad_disponible INTO v_saldo
  FROM public.inventario_saldos
  WHERE escuela_id = p_escuela_id
    AND sucursal_id = p_sucursal_id
    AND catalogo_item_id = p_catalogo_item_id
  FOR UPDATE;

  v_saldo_nuevo := v_saldo + p_delta;

  -- Solo las ventas admiten saldo negativo
  IF p_delta < 0 AND p_tipo <> 'venta' AND v_saldo_nuevo < 0 THEN
    RAISE EXCEPTION 'La salida de % unidades supera las existencias disponibles (%).', abs(p_delta), v_saldo;
  END IF;

  UPDATE public.inventario_saldos
  SET cantidad_disponible = v_saldo_nuevo, updated_at = now()
  WHERE escuela_id = p_escuela_id
    AND sucursal_id = p_sucursal_id
    AND catalogo_item_id = p_catalogo_item_id;

  INSERT INTO public.inventario_movimientos (
    escuela_id, sucursal_id, catalogo_item_id, tipo, cantidad, direccion, saldo_resultante,
    observacion, referencia_tipo, referencia_id, operacion_id, creado_por
  ) VALUES (
    p_escuela_id, p_sucursal_id, p_catalogo_item_id, p_tipo, abs(p_delta),
    CASE WHEN p_delta > 0 THEN 'entrada' ELSE 'salida' END, v_saldo_nuevo,
    nullif(btrim(p_observacion), ''), p_referencia_tipo, p_referencia_id, v_op_id, p_usuario_id
  );

  RETURN v_saldo_nuevo;
END;
$$;

-- 10. RPC Atómica para Notas de Venta y Mixtas (rpc_guardar_nota_cxc)
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
       AND v_nota_existente.sucursal_id IS NOT NULL
       AND v_nota_existente.sucursal_id IS DISTINCT FROM v_usuario.sucursal_id THEN
      RAISE EXCEPTION 'No autorizado para editar notas de otra sucursal.';
    END IF;

    -- Conservar la sucursal original al editar
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

  IF p_alumno_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.alumnos a
    WHERE a.id = p_alumno_id AND a.escuela_id = v_usuario.escuela_id
  ) THEN
    RAISE EXCEPTION 'Alumno inválido para la escuela.';
  END IF;

  IF v_sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = v_sucursal_id AND escuela_id = v_usuario.escuela_id) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
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
  DELETE FROM temp_cxc_lineas_ant;

  CREATE TEMP TABLE IF NOT EXISTS temp_cxc_lineas_nue (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxc_lineas_nue;

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

-- 11. RPC Atómica para Notas de Compra / Gastos (rpc_guardar_nota_cxp)
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
  DELETE FROM temp_cxp_lineas_ant;

  CREATE TEMP TABLE IF NOT EXISTS temp_cxp_lineas_nue (catalogo_item_id uuid PRIMARY KEY, cantidad integer) ON COMMIT DROP;
  DELETE FROM temp_cxp_lineas_nue;

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

-- 12. Triggers de protección contra modificaciones directas que evadan inventario
CREATE OR REPLACE FUNCTION public.fn_inventario_proteger_detalles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat text;
BEGIN
  IF current_setting('saasport.en_rpc_guardar_nota', true) = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Comprobar si la fila entrante contiene un producto
  IF (TG_OP IN ('INSERT', 'UPDATE')) AND NEW.catalogo_item_id IS NOT NULL THEN
    SELECT categoria INTO v_cat FROM public.catalogo_items WHERE id = NEW.catalogo_item_id;
    IF v_cat = 'producto' THEN
      RAISE EXCEPTION 'Las notas con productos deben registrarse y editarse mediante las funciones transaccionales de inventario.';
    END IF;
  END IF;

  -- Comprobar si la fila saliente era un producto (evita convertir producto en servicio para evadir)
  IF (TG_OP IN ('UPDATE', 'DELETE')) AND OLD.catalogo_item_id IS NOT NULL THEN
    SELECT categoria INTO v_cat FROM public.catalogo_items WHERE id = OLD.catalogo_item_id;
    IF v_cat = 'producto' THEN
      RAISE EXCEPTION 'Las notas con productos deben registrarse y editarse mediante las funciones transaccionales de inventario.';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_proteger_cxc_detalle ON public.cxc_detalle;
CREATE TRIGGER trg_inventario_proteger_cxc_detalle
  BEFORE INSERT OR UPDATE OR DELETE ON public.cxc_detalle
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_detalles();

DROP TRIGGER IF EXISTS trg_inventario_proteger_cxp_detalle ON public.cxp_detalle;
CREATE TRIGGER trg_inventario_proteger_cxp_detalle
  BEFORE INSERT OR UPDATE OR DELETE ON public.cxp_detalle
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_detalles();

-- Conservar la sucursal original de toda nota que contenga productos.
CREATE OR REPLACE FUNCTION public.fn_inventario_proteger_sucursal_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.sucursal_id IS NOT DISTINCT FROM OLD.sucursal_id THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'cuentas_cobrar' AND EXISTS (
    SELECT 1
    FROM public.cxc_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_cobrar_id = OLD.id AND ci.categoria = 'producto'
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la sucursal original de una nota con productos.';
  END IF;

  IF TG_TABLE_NAME = 'cuentas_pagar' AND EXISTS (
    SELECT 1
    FROM public.cxp_detalle d
    JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
    WHERE d.cuenta_pagar_id = OLD.id AND ci.categoria = 'producto'
  ) THEN
    RAISE EXCEPTION 'No se puede cambiar la sucursal original de una nota con productos.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_proteger_sucursal_cxc ON public.cuentas_cobrar;
CREATE TRIGGER trg_inventario_proteger_sucursal_cxc
  BEFORE UPDATE OF sucursal_id ON public.cuentas_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_sucursal_nota();

DROP TRIGGER IF EXISTS trg_inventario_proteger_sucursal_cxp ON public.cuentas_pagar;
CREATE TRIGGER trg_inventario_proteger_sucursal_cxp
  BEFORE UPDATE OF sucursal_id ON public.cuentas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_sucursal_nota();

-- 13. Protección contra eliminación física de notas con movimientos
CREATE OR REPLACE FUNCTION public.fn_inventario_proteger_borrado_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.inventario_movimientos
    WHERE escuela_id = OLD.escuela_id
      AND (
        (referencia_tipo = 'cxc' AND referencia_id = OLD.id)
        OR (referencia_tipo = 'cxp' AND referencia_id = OLD.id)
        OR (referencia_tipo IN ('venta', 'correccion_venta') AND referencia_id IN (SELECT id FROM public.cxc_detalle WHERE cuenta_cobrar_id = OLD.id))
        OR (referencia_tipo IN ('compra', 'correccion_compra') AND referencia_id IN (SELECT id FROM public.cxp_detalle WHERE cuenta_pagar_id = OLD.id))
      )
  ) THEN
    RAISE EXCEPTION 'No se puede eliminar físicamente una nota con movimientos de inventario. Debe anularse.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_proteger_borrado_cxc ON public.cuentas_cobrar;
CREATE TRIGGER trg_inventario_proteger_borrado_cxc
  BEFORE DELETE ON public.cuentas_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_borrado_nota();

DROP TRIGGER IF EXISTS trg_inventario_proteger_borrado_cxp ON public.cuentas_pagar;
CREATE TRIGGER trg_inventario_proteger_borrado_cxp
  BEFORE DELETE ON public.cuentas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_proteger_borrado_nota();

-- 14. Anulación de notas con inventario (fn_inventario_anular_nota)
CREATE OR REPLACE FUNCTION public.fn_inventario_anular_nota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_abierto_at timestamptz;
  v_detalle record;
BEGIN
  IF OLD.anulada IS TRUE OR NEW.anulada IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.es_anticipo, false) THEN
    RETURN NEW;
  END IF;

  SELECT abierto_at INTO v_abierto_at FROM public.inventario_aperturas
  WHERE escuela_id = NEW.escuela_id AND sucursal_id = NEW.sucursal_id;

  -- Si la nota fue creada antes de la apertura, conserva condición histórica
  IF v_abierto_at IS NULL OR NEW.created_at < v_abierto_at THEN
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'cuentas_cobrar' THEN
    FOR v_detalle IN
      SELECT d.catalogo_item_id, sum(d.cantidad)::integer AS cantidad
      FROM public.cxc_detalle d
      JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE d.cuenta_cobrar_id = NEW.id AND ci.categoria = 'producto'
        AND EXISTS (
          SELECT 1 FROM public.inventario_movimientos m
          WHERE m.escuela_id = NEW.escuela_id
            AND m.sucursal_id = NEW.sucursal_id
            AND m.catalogo_item_id = d.catalogo_item_id
            AND m.referencia_tipo = 'cxc'
            AND m.referencia_id = NEW.id
        )
      GROUP BY d.catalogo_item_id
    LOOP
      PERFORM public.fn_inventario_registrar(
        NEW.escuela_id, NEW.sucursal_id, v_detalle.catalogo_item_id,
        'anulacion_venta', v_detalle.cantidad, 'Anulación de venta: ' || NEW.id,
        'cxc', NEW.id, auth.uid()
      );
    END LOOP;
  ELSE
    FOR v_detalle IN
      SELECT d.catalogo_item_id, sum(d.cantidad)::integer AS cantidad
      FROM public.cxp_detalle d
      JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE d.cuenta_pagar_id = NEW.id AND ci.categoria = 'producto'
        AND EXISTS (
          SELECT 1 FROM public.inventario_movimientos m
          WHERE m.escuela_id = NEW.escuela_id
            AND m.sucursal_id = NEW.sucursal_id
            AND m.catalogo_item_id = d.catalogo_item_id
            AND m.referencia_tipo = 'cxp'
            AND m.referencia_id = NEW.id
        )
      GROUP BY d.catalogo_item_id
    LOOP
      PERFORM public.fn_inventario_registrar(
        NEW.escuela_id, NEW.sucursal_id, v_detalle.catalogo_item_id,
        'anulacion_compra', -v_detalle.cantidad, 'Anulación de compra: ' || NEW.id,
        'cxp', NEW.id, auth.uid()
      );
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventario_anular_cxc ON public.cuentas_cobrar;
CREATE TRIGGER trg_inventario_anular_cxc
  AFTER UPDATE OF anulada ON public.cuentas_cobrar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_anular_nota();

DROP TRIGGER IF EXISTS trg_inventario_anular_cxp ON public.cuentas_pagar;
CREATE TRIGGER trg_inventario_anular_cxp
  AFTER UPDATE OF anulada ON public.cuentas_pagar
  FOR EACH ROW EXECUTE FUNCTION public.fn_inventario_anular_nota();

-- 15. RPC de Apertura de inventario por sucursal
CREATE OR REPLACE FUNCTION public.rpc_confirmar_apertura_inventario(
  p_sucursal_id uuid,
  p_lineas jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario public.usuarios%rowtype;
  l jsonb;
  v_producto uuid;
  v_cantidad integer;
  v_count integer;
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol NOT IN ('Administrador', 'SuperAdministrador') THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_usuario.rol = 'Administrador' AND v_usuario.sucursal_id IS DISTINCT FROM p_sucursal_id THEN
    RAISE EXCEPTION 'Solo puedes abrir el inventario de tu sucursal.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.sucursales WHERE id = p_sucursal_id AND escuela_id = v_usuario.escuela_id) THEN
    RAISE EXCEPTION 'Sucursal inválida.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.inventario_aperturas WHERE escuela_id = v_usuario.escuela_id AND sucursal_id = p_sucursal_id) THEN
    RAISE EXCEPTION 'El inventario ya fue abierto para esta sucursal.';
  END IF;

  SELECT count(*) INTO v_count FROM public.catalogo_items
  WHERE escuela_id = v_usuario.escuela_id AND categoria = 'producto' AND activo;

  IF jsonb_typeof(p_lineas) <> 'array'
     OR jsonb_array_length(p_lineas) <> v_count
     OR (SELECT count(DISTINCT (value->>'catalogo_item_id')::uuid) FROM jsonb_array_elements(p_lineas)) <> v_count THEN
    RAISE EXCEPTION 'Debes confirmar el conteo de todos los productos activos.';
  END IF;

  INSERT INTO public.inventario_aperturas (escuela_id, sucursal_id, abierto_por)
  VALUES (v_usuario.escuela_id, p_sucursal_id, v_usuario.id);

  FOR l IN SELECT value FROM jsonb_array_elements(p_lineas) LOOP
    v_producto := (l->>'catalogo_item_id')::uuid;
    v_cantidad := (l->>'cantidad')::integer;

    IF v_cantidad IS NULL OR v_cantidad < 0
       OR NOT EXISTS (SELECT 1 FROM public.catalogo_items WHERE id = v_producto AND escuela_id = v_usuario.escuela_id AND categoria = 'producto' AND activo) THEN
      RAISE EXCEPTION 'El conteo inicial contiene una línea inválida.';
    END IF;

    IF v_cantidad = 0 THEN
      INSERT INTO public.inventario_saldos (escuela_id, sucursal_id, catalogo_item_id, cantidad_disponible)
      VALUES (v_usuario.escuela_id, p_sucursal_id, v_producto, 0)
      ON CONFLICT (escuela_id, sucursal_id, catalogo_item_id) DO NOTHING;
    ELSE
      PERFORM public.fn_inventario_registrar(
        v_usuario.escuela_id, p_sucursal_id, v_producto,
        'apertura', v_cantidad, 'Conteo inicial',
        'apertura', NULL, v_usuario.id
      );
    END IF;
  END LOOP;
END;
$$;

-- 16. RPC para registrar regalos y ajustes con idempotencia
CREATE OR REPLACE FUNCTION public.rpc_registrar_movimiento_inventario(
  p_sucursal_id uuid,
  p_catalogo_item_id uuid,
  p_tipo text,
  p_cantidad integer,
  p_observacion text,
  p_operacion_id uuid DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario public.usuarios%rowtype;
  v_delta integer;
  v_op_id uuid := COALESCE(p_operacion_id, gen_random_uuid());
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol NOT IN ('Administrador', 'SuperAdministrador') THEN
    RAISE EXCEPTION 'No autorizado.';
  END IF;

  IF v_usuario.rol = 'Administrador' AND v_usuario.sucursal_id IS DISTINCT FROM p_sucursal_id THEN
    RAISE EXCEPTION 'Solo puedes operar tu sucursal.';
  END IF;

  IF p_tipo NOT IN ('regalo', 'ajuste_entrada', 'ajuste_salida') OR p_cantidad <= 0 OR nullif(btrim(p_observacion), '') IS NULL THEN
    RAISE EXCEPTION 'Tipo, cantidad u observación inválidos.';
  END IF;

  v_delta := CASE WHEN p_tipo = 'ajuste_entrada' THEN p_cantidad ELSE -p_cantidad END;

  RETURN public.fn_inventario_registrar(
    v_usuario.escuela_id, p_sucursal_id, p_catalogo_item_id,
    p_tipo, v_delta, p_observacion, 'manual', NULL, v_usuario.id, v_op_id
  );
END;
$$;

-- 17. RPC para traslados con idempotencia
CREATE OR REPLACE FUNCTION public.rpc_trasladar_inventario(
  p_origen_id uuid,
  p_destino_id uuid,
  p_catalogo_item_id uuid,
  p_cantidad integer,
  p_observacion text,
  p_operacion_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario public.usuarios%rowtype;
  v_operacion uuid := COALESCE(p_operacion_id, gen_random_uuid());
BEGIN
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = auth.uid() AND activo;
  IF NOT FOUND OR v_usuario.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo el SuperAdministrador puede trasladar inventario.';
  END IF;

  IF p_origen_id = p_destino_id OR p_cantidad <= 0 OR nullif(btrim(p_observacion), '') IS NULL THEN
    RAISE EXCEPTION 'Traslado inválido.';
  END IF;

  -- Serializar traslados del mismo producto y par de sucursales en un orden estable.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_usuario.escuela_id::text || ':traslado:' || p_catalogo_item_id::text || ':' ||
    least(p_origen_id::text, p_destino_id::text) || ':' ||
    greatest(p_origen_id::text, p_destino_id::text),
    0
  ));

  -- Idempotencia
  IF p_operacion_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.inventario_movimientos
    WHERE escuela_id = v_usuario.escuela_id AND operacion_id = p_operacion_id AND tipo = 'traslado_salida'
  ) THEN
    RETURN;
  END IF;

  PERFORM public.fn_inventario_registrar(
    v_usuario.escuela_id, p_origen_id, p_catalogo_item_id,
    'traslado_salida', -p_cantidad, p_observacion,
    'traslado', v_operacion, v_usuario.id, v_operacion
  );

  PERFORM public.fn_inventario_registrar(
    v_usuario.escuela_id, p_destino_id, p_catalogo_item_id,
    'traslado_entrada', p_cantidad, p_observacion,
    'traslado', v_operacion, v_usuario.id, v_operacion
  );
END;
$$;

-- 18. Seguridad RLS y Permisos
ALTER TABLE public.inventario_aperturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_saldos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_movimientos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventario_cambios_cupo ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.inventario_aperturas, public.inventario_saldos, public.inventario_movimientos, public.inventario_cambios_cupo FROM anon, authenticated;
GRANT SELECT ON public.inventario_aperturas, public.inventario_saldos, public.inventario_movimientos TO authenticated;

DROP POLICY IF EXISTS inventario_aperturas_select ON public.inventario_aperturas;
CREATE POLICY inventario_aperturas_select ON public.inventario_aperturas
  FOR SELECT TO authenticated
  USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (
      (SELECT public.current_user_rol()) = 'SuperAdministrador'
      OR (
        (SELECT public.current_user_rol()) IN ('Administrador', 'Asistente')
        AND sucursal_id = (SELECT private.current_user_sucursal_id())
      )
    )
  );

DROP POLICY IF EXISTS inventario_saldos_select ON public.inventario_saldos;
CREATE POLICY inventario_saldos_select ON public.inventario_saldos
  FOR SELECT TO authenticated
  USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (
      (SELECT public.current_user_rol()) = 'SuperAdministrador'
      OR (
        (SELECT public.current_user_rol()) IN ('Administrador', 'Asistente')
        AND sucursal_id = (SELECT private.current_user_sucursal_id())
      )
    )
  );

DROP POLICY IF EXISTS inventario_movimientos_select ON public.inventario_movimientos;
CREATE POLICY inventario_movimientos_select ON public.inventario_movimientos
  FOR SELECT TO authenticated
  USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (
      (SELECT public.current_user_rol()) = 'SuperAdministrador'
      OR (
        (SELECT public.current_user_rol()) = 'Administrador'
        AND sucursal_id = (SELECT private.current_user_sucursal_id())
      )
    )
  );

REVOKE ALL ON FUNCTION public.fn_inventario_registrar FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_historial_inmutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_auditar_cupo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_validar_catalogo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_inicializar_producto() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_proteger_detalles() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_proteger_sucursal_nota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_proteger_borrado_nota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fn_inventario_anular_nota() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_confirmar_apertura_inventario FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_registrar_movimiento_inventario FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_trasladar_inventario FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_guardar_nota_cxc FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_guardar_nota_cxp FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rpc_confirmar_apertura_inventario(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_registrar_movimiento_inventario(uuid, uuid, text, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_trasladar_inventario(uuid, uuid, uuid, integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_nota_cxc(uuid, uuid, uuid, numeric, text, text, date, date, boolean, jsonb, text, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_nota_cxp(uuid, uuid, uuid, uuid, numeric, text, text, date, date, boolean, jsonb, text, text, text, uuid) TO authenticated;
