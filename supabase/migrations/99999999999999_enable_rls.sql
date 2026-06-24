-- Habilitar Row Level Security (RLS) en todas las tablas del esquema público
-- Este script actúa como una medida de seguridad estricta para asegurar que ninguna tabla quede expuesta sin políticas.

DO $$
DECLARE
    row record;
BEGIN
    FOR row IN
        SELECT tablename
        FROM pg_tables
        WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', row.tablename);
    END LOOP;
END;
$$;

-- Nota: Como no se han definido políticas específicas de lectura/escritura en este script, 
-- por defecto Supabase denegará TODO el acceso desde la API anónima o autenticada 
-- hasta que se creen las políticas CREATE POLICY correspondientes.
