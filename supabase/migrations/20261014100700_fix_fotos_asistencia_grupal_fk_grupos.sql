-- Migración: Corregir claves foráneas duplicadas y sincronizar grupo_id en fotos_asistencia_grupal
-- Descripción:
-- 1. Respalda y sincroniza grupo_id con cancha_id para los registros históricos donde grupo_id era nulo.
-- 2. Renombra la restricción de clave foránea de grupo_id a un nombre descriptivo.
-- 3. Elimina la clave foránea duplicada fotos_asistencia_grupal_cancha_id_fkey1 que causaba el error PGRST201 en PostgREST.
-- 4. Agrega un disparador (trigger) para mantener sincronizadas automáticamente ambas columnas.

-- 1. Sincronizar registros existentes
UPDATE public.fotos_asistencia_grupal 
SET grupo_id = cancha_id 
WHERE grupo_id IS NULL AND cancha_id IS NOT NULL;

UPDATE public.fotos_asistencia_grupal 
SET cancha_id = grupo_id 
WHERE cancha_id IS NULL AND grupo_id IS NOT NULL;

-- 2. Renombrar constraint si existe con el nombre anterior
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'fotos_asistencia_grupal_cancha_id_fkey' 
      AND conrelid = 'public.fotos_asistencia_grupal'::regclass
  ) THEN
    ALTER TABLE public.fotos_asistencia_grupal 
    RENAME CONSTRAINT fotos_asistencia_grupal_cancha_id_fkey TO fotos_asistencia_grupal_grupo_id_fkey;
  END IF;
END $$;

-- 3. Eliminar constraint duplicada si existe
ALTER TABLE public.fotos_asistencia_grupal 
DROP CONSTRAINT IF EXISTS fotos_asistencia_grupal_cancha_id_fkey1;

-- 4. Función y disparador de sincronización bidireccional
CREATE OR REPLACE FUNCTION public.trg_sync_fotos_asistencia_grupo_cancha()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grupo_id IS NULL AND NEW.cancha_id IS NOT NULL THEN
    NEW.grupo_id := NEW.cancha_id;
  ELSIF NEW.cancha_id IS NULL AND NEW.grupo_id IS NOT NULL THEN
    NEW.cancha_id := NEW.grupo_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS sync_fotos_asistencia_grupo_cancha ON public.fotos_asistencia_grupal;
CREATE TRIGGER sync_fotos_asistencia_grupo_cancha
BEFORE INSERT OR UPDATE ON public.fotos_asistencia_grupal
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_fotos_asistencia_grupo_cancha();

-- 5. Recargar esquema de PostgREST
NOTIFY pgrst, 'reload schema';
