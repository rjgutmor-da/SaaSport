-- Gestión anual e histórica de alumnos, grupos y entrenadores.
-- Esta migración crea la fuente histórica sin retirar todavía los campos
-- legados de public.alumnos; las RPC mantienen ambas representaciones.

CREATE TABLE IF NOT EXISTS public.gestiones_deportivas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id),
  anio smallint NOT NULL CHECK (anio BETWEEN 2000 AND 2100),
  estado varchar NOT NULL DEFAULT 'planificacion'
    CHECK (estado IN ('planificacion', 'activa', 'cerrada')),
  creada_por uuid REFERENCES public.usuarios(id),
  activada_por uuid REFERENCES public.usuarios(id),
  activada_en timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (escuela_id, anio)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_gestiones_una_activa
  ON public.gestiones_deportivas (escuela_id) WHERE estado = 'activa';
CREATE UNIQUE INDEX IF NOT EXISTS ux_gestiones_una_planificacion
  ON public.gestiones_deportivas (escuela_id) WHERE estado = 'planificacion';
CREATE INDEX IF NOT EXISTS ix_gestiones_escuela_estado
  ON public.gestiones_deportivas (escuela_id, estado);

CREATE TABLE IF NOT EXISTS public.grupos_gestion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id),
  gestion_id uuid NOT NULL REFERENCES public.gestiones_deportivas(id),
  sucursal_id uuid REFERENCES public.sucursales(id),
  grupo_id uuid REFERENCES public.grupos(id),
  horario_id uuid REFERENCES public.horarios(id),
  nombre_snapshot varchar NOT NULL,
  hora_snapshot varchar,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gestion_id, grupo_id, horario_id)
);
CREATE INDEX IF NOT EXISTS ix_grupos_gestion_escuela_gestion
  ON public.grupos_gestion (escuela_id, gestion_id);
CREATE INDEX IF NOT EXISTS ix_grupos_gestion_sucursal
  ON public.grupos_gestion (sucursal_id);
CREATE INDEX IF NOT EXISTS ix_grupos_gestion_grupo_horario
  ON public.grupos_gestion (grupo_id, horario_id);

CREATE TABLE IF NOT EXISTS public.alumnos_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id),
  alumno_id uuid NOT NULL REFERENCES public.alumnos(id),
  grupo_gestion_id uuid NOT NULL REFERENCES public.grupos_gestion(id),
  gestion_id uuid NOT NULL REFERENCES public.gestiones_deportivas(id),
  estado varchar NOT NULL DEFAULT 'planificada'
    CHECK (estado IN ('planificada', 'activa', 'cerrada')),
  decision varchar NOT NULL DEFAULT 'migrara'
    CHECK (decision IN ('migrara', 'no_continua', 'pendiente')),
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  motivo varchar NOT NULL DEFAULT 'migracion_anual',
  creado_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alumno_id, grupo_gestion_id),
  CHECK (vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_grupos_una_membresia_activa
  ON public.alumnos_grupos (alumno_id) WHERE estado = 'activa';
CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_grupos_una_membresia_por_gestion
  ON public.alumnos_grupos (alumno_id, gestion_id)
  WHERE estado IN ('planificada', 'activa');
CREATE INDEX IF NOT EXISTS ix_alumnos_grupos_escuela_gestion_estado
  ON public.alumnos_grupos (escuela_id, gestion_id, estado);
CREATE INDEX IF NOT EXISTS ix_alumnos_grupos_alumno
  ON public.alumnos_grupos (alumno_id, estado);
CREATE INDEX IF NOT EXISTS ix_alumnos_grupos_grupo
  ON public.alumnos_grupos (grupo_gestion_id, estado);

CREATE TABLE IF NOT EXISTS public.entrenadores_grupos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  escuela_id uuid NOT NULL REFERENCES public.escuelas(id),
  entrenador_id uuid NOT NULL REFERENCES public.usuarios(id),
  grupo_gestion_id uuid NOT NULL REFERENCES public.grupos_gestion(id),
  gestion_id uuid NOT NULL REFERENCES public.gestiones_deportivas(id),
  estado varchar NOT NULL DEFAULT 'planificada'
    CHECK (estado IN ('planificada', 'activa', 'cerrada')),
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  motivo varchar NOT NULL DEFAULT 'asignacion',
  creado_por uuid REFERENCES public.usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigente_hasta IS NULL OR vigente_desde IS NULL OR vigente_hasta >= vigente_desde)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_entrenadores_grupos_un_titular
  ON public.entrenadores_grupos (grupo_gestion_id)
  WHERE estado IN ('planificada', 'activa');
CREATE INDEX IF NOT EXISTS ix_entrenadores_grupos_escuela_gestion_estado
  ON public.entrenadores_grupos (escuela_id, gestion_id, estado);
CREATE INDEX IF NOT EXISTS ix_entrenadores_grupos_entrenador
  ON public.entrenadores_grupos (entrenador_id, estado);
CREATE INDEX IF NOT EXISTS ix_entrenadores_grupos_grupo
  ON public.entrenadores_grupos (grupo_gestion_id, estado);

ALTER TABLE public.alumnos
  ADD COLUMN IF NOT EXISTS grupo_gestion_id uuid REFERENCES public.grupos_gestion(id);
CREATE INDEX IF NOT EXISTS ix_alumnos_grupo_gestion
  ON public.alumnos (grupo_gestion_id);

ALTER TABLE public.asistencias_normales
  ADD COLUMN IF NOT EXISTS grupo_gestion_id uuid REFERENCES public.grupos_gestion(id);
ALTER TABLE public.asistencias_arqueros
  ADD COLUMN IF NOT EXISTS grupo_gestion_id uuid REFERENCES public.grupos_gestion(id);
CREATE INDEX IF NOT EXISTS ix_asistencias_normales_grupo_gestion
  ON public.asistencias_normales (grupo_gestion_id, fecha);
CREATE INDEX IF NOT EXISTS ix_asistencias_arqueros_grupo_gestion
  ON public.asistencias_arqueros (grupo_gestion_id, fecha);

COMMENT ON TABLE public.gestiones_deportivas IS
  'Gestiones anuales por escuela; solo una activa y una planificación futura.';
COMMENT ON TABLE public.grupos_gestion IS
  'Instancia histórica y editable de un grupo-horario dentro de una gestión.';
COMMENT ON TABLE public.alumnos_grupos IS
  'Historial de pertenencia de cada alumno a grupos de cada gestión.';
COMMENT ON TABLE public.entrenadores_grupos IS
  'Historial del único entrenador principal por grupo-horario.';

-- Backfill inicial: crea la gestión activa del año local de cada escuela y
-- grupos a partir de la configuración existente y de alumnos reales.
INSERT INTO public.gestiones_deportivas (escuela_id, anio, estado)
SELECT e.id,
       EXTRACT(YEAR FROM timezone(COALESCE(e.zona_horaria, 'America/La_Paz'), now()))::smallint,
       'activa'
FROM public.escuelas e
WHERE e.activa IS TRUE
ON CONFLICT (escuela_id, anio) DO NOTHING;

INSERT INTO public.grupos_gestion (
  escuela_id, gestion_id, sucursal_id, grupo_id, horario_id,
  nombre_snapshot, hora_snapshot
)
SELECT DISTINCT
  g.escuela_id,
  g.id,
  gr.sucursal_id,
  gr.id,
  h.id,
  gr.nombre,
  h.hora
FROM public.gestiones_deportivas g
JOIN public.grupos gr ON gr.escuela_id = g.escuela_id
JOIN public.grupos_horarios gh ON gh.grupo_id = gr.id
JOIN public.horarios h ON h.id = gh.horario_id AND h.escuela_id = g.escuela_id
WHERE g.estado = 'activa'
ON CONFLICT (gestion_id, grupo_id, horario_id) DO NOTHING;

INSERT INTO public.grupos_gestion (
  escuela_id, gestion_id, sucursal_id, grupo_id, horario_id,
  nombre_snapshot, hora_snapshot
)
SELECT DISTINCT
  a.escuela_id,
  g.id,
  a.sucursal_id,
  a.grupo_id,
  a.horario_id,
  COALESCE(gr.nombre, 'Sin grupo'),
  h.hora
FROM public.alumnos a
JOIN public.gestiones_deportivas g
  ON g.escuela_id = a.escuela_id AND g.estado = 'activa'
LEFT JOIN public.grupos gr ON gr.id = a.grupo_id
LEFT JOIN public.horarios h ON h.id = a.horario_id
WHERE a.archivado IS NOT TRUE
  AND a.grupo_id IS NOT NULL
  AND a.horario_id IS NOT NULL
ON CONFLICT (gestion_id, grupo_id, horario_id) DO NOTHING;

INSERT INTO public.alumnos_grupos (
  escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
  decision, vigente_desde, motivo
)
SELECT a.escuela_id, a.id, gg.id, gg.gestion_id, 'activa', 'migrara',
       COALESCE(a.created_at, now()), 'backfill_gestion_actual'
FROM public.alumnos a
JOIN public.grupos_gestion gg
  ON gg.escuela_id = a.escuela_id
 AND gg.grupo_id = a.grupo_id
 AND gg.horario_id = a.horario_id
JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id AND gd.estado = 'activa'
WHERE a.archivado IS NOT TRUE
  AND a.grupo_id IS NOT NULL
  AND a.horario_id IS NOT NULL
ON CONFLICT (alumno_id, grupo_gestion_id) DO NOTHING;

UPDATE public.alumnos a
SET grupo_gestion_id = ag.grupo_gestion_id
FROM public.alumnos_grupos ag
WHERE ag.alumno_id = a.id
  AND ag.estado = 'activa'
  AND a.grupo_gestion_id IS NULL;

-- Asignación inicial de entrenadores titulares: se asigna al entrenador con
-- mayor cantidad de alumnos en cada grupo (moda estadística).
INSERT INTO public.entrenadores_grupos (
  escuela_id, entrenador_id, grupo_gestion_id, gestion_id, estado,
  vigente_desde, motivo
)
SELECT x.escuela_id, x.entrenador_id, x.grupo_gestion_id, x.gestion_id,
       'activa', now(), 'backfill_entrenador_actual'
FROM (
  SELECT a.escuela_id,
         gg.id AS grupo_gestion_id,
         gg.gestion_id,
         a.profesor_asignado_id AS entrenador_id,
         ROW_NUMBER() OVER (
           PARTITION BY a.escuela_id, gg.id, gg.gestion_id 
           ORDER BY COUNT(*) DESC, a.profesor_asignado_id
         ) AS rank_frecuencia
  FROM public.alumnos a
  JOIN public.grupos_gestion gg
    ON gg.escuela_id = a.escuela_id
   AND gg.grupo_id = a.grupo_id
   AND gg.horario_id = a.horario_id
  JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id AND gd.estado = 'activa'
  WHERE a.archivado IS NOT TRUE
    AND a.profesor_asignado_id IS NOT NULL
  GROUP BY a.escuela_id, gg.id, gg.gestion_id, a.profesor_asignado_id
) x
WHERE x.rank_frecuencia = 1
ON CONFLICT DO NOTHING;

-- RLS: lectura dentro de la escuela; las escrituras de gestión/profesor se
-- realizan únicamente mediante las RPC SECURITY DEFINER con validación explícita.
ALTER TABLE public.gestiones_deportivas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_gestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alumnos_grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entrenadores_grupos ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.gestiones_deportivas TO authenticated;
GRANT SELECT ON public.grupos_gestion TO authenticated;
GRANT SELECT ON public.alumnos_grupos TO authenticated;
GRANT SELECT ON public.entrenadores_grupos TO authenticated;

DROP POLICY IF EXISTS "gestion anual lectura propia escuela" ON public.gestiones_deportivas;
CREATE POLICY "gestion anual lectura propia escuela"
  ON public.gestiones_deportivas FOR SELECT TO authenticated
  USING (escuela_id = (SELECT public.current_user_escuela_id()));

DROP POLICY IF EXISTS "grupos gestion lectura propia escuela" ON public.grupos_gestion;
CREATE POLICY "grupos gestion lectura propia escuela"
  ON public.grupos_gestion FOR SELECT TO authenticated
  USING (escuela_id = (SELECT public.current_user_escuela_id()));

DROP POLICY IF EXISTS "alumnos grupos lectura propia escuela" ON public.alumnos_grupos;
CREATE POLICY "alumnos grupos lectura propia escuela"
  ON public.alumnos_grupos FOR SELECT TO authenticated
  USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (
      public.current_user_rol() = 'SuperAdministrador'
      OR (
        public.current_user_rol() = 'Administrador'
        AND EXISTS (
          SELECT 1
          FROM public.grupos_gestion gg
          JOIN public.usuarios u ON u.id = auth.uid()
          WHERE gg.id = alumnos_grupos.grupo_gestion_id
            AND (u.sucursal_id IS NULL OR gg.sucursal_id IS NOT DISTINCT FROM u.sucursal_id)
        )
      )
      OR (
        public.current_user_rol() = 'Entrenador'
        AND EXISTS (
          SELECT 1
          FROM public.entrenadores_grupos eg
          WHERE eg.grupo_gestion_id = alumnos_grupos.grupo_gestion_id
            AND eg.entrenador_id = auth.uid()
            AND eg.estado = 'activa'
        )
      )
    )
  );

DROP POLICY IF EXISTS "entrenadores grupos lectura propia escuela" ON public.entrenadores_grupos;
CREATE POLICY "entrenadores grupos lectura propia escuela"
  ON public.entrenadores_grupos FOR SELECT TO authenticated
  USING (
    escuela_id = (SELECT public.current_user_escuela_id())
    AND (
      public.current_user_rol() = 'SuperAdministrador'
      OR (public.current_user_rol() = 'Entrenador' AND entrenador_id = auth.uid())
      OR (
        public.current_user_rol() = 'Administrador'
        AND EXISTS (
          SELECT 1
          FROM public.grupos_gestion gg
          JOIN public.usuarios u ON u.id = auth.uid()
          WHERE gg.id = entrenadores_grupos.grupo_gestion_id
            AND (u.sucursal_id IS NULL OR gg.sucursal_id IS NOT DISTINCT FROM u.sucursal_id)
        )
      )
    )
  );

-- La función usa una comprobación de identidad/escuela en cada llamada y no
-- depende de claims editables del usuario.
CREATE OR REPLACE FUNCTION public.rpc_crear_gestion_siguiente()
RETURNS TABLE (gestion_id uuid, anio smallint, grupos_copiados integer, alumnos_planificados integer, entrenadores_planificados integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_escuela public.escuelas%ROWTYPE;
  v_actual public.gestiones_deportivas%ROWTYPE;
  v_nueva public.gestiones_deportivas%ROWTYPE;
  v_fecha_local date;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede preparar una gestión.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_escuela FROM public.escuelas WHERE id = v_actor.escuela_id;
  v_fecha_local := timezone(COALESCE(v_escuela.zona_horaria, 'America/La_Paz'), now())::date;
  IF EXTRACT(MONTH FROM v_fecha_local) < 12 THEN
    RAISE EXCEPTION 'La próxima gestión puede prepararse desde el 1 de diciembre.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actual FROM public.gestiones_deportivas
  WHERE escuela_id = v_actor.escuela_id AND estado = 'activa' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La escuela no tiene una gestión activa.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.gestiones_deportivas (escuela_id, anio, estado, creada_por)
  VALUES (v_actor.escuela_id, v_actual.anio + 1, 'planificacion', v_actor.id)
  RETURNING * INTO v_nueva;

  INSERT INTO public.grupos_gestion (
    escuela_id, gestion_id, sucursal_id, grupo_id, horario_id,
    nombre_snapshot, hora_snapshot
  )
  SELECT escuela_id, v_nueva.id, sucursal_id, grupo_id, horario_id,
         nombre_snapshot, hora_snapshot
  FROM public.grupos_gestion WHERE gestion_id = v_actual.id;
  GET DIAGNOSTICS grupos_copiados = ROW_COUNT;

  INSERT INTO public.alumnos_grupos (
    escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
    decision, motivo, creado_por
  )
  SELECT a.escuela_id, a.id, nuevo.id, v_nueva.id, 'planificada',
         'migrara', 'migracion_anual', v_actor.id
  FROM public.alumnos_grupos viejo
  JOIN public.alumnos a ON a.id = viejo.alumno_id AND a.archivado IS NOT TRUE
  JOIN public.grupos_gestion antiguo ON antiguo.id = viejo.grupo_gestion_id
  JOIN public.grupos_gestion nuevo
    ON nuevo.gestion_id = v_nueva.id
   AND nuevo.grupo_id IS NOT DISTINCT FROM antiguo.grupo_id
   AND nuevo.horario_id IS NOT DISTINCT FROM antiguo.horario_id
  WHERE viejo.gestion_id = v_actual.id AND viejo.estado = 'activa'
  ON CONFLICT (alumno_id, grupo_gestion_id) DO NOTHING;
  GET DIAGNOSTICS alumnos_planificados = ROW_COUNT;

  INSERT INTO public.entrenadores_grupos (
    escuela_id, entrenador_id, grupo_gestion_id, gestion_id, estado,
    motivo, creado_por
  )
  SELECT e.escuela_id, e.entrenador_id, nuevo.id, v_nueva.id,
         'planificada', 'copia_gestion_anual', v_actor.id
  FROM public.entrenadores_grupos e
  JOIN public.grupos_gestion antiguo ON antiguo.id = e.grupo_gestion_id
  JOIN public.grupos_gestion nuevo
    ON nuevo.gestion_id = v_nueva.id
   AND nuevo.grupo_id IS NOT DISTINCT FROM antiguo.grupo_id
   AND nuevo.horario_id IS NOT DISTINCT FROM antiguo.horario_id
  WHERE e.gestion_id = v_actual.id AND e.estado = 'activa'
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS entrenadores_planificados = ROW_COUNT;

  RETURN QUERY SELECT v_nueva.id, v_nueva.anio, grupos_copiados,
                      alumnos_planificados, entrenadores_planificados;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_guardar_planificacion_gestion(
  p_gestion_id uuid,
  p_plan jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_gestion public.gestiones_deportivas%ROWTYPE;
  v_row record;
  v_grupos integer := 0;
  v_alumnos integer := 0;
  v_entrenadores integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede editar una planificación.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_gestion FROM public.gestiones_deportivas
  WHERE id = p_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND OR v_gestion.estado <> 'planificacion' THEN
    RAISE EXCEPTION 'La gestión no está disponible para planificación.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(COALESCE(p_plan, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'La planificación debe enviarse como un objeto JSON.' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'grupos', p_plan->'canchas', '[]'::jsonb)) AS x(
    id uuid, nombre_snapshot varchar, hora_snapshot varchar,
    sucursal_id uuid, grupo_id uuid, cancha_id uuid, horario_id uuid
  ) LOOP
    IF v_row.id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo de la planificación no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.grupos_gestion
    SET nombre_snapshot = COALESCE(v_row.nombre_snapshot, nombre_snapshot),
        hora_snapshot = COALESCE(v_row.hora_snapshot, hora_snapshot),
        sucursal_id = COALESCE(v_row.sucursal_id, sucursal_id),
        grupo_id = COALESCE(v_row.grupo_id, v_row.cancha_id, grupo_id),
        horario_id = COALESCE(v_row.horario_id, horario_id),
        updated_at = now()
    WHERE id = v_row.id AND gestion_id = v_gestion.id;
    v_grupos := v_grupos + 1;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'alumnos', '[]'::jsonb)) AS x(
    alumno_id uuid, grupo_gestion_id uuid, decision varchar
  ) LOOP
    IF v_row.decision NOT IN ('migrara', 'no_continua', 'pendiente') THEN
      RAISE EXCEPTION 'Decisión de migración inválida.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.alumnos
      WHERE id = v_row.alumno_id AND escuela_id = v_actor.escuela_id
    ) THEN
      RAISE EXCEPTION 'El alumno de la planificación no pertenece a la escuela.' USING ERRCODE = '42501';
    END IF;
    IF v_row.decision <> 'no_continua' AND v_row.grupo_gestion_id IS NULL THEN
      RAISE EXCEPTION 'Cada alumno que continúa debe tener un grupo destino.' USING ERRCODE = '22023';
    END IF;
    IF v_row.grupo_gestion_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.grupo_gestion_id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo destino del alumno no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    UPDATE public.alumnos_grupos
    SET grupo_gestion_id = COALESCE(v_row.grupo_gestion_id, grupo_gestion_id),
        decision = v_row.decision,
        updated_at = now()
    WHERE alumno_id = v_row.alumno_id
      AND gestion_id = v_gestion.id;
    IF NOT FOUND AND v_row.decision <> 'no_continua' THEN
      INSERT INTO public.alumnos_grupos (
        escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
        decision, motivo, creado_por
      ) VALUES (
        v_actor.escuela_id, v_row.alumno_id, v_row.grupo_gestion_id,
        v_gestion.id, 'planificada', v_row.decision,
        'planificacion_manual', v_actor.id
      );
    END IF;
    v_alumnos := v_alumnos + 1;
  END LOOP;

  FOR v_row IN SELECT * FROM jsonb_to_recordset(COALESCE(p_plan->'entrenadores', '[]'::jsonb)) AS x(
    grupo_gestion_id uuid, entrenador_id uuid
  ) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.grupos_gestion
      WHERE id = v_row.grupo_gestion_id AND escuela_id = v_actor.escuela_id AND gestion_id = v_gestion.id
    ) THEN
      RAISE EXCEPTION 'El grupo del entrenador no pertenece a la gestión.' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.usuarios
      WHERE id = v_row.entrenador_id AND escuela_id = v_actor.escuela_id
        AND rol = 'Entrenador' AND activo IS TRUE
    ) THEN
      RAISE EXCEPTION 'El entrenador de la planificación no es válido.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.entrenadores_grupos
               WHERE grupo_gestion_id = v_row.grupo_gestion_id
                 AND estado = 'planificada') THEN
      UPDATE public.entrenadores_grupos
      SET entrenador_id = v_row.entrenador_id, updated_at = now()
      WHERE grupo_gestion_id = v_row.grupo_gestion_id AND estado = 'planificada';
    ELSE
      INSERT INTO public.entrenadores_grupos (
        escuela_id, entrenador_id, grupo_gestion_id, gestion_id,
        estado, motivo, creado_por
      ) VALUES (
        v_actor.escuela_id, v_row.entrenador_id, v_row.grupo_gestion_id,
        v_gestion.id, 'planificada', 'planificacion_manual', v_actor.id
      );
    END IF;
    v_entrenadores := v_entrenadores + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'gestion_id', v_gestion.id,
    'grupos_actualizados', v_grupos,
    'alumnos_actualizados', v_alumnos,
    'entrenadores_actualizados', v_entrenadores
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_activar_gestion(p_gestion_id uuid)
RETURNS TABLE (alumnos_migrados integer, alumnos_no_continuan integer, grupos_activados integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_target public.gestiones_deportivas%ROWTYPE;
  v_actual public.gestiones_deportivas%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_pendientes integer;
  v_sin_entrenador integer;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede activar una gestión.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_target FROM public.gestiones_deportivas
  WHERE id = p_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND OR v_target.estado <> 'planificacion' THEN
    RAISE EXCEPTION 'La gestión no está en planificación.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actual FROM public.gestiones_deportivas
  WHERE escuela_id = v_actor.escuela_id AND estado = 'activa'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La escuela no tiene una gestión activa para cerrar.' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_pendientes
  FROM public.alumnos a
  WHERE a.escuela_id = v_actor.escuela_id
    AND a.archivado IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.alumnos_grupos ag
      WHERE ag.alumno_id = a.id AND ag.gestion_id = v_target.id
        AND ag.estado = 'planificada' AND ag.decision IN ('migrara', 'no_continua')
    );
  IF v_pendientes > 0 THEN
    RAISE EXCEPTION 'Hay % alumno(s) sin decisión de migración.', v_pendientes USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_sin_entrenador
  FROM public.grupos_gestion gg
  WHERE gg.gestion_id = v_target.id
    AND NOT EXISTS (
      SELECT 1
      FROM public.entrenadores_grupos eg
      JOIN public.usuarios u ON u.id = eg.entrenador_id
      WHERE eg.grupo_gestion_id = gg.id
        AND eg.estado = 'planificada'
        AND u.escuela_id = v_actor.escuela_id
        AND u.rol = 'Entrenador'
        AND u.activo IS TRUE
    );
  IF v_sin_entrenador > 0 THEN
    RAISE EXCEPTION 'Hay % grupo(s) sin profesor principal.', v_sin_entrenador USING ERRCODE = '22023';
  END IF;

  UPDATE public.gestiones_deportivas
  SET estado = 'cerrada', updated_at = v_now
  WHERE id = v_actual.id;
  UPDATE public.alumnos_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE gestion_id = v_actual.id AND estado = 'activa';
  UPDATE public.entrenadores_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE gestion_id = v_actual.id AND estado = 'activa';

  UPDATE public.alumnos_grupos
  SET estado = CASE WHEN decision = 'migrara' THEN 'activa' ELSE 'cerrada' END,
      vigente_desde = CASE WHEN decision = 'migrara' THEN v_now ELSE vigente_desde END,
      vigente_hasta = CASE WHEN decision = 'migrara' THEN NULL ELSE v_now END,
      updated_at = v_now
  WHERE gestion_id = v_target.id AND estado = 'planificada';

  UPDATE public.entrenadores_grupos
  SET estado = 'activa', vigente_desde = v_now, updated_at = v_now
  WHERE gestion_id = v_target.id AND estado = 'planificada';

  UPDATE public.alumnos a
  SET archivado = TRUE, archivado_at = v_now, grupo_gestion_id = NULL,
      updated_at = v_now
  WHERE a.escuela_id = v_actor.escuela_id
    AND a.archivado IS NOT TRUE
    AND EXISTS (
      SELECT 1 FROM public.alumnos_grupos ag
      WHERE ag.alumno_id = a.id AND ag.gestion_id = v_target.id
        AND ag.estado = 'cerrada' AND ag.decision = 'no_continua'
    );

  UPDATE public.alumnos a
  SET grupo_gestion_id = ag.grupo_gestion_id,
      grupo_id = gg.grupo_id,
      horario_id = gg.horario_id,
      sucursal_id = gg.sucursal_id,
      profesor_asignado_id = eg.entrenador_id,
      updated_at = v_now
  FROM public.alumnos_grupos ag
  JOIN public.grupos_gestion gg ON gg.id = ag.grupo_gestion_id
  JOIN public.entrenadores_grupos eg
    ON eg.grupo_gestion_id = gg.id AND eg.estado = 'activa'
  WHERE a.id = ag.alumno_id AND ag.gestion_id = v_target.id
    AND ag.estado = 'activa';
  DELETE FROM public.alumnos_entrenadores ae
  USING public.alumnos a
  WHERE a.id = ae.alumno_id
    AND (a.archivado IS TRUE OR a.escuela_id = v_actor.escuela_id);
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
  SELECT a.id, eg.entrenador_id
  FROM public.alumnos a
  JOIN public.alumnos_grupos ag ON ag.alumno_id = a.id AND ag.gestion_id = v_target.id AND ag.estado = 'activa'
  JOIN public.entrenadores_grupos eg ON eg.grupo_gestion_id = ag.grupo_gestion_id AND eg.estado = 'activa'
  WHERE a.escuela_id = v_actor.escuela_id AND a.archivado IS NOT TRUE
  ON CONFLICT DO NOTHING;

  UPDATE public.gestiones_deportivas
  SET estado = 'activa', activada_por = v_actor.id,
      activada_en = v_now, updated_at = v_now
  WHERE id = v_target.id;

  SELECT COUNT(*) INTO alumnos_migrados
  FROM public.alumnos_grupos WHERE gestion_id = v_target.id AND estado = 'activa';
  SELECT COUNT(*) INTO alumnos_no_continuan
  FROM public.alumnos_grupos WHERE gestion_id = v_target.id AND decision = 'no_continua';
  SELECT COUNT(*) INTO grupos_activados
  FROM public.grupos_gestion WHERE gestion_id = v_target.id;

  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle
  ) VALUES (
    v_actor.escuela_id, v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'ACTIVAR_GESTION_DEPORTIVA', 'gestiones_deportivas', v_target.id::text,
    jsonb_build_object(
      'anio', v_target.anio,
      'alumnos_migrados', alumnos_migrados,
      'alumnos_no_continuan', alumnos_no_continuan,
      'grupos_activados', grupos_activados
    )
  );
  RETURN QUERY SELECT alumnos_migrados, alumnos_no_continuan, grupos_activados;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_trasladar_alumno(
  p_alumno_id uuid,
  p_grupo_destino_id uuid,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_alumno public.alumnos%ROWTYPE;
  v_destino public.grupos_gestion%ROWTYPE;
  v_gestion public.gestiones_deportivas%ROWTYPE;
  v_entrenador uuid;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('Administrador', 'SuperAdministrador') THEN
    RAISE EXCEPTION 'No tienes permiso para trasladar alumnos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_alumno FROM public.alumnos WHERE id = p_alumno_id FOR UPDATE;
  IF NOT FOUND OR v_alumno.escuela_id <> v_actor.escuela_id THEN
    RAISE EXCEPTION 'El alumno no pertenece a tu escuela.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL
     AND v_alumno.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes trasladar alumnos de otra sucursal.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_destino FROM public.grupos_gestion
  WHERE id = p_grupo_destino_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo destino no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_gestion FROM public.gestiones_deportivas
  WHERE id = v_destino.gestion_id AND estado = 'activa';
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo destino no está activo.' USING ERRCODE = '22023'; END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL
     AND v_destino.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes trasladar a otra sucursal.' USING ERRCODE = '42501';
  END IF;
  SELECT entrenador_id INTO v_entrenador FROM public.entrenadores_grupos
  WHERE grupo_gestion_id = v_destino.id AND estado = 'activa';
  IF v_entrenador IS NULL THEN RAISE EXCEPTION 'El grupo destino no tiene profesor principal.' USING ERRCODE = '22023'; END IF;

  PERFORM 1
  FROM public.alumnos_grupos
  WHERE alumno_id = v_alumno.id AND gestion_id = v_gestion.id AND estado = 'activa'
  FOR UPDATE;
  UPDATE public.alumnos_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, motivo = COALESCE(NULLIF(p_motivo, ''), 'traslado'), updated_at = v_now
  WHERE alumno_id = v_alumno.id AND gestion_id = v_gestion.id AND estado = 'activa';
  INSERT INTO public.alumnos_grupos (
    escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
    decision, vigente_desde, motivo, creado_por
  ) VALUES (
    v_alumno.escuela_id, v_alumno.id, v_destino.id, v_gestion.id, 'activa',
    'migrara', v_now, COALESCE(NULLIF(p_motivo, ''), 'traslado'), v_actor.id
  );
  UPDATE public.alumnos
  SET grupo_gestion_id = v_destino.id,
      grupo_id = v_destino.grupo_id,
      horario_id = v_destino.horario_id,
      sucursal_id = v_destino.sucursal_id,
      profesor_asignado_id = v_entrenador,
      updated_at = v_now
  WHERE id = v_alumno.id;
  DELETE FROM public.alumnos_entrenadores WHERE alumno_id = v_alumno.id;
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
  VALUES (v_alumno.id, v_entrenador)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle
  ) VALUES (
    v_actor.escuela_id, v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'TRASLADO_ALUMNO_GRUPO', 'alumnos', v_alumno.id::text,
    jsonb_build_object('grupo_destino', v_destino.id, 'entrenador_destino', v_entrenador, 'motivo', p_motivo)
  );
  RETURN jsonb_build_object('alumno_id', v_alumno.id, 'grupo_gestion_id', v_destino.id, 'entrenador_id', v_entrenador);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_asignar_entrenador_grupo(
  p_grupo_gestion_id uuid,
  p_entrenador_id uuid,
  p_motivo text DEFAULT 'asignacion'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_grupo public.grupos_gestion%ROWTYPE;
  v_entrenador public.usuarios%ROWTYPE;
  v_estado varchar;
  v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador puede asignar profesores a grupos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_grupo FROM public.grupos_gestion
  WHERE id = p_grupo_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  SELECT * INTO v_entrenador FROM public.usuarios
  WHERE id = p_entrenador_id AND escuela_id = v_actor.escuela_id
    AND rol = 'Entrenador' AND activo IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El entrenador no es válido, está inactivo o pertenece a otra escuela.' USING ERRCODE = '22023'; END IF;
  IF v_grupo.id IS NULL THEN RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  v_estado := CASE WHEN EXISTS (SELECT 1 FROM public.gestiones_deportivas WHERE id = v_grupo.gestion_id AND estado = 'activa') THEN 'activa' ELSE 'planificada' END;
  UPDATE public.entrenadores_grupos
  SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
  WHERE grupo_gestion_id = v_grupo.id AND estado IN ('activa', 'planificada');
  INSERT INTO public.entrenadores_grupos (
    escuela_id, entrenador_id, grupo_gestion_id, gestion_id,
    estado, vigente_desde, motivo, creado_por
  ) VALUES (
    v_actor.escuela_id, v_entrenador.id, v_grupo.id, v_grupo.gestion_id,
    v_estado, CASE WHEN v_estado = 'activa' THEN v_now ELSE NULL END,
    COALESCE(NULLIF(p_motivo, ''), 'asignacion'), v_actor.id
  );
  IF v_estado = 'activa' THEN
    UPDATE public.alumnos a
    SET profesor_asignado_id = v_entrenador.id, updated_at = v_now
    WHERE a.grupo_gestion_id = v_grupo.id AND a.archivado IS NOT TRUE;
    DELETE FROM public.alumnos_entrenadores ae
    USING public.alumnos a
    WHERE a.id = ae.alumno_id
      AND a.grupo_gestion_id = v_grupo.id;
    INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
    SELECT a.id, v_entrenador.id
    FROM public.alumnos a
    WHERE a.grupo_gestion_id = v_grupo.id AND a.archivado IS NOT TRUE
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN jsonb_build_object('grupo_gestion_id', v_grupo.id, 'entrenador_id', v_entrenador.id, 'estado', v_estado);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_cambiar_entrenador_grupo(
  p_grupo_gestion_id uuid,
  p_entrenador_id uuid,
  p_motivo text DEFAULT 'cambio_profesor'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN public.rpc_asignar_entrenador_grupo(p_grupo_gestion_id, p_entrenador_id, p_motivo);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_crear_gestion_siguiente() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_guardar_planificacion_gestion(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_activar_gestion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_trasladar_alumno(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_asignar_entrenador_grupo(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_cambiar_entrenador_grupo(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_crear_gestion_siguiente() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_guardar_planificacion_gestion(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_activar_gestion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_trasladar_alumno(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_asignar_entrenador_grupo(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_cambiar_entrenador_grupo(uuid, uuid, text) TO authenticated;

-- Baja completa compatible con el payload legado y con el nuevo modelo anual.
-- El formato nuevo usa grupo_gestion_id; el anterior usa la combinación
-- sucursal_id/grupo_id/horario_id para grupos de la gestión activa.
CREATE OR REPLACE FUNCTION public.rpc_reasignar_y_desactivar_entrenador(
  p_entrenador_saliente uuid,
  p_asignaciones jsonb
)
RETURNS TABLE (
  alumnos_reasignados integer,
  grupos_reasignados integer,
  sesiones_revocadas integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_saliente public.usuarios%ROWTYPE;
  v_row record;
  v_now timestamptz := clock_timestamp();
  v_alumnos integer := 0;
  v_afectados integer := 0;
  v_grupos integer := 0;
  v_sesiones integer := 0;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol <> 'SuperAdministrador' THEN
    RAISE EXCEPTION 'Solo un SuperAdministrador activo puede dar de baja y reasignar entrenadores.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_saliente FROM public.usuarios WHERE id = p_entrenador_saliente FOR UPDATE;
  IF NOT FOUND OR v_saliente.escuela_id <> v_actor.escuela_id THEN
    RAISE EXCEPTION 'El entrenador no pertenece a tu escuela.' USING ERRCODE = '42501';
  END IF;
  IF v_saliente.rol <> 'Entrenador' OR v_saliente.activo IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo se puede dar de baja a un entrenador activo.' USING ERRCODE = '22023';
  END IF;
  IF p_asignaciones IS NULL OR jsonb_typeof(p_asignaciones) <> 'array' THEN
    RAISE EXCEPTION 'Las asignaciones deben enviarse como una lista de grupos.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE tmp_reasignaciones (
    grupo_gestion_id uuid PRIMARY KEY,
    entrenador_destino_id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_reasignaciones (grupo_gestion_id, entrenador_destino_id)
  SELECT COALESCE(x.grupo_gestion_id, gg.id), x.entrenador_destino_id
  FROM jsonb_to_recordset(p_asignaciones) AS x(
    grupo_gestion_id uuid,
    sucursal_id uuid,
    grupo_id uuid,
    cancha_id uuid,
    horario_id uuid,
    entrenador_destino_id uuid
  )
  LEFT JOIN public.grupos_gestion gg
    ON x.grupo_gestion_id IS NULL
   AND gg.escuela_id = v_actor.escuela_id
   AND gg.sucursal_id IS NOT DISTINCT FROM x.sucursal_id
   AND gg.grupo_id IS NOT DISTINCT FROM COALESCE(x.grupo_id, x.cancha_id)
   AND gg.horario_id IS NOT DISTINCT FROM x.horario_id
   AND EXISTS (
     SELECT 1 FROM public.gestiones_deportivas gd
     WHERE gd.id = gg.gestion_id AND gd.escuela_id = v_actor.escuela_id
       AND gd.estado = 'activa'
   );

  IF EXISTS (SELECT 1 FROM tmp_reasignaciones WHERE grupo_gestion_id IS NULL)
     OR EXISTS (
       SELECT 1 FROM tmp_reasignaciones t
       LEFT JOIN public.grupos_gestion gg ON gg.id = t.grupo_gestion_id
       LEFT JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id
       WHERE gg.id IS NULL OR gg.escuela_id <> v_actor.escuela_id
          OR gd.estado NOT IN ('activa', 'planificacion')
     ) THEN
    RAISE EXCEPTION 'Hay un grupo inválido o fuera de la escuela.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tmp_reasignaciones t
    LEFT JOIN public.usuarios u ON u.id = t.entrenador_destino_id
    WHERE t.entrenador_destino_id = p_entrenador_saliente
       OR u.id IS NULL OR u.escuela_id <> v_actor.escuela_id
       OR u.rol <> 'Entrenador' OR u.activo IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'Hay un entrenador destino inválido, inactivo o fuera de la escuela.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.entrenadores_grupos eg
    WHERE eg.entrenador_id = p_entrenador_saliente
      AND eg.estado IN ('activa', 'planificada')
      AND NOT EXISTS (SELECT 1 FROM tmp_reasignaciones t WHERE t.grupo_gestion_id = eg.grupo_gestion_id)
  ) OR EXISTS (
    SELECT 1 FROM tmp_reasignaciones t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.entrenadores_grupos eg
      WHERE eg.entrenador_id = p_entrenador_saliente
        AND eg.grupo_gestion_id = t.grupo_gestion_id
        AND eg.estado IN ('activa', 'planificada')
    )
  ) THEN
    RAISE EXCEPTION 'Las asignaciones no cubren exactamente todos los grupos vigentes y futuros del entrenador.' USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.entrenadores_grupos eg
  JOIN tmp_reasignaciones t ON t.grupo_gestion_id = eg.grupo_gestion_id
  WHERE eg.entrenador_id = p_entrenador_saliente
    AND eg.estado IN ('activa', 'planificada')
  FOR UPDATE;

  FOR v_row IN
    SELECT eg.id, eg.escuela_id, eg.grupo_gestion_id, eg.gestion_id,
           eg.estado, eg.vigente_desde, t.entrenador_destino_id
    FROM public.entrenadores_grupos eg
    JOIN tmp_reasignaciones t ON t.grupo_gestion_id = eg.grupo_gestion_id
    WHERE eg.entrenador_id = p_entrenador_saliente
      AND eg.estado IN ('activa', 'planificada')
  LOOP
    UPDATE public.entrenadores_grupos
    SET estado = 'cerrada', vigente_hasta = v_now, updated_at = v_now
    WHERE id = v_row.id;
    INSERT INTO public.entrenadores_grupos (
      escuela_id, entrenador_id, grupo_gestion_id, gestion_id, estado,
      vigente_desde, motivo, creado_por
    ) VALUES (
      v_row.escuela_id, v_row.entrenador_destino_id, v_row.grupo_gestion_id,
      v_row.gestion_id, v_row.estado,
      CASE WHEN v_row.estado = 'activa' THEN v_now ELSE NULL END,
      'baja_reasignacion', v_actor.id
    );
    v_grupos := v_grupos + 1;
    IF v_row.estado = 'activa' THEN
      UPDATE public.alumnos
      SET profesor_asignado_id = v_row.entrenador_destino_id, updated_at = v_now
      WHERE escuela_id = v_actor.escuela_id
        AND grupo_gestion_id = v_row.grupo_gestion_id
        AND archivado IS NOT TRUE;
      GET DIAGNOSTICS v_afectados = ROW_COUNT;
      v_alumnos := v_alumnos + v_afectados;
      DELETE FROM public.alumnos_entrenadores ae
      USING public.alumnos a
      WHERE a.id = ae.alumno_id
        AND a.grupo_gestion_id = v_row.grupo_gestion_id;
      INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
      SELECT a.id, v_row.entrenador_destino_id
      FROM public.alumnos a
      WHERE a.grupo_gestion_id = v_row.grupo_gestion_id AND a.archivado IS NOT TRUE
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  PERFORM set_config('app.reasignacion_entrenador', 'true', true);
  UPDATE public.usuarios SET activo = false WHERE id = p_entrenador_saliente;
  UPDATE public.user_app_sessions
  SET revoked_at = now(), revoked_reason = 'baja_entrenador_reasignacion'
  WHERE user_id = p_entrenador_saliente AND revoked_at IS NULL;
  GET DIAGNOSTICS v_sesiones = ROW_COUNT;

  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle
  ) VALUES (
    v_actor.escuela_id, v_actor.id,
    trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'BAJA_ENTRENADOR_REASIGNACION', 'usuarios', p_entrenador_saliente::text,
    jsonb_build_object(
      'alumnos_reasignados', v_alumnos,
      'grupos_reasignados', v_grupos,
      'sesiones_revocadas', v_sesiones
    )
  );
  RETURN QUERY SELECT v_alumnos, v_grupos, v_sesiones;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_reasignar_y_desactivar_entrenador(uuid, jsonb) TO authenticated;

-- Contratos de transición para AsiSport. Ningún cliente debe volver a decidir
-- libremente el profesor de un alumno o el contexto histórico de una asistencia.
ALTER TABLE public.fotos_asistencia_grupal
  ADD COLUMN IF NOT EXISTS grupo_gestion_id uuid REFERENCES public.grupos_gestion(id);
CREATE INDEX IF NOT EXISTS ix_fotos_asistencia_grupal_grupo_fecha
  ON public.fotos_asistencia_grupal (grupo_gestion_id, fecha);

-- Una misma persona puede volver a un grupo después de un traslado; la
-- unicidad aplica únicamente a la pertenencia vigente/planificada.
ALTER TABLE public.alumnos_grupos
  DROP CONSTRAINT IF EXISTS alumnos_grupos_alumno_id_grupo_gestion_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS ux_alumnos_grupos_un_grupo_vigente
  ON public.alumnos_grupos (alumno_id, grupo_gestion_id)
  WHERE estado IN ('planificada', 'activa');

CREATE OR REPLACE FUNCTION public.rpc_grupos_gestion_activos()
RETURNS TABLE (
  id uuid,
  gestion_id uuid,
  anio smallint,
  sucursal_id uuid,
  grupo_id uuid,
  horario_id uuid,
  nombre_snapshot varchar,
  hora_snapshot varchar,
  entrenador_id uuid,
  entrenador_nombre text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sesión no autorizada.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT gg.id, gg.gestion_id, gd.anio, gg.sucursal_id, gg.grupo_id,
         gg.horario_id, gg.nombre_snapshot, gg.hora_snapshot,
         eg.entrenador_id,
         trim(concat_ws(' ', entrenador.nombres, entrenador.apellidos))
  FROM public.grupos_gestion gg
  JOIN public.gestiones_deportivas gd
    ON gd.id = gg.gestion_id AND gd.estado = 'activa'
  LEFT JOIN public.entrenadores_grupos eg
    ON eg.grupo_gestion_id = gg.id AND eg.estado = 'activa'
  LEFT JOIN public.usuarios entrenador ON entrenador.id = eg.entrenador_id
  WHERE gg.escuela_id = v_actor.escuela_id
    AND (
      v_actor.rol = 'SuperAdministrador'
      OR (
        v_actor.rol IN ('Administrador', 'Asistente', 'Entrenarqueros')
        AND (v_actor.sucursal_id IS NULL OR gg.sucursal_id IS NOT DISTINCT FROM v_actor.sucursal_id)
      )
      OR (v_actor.rol = 'Entrenador' AND eg.entrenador_id = v_actor.id)
    )
  ORDER BY gg.nombre_snapshot, gg.hora_snapshot;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_registrar_alumno_en_grupo(
  p_alumno jsonb,
  p_grupo_gestion_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_grupo public.grupos_gestion%ROWTYPE;
  v_gestion public.gestiones_deportivas%ROWTYPE;
  v_entrenador uuid;
  v_alumno public.alumnos%ROWTYPE;
  v_es_arquero boolean := COALESCE((p_alumno->>'es_arquero')::boolean, false);
  v_now timestamptz := clock_timestamp();
BEGIN
  IF jsonb_typeof(COALESCE(p_alumno, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Los datos del alumno son inválidos.' USING ERRCODE = '22023';
  END IF;
  IF NULLIF(trim(p_alumno->>'nombres'), '') IS NULL
     OR NULLIF(trim(p_alumno->>'apellidos'), '') IS NULL
     OR NULLIF(p_alumno->>'fecha_nacimiento', '') IS NULL THEN
    RAISE EXCEPTION 'Nombres, apellidos y fecha de nacimiento son obligatorios.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_actor FROM public.usuarios
  WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente', 'Entrenador', 'Entrenarqueros') THEN
    RAISE EXCEPTION 'No tienes permiso para registrar alumnos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_grupo FROM public.grupos_gestion
  WHERE id = p_grupo_gestion_id AND escuela_id = v_actor.escuela_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El grupo no pertenece a tu escuela.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_gestion FROM public.gestiones_deportivas
  WHERE id = v_grupo.gestion_id AND estado = 'activa';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El grupo no está activo.' USING ERRCODE = '22023';
  END IF;
  SELECT entrenador_id INTO v_entrenador FROM public.entrenadores_grupos
  WHERE grupo_gestion_id = v_grupo.id AND estado = 'activa'
  FOR UPDATE;
  IF v_entrenador IS NULL THEN
    RAISE EXCEPTION 'El grupo no tiene profesor principal.' USING ERRCODE = '22023';
  END IF;

  IF v_actor.rol IN ('Administrador', 'Asistente')
     AND v_actor.sucursal_id IS NOT NULL
     AND v_grupo.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes registrar alumnos fuera de tu sucursal.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Entrenador' AND v_entrenador <> v_actor.id THEN
    RAISE EXCEPTION 'Solo puedes registrar alumnos en tus grupos activos.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Entrenarqueros' THEN
    IF v_actor.sucursal_id IS NOT NULL AND v_grupo.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
      RAISE EXCEPTION 'No puedes registrar alumnos fuera de tu sucursal.' USING ERRCODE = '42501';
    END IF;
    IF NOT v_es_arquero THEN
      RAISE EXCEPTION 'Entrenarqueros solo puede registrar arqueros.' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NULLIF(trim(p_alumno->>'carnet_identidad'), '') IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.alumnos
    WHERE escuela_id = v_actor.escuela_id
      AND carnet_identidad = trim(p_alumno->>'carnet_identidad')
  ) THEN
    RAISE EXCEPTION 'El carnet de identidad ya está registrado en la escuela.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.alumnos (
    nombres, apellidos, fecha_nacimiento, carnet_identidad,
    nombre_padre, telefono_padre, nombre_madre, telefono_madre,
    whatsapp_preferido, telefono_deportista, colegio, direccion,
    sucursal_id, grupo_id, horario_id, profesor_asignado_id,
    grupo_gestion_id, es_arquero, foto_url, estado, escuela_id,
    created_by, tipo, mensualidad, observaciones
  ) VALUES (
    regexp_replace(trim(p_alumno->>'nombres'), '\\s+', ' ', 'g'),
    regexp_replace(trim(p_alumno->>'apellidos'), '\\s+', ' ', 'g'),
    (p_alumno->>'fecha_nacimiento')::date,
    NULLIF(trim(p_alumno->>'carnet_identidad'), ''),
    NULLIF(trim(p_alumno->>'nombre_padre'), ''), NULLIF(trim(p_alumno->>'telefono_padre'), ''),
    NULLIF(trim(p_alumno->>'nombre_madre'), ''), NULLIF(trim(p_alumno->>'telefono_madre'), ''),
    COALESCE(NULLIF(trim(p_alumno->>'whatsapp_preferido'), ''), 'padre'),
    NULLIF(trim(p_alumno->>'telefono_deportista'), ''), NULLIF(trim(p_alumno->>'colegio'), ''),
    NULLIF(trim(p_alumno->>'direccion'), ''), v_grupo.sucursal_id, v_grupo.grupo_id,
    v_grupo.horario_id, v_entrenador, v_grupo.id, v_es_arquero,
    NULLIF(trim(p_alumno->>'foto_url'), ''), COALESCE(NULLIF(trim(p_alumno->>'estado'), ''), 'Pendiente'),
    v_actor.escuela_id, v_actor.id, COALESCE(NULLIF(trim(p_alumno->>'tipo'), ''), 'Formativo'),
    NULLIF(p_alumno->>'mensualidad', '')::numeric, NULLIF(trim(p_alumno->>'observaciones'), '')
  ) RETURNING * INTO v_alumno;

  INSERT INTO public.alumnos_grupos (
    escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado,
    decision, vigente_desde, motivo, creado_por
  ) VALUES (
    v_actor.escuela_id, v_alumno.id, v_grupo.id, v_gestion.id, 'activa',
    'migrara', v_now, 'alta', v_actor.id
  );
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id)
  VALUES (v_alumno.id, v_entrenador)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.audit_log (escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle)
  VALUES (
    v_actor.escuela_id, v_actor.id, trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'REGISTRAR_ALUMNO_GRUPO', 'alumnos', v_alumno.id::text,
    jsonb_build_object('grupo_gestion_id', v_grupo.id, 'entrenador_id', v_entrenador)
  );
  RETURN jsonb_build_object('alumno_id', v_alumno.id, 'grupo_gestion_id', v_grupo.id, 'entrenador_id', v_entrenador);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_registrar_asistencias_lote(
  p_fecha date,
  p_grupo_gestion_id uuid,
  p_asistencias jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_grupo public.grupos_gestion%ROWTYPE;
  v_principal uuid;
  v_total integer := 0;
  v_insertadas integer := 0;
  v_actualizadas integer := 0;
BEGIN
  IF p_fecha IS NULL OR jsonb_typeof(COALESCE(p_asistencias, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'Fecha o lista de asistencias inválida.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('SuperAdministrador', 'Administrador', 'Asistente', 'Entrenador', 'Entrenarqueros') THEN
    RAISE EXCEPTION 'No tienes permiso para tomar asistencia.' USING ERRCODE = '42501';
  END IF;
  SELECT gg.* INTO v_grupo
  FROM public.grupos_gestion gg JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id
  WHERE gg.id = p_grupo_gestion_id AND gg.escuela_id = v_actor.escuela_id AND gd.estado = 'activa'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El grupo no está activo o no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  SELECT entrenador_id INTO v_principal FROM public.entrenadores_grupos
  WHERE grupo_gestion_id = v_grupo.id AND estado = 'activa';
  IF v_principal IS NULL THEN RAISE EXCEPTION 'El grupo no tiene profesor principal.' USING ERRCODE = '22023'; END IF;
  IF v_actor.rol IN ('Administrador', 'Asistente', 'Entrenarqueros')
     AND v_actor.sucursal_id IS NOT NULL AND v_grupo.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN
    RAISE EXCEPTION 'No puedes tomar asistencia fuera de tu sucursal.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Entrenador' AND v_principal <> v_actor.id THEN
    RAISE EXCEPTION 'Solo puedes tomar asistencia de tus grupos activos.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(p_asistencias) AS x(alumno_id uuid, estado varchar)
    GROUP BY alumno_id HAVING count(*) > 1
  ) THEN RAISE EXCEPTION 'Un alumno no puede repetirse en la lista.' USING ERRCODE = '22023'; END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_asistencias) AS x(alumno_id uuid, estado varchar)
    LEFT JOIN public.alumnos_grupos ag ON ag.alumno_id = x.alumno_id
      AND ag.grupo_gestion_id = v_grupo.id AND ag.estado = 'activa'
    LEFT JOIN public.alumnos a ON a.id = x.alumno_id
    WHERE x.alumno_id IS NULL OR x.estado NOT IN ('Presente', 'Ausente', 'Licencia')
      OR ag.id IS NULL OR a.archivado IS TRUE
      OR (v_actor.rol = 'Entrenarqueros' AND a.es_arquero IS NOT TRUE)
  ) THEN RAISE EXCEPTION 'La lista contiene alumnos o estados inválidos para el grupo.' USING ERRCODE = '22023'; END IF;

  SELECT count(*) INTO v_total FROM jsonb_array_elements(p_asistencias);
  SELECT count(*) INTO v_actualizadas
  FROM public.asistencias_normales an
  JOIN jsonb_to_recordset(p_asistencias) AS x(alumno_id uuid, estado varchar)
    ON x.alumno_id = an.alumno_id
  WHERE an.fecha = p_fecha;
  IF v_actor.rol = 'Entrenarqueros' AND v_actualizadas > 0 THEN
    RAISE EXCEPTION 'Las asistencias de arqueros ya registradas no se pueden modificar.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.asistencias_normales (alumno_id, fecha, estado, entrenador_id, grupo_gestion_id)
  SELECT x.alumno_id, p_fecha, x.estado, v_actor.id, v_grupo.id
  FROM jsonb_to_recordset(p_asistencias) AS x(alumno_id uuid, estado varchar)
  ON CONFLICT (alumno_id, fecha) DO UPDATE SET estado = EXCLUDED.estado;
  v_insertadas := v_total - v_actualizadas;

  INSERT INTO public.audit_log (escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle)
  VALUES (
    v_actor.escuela_id, v_actor.id, trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)),
    'REGISTRAR_ASISTENCIA_GRUPO', 'asistencias_normales', v_grupo.id::text,
    jsonb_build_object('fecha', p_fecha, 'grupo_gestion_id', v_grupo.id, 'insertadas', v_insertadas, 'corregidas', v_actualizadas)
  );
  RETURN jsonb_build_object('total', v_total, 'insertadas', v_insertadas, 'actualizadas', v_actualizadas);
END;
$$;

-- Clientes antiguos continúan enviando asistencias sin grupo durante la
-- transición. El trigger solo completa datos ausentes y nunca reescribe historia.
CREATE OR REPLACE FUNCTION public.fn_asistencia_completar_contexto_gestion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.grupo_gestion_id IS NULL THEN
    SELECT grupo_gestion_id INTO NEW.grupo_gestion_id FROM public.alumnos WHERE id = NEW.alumno_id;
  END IF;
  IF NEW.entrenador_id IS NULL THEN NEW.entrenador_id := auth.uid(); END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_asistencia_completar_contexto_gestion ON public.asistencias_normales;
CREATE TRIGGER trg_asistencia_completar_contexto_gestion
  BEFORE INSERT ON public.asistencias_normales
  FOR EACH ROW EXECUTE FUNCTION public.fn_asistencia_completar_contexto_gestion();

CREATE OR REPLACE FUNCTION public.fn_proteger_contexto_asistencia()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.grupo_gestion_id IS DISTINCT FROM OLD.grupo_gestion_id
     OR NEW.entrenador_id IS DISTINCT FROM OLD.entrenador_id THEN
    RAISE EXCEPTION 'El grupo y el autor originales de una asistencia no se pueden modificar.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_proteger_contexto_asistencia ON public.asistencias_normales;
CREATE TRIGGER trg_proteger_contexto_asistencia
  BEFORE UPDATE ON public.asistencias_normales
  FOR EACH ROW EXECUTE FUNCTION public.fn_proteger_contexto_asistencia();

CREATE OR REPLACE FUNCTION public.rpc_archivar_alumno(p_alumno_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor public.usuarios%ROWTYPE; v_alumno public.alumnos%ROWTYPE; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('Administrador', 'SuperAdministrador') THEN RAISE EXCEPTION 'No tienes permiso para archivar alumnos.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_alumno FROM public.alumnos WHERE id = p_alumno_id FOR UPDATE;
  IF NOT FOUND OR v_alumno.escuela_id <> v_actor.escuela_id THEN RAISE EXCEPTION 'El alumno no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL AND v_alumno.sucursal_id IS DISTINCT FROM v_actor.sucursal_id THEN RAISE EXCEPTION 'No puedes archivar alumnos de otra sucursal.' USING ERRCODE = '42501'; END IF;
  UPDATE public.alumnos_grupos SET estado = 'cerrada', vigente_hasta = v_now, motivo = 'archivo', updated_at = v_now WHERE alumno_id = v_alumno.id AND estado = 'activa';
  UPDATE public.alumnos SET archivado = true, grupo_gestion_id = NULL, profesor_asignado_id = NULL WHERE id = v_alumno.id;
  DELETE FROM public.alumnos_entrenadores WHERE alumno_id = v_alumno.id;
  RETURN jsonb_build_object('alumno_id', v_alumno.id, 'archivado', true);
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_restaurar_alumno(p_alumno_id uuid, p_grupo_gestion_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_actor public.usuarios%ROWTYPE; v_alumno public.alumnos%ROWTYPE; v_grupo public.grupos_gestion%ROWTYPE; v_entrenador uuid; v_now timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('Administrador', 'SuperAdministrador') THEN RAISE EXCEPTION 'No tienes permiso para restaurar alumnos.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_alumno FROM public.alumnos WHERE id = p_alumno_id FOR UPDATE;
  IF NOT FOUND OR v_alumno.escuela_id <> v_actor.escuela_id THEN RAISE EXCEPTION 'El alumno no pertenece a tu escuela.' USING ERRCODE = '42501'; END IF;
  SELECT gg.* INTO v_grupo FROM public.grupos_gestion gg JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id AND gd.estado = 'activa'
  WHERE gg.id = COALESCE(p_grupo_gestion_id, (SELECT ag.grupo_gestion_id FROM public.alumnos_grupos ag WHERE ag.alumno_id = v_alumno.id ORDER BY ag.vigente_hasta DESC NULLS LAST LIMIT 1))
    AND gg.escuela_id = v_actor.escuela_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Selecciona un grupo activo para restaurar al alumno.' USING ERRCODE = '22023'; END IF;
  SELECT entrenador_id INTO v_entrenador FROM public.entrenadores_grupos WHERE grupo_gestion_id = v_grupo.id AND estado = 'activa';
  IF v_entrenador IS NULL THEN RAISE EXCEPTION 'El grupo destino no tiene profesor principal.' USING ERRCODE = '22023'; END IF;
  UPDATE public.alumnos SET archivado = false, grupo_gestion_id = v_grupo.id, grupo_id = v_grupo.grupo_id, horario_id = v_grupo.horario_id, sucursal_id = v_grupo.sucursal_id, profesor_asignado_id = v_entrenador WHERE id = v_alumno.id;
  INSERT INTO public.alumnos_grupos (escuela_id, alumno_id, grupo_gestion_id, gestion_id, estado, decision, vigente_desde, motivo, creado_por)
  VALUES (v_actor.escuela_id, v_alumno.id, v_grupo.id, v_grupo.gestion_id, 'activa', 'migrara', v_now, 'restauracion', v_actor.id);
  INSERT INTO public.alumnos_entrenadores (alumno_id, entrenador_id) VALUES (v_alumno.id, v_entrenador) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('alumno_id', v_alumno.id, 'grupo_gestion_id', v_grupo.id, 'restaurado', true);
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_combinar_alumnos(
  p_alumno_destino_id uuid,
  p_alumno_origen_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_destino public.alumnos%ROWTYPE;
  v_origen public.alumnos%ROWTYPE;
  v_now timestamptz := clock_timestamp();
  v_migradas integer := 0;
BEGIN
  IF p_alumno_destino_id IS NULL OR p_alumno_origen_id IS NULL OR p_alumno_destino_id = p_alumno_origen_id THEN
    RAISE EXCEPTION 'Debes seleccionar dos alumnos diferentes.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_actor FROM public.usuarios WHERE id = auth.uid() AND activo IS TRUE;
  IF NOT FOUND OR v_actor.rol NOT IN ('Administrador', 'SuperAdministrador') THEN
    RAISE EXCEPTION 'Solo Administrador o SuperAdministrador puede combinar alumnos.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_destino FROM public.alumnos WHERE id = p_alumno_destino_id FOR UPDATE;
  SELECT * INTO v_origen FROM public.alumnos WHERE id = p_alumno_origen_id FOR UPDATE;
  IF NOT FOUND OR v_destino.escuela_id <> v_actor.escuela_id OR v_origen.escuela_id <> v_actor.escuela_id THEN
    RAISE EXCEPTION 'Ambos alumnos deben pertenecer a tu escuela.' USING ERRCODE = '42501';
  END IF;
  IF v_actor.rol = 'Administrador' AND v_actor.sucursal_id IS NOT NULL
     AND (v_destino.sucursal_id IS DISTINCT FROM v_actor.sucursal_id OR v_origen.sucursal_id IS DISTINCT FROM v_actor.sucursal_id) THEN
    RAISE EXCEPTION 'No puedes combinar alumnos de otra sucursal.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.alumnos
  SET carnet_identidad = COALESCE(NULLIF(v_destino.carnet_identidad, ''), v_origen.carnet_identidad),
      nombre_padre = COALESCE(NULLIF(v_destino.nombre_padre, ''), v_origen.nombre_padre),
      telefono_padre = COALESCE(NULLIF(v_destino.telefono_padre, ''), v_origen.telefono_padre),
      nombre_madre = COALESCE(NULLIF(v_destino.nombre_madre, ''), v_origen.nombre_madre),
      telefono_madre = COALESCE(NULLIF(v_destino.telefono_madre, ''), v_origen.telefono_madre),
      telefono_deportista = COALESCE(NULLIF(v_destino.telefono_deportista, ''), v_origen.telefono_deportista),
      colegio = COALESCE(NULLIF(v_destino.colegio, ''), v_origen.colegio),
      direccion = COALESCE(NULLIF(v_destino.direccion, ''), v_origen.direccion),
      foto_url = COALESCE(NULLIF(v_destino.foto_url, ''), v_origen.foto_url),
      es_arquero = COALESCE(v_destino.es_arquero, false) OR COALESCE(v_origen.es_arquero, false)
  WHERE id = v_destino.id;

  -- Solo se mueven registros que no chocan con una fecha del destino; los
  -- conflictos permanecen ligados al alumno origen archivado para no borrar
  -- historia ni alterar su grupo/autor original.
  UPDATE public.asistencias_normales origen
  SET alumno_id = v_destino.id
  WHERE origen.alumno_id = v_origen.id
    AND NOT EXISTS (SELECT 1 FROM public.asistencias_normales destino WHERE destino.alumno_id = v_destino.id AND destino.fecha = origen.fecha);
  GET DIAGNOSTICS v_migradas = ROW_COUNT;
  UPDATE public.asistencias_arqueros origen
  SET alumno_id = v_destino.id
  WHERE origen.alumno_id = v_origen.id
    AND NOT EXISTS (SELECT 1 FROM public.asistencias_arqueros destino WHERE destino.alumno_id = v_destino.id AND destino.fecha = origen.fecha);
  UPDATE public.alumnos_grupos SET estado = 'cerrada', vigente_hasta = v_now, motivo = 'fusion' WHERE alumno_id = v_origen.id AND estado IN ('activa', 'planificada');
  UPDATE public.alumnos SET archivado = true, grupo_gestion_id = NULL, profesor_asignado_id = NULL WHERE id = v_origen.id;
  DELETE FROM public.alumnos_entrenadores WHERE alumno_id = v_origen.id;
  INSERT INTO public.audit_log (escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle)
  VALUES (v_actor.escuela_id, v_actor.id, trim(concat_ws(' ', v_actor.nombres, v_actor.apellidos)), 'COMBINAR_ALUMNOS', 'alumnos', v_destino.id::text,
    jsonb_build_object('alumno_origen_id', v_origen.id, 'asistencias_migradas', v_migradas, 'conflictos_conservados', true));
  RETURN jsonb_build_object('alumno_destino_id', v_destino.id, 'alumno_origen_id', v_origen.id, 'asistencias_migradas', v_migradas);
END; $$;

CREATE OR REPLACE VIEW public.v_asistencias_contexto WITH (security_invoker = true) AS
SELECT an.id AS asistencia_id, an.alumno_id, an.fecha, an.estado, an.entrenador_id,
       an.grupo_gestion_id, a.escuela_id, gd.anio AS gestion_anio,
       COALESCE(gg.nombre_snapshot, 'Sin grupo histórico') AS grupo_nombre,
       gg.hora_snapshot AS grupo_hora, gg.sucursal_id, gg.grupo_id, gg.horario_id,
       trim(concat_ws(' ', u.nombres, u.apellidos)) AS registrado_por,
       u.nombres AS registrado_nombres, u.apellidos AS registrado_apellidos,
       u.rol AS registrado_rol
FROM public.asistencias_normales an
JOIN public.alumnos a ON a.id = an.alumno_id
LEFT JOIN public.grupos_gestion gg ON gg.id = an.grupo_gestion_id
LEFT JOIN public.gestiones_deportivas gd ON gd.id = gg.gestion_id
LEFT JOIN public.usuarios u ON u.id = an.entrenador_id;
REVOKE ALL ON public.v_asistencias_contexto FROM PUBLIC, anon;
GRANT SELECT ON public.v_asistencias_contexto TO authenticated;

DO $$
BEGIN
  IF to_regclass('public.v_alumnos') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_alumnos SET (security_invoker = true)';
  END IF;
  IF to_regclass('public.v_estadisticas_asistencia_diaria') IS NOT NULL THEN
    EXECUTE 'ALTER VIEW public.v_estadisticas_asistencia_diaria SET (security_invoker = true)';
  END IF;
END;
$$;
DROP POLICY IF EXISTS "Lectura general para usuarios autenticados" ON public.alumnos_entrenadores;

REVOKE ALL ON FUNCTION public.rpc_grupos_gestion_activos() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_registrar_alumno_en_grupo(jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_registrar_asistencias_lote(date, uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_archivar_alumno(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rpc_restaurar_alumno(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_grupos_gestion_activos() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_registrar_alumno_en_grupo(jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_registrar_asistencias_lote(date, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_archivar_alumno(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_restaurar_alumno(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_combinar_alumnos(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_combinar_alumnos(uuid, uuid) TO authenticated;
