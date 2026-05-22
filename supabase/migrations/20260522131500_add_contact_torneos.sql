-- ==============================================================================
-- SaaSport: Añadir campos contacto y telefono a tabla torneos
-- Ubicación Oficial: SaaSport/supabase/migrations/20260522131500_add_contact_torneos.sql
-- ==============================================================================

ALTER TABLE public.torneos 
  ADD COLUMN IF NOT EXISTS contacto TEXT,
  ADD COLUMN IF NOT EXISTS telefono TEXT;
