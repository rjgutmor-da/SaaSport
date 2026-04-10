ALTER TABLE public.catalogo_items
ADD COLUMN es_ingreso BOOLEAN DEFAULT true,
ADD COLUMN es_gasto BOOLEAN DEFAULT false;

UPDATE public.catalogo_items
SET es_ingreso = true, es_gasto = (tipo = 'producto');
