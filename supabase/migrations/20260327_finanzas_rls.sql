-- ==============================================================================
-- SaaSport: Módulo de Finanzas - POLÍTICAS DE SEGURIDAD (RLS)
-- Ubicación Oficial: SaaSport/supabase/migrations/
-- ==============================================================================

-- 1. Habilitar RLS en las 15 tablas maestras y transaccionales
ALTER TABLE public.plan_cuentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cajas_bancos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_productos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_detalle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comprobantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_cobrar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_pagar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_contables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cobros_aplicados ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos_aplicados ENABLE ROW LEVEL SECURITY;

-- 2. Crear políticas base para "Lectura" (SELECT)
-- Aislamiento estricto: Solo puedes leer data donde escuela_id coincida con tu sesión.
CREATE POLICY "lectura_plan_cuentas_escuela" ON public.plan_cuentas FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id() OR escuela_id IS NULL);
CREATE POLICY "lectura_cajas_escuela" ON public.cajas_bancos FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_proveedores_escuela" ON public.proveedores FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_personal_escuela" ON public.personal FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_product_escuela" ON public.productos FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_stock_escuela" ON public.stock_productos FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_ventas_escuela" ON public.ventas FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_ventasdet_escuela" ON public.ventas_detalle FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_comprob_escuela" ON public.comprobantes FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_cxc_escuela" ON public.cuentas_cobrar FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_cxp_escuela" ON public.cuentas_pagar FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_asientos_escuela" ON public.asientos_contables FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_movimientos_escuela" ON public.movimientos_contables FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_cobapl_escuela" ON public.cobros_aplicados FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());
CREATE POLICY "lectura_pagapl_escuela" ON public.pagos_aplicados FOR SELECT TO authenticated USING (escuela_id = current_user_escuela_id());

-- 3. Crear políticas para "Mutación" (INSERT, UPDATE, DELETE)
-- Usamos las funciones nativas: current_user_rol() y current_user_escuela_id()
-- Nota: UPDATE y DELETE ya fueron revocados en el Ledger por comandos REVOKE independientes, 
-- aquí solo blindamos INSERT en esas tablas y CRUD general en las de negocio.
CREATE POLICY "mutacion_finanzas_pc" ON public.plan_cuentas FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_cb" ON public.cajas_bancos FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_prov" ON public.proveedores FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_pers" ON public.personal FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_prod" ON public.productos FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_stok" ON public.stock_productos FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_vent" ON public.ventas FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_vdet" ON public.ventas_detalle FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_comp" ON public.comprobantes FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_cxc" ON public.cuentas_cobrar FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_cxp" ON public.cuentas_pagar FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_asiento" ON public.asientos_contables FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_mov" ON public.movimientos_contables FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_cob" ON public.cobros_aplicados FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
CREATE POLICY "mutacion_finanzas_pag" ON public.pagos_aplicados FOR ALL TO authenticated USING (current_user_rol() IN ('Dueño', 'Administrador', 'SuperAdministrador') AND escuela_id = current_user_escuela_id());
