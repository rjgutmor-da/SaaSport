-- ==============================================================================
-- SaaSport: Tabla de Torneos y Políticas de Seguridad (RLS)
-- Ubicación Oficial: SaaSport/supabase/migrations/20260522_create_torneos.sql
-- ==============================================================================

-- 1. Crear tabla de torneos
CREATE TABLE IF NOT EXISTS public.torneos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id UUID NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE DEFAULT current_user_escuela_id(),
  nombre TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT torneos_nombre_escuela_key UNIQUE (escuela_id, nombre)
);

-- 2. Habilitar RLS
ALTER TABLE public.torneos ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas
CREATE POLICY "lectura_torneos_escuela" ON public.torneos 
  FOR SELECT TO authenticated 
  USING (escuela_id = current_user_escuela_id());

CREATE POLICY "mutacion_torneos_escuela" ON public.torneos 
  FOR ALL TO authenticated 
  USING (escuela_id = current_user_escuela_id());
