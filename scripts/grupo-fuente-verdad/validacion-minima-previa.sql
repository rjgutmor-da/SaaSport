CREATE OR REPLACE FUNCTION public.validar_eliminar_entrenador()
RETURNS trigger LANGUAGE plpgsql AS $function$
DECLARE total_entrenadores INT;
BEGIN
 SELECT COUNT(*) INTO total_entrenadores FROM alumnos_entrenadores
 WHERE alumno_id=OLD.alumno_id AND (entrenador_id != OLD.entrenador_id OR TG_OP != 'DELETE');
 IF total_entrenadores < 1 THEN
  RAISE EXCEPTION 'Debe haber al menos 1 entrenador asignado. No se puede remover el último entrenador.';
 END IF;
 RETURN OLD;
END;
$function$;
