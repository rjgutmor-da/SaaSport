-- Migration: 20260912181000_permitir_asistente_sin_sucursal.sql
-- Permite que los usuarios con rol Asistente que tengan sucursal_id IS NULL
-- puedan consultar, crear y gestionar alumnos, asistencias, CxC y cobros de toda la escuela.

-- 1. Tabla public.alumnos
DROP POLICY IF EXISTS "Asistente puede consultar alumnos de su sucursal" ON public.alumnos;
CREATE POLICY "Asistente puede consultar alumnos de su sucursal"
ON public.alumnos FOR SELECT TO authenticated
USING (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "Asistente puede crear alumnos de su sucursal" ON public.alumnos;
CREATE POLICY "Asistente puede crear alumnos de su sucursal"
ON public.alumnos FOR INSERT TO authenticated
WITH CHECK (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "Asistente puede modificar alumnos de su sucursal" ON public.alumnos;
CREATE POLICY "Asistente puede modificar alumnos de su sucursal"
ON public.alumnos FOR UPDATE TO authenticated
USING (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
)
WITH CHECK (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
);

-- 2. Tabla public.asistencias_normales
DROP POLICY IF EXISTS "Asistente gestiona asistencias de su escuela" ON public.asistencias_normales;
CREATE POLICY "Asistente gestiona asistencias de su escuela"
ON public.asistencias_normales FOR ALL TO authenticated
USING (
  current_user_rol() = 'Asistente'
  AND EXISTS (
    SELECT 1 FROM public.alumnos a
    WHERE a.id = asistencias_normales.alumno_id
      AND a.escuela_id = current_user_escuela_id()
      AND (
        (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
        OR a.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
      )
  )
)
WITH CHECK (
  current_user_rol() = 'Asistente'
  AND EXISTS (
    SELECT 1 FROM public.alumnos a
    WHERE a.id = asistencias_normales.alumno_id
      AND a.escuela_id = current_user_escuela_id()
      AND (
        (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
        OR a.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
      )
  )
);

-- 3. Tabla public.cuentas_cobrar
DROP POLICY IF EXISTS "Asistente consulta CxC de su sucursal" ON public.cuentas_cobrar;
CREATE POLICY "Asistente consulta CxC de su sucursal"
ON public.cuentas_cobrar FOR SELECT TO authenticated
USING (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
);

DROP POLICY IF EXISTS "Asistente registra CxC en su sucursal" ON public.cuentas_cobrar;
CREATE POLICY "Asistente registra CxC en su sucursal"
ON public.cuentas_cobrar FOR INSERT TO authenticated
WITH CHECK (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
  )
);

-- 4. Tabla public.cobros_aplicados
DROP POLICY IF EXISTS "Asistente consulta cobros de su sucursal" ON public.cobros_aplicados;
CREATE POLICY "Asistente consulta cobros de su sucursal"
ON public.cobros_aplicados FOR SELECT TO authenticated
USING (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR EXISTS (
      SELECT 1 FROM public.cuentas_cobrar cxc
      WHERE cxc.id = cobros_aplicados.cuenta_cobrar_id
        AND cxc.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
    )
  )
);

DROP POLICY IF EXISTS "Asistente registra cobros en su sucursal" ON public.cobros_aplicados;
CREATE POLICY "Asistente registra cobros en su sucursal"
ON public.cobros_aplicados FOR INSERT TO authenticated
WITH CHECK (
  current_user_rol() = 'Asistente'
  AND escuela_id = current_user_escuela_id()
  AND (
    (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid())) IS NULL
    OR EXISTS (
      SELECT 1 FROM public.cuentas_cobrar cxc
      WHERE cxc.id = cobros_aplicados.cuenta_cobrar_id
        AND cxc.sucursal_id = (SELECT u.sucursal_id FROM public.usuarios u WHERE u.id = (SELECT auth.uid()))
    )
  )
);
