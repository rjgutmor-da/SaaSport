-- 20260409_06_costo_unitario.sql

BEGIN;

ALTER TABLE public.catalogo_items
ADD COLUMN costo_unitario DECIMAL(10,2) DEFAULT 0.00;

COMMIT;
