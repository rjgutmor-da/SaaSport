-- 20260409_05_costo_de_ventas.sql

BEGIN;

-- Insertar la Cuenta Mayor de Costo de Ventas (si no existe)
INSERT INTO public.plan_cuentas (escuela_id, codigo, nombre, tipo, es_transaccional)
VALUES 
  (NULL, '5.6', 'Costo de Bienes Vendidos (Costo de Ventas)', 'gasto', false)
ON CONFLICT (codigo, escuela_id) DO NOTHING;

-- Insertar la cuenta transaccional para los uniformes
INSERT INTO public.plan_cuentas (escuela_id, codigo, nombre, tipo, es_transaccional)
VALUES 
  (NULL, '5.6.1', 'Costo de Uniformes, Indumentaria y Equipamiento', 'gasto', true)
ON CONFLICT (codigo, escuela_id) DO NOTHING;

COMMIT;
