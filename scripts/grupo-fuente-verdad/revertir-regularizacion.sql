-- Ejecutar en transacción DESPUÉS de rollback.sql. Falla ante ediciones posteriores.
SELECT a.id FROM public.alumnos a JOIN private.respaldo_grupo_20260930 b ON b.alumno_id=a.id
ORDER BY a.id FOR UPDATE OF a;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.alumnos a JOIN private.respaldo_grupo_20260930 b ON b.alumno_id=a.id
 WHERE to_jsonb(a) IS DISTINCT FROM b.alumno_despues
 OR COALESCE((SELECT jsonb_agg(to_jsonb(ag) ORDER BY ag.id) FROM public.alumnos_grupos ag
 WHERE ag.alumno_id=a.id),'[]'::jsonb) IS DISTINCT FROM b.membresias_despues)
 THEN RAISE EXCEPTION 'Hay modificaciones posteriores; se requiere reconciliación individual'; END IF;
END $$;
-- Solo filas creadas por esta regularización, sin asistencia ligada a ellas.
DELETE FROM public.alumnos_grupos ag USING private.respaldo_grupo_20260930 b
WHERE ag.alumno_id=b.alumno_id AND NOT EXISTS (
 SELECT 1 FROM jsonb_array_elements(b.membresias_antes) x WHERE (x->>'id')::uuid=ag.id);
UPDATE public.alumnos_grupos ag SET estado=x.estado,vigente_desde=x.vigente_desde,
 vigente_hasta=x.vigente_hasta,updated_at=x.updated_at
FROM private.respaldo_grupo_20260930 b,
LATERAL jsonb_populate_recordset(NULL::public.alumnos_grupos,b.membresias_antes) x
WHERE ag.id=x.id AND ag.alumno_id=b.alumno_id;
UPDATE public.alumnos a SET grupo_gestion_id=(b.alumno_antes->>'grupo_gestion_id')::uuid
FROM private.respaldo_grupo_20260930 b WHERE a.id=b.alumno_id;
-- Conservar respaldo para auditoría. updated_at refleja la reversión administrativa.
