-- Migración: Unificar grupos a 1 solo horario y 1 entrenador canónico (relación estricta 1 a 1)

CREATE OR REPLACE FUNCTION public.rpc_obtener_grupos_con_entrenador(p_escuela_id uuid)
RETURNS TABLE(
  id uuid,
  nombre text,
  sucursal_id uuid,
  sucursal_nombre text,
  horario_id uuid,
  horario_hora text,
  entrenador_id uuid,
  entrenador_nombre text,
  activo boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH gestion_activa AS (
    SELECT ga.id FROM public.gestiones_deportivas ga
    WHERE ga.escuela_id = p_escuela_id AND ga.estado = 'activa'
    ORDER BY ga.created_at DESC
    LIMIT 1
  ),
  entrenador_titular AS (
    SELECT DISTINCT ON (eg.grupo_gestion_id)
      eg.grupo_gestion_id,
      eg.entrenador_id,
      (u.nombres || ' ' || u.apellidos)::text AS entrenador_nombre
    FROM public.entrenadores_grupos eg
    JOIN public.usuarios u ON u.id = eg.entrenador_id
    WHERE eg.escuela_id = p_escuela_id AND eg.estado = 'activa'
    ORDER BY eg.grupo_gestion_id, eg.created_at DESC
  ),
  grupos_base AS (
    SELECT DISTINCT ON (g.id)
      g.id,
      g.nombre::text AS nombre,
      g.sucursal_id,
      s.nombre::text AS sucursal_nombre,
      gh.horario_id AS horario_id,
      h.hora::text AS horario_hora,
      COALESCE(et_gg.entrenador_id, et_any.entrenador_id) AS entrenador_id,
      COALESCE(et_gg.entrenador_nombre, et_any.entrenador_nombre) AS entrenador_nombre,
      g.activo
    FROM public.grupos g
    LEFT JOIN public.sucursales s ON g.sucursal_id = s.id
    LEFT JOIN public.grupos_horarios gh ON gh.grupo_id = g.id
    LEFT JOIN public.horarios h ON gh.horario_id = h.id
    LEFT JOIN gestion_activa ga ON true
    LEFT JOIN public.grupos_gestion gg ON gg.grupo_id = g.id AND gg.gestion_id = ga.id AND (gg.horario_id = gh.horario_id OR gh.horario_id IS NULL)
    LEFT JOIN entrenador_titular et_gg ON et_gg.grupo_gestion_id = gg.id
    LEFT JOIN LATERAL (
      SELECT et2.entrenador_id, et2.entrenador_nombre
      FROM public.grupos_gestion gg2
      JOIN entrenador_titular et2 ON et2.grupo_gestion_id = gg2.id
      WHERE gg2.grupo_id = g.id AND gg2.gestion_id = ga.id
      LIMIT 1
    ) et_any ON true
    WHERE g.escuela_id = p_escuela_id
    ORDER BY g.id
  )
  SELECT * FROM grupos_base
  ORDER BY grupos_base.nombre ASC;
END;
$$;
