-- Habilitar extensión pg_trgm para búsquedas de texto eficientes con ILIKE
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Crear índice GIN en la columna terminos_busqueda de la tabla alumnos
CREATE INDEX IF NOT EXISTS idx_alumnos_terminos_busqueda_trgm 
  ON public.alumnos USING gin (terminos_busqueda gin_trgm_ops);
