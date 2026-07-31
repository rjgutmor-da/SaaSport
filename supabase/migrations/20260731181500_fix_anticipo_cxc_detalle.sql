-- Migration: Fix anticipo cxc_detalle items and link missing student IDs
-- Reason: Prevent "La mensualidad no pertenece a una cuenta valida del alumno" by ensuring all advance notes use 'Anticipo' item in cxc_detalle.

-- 1. Asignar alumno_id a notas legacy si pueden identificarse
UPDATE public.cuentas_cobrar 
SET alumno_id = '7acaaa43-66ce-4027-98f8-aa059a9fe71b'
WHERE id = 'fea6c16c-7ffe-40b7-bcd5-dbef7ef1756d' AND alumno_id IS NULL;

UPDATE public.cuentas_cobrar 
SET alumno_id = '0e4995fa-6631-4d45-b041-4aeb7f020f70'
WHERE id = 'f5613722-70bf-4ad8-b35a-6f2684354396' AND alumno_id IS NULL;

-- 2. Corregir cxc_detalle de los anticipos para que usen el catalogo_item "Anticipo" en lugar de "Mensualidad"
UPDATE public.cxc_detalle d
SET catalogo_item_id = ci_ant.id,
    periodo_estadistico = NULL,
    ciclo_inicio = NULL,
    ciclo_fin = NULL
FROM public.cuentas_cobrar cc
JOIN public.catalogo_items ci_ant ON ci_ant.escuela_id = cc.escuela_id AND lower(btrim(ci_ant.nombre)) = 'anticipo'
WHERE d.cuenta_cobrar_id = cc.id
  AND cc.es_anticipo IS TRUE
  AND d.catalogo_item_id IN (
    SELECT ci_men.id FROM public.catalogo_items ci_men WHERE lower(btrim(ci_men.nombre)) = 'mensualidad'
  );
