-- Índice parcial para acelerar el conteo de alumnos activos por escuela y grupo
CREATE INDEX IF NOT EXISTS idx_alumnos_escuela_grupo_activos
  ON public.alumnos (escuela_id, grupo_id)
  WHERE archivado IS NOT TRUE AND grupo_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.rpc_obtener_grupos_con_entrenador(uuid);

CREATE FUNCTION public.rpc_obtener_grupos_con_entrenador(p_escuela_id uuid)
 RETURNS TABLE(
   id uuid,
   nombre text,
   sucursal_id uuid,
   sucursal_nombre text,
   horario_id uuid,
   horario_hora text,
   entrenador_id uuid,
   entrenador_nombre text,
   activo boolean,
   alumnos_activos integer
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.usuarios u WHERE u.id = auth.uid() AND u.activo IS TRUE AND u.escuela_id = p_escuela_id
  ) THEN
    IF current_setting('request.jwt.claim.role', true) IS DISTINCT FROM 'service_role'
       AND session_user NOT IN ('postgres', 'supabase_admin') THEN
      RAISE EXCEPTION 'No autorizado para consultar grupos de otra escuela.' USING ERRCODE = '42501';
    END IF;
    -- Un usuario autenticado no puede aprovechar una conexión administrativa.
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'No autorizado para consultar grupos de otra escuela.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.nombre::text,
    g.sucursal_id,
    s.nombre::text,
    c.horario_id,
    h.hora::text,
    c.entrenador_id,
    (u.nombres || ' ' || u.apellidos)::text,
    g.activo,
    COALESCE(aa.total, 0)::integer
  FROM public.grupos g
  CROSS JOIN LATERAL private.configuracion_vigente_grupo(g.escuela_id, g.id) c
  LEFT JOIN public.sucursales s ON s.id = g.sucursal_id AND s.escuela_id = g.escuela_id
  LEFT JOIN public.horarios h ON h.id = c.horario_id AND h.escuela_id = g.escuela_id
  LEFT JOIN public.usuarios u ON u.id = c.entrenador_id AND u.escuela_id = g.escuela_id
  LEFT JOIN (
    SELECT a.grupo_id, COUNT(*)::integer AS total
    FROM public.alumnos a
    WHERE a.escuela_id = p_escuela_id
      AND a.archivado IS NOT TRUE
      AND a.grupo_id IS NOT NULL
    GROUP BY a.grupo_id
  ) aa ON aa.grupo_id = g.id
  WHERE g.escuela_id = p_escuela_id
  ORDER BY g.nombre;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_obtener_grupos_con_entrenador(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_obtener_grupos_con_entrenador(uuid) TO authenticated, service_role;
