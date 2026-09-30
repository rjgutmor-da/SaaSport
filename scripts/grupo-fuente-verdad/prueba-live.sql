BEGIN;
SET LOCAL lock_timeout='3s';
DO $test$
DECLARE g public.grupos%ROWTYPE; actor_id uuid; c record; n integer; outsider uuid;
BEGIN
 SELECT gr.* INTO g FROM public.grupos gr JOIN public.escuelas e ON e.id=gr.escuela_id AND e.activa
 WHERE gr.activo AND EXISTS(SELECT 1 FROM public.usuarios u WHERE u.escuela_id=gr.escuela_id AND u.activo AND u.rol='SuperAdministrador')
 AND EXISTS(SELECT 1 FROM public.alumnos a WHERE a.cancha_id=gr.id AND a.archivado IS NOT TRUE)
 ORDER BY (SELECT count(*) FROM public.alumnos a WHERE a.cancha_id=gr.id AND a.archivado IS NOT TRUE),gr.id LIMIT 1;
 SELECT id INTO actor_id FROM public.usuarios WHERE escuela_id=g.escuela_id AND activo AND rol='SuperAdministrador' ORDER BY id LIMIT 1;
 SELECT * INTO c FROM private.configuracion_vigente_grupo(g.escuela_id,g.id);
 PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM public.rpc_guardar_grupo_completo(g.id,g.nombre,g.sucursal_id,NULL,NULL);
 SELECT count(*) INTO n FROM public.alumnos a WHERE a.cancha_id=g.id AND a.archivado IS NOT TRUE
 AND (a.horario_id IS NOT NULL OR a.profesor_asignado_id IS NOT NULL);
 IF n<>0 THEN RAISE EXCEPTION 'Falló propagación de vacíos'; END IF;
 PERFORM public.rpc_guardar_grupo_completo(g.id,g.nombre,g.sucursal_id,c.horario_id,c.entrenador_id);
 SELECT count(*) INTO n FROM public.alumnos a WHERE a.cancha_id=g.id AND a.archivado IS NOT TRUE
 AND (a.horario_id IS DISTINCT FROM c.horario_id OR a.profesor_asignado_id IS DISTINCT FROM c.entrenador_id);
 IF n<>0 THEN RAISE EXCEPTION 'Falló reasignación'; END IF;
 -- Formulario desactualizado: incluso un UPDATE con valores vacíos hereda la terna vigente.
 UPDATE public.alumnos SET horario_id=NULL,profesor_asignado_id=NULL WHERE cancha_id=g.id AND archivado IS NOT TRUE;
 SELECT count(*) INTO n FROM public.alumnos a WHERE a.cancha_id=g.id AND a.archivado IS NOT TRUE
 AND (a.horario_id IS DISTINCT FROM c.horario_id OR a.profesor_asignado_id IS DISTINCT FROM c.entrenador_id);
 IF n<>0 THEN RAISE EXCEPTION 'Falló protección de formulario desactualizado'; END IF;
 RESET ROLE;
 SELECT id INTO outsider FROM public.usuarios WHERE escuela_id<>g.escuela_id AND activo ORDER BY id LIMIT 1;
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN
  PERFORM * FROM public.rpc_obtener_grupos_con_entrenador(g.escuela_id);
  RAISE EXCEPTION 'Se permitió consultar otra escuela';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RESET ROLE;
END $test$;
SELECT 'OK: vaciar, reasignar y guardar ficha desactualizada con rol authenticated; consulta ajena denegada. Todo revertido.' resultado;
ROLLBACK;
