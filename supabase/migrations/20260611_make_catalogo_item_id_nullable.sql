-- Migration to make catalogo_item_id nullable in cxc_detalle and cxp_detalle
-- This allows registering movements like transfers without associating them with any catalog concept.

ALTER TABLE public.cxc_detalle ALTER COLUMN catalogo_item_id DROP NOT NULL;
ALTER TABLE public.cxp_detalle ALTER COLUMN catalogo_item_id DROP NOT NULL;
