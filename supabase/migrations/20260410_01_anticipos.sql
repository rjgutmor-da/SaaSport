-- 20260410_01_anticipos.sql
-- Agregar 'Anticipo a Proveedores' si no existe.
-- 'Cobros Anticipados' ya existe como 2.1.5 (creado en 20260408_02_plan_cuentas_futbol.sql).

DO $$ 
BEGIN 
  IF NOT EXISTS (SELECT 1 FROM public.plan_cuentas WHERE codigo = '1.1.6' AND escuela_id IS NULL) THEN
    INSERT INTO public.plan_cuentas (codigo, nombre, tipo, es_transaccional) 
    VALUES ('1.1.6', 'Anticipo a Proveedores (Pagos adelantados por bienes o servicios)', 'activo', true);
  END IF;
END $$;
