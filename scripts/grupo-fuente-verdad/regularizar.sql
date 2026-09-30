-- Ejecutar como migración administrativa después de instalar la fuente de verdad.
-- Respaldo privado de la regularización del 30-09-2026. No incluye alumnos sin grupo.
SET LOCAL lock_timeout = '5s';
CREATE TABLE private.respaldo_grupo_20260930 (
  alumno_id uuid PRIMARY KEY, escuela_id uuid NOT NULL,
  alumno_antes jsonb NOT NULL, membresias_antes jsonb NOT NULL,
  alumno_despues jsonb, membresias_despues jsonb
);
ALTER TABLE private.respaldo_grupo_20260930 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.respaldo_grupo_20260930 FROM PUBLIC,anon,authenticated;
-- Bloquear la configuración antes de seleccionar candidatos.
SELECT g.id FROM public.grupos g JOIN public.escuelas e ON e.id=g.escuela_id
WHERE e.activa ORDER BY g.id FOR SHARE OF g;
INSERT INTO private.respaldo_grupo_20260930(alumno_id,escuela_id,alumno_antes,membresias_antes)
SELECT a.id,a.escuela_id,to_jsonb(a),COALESCE((SELECT jsonb_agg(to_jsonb(ag) ORDER BY ag.id)
  FROM public.alumnos_grupos ag WHERE ag.alumno_id=a.id),'[]'::jsonb)
FROM public.alumnos a JOIN public.escuelas e ON e.id=a.escuela_id AND e.activa
JOIN public.grupos g ON g.id=a.cancha_id AND g.escuela_id=a.escuela_id
CROSS JOIN LATERAL private.configuracion_vigente_grupo(a.escuela_id,g.id) c
WHERE a.archivado IS NOT TRUE AND (
  a.horario_id IS DISTINCT FROM c.horario_id OR a.profesor_asignado_id IS DISTINCT FROM c.entrenador_id
  OR a.grupo_gestion_id IS DISTINCT FROM c.grupo_gestion_id
  OR (c.grupo_gestion_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.alumnos_grupos ag WHERE ag.alumno_id=a.id AND ag.gestion_id=c.gestion_id
      AND ag.grupo_gestion_id=c.grupo_gestion_id AND ag.estado='activa'))
) FOR UPDATE OF a;
-- El alcance anunciado solo permite corregir enlaces; abortar si cambió la terna.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM private.respaldo_grupo_20260930 b
   JOIN public.alumnos a ON a.id=b.alumno_id
   CROSS JOIN LATERAL private.configuracion_vigente_grupo(a.escuela_id,a.cancha_id) c
   WHERE a.horario_id IS DISTINCT FROM c.horario_id OR a.profesor_asignado_id IS DISTINCT FROM c.entrenador_id)
 THEN RAISE EXCEPTION 'La configuración cambió: revisar y anunciar el nuevo alcance antes de regularizar'; END IF;
END $$;
UPDATE public.alumnos a SET grupo_gestion_id=a.grupo_gestion_id
FROM private.respaldo_grupo_20260930 b WHERE a.id=b.alumno_id;
UPDATE private.respaldo_grupo_20260930 b SET alumno_despues=to_jsonb(a),
 membresias_despues=COALESCE((SELECT jsonb_agg(to_jsonb(ag) ORDER BY ag.id)
 FROM public.alumnos_grupos ag WHERE ag.alumno_id=a.id),'[]'::jsonb)
FROM public.alumnos a WHERE a.id=b.alumno_id;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM private.respaldo_grupo_20260930 b
 WHERE b.alumno_antes->'horario_id' IS DISTINCT FROM b.alumno_despues->'horario_id'
 OR b.alumno_antes->'profesor_asignado_id' IS DISTINCT FROM b.alumno_despues->'profesor_asignado_id'
 OR b.alumno_antes->'sucursal_id' IS DISTINCT FROM b.alumno_despues->'sucursal_id')
 THEN RAISE EXCEPTION 'La regularización alteró campos fuera de alcance'; END IF;
END $$;
