-- Migración para extender la tabla catalogo_items con dimensiones contables
ALTER TABLE public.catalogo_items 
ADD COLUMN cuenta_ingreso_id UUID REFERENCES public.plan_cuentas(id) ON DELETE SET NULL,
ADD COLUMN cuenta_gasto_id UUID REFERENCES public.plan_cuentas(id) ON DELETE SET NULL;

-- Índice para mejorar las búsquedas cuando se generen facturas
CREATE INDEX idx_catalogo_ingreso ON public.catalogo_items(cuenta_ingreso_id);
CREATE INDEX idx_catalogo_gasto ON public.catalogo_items(cuenta_gasto_id);
