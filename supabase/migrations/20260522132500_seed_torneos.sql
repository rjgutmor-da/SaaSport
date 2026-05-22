-- ==============================================================================
-- SaaSport: Seed de torneos predefinidos
-- Ubicación Oficial: SaaSport/supabase/migrations/20260522132500_seed_torneos.sql
-- ==============================================================================

-- Inserción de la lista de torneos predefinidos para todas las escuelas existentes.
-- Si en el futuro se crea una escuela nueva, los torneos deberían añadirse desde el frontend o mediante triggers.
-- Se usa ON CONFLICT DO NOTHING para evitar duplicados si ya existen.

WITH nuevos_torneos AS (
  SELECT 'Torito Garcia' AS nombre UNION ALL
  SELECT 'Taquito' UNION ALL
  SELECT 'Super Campeones' UNION ALL
  SELECT 'Leones' UNION ALL
  SELECT 'Atletico Junior' UNION ALL
  SELECT 'Cañito' UNION ALL
  SELECT 'Sucha Suarez' UNION ALL
  SELECT 'Planeta' UNION ALL
  SELECT 'Semillero' UNION ALL
  SELECT 'JMP' UNION ALL
  SELECT 'Milton Melgar' UNION ALL
  SELECT 'Blooming Cup'
)
INSERT INTO public.torneos (escuela_id, nombre, activo)
SELECT e.id, nt.nombre, true
FROM public.escuelas e
CROSS JOIN nuevos_torneos nt
ON CONFLICT (escuela_id, nombre) DO NOTHING;
