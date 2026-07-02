-- Copia sincronizada de la migracion del ecosistema para el repositorio SaaSport.

ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol = ANY (ARRAY[
    'SuperAdministrador'::text, 'Administrador'::text, 'Asistente'::text,
    'Entrenador'::text, 'Entrenarqueros'::text
  ]));

CREATE POLICY "Asistente puede consultar alumnos de su sucursal" ON public.alumnos FOR SELECT TO authenticated
USING (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())));
CREATE POLICY "Asistente puede crear alumnos de su sucursal" ON public.alumnos FOR INSERT TO authenticated
WITH CHECK (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())));
CREATE POLICY "Asistente puede modificar alumnos de su sucursal" ON public.alumnos FOR UPDATE TO authenticated
USING (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())))
WITH CHECK (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())));

CREATE POLICY "Asistente gestiona asistencias de su escuela" ON public.asistencias_normales FOR ALL TO authenticated
USING (current_user_rol() = 'Asistente' AND EXISTS (SELECT 1 FROM public.alumnos a WHERE a.id = asistencias_normales.alumno_id AND a.escuela_id = current_user_escuela_id() AND a.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))))
WITH CHECK (current_user_rol() = 'Asistente' AND EXISTS (SELECT 1 FROM public.alumnos a WHERE a.id = asistencias_normales.alumno_id AND a.escuela_id = current_user_escuela_id() AND a.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))));

CREATE POLICY "Asistente consulta CxC de su sucursal" ON public.cuentas_cobrar FOR SELECT TO authenticated
USING (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())));
CREATE POLICY "Asistente registra CxC en su sucursal" ON public.cuentas_cobrar FOR INSERT TO authenticated
WITH CHECK (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())));
CREATE POLICY "Asistente consulta cobros de su sucursal" ON public.cobros_aplicados FOR SELECT TO authenticated
USING (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND EXISTS (SELECT 1 FROM public.cuentas_cobrar cxc WHERE cxc.id = cobros_aplicados.cuenta_cobrar_id AND cxc.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))));
CREATE POLICY "Asistente registra cobros en su sucursal" ON public.cobros_aplicados FOR INSERT TO authenticated
WITH CHECK (current_user_rol() = 'Asistente' AND escuela_id = current_user_escuela_id() AND EXISTS (SELECT 1 FROM public.cuentas_cobrar cxc WHERE cxc.id = cobros_aplicados.cuenta_cobrar_id AND cxc.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))));
