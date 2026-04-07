-- ==============================================================================
-- SaaSport: Módulo de Finanzas - CORE CONTABLE PURISTA (Producción)
-- Ubicación Oficial: SaaSport/supabase/migrations/
-- ==============================================================================

-- ==========================================
-- 0. FUNCIONES DE PROTECCIÓN Y VALIDACIÓN
-- ==========================================

CREATE OR REPLACE FUNCTION prevent_update_delete() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Operación denegada. El libro contable es append-only (solo inserciones).';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validar_partida_doble() RETURNS TRIGGER AS $$
DECLARE
    v_descuadrados INT;
BEGIN
    SELECT COUNT(*)
    INTO v_descuadrados
    FROM (
        SELECT mc.asiento_id
        FROM public.movimientos_contables mc
        WHERE mc.asiento_id IN (SELECT asiento_id FROM nuevos_movimientos)
        GROUP BY mc.asiento_id
        HAVING SUM(mc.debe) <> SUM(mc.haber)
    ) AS subquery;

    IF v_descuadrados > 0 THEN
        RAISE EXCEPTION 'Constraint Lógico Violado: La transacción contiene Asientos donde el Debe NO es igual al Haber.';
    END IF;

    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validar_sobrepago_cxc() RETURNS TRIGGER AS $$
DECLARE
    v_monto_total DECIMAL;
    v_pagado_anterior DECIMAL;
BEGIN
    SELECT monto_total INTO v_monto_total FROM public.cuentas_cobrar WHERE id = NEW.cuenta_cobrar_id;
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior FROM public.cobros_aplicados 
    WHERE cuenta_cobrar_id = NEW.cuenta_cobrar_id AND id <> NEW.id;

    IF (v_pagado_anterior + NEW.monto_aplicado) > v_monto_total THEN
        RAISE EXCEPTION 'El abono de % excede la deuda restante de la Factura CxC.', NEW.monto_aplicado;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_validar_sobrepago_cxp() RETURNS TRIGGER AS $$
DECLARE
    v_monto_total DECIMAL;
    v_pagado_anterior DECIMAL;
BEGIN
    SELECT monto_total INTO v_monto_total FROM public.cuentas_pagar WHERE id = NEW.cuenta_pagar_id;
    SELECT COALESCE(SUM(monto_aplicado), 0) INTO v_pagado_anterior FROM public.pagos_aplicados 
    WHERE cuenta_pagar_id = NEW.cuenta_pagar_id AND id <> NEW.id;

    IF (v_pagado_anterior + NEW.monto_aplicado) > v_monto_total THEN
        RAISE EXCEPTION 'El abono de % excede la deuda restante de la Factura CxP.', NEW.monto_aplicado;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ==========================================
-- 1. TABLAS MAESTRAS (Core Contable)
-- ==========================================

CREATE TABLE public.plan_cuentas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID REFERENCES public.escuelas(id) ON DELETE CASCADE,
    codigo VARCHAR(20) NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    tipo VARCHAR(20) CHECK (tipo IN ('activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto')) NOT NULL,
    es_transaccional BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_plan_cuentas_codigo UNIQUE NULLS NOT DISTINCT (escuela_id, codigo)
);
CREATE INDEX idx_pc_escuela ON public.plan_cuentas(escuela_id);

CREATE TABLE public.cajas_bancos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE SET NULL,
    cuenta_contable_id UUID NOT NULL REFERENCES public.plan_cuentas(id) ON DELETE RESTRICT,
    nombre VARCHAR(100) NOT NULL,
    tipo VARCHAR(30) CHECK (tipo IN ('caja_chica', 'cuenta_bancaria')) NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cajas_escuela ON public.cajas_bancos(escuela_id);

CREATE TABLE public.proveedores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    cuenta_contable_id UUID REFERENCES public.plan_cuentas(id) ON DELETE SET NULL,
    nombre VARCHAR(150) NOT NULL,
    nit_ci VARCHAR(30),
    telefono VARCHAR(30),
    direccion TEXT,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prov_escuela ON public.proveedores(escuela_id);

CREATE TABLE public.personal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    cuenta_contable_id UUID REFERENCES public.plan_cuentas(id) ON DELETE SET NULL,
    nombres VARCHAR(100) NOT NULL,
    apellidos VARCHAR(100) NOT NULL,
    cargo VARCHAR(80),
    telefono VARCHAR(30),
    salario_base DECIMAL(10,2),
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pers_escuela ON public.personal(escuela_id);

-- ==========================================
-- 2. INVENTARIO (MODO LIVIANO MVP)
-- ==========================================

CREATE TABLE public.productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    nombre VARCHAR(150) NOT NULL,
    precio_venta DECIMAL(12,2) DEFAULT 0.00,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.stock_productos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
    cantidad_disponible INT DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ventas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    alumno_id UUID REFERENCES public.alumnos(id) ON DELETE SET NULL,
    fecha TIMESTAMPTZ DEFAULT NOW(),
    total DECIMAL(12,2) NOT NULL CHECK (total >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE public.ventas_detalle (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    venta_id UUID NOT NULL REFERENCES public.ventas(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
    cantidad INT NOT NULL CHECK (cantidad > 0),
    precio_unitario DECIMAL(12,2) NOT NULL CHECK (precio_unitario >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- ==========================================
-- 3. COMPROBANTES Y OBLIGACIONES
-- ==========================================

CREATE TABLE public.comprobantes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    tipo VARCHAR(20) CHECK (tipo IN ('factura', 'recibo')) NOT NULL,
    serie VARCHAR(20),
    numero BIGINT NOT NULL,
    estado VARCHAR(20) DEFAULT 'emitido' CHECK (estado IN ('emitido', 'anulado')),
    fecha_emision TIMESTAMPTZ DEFAULT NOW(),
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_comprobante_numero UNIQUE NULLS NOT DISTINCT (escuela_id, tipo, serie, numero)
);
CREATE INDEX idx_comp_fecha ON public.comprobantes(escuela_id, fecha_emision);

CREATE TABLE public.cuentas_cobrar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE SET NULL,
    alumno_id UUID REFERENCES public.alumnos(id) ON DELETE SET NULL,
    cuenta_contable_id UUID NOT NULL REFERENCES public.plan_cuentas(id) ON DELETE RESTRICT,
    comprobante_id UUID REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
    venta_id UUID REFERENCES public.ventas(id) ON DELETE SET NULL, 
    monto_total DECIMAL(12,2) NOT NULL CHECK (monto_total >= 0),
    periodo VARCHAR(7), -- YYYY-MM
    fecha_emision DATE DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cxc_alumno_escuela ON public.cuentas_cobrar(escuela_id, alumno_id);
CREATE INDEX idx_cxc_periodo ON public.cuentas_cobrar(escuela_id, periodo);

CREATE TABLE public.cuentas_pagar (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE SET NULL,
    proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
    personal_id UUID REFERENCES public.personal(id) ON DELETE SET NULL,
    cuenta_contable_id UUID NOT NULL REFERENCES public.plan_cuentas(id) ON DELETE RESTRICT,
    comprobante_id UUID REFERENCES public.comprobantes(id) ON DELETE RESTRICT,
    monto_total DECIMAL(12,2) NOT NULL CHECK (monto_total >= 0),
    periodo VARCHAR(7), -- YYYY-MM
    fecha_emision DATE DEFAULT CURRENT_DATE,
    fecha_vencimiento DATE,
    descripcion TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cxp_proveedor_escuela ON public.cuentas_pagar(escuela_id, proveedor_id);
CREATE INDEX idx_cxp_periodo ON public.cuentas_pagar(escuela_id, periodo);

-- ==========================================
-- 4. LIBRO MAYOR: ASIENTOS Y MOVIMIENTOS
-- ==========================================

CREATE TABLE public.asientos_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    sucursal_id UUID REFERENCES public.sucursales(id) ON DELETE SET NULL,
    usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
    fecha TIMESTAMPTZ DEFAULT NOW(),
    descripcion TEXT NOT NULL,
    metodo_pago VARCHAR(20) CHECK (metodo_pago IN ('efectivo', 'transferencia', 'qr')) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_asiento_fecha ON public.asientos_contables(escuela_id, fecha);

CREATE TABLE public.movimientos_contables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    asiento_id UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE RESTRICT, 
    cuenta_contable_id UUID NOT NULL REFERENCES public.plan_cuentas(id) ON DELETE RESTRICT,
    debe DECIMAL(12,2) DEFAULT 0.00 CHECK (debe >= 0),
    haber DECIMAL(12,2) DEFAULT 0.00 CHECK (haber >= 0),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_linea_exclusiva CHECK ((debe > 0 AND haber = 0) OR (debe = 0 AND haber > 0))
);
CREATE INDEX idx_mc_asiento ON public.movimientos_contables(asiento_id);
CREATE INDEX idx_mc_cuenta ON public.movimientos_contables(cuenta_contable_id);

CREATE TRIGGER trg_movimientos_inmutables
BEFORE UPDATE OR DELETE ON public.movimientos_contables
FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();

CREATE TRIGGER trg_validar_partida_doble
AFTER INSERT ON public.movimientos_contables
REFERENCING NEW TABLE AS nuevos_movimientos
FOR EACH STATEMENT EXECUTE FUNCTION fn_validar_partida_doble();


-- ==========================================
-- 5. TRAZABILIDAD DE PAGOS (APLICACIÓN N:M)
-- ==========================================

CREATE TABLE public.cobros_aplicados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    cuenta_cobrar_id UUID NOT NULL REFERENCES public.cuentas_cobrar(id) ON DELETE RESTRICT,
    asiento_id UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE RESTRICT,
    monto_aplicado DECIMAL(12,2) NOT NULL CHECK (monto_aplicado > 0),
    fecha TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_cobros_cxc ON public.cobros_aplicados(cuenta_cobrar_id);

CREATE TABLE public.pagos_aplicados (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
    cuenta_pagar_id UUID NOT NULL REFERENCES public.cuentas_pagar(id) ON DELETE RESTRICT,
    asiento_id UUID NOT NULL REFERENCES public.asientos_contables(id) ON DELETE RESTRICT,
    monto_aplicado DECIMAL(12,2) NOT NULL CHECK (monto_aplicado > 0),
    fecha TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_pagos_cxp ON public.pagos_aplicados(cuenta_pagar_id);

CREATE TRIGGER trg_cobros_inmutables BEFORE UPDATE OR DELETE ON public.cobros_aplicados FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
CREATE TRIGGER trg_pagos_inmutables BEFORE UPDATE OR DELETE ON public.pagos_aplicados FOR EACH ROW EXECUTE FUNCTION prevent_update_delete();
CREATE TRIGGER trg_validar_sobrepago_cxc BEFORE INSERT ON public.cobros_aplicados FOR EACH ROW EXECUTE FUNCTION fn_validar_sobrepago_cxc();
CREATE TRIGGER trg_validar_sobrepago_cxp BEFORE INSERT ON public.pagos_aplicados FOR EACH ROW EXECUTE FUNCTION fn_validar_sobrepago_cxp();

-- ==========================================
-- 6. VISTAS DERIVADAS (SINGLE SOURCE OF TRUTH)
-- ==========================================

CREATE OR REPLACE VIEW public.v_saldos_cajas_bancos AS
SELECT 
    cb.id, cb.escuela_id, cb.sucursal_id, cb.nombre, cb.tipo,
    COALESCE(SUM(mc.debe) - SUM(mc.haber), 0) AS saldo_actual
FROM public.cajas_bancos cb
LEFT JOIN public.movimientos_contables mc ON cb.cuenta_contable_id = mc.cuenta_contable_id AND cb.escuela_id = mc.escuela_id
GROUP BY cb.id, cb.escuela_id, cb.sucursal_id, cb.nombre, cb.tipo;

CREATE OR REPLACE VIEW public.v_estado_cuentas_cobrar AS
SELECT 
    cxc.id, cxc.escuela_id, cxc.sucursal_id, cxc.alumno_id, cxc.cuenta_contable_id,
    cxc.comprobante_id, cxc.periodo, cxc.fecha_emision, cxc.fecha_vencimiento, cxc.descripcion, cxc.monto_total,
    COALESCE(SUM(ca.monto_aplicado), 0) AS monto_pagado,
    (cxc.monto_total - COALESCE(SUM(ca.monto_aplicado), 0)) AS deuda_restante,
    CASE 
        WHEN COALESCE(SUM(ca.monto_aplicado), 0) >= cxc.monto_total THEN 'Pagado'
        WHEN cxc.fecha_vencimiento < CURRENT_DATE AND COALESCE(SUM(ca.monto_aplicado), 0) < cxc.monto_total THEN 'Mora'
        WHEN COALESCE(SUM(ca.monto_aplicado), 0) > 0 THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado
FROM public.cuentas_cobrar cxc
LEFT JOIN public.cobros_aplicados ca ON cxc.id = ca.cuenta_cobrar_id
GROUP BY cxc.id;

CREATE OR REPLACE VIEW public.v_estado_cuentas_pagar AS
SELECT 
    cxp.id, cxp.escuela_id, cxp.sucursal_id, cxp.proveedor_id, cxp.personal_id, cxp.cuenta_contable_id,
    cxp.comprobante_id, cxp.periodo, cxp.fecha_emision, cxp.fecha_vencimiento, cxp.descripcion, cxp.monto_total,
    COALESCE(SUM(pa.monto_aplicado), 0) AS monto_pagado,
    (cxp.monto_total - COALESCE(SUM(pa.monto_aplicado), 0)) AS deuda_restante,
    CASE 
        WHEN COALESCE(SUM(pa.monto_aplicado), 0) >= cxp.monto_total THEN 'Pagado'
        WHEN cxp.fecha_vencimiento < CURRENT_DATE AND COALESCE(SUM(pa.monto_aplicado), 0) < cxp.monto_total THEN 'Mora'
        WHEN COALESCE(SUM(pa.monto_aplicado), 0) > 0 THEN 'Parcial'
        ELSE 'Pendiente'
    END AS estado
FROM public.cuentas_pagar cxp
LEFT JOIN public.pagos_aplicados pa ON cxp.id = pa.cuenta_pagar_id
GROUP BY cxp.id;


-- ==========================================
-- 7. BLINDAJE DE SEGURIDAD (REVOKES)
-- ==========================================
REVOKE UPDATE, DELETE ON public.movimientos_contables FROM public, authenticated, anon;
REVOKE UPDATE, DELETE ON public.cobros_aplicados FROM public, authenticated, anon;
REVOKE UPDATE, DELETE ON public.pagos_aplicados FROM public, authenticated, anon;


-- ==========================================
-- 8. PLAN DE CUENTAS ESTÁNDAR (SEED DEL CSV)
-- ==========================================
-- Las cuentas sin escuela_id (NULL) son las cuentas oficiales del producto SaaS disponibles para todos.

INSERT INTO public.plan_cuentas (codigo, nombre, tipo, es_transaccional) VALUES 
-- 1. ACTIVO --
('1', 'ACTIVO', 'activo', false),
('1.1', 'Activo Corriente', 'activo', false),
('1.1.1', 'Cajas Efectivo', 'activo', true),
('1.1.2', 'Bancos', 'activo', true),
('1.1.3', 'Cuentas por Cobrar Alumnos', 'activo', true),
('1.1.4', 'Inventario de Indumentaria', 'activo', true),
('1.1.5', 'Inventario de Productos', 'activo', true),
('1.2', 'Activo No Corriente', 'activo', false),
('1.2.1', 'Terrenos / Instalaciones Deportivas', 'activo', true),
('1.2.2', 'Equipamiento Deportivo', 'activo', true),
('1.2.3', 'Muebles y Enseres', 'activo', true),
('1.2.4', 'Equipo de Computación', 'activo', true),

-- 2. PASIVO --
('2', 'PASIVO', 'pasivo', false),
('2.1', 'Pasivo Corriente', 'pasivo', false),
('2.1.1', 'Cuentas por Pagar Proveedores', 'pasivo', true),
('2.1.2', 'Sueldos y Salarios por Pagar', 'pasivo', true),
('2.1.3', 'Beneficios Sociales por Pagar', 'pasivo', true),
('2.1.4', 'Impuestos y Retenciones por Pagar', 'pasivo', true),
('2.1.5', 'Cobros Anticipados', 'pasivo', true),

-- 3. PATRIMONIO --
('3', 'PATRIMONIO', 'patrimonio', false),
('3.1', 'Capital Social', 'patrimonio', true),
('3.2', 'Resultados Acumulados', 'patrimonio', true),
('3.3', 'Resultado del Ejercicio', 'patrimonio', true),

-- 4. INGRESOS --
('4', 'INGRESOS', 'ingreso', false),
('4.1', 'Ingresos Operativos', 'ingreso', false),
('4.1.1', 'Ingresos por Mensualidades Fútbol', 'ingreso', true),
('4.1.2', 'Ingresos por Inscripciones a Torneos', 'ingreso', true),
('4.1.3', 'Ingresos por Derechos de Formación / Traspasos', 'ingreso', true),
('4.2', 'Venta de Bienes', 'ingreso', false),
('4.2.1', 'Venta de Uniformes', 'ingreso', true),
('4.2.2', 'Venta de Indumentaria de Invierno', 'ingreso', true),
('4.2.3', 'Venta de Accesorios', 'ingreso', true),
('4.2.4', 'Venta de Productos Consumibles', 'ingreso', true),
('4.3', 'Otros Ingresos', 'ingreso', false),
('4.3.1', 'Ingresos por Eventos Especiales', 'ingreso', true),
('4.3.2', 'Venta de Entradas', 'ingreso', true),

-- 5. EGRESOS (GASTOS) --
('5', 'EGRESOS', 'gasto', false),
('5.1', 'Gastos de Personal', 'gasto', false),
('5.1.1', 'Sueldos y Salarios', 'gasto', true),
('5.1.2', 'Bonos e Incentivos al Personal', 'gasto', true),
('5.1.3', 'Cargas Sociales y Beneficios', 'gasto', true),
('5.2', 'Gastos Operativos y de Mantenimiento', 'gasto', false),
('5.2.1', 'Alquiler de Canchas e Instalaciones', 'gasto', true),
('5.2.2', 'Mantenimiento de Campos Deportivos', 'gasto', true),
('5.2.3', 'Servicios Básicos', 'gasto', true),
('5.2.4', 'Materiales y Suministros de Limpieza', 'gasto', true),
('5.2.5', 'Participación en Torneos', 'gasto', true),
('5.2.6', 'Ayuda Social', 'gasto', true),
('5.3', 'Material y Equipamiento Deportivo', 'gasto', false),
('5.3.1', 'Insumos Deportivos', 'gasto', true),
('5.3.2', 'Material Médico y Primeros Auxilios', 'gasto', true),
('5.4', 'Gastos Administrativos y de Gestión', 'gasto', false),
('5.4.1', 'Servicios Profesionales Externos', 'gasto', true),
('5.4.2', 'Gastos de Oficina', 'gasto', true),
('5.4.3', 'Licencias de Software y Publicidad', 'gasto', true),
('5.5', 'Gastos Financieros e Impuestos', 'gasto', false),
('5.5.1', 'Comisiones Bancarias / Retenciones', 'gasto', true),
('5.5.2', 'Impuestos sobre las Ventas / Débito Fiscal', 'gasto', true);

-- Fin Inteligente y Ordenado.
