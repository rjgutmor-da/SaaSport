-- 1. Drop check constraint and add updated one
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol = ANY (ARRAY['Administrador'::text, 'Entrenador'::text, 'Entrenarqueros'::text, 'SuperAdministrador'::text]));

-- 2. Update users
UPDATE public.usuarios SET rol = 'SuperAdministrador' WHERE rol = 'Dueño';

-- 3. cxp_detalle
DROP POLICY IF EXISTS "actualizar_cxpdet" ON public.cxp_detalle;
CREATE POLICY "actualizar_cxpdet" ON public.cxp_detalle FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_cxpdet" ON public.cxp_detalle;
CREATE POLICY "insertar_cxpdet" ON public.cxp_detalle FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 4. usuarios
DROP POLICY IF EXISTS "actualizar_usuarios_admin" ON public.usuarios;
CREATE POLICY "actualizar_usuarios_admin" ON public.usuarios FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_actualizar_usuarios" ON public.usuarios;
CREATE POLICY "insertar_actualizar_usuarios" ON public.usuarios FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 5. asistencias_normales
DROP POLICY IF EXISTS "Permitir ALL a admins en asistencias_normales" ON public.asistencias_normales;
CREATE POLICY "Permitir ALL a admins en asistencias_normales" ON public.asistencias_normales FOR ALL TO authenticated USING (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (((usuarios.rol)::text = 'SuperAdministrador'::text) OR ((usuarios.rol)::text = 'Administrador'::text))))) WITH CHECK (EXISTS ( SELECT 1 FROM usuarios WHERE ((usuarios.id = auth.uid()) AND (((usuarios.rol)::text = 'SuperAdministrador'::text) OR ((usuarios.rol)::text = 'Administrador'::text)))));

-- 6. sucursales
DROP POLICY IF EXISTS "Administradores pueden actualizar sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden actualizar sucursales" ON public.sucursales FOR UPDATE TO public USING (auth.uid() IN ( SELECT usuarios.id FROM usuarios WHERE ((usuarios.escuela_id = sucursales.escuela_id) AND (((usuarios.rol)::text = 'Administrador'::text) OR ((usuarios.rol)::text = 'SuperAdministrador'::text))))) WITH CHECK (auth.uid() IN ( SELECT usuarios.id FROM usuarios WHERE ((usuarios.escuela_id = sucursales.escuela_id) AND (((usuarios.rol)::text = 'Administrador'::text) OR ((usuarios.rol)::text = 'SuperAdministrador'::text)))));

DROP POLICY IF EXISTS "Administradores pueden crear sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden crear sucursales" ON public.sucursales FOR INSERT TO public WITH CHECK (auth.uid() IN ( SELECT usuarios.id FROM usuarios WHERE ((usuarios.escuela_id = sucursales.escuela_id) AND (((usuarios.rol)::text = 'Administrador'::text) OR ((usuarios.rol)::text = 'SuperAdministrador'::text)))));

DROP POLICY IF EXISTS "Administradores pueden eliminar sucursales" ON public.sucursales;
CREATE POLICY "Administradores pueden eliminar sucursales" ON public.sucursales FOR DELETE TO public USING (auth.uid() IN ( SELECT usuarios.id FROM usuarios WHERE ((usuarios.escuela_id = sucursales.escuela_id) AND (((usuarios.rol)::text = 'Administrador'::text) OR ((usuarios.rol)::text = 'SuperAdministrador'::text)))));

-- 7. cuentas_pagar
DROP POLICY IF EXISTS "actualizar_cxp" ON public.cuentas_pagar;
CREATE POLICY "actualizar_cxp" ON public.cuentas_pagar FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_actualizar_cxp" ON public.cuentas_pagar;
CREATE POLICY "insertar_actualizar_cxp" ON public.cuentas_pagar FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 8. alumnos
DROP POLICY IF EXISTS "Creación de alumnos" ON public.alumnos;
CREATE POLICY "Creación de alumnos" ON public.alumnos FOR INSERT TO authenticated WITH CHECK (((escuela_id = current_user_escuela_id()) AND (((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) OR (((current_user_rol())::text = ANY (ARRAY['Entrenador'::text, 'Entrenarqueros'::text])) AND (profesor_asignado_id = auth.uid())))));

DROP POLICY IF EXISTS "Modificación de alumnos" ON public.alumnos;
CREATE POLICY "Modificación de alumnos" ON public.alumnos FOR UPDATE TO authenticated USING (((escuela_id = current_user_escuela_id()) AND (((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) OR (((current_user_rol())::text = ANY (ARRAY['Entrenador'::text, 'Entrenarqueros'::text])) AND (profesor_asignado_id = auth.uid()))))) WITH CHECK (((escuela_id = current_user_escuela_id()) AND (((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) OR (((current_user_rol())::text = ANY (ARRAY['Entrenador'::text, 'Entrenarqueros'::text])) AND (profesor_asignado_id = auth.uid())))));

DROP POLICY IF EXISTS "Visualización de alumnos" ON public.alumnos;
CREATE POLICY "Visualización de alumnos" ON public.alumnos FOR SELECT TO authenticated USING (((escuela_id = current_user_escuela_id()) AND (((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) OR (((current_user_rol())::text = ANY (ARRAY['Entrenador'::text, 'Entrenarqueros'::text])) AND ((profesor_asignado_id = auth.uid()) OR (EXISTS ( SELECT 1 FROM alumnos_entrenadores ae WHERE ((ae.alumno_id = alumnos.id) AND (ae.entrenador_id = auth.uid())))))))));

-- 9. personal
DROP POLICY IF EXISTS "mutacion_finanzas_pers" ON public.personal;
CREATE POLICY "mutacion_finanzas_pers" ON public.personal FOR ALL TO authenticated USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 10. cajas_bancos
DROP POLICY IF EXISTS "actualizar_cb" ON public.cajas_bancos;
CREATE POLICY "actualizar_cb" ON public.cajas_bancos FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_cb" ON public.cajas_bancos;
CREATE POLICY "insertar_cb" ON public.cajas_bancos FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 11. catalogo_items
DROP POLICY IF EXISTS "actualizar_prod" ON public.catalogo_items;
CREATE POLICY "actualizar_prod" ON public.catalogo_items FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_prod" ON public.catalogo_items;
CREATE POLICY "insertar_prod" ON public.catalogo_items FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 12. proveedores
DROP POLICY IF EXISTS "mutacion_finanzas_prov" ON public.proveedores;
CREATE POLICY "mutacion_finanzas_prov" ON public.proveedores FOR ALL TO authenticated USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 13. cuentas_cobrar
DROP POLICY IF EXISTS "actualizar_cxc" ON public.cuentas_cobrar;
CREATE POLICY "actualizar_cxc" ON public.cuentas_cobrar FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_actualizar_cxc" ON public.cuentas_cobrar;
CREATE POLICY "insertar_actualizar_cxc" ON public.cuentas_cobrar FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 14. pagos_aplicados
DROP POLICY IF EXISTS "actualizar_pag" ON public.pagos_aplicados;
CREATE POLICY "actualizar_pag" ON public.pagos_aplicados FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_pag" ON public.pagos_aplicados;
CREATE POLICY "insertar_pag" ON public.pagos_aplicados FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

-- 15. cobros_aplicados
DROP POLICY IF EXISTS "actualizar_cob" ON public.cobros_aplicados;
CREATE POLICY "actualizar_cob" ON public.cobros_aplicados FOR UPDATE TO public USING ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id()))) WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));

DROP POLICY IF EXISTS "insertar_cob" ON public.cobros_aplicados;
CREATE POLICY "insertar_cob" ON public.cobros_aplicados FOR INSERT TO public WITH CHECK ((((current_user_rol())::text = ANY (ARRAY['Administrador'::text, 'SuperAdministrador'::text])) AND (escuela_id = current_user_escuela_id())));
