-- La ficha ya fue normalizada por el grupo antes de sincronizar el vínculo.
CREATE OR REPLACE FUNCTION public.validar_eliminar_entrenador()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.alumnos a WHERE a.id=OLD.alumno_id AND a.profesor_asignado_id IS NULL) THEN
   RETURN OLD;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.alumnos_entrenadores ae
   WHERE ae.alumno_id=OLD.alumno_id AND ae.entrenador_id<>OLD.entrenador_id) THEN
   RAISE EXCEPTION 'Debe haber al menos 1 entrenador asignado. No se puede remover el último entrenador.';
 END IF;
 RETURN OLD;
END;
$$;
