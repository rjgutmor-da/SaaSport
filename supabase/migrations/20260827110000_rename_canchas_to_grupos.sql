-- ============================================================================
-- Migración: Unificación de Dominio (canchas -> grupos, cancha_id -> grupo_id)
-- ============================================================================

-- 1. Renombrar tabla public.canchas -> public.grupos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'canchas'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'grupos'
  ) THEN
    ALTER TABLE public.canchas RENAME TO grupos;
  END IF;
END $$;

-- 2. Renombrar tabla public.canchas_horarios -> public.grupos_horarios
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'canchas_horarios'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'grupos_horarios'
  ) THEN
    ALTER TABLE public.canchas_horarios RENAME TO grupos_horarios;
  END IF;
END $$;

-- 3. Renombrar columna cancha_id -> grupo_id en public.grupos_horarios
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'grupos_horarios' AND column_name = 'cancha_id'
  ) THEN
    ALTER TABLE public.grupos_horarios RENAME COLUMN cancha_id TO grupo_id;
  END IF;
END $$;

-- 4. Renombrar columna cancha_id -> grupo_id en public.alumnos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'alumnos' AND column_name = 'cancha_id'
  ) THEN
    ALTER TABLE public.alumnos RENAME COLUMN cancha_id TO grupo_id;
  END IF;
END $$;

-- 5. Renombrar columna cancha_id -> grupo_id en public.fotos_asistencia_grupal
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'fotos_asistencia_grupal' AND column_name = 'cancha_id'
  ) THEN
    ALTER TABLE public.fotos_asistencia_grupal RENAME COLUMN cancha_id TO grupo_id;
  END IF;
END $$;

-- 6. Actualizar índices si existen
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'canchas_pkey') THEN
    ALTER INDEX public.canchas_pkey RENAME TO grupos_pkey;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'canchas_horarios_pkey') THEN
    ALTER INDEX public.canchas_horarios_pkey RENAME TO grupos_horarios_pkey;
  END IF;
END $$;

-- 7. Actualizar RLS en public.grupos y public.grupos_horarios
ALTER TABLE public.grupos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grupos_horarios ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "grupos_escuela_select" ON public.grupos;
  CREATE POLICY "grupos_escuela_select" ON public.grupos
    FOR SELECT TO authenticated
    USING (escuela_id = current_user_escuela_id());

  DROP POLICY IF EXISTS "grupos_horarios_escuela_select" ON public.grupos_horarios;
  CREATE POLICY "grupos_horarios_escuela_select" ON public.grupos_horarios
    FOR SELECT TO authenticated
    USING (EXISTS (
      SELECT 1 FROM public.grupos g 
      WHERE g.id = grupos_horarios.grupo_id 
        AND g.escuela_id = current_user_escuela_id()
    ));
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grupos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grupos_horarios TO authenticated;

-- 8. Recrear / Actualizar vistas (Drop en cascada para permitir nuevas columnas y recreación limpia)
DROP VIEW IF EXISTS public.v_alumnos_deuda CASCADE;
DROP VIEW IF EXISTS public.v_cuentas_cobrar CASCADE;
DROP VIEW IF EXISTS public.v_alumnos CASCADE;

CREATE VIEW public.v_alumnos WITH (security_invoker = true) AS
SELECT 
  a.id,
  a.escuela_id,
  a.nombres,
  a.apellidos,
  a.carnet_identidad,
  a.fecha_nacimiento,
  a.nombre_padre,
  a.telefono_padre,
  a.nombre_madre,
  a.telefono_madre,
  a.whatsapp_preferido,
  a.colegio,
  a.direccion,
  a.grupo_id,
  a.grupo_id AS cancha_id,
  a.horario_id,
  a.profesor_asignado_id,
  a.sucursal_id,
  a.es_arquero,
  a.tipo,
  a.mensualidad,
  a.observaciones,
  a.foto_url,
  a.archivado,
  a.estado,
  a.created_at,
  a.updated_at,
  s.nombre AS sucursal_nombre,
  g.nombre AS grupo_nombre,
  g.nombre AS cancha_nombre,
  h.hora AS horario_hora,
  u.nombres AS profesor_nombres,
  u.apellidos AS profesor_apellidos
FROM public.alumnos a
LEFT JOIN public.sucursales s ON a.sucursal_id = s.id
LEFT JOIN public.grupos g ON a.grupo_id = g.id
LEFT JOIN public.horarios h ON a.horario_id = h.id
LEFT JOIN public.usuarios u ON a.profesor_asignado_id = u.id;

GRANT SELECT ON public.v_alumnos TO authenticated;

-- 9. Recrear / Actualizar vista public.v_cuentas_cobrar
CREATE VIEW public.v_cuentas_cobrar WITH (security_invoker = true) AS
SELECT 
  cc.id,
  cc.escuela_id,
  cc.sucursal_id,
  cc.alumno_id,
  cc.monto_total,
  cc.periodo,
  cc.fecha_emision,
  cc.fecha_vencimiento,
  cc.descripcion,
  cc.observaciones,
  cc.estado,
  cc.created_at,
  cc.updated_at,
  cc.editado,
  cc.editado_por,
  cc.editado_at,
  cc.anulada,
  cc.anulada_por,
  cc.anulada_at,
  COALESCE(sum(ca.monto_aplicado) FILTER (WHERE (ca.es_aplicacion_anticipo IS NOT TRUE)), (0)::numeric) AS total_cobrado,
  CASE
    WHEN cc.es_anticipo THEN (COALESCE(sum(ca.monto_aplicado) FILTER (WHERE (ca.es_aplicacion_anticipo IS NOT TRUE)), (0)::numeric) - COALESCE(sum(ca.monto_aplicado) FILTER (WHERE (ca.es_aplicacion_anticipo IS TRUE)), (0)::numeric))
    ELSE (cc.monto_total - COALESCE(sum(ca.monto_aplicado), (0)::numeric))
  END AS saldo_pendiente,
  a.nombres AS alumno_nombres,
  a.apellidos AS alumno_apellidos,
  a.nombre_padre,
  a.telefono_padre,
  a.nombre_madre,
  a.telefono_madre,
  a.whatsapp_preferido,
  a.sucursal_id AS alumno_sucursal_id,
  a.grupo_id AS alumno_grupo_id,
  a.grupo_id AS alumno_cancha_id,
  a.horario_id AS alumno_horario_id,
  a.profesor_asignado_id AS alumno_entrenador_id,
  suc.nombre AS sucursal_nombre,
  g.nombre AS grupo_nombre,
  g.nombre AS cancha_nombre,
  hor.hora AS horario_hora,
  COALESCE((((ue.nombres)::text || ' '::text) || (ue.apellidos)::text), ''::text) AS entrenador_nombre,
  cc.es_anticipo,
  a.fecha_nacimiento,
  cc.ciclo_inicio,
  cc.ciclo_fin,
  cc.periodo_estadistico
FROM public.cuentas_cobrar cc
LEFT JOIN public.cobros_aplicados ca ON cc.id = ca.cuenta_cobrar_id
LEFT JOIN public.alumnos a ON a.id = cc.alumno_id
LEFT JOIN public.sucursales suc ON suc.id = a.sucursal_id
LEFT JOIN public.grupos g ON g.id = a.grupo_id
LEFT JOIN public.horarios hor ON hor.id = a.horario_id
LEFT JOIN public.usuarios ue ON ue.id = a.profesor_asignado_id
WHERE cc.anulada IS NOT TRUE AND cc.estado::text <> 'borrador'::text
GROUP BY cc.id, a.id, suc.id, g.id, hor.id, ue.id, cc.ciclo_inicio, cc.ciclo_fin, cc.periodo_estadistico;

GRANT SELECT ON public.v_cuentas_cobrar TO authenticated;

-- 10. Recrear / Actualizar vista public.v_alumnos_deuda
CREATE VIEW public.v_alumnos_deuda WITH (security_invoker = true) AS
WITH asistencias_mes AS (
  SELECT 
    an.alumno_id,
    count(an.id) FILTER (WHERE an.fecha >= date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) AND (an.estado::text = ANY (ARRAY['Presente'::character varying::text, 'Licencia'::character varying::text]))) AS asistencias_actual,
    count(an.id) FILTER (WHERE an.fecha >= (date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) - '1 mon'::interval) AND an.fecha < date_trunc('month'::text, CURRENT_DATE::timestamp with time zone) AND (an.estado::text = ANY (ARRAY['Presente'::character varying::text, 'Licencia'::character varying::text]))) AS asistencias_anterior
  FROM asistencias_normales an
  GROUP BY an.alumno_id
), meses_stats AS (
  SELECT 
    cc_1.alumno_id,
    count(DISTINCT to_char(cc_1.fecha_emision::timestamp with time zone, 'YYYY-MM'::text)) AS meses_saasport,
    min(cc_1.fecha_emision) AS primera_fecha_saasport
  FROM cuentas_cobrar cc_1
  WHERE cc_1.anulada IS NOT TRUE
  GROUP BY cc_1.alumno_id
), ultima_mens_stats AS (
  SELECT DISTINCT ON (cc_1.alumno_id) 
    cc_1.alumno_id,
    cd.periodo_meses ->> '-1'::integer AS ultima_mensualidad
  FROM cuentas_cobrar cc_1
  JOIN cxc_detalle cd ON cc_1.id = cd.cuenta_cobrar_id
  JOIN catalogo_items ci ON cd.catalogo_item_id = ci.id
  WHERE cc_1.anulada IS NOT TRUE AND ci.nombre::text ~~* '%mensualidad%'::text
  ORDER BY cc_1.alumno_id, cc_1.fecha_emision DESC, cd.id DESC
)
SELECT 
  a.id AS alumno_id,
  a.escuela_id,
  a.nombres,
  a.apellidos,
  a.fecha_nacimiento,
  a.sucursal_id,
  a.grupo_id,
  a.grupo_id AS cancha_id,
  a.horario_id,
  a.profesor_asignado_id AS entrenador_id,
  a.nombre_padre,
  a.telefono_padre,
  a.nombre_madre,
  a.telefono_madre,
  a.whatsapp_preferido,
  a.meses_permanencia_inicial,
  a.ingresos_iniciales,
  s.nombre AS sucursal_nombre,
  g.nombre AS grupo_nombre,
  g.nombre AS cancha_nombre,
  h.hora AS horario_hora,
  (u.nombres::text || ' '::text) || u.apellidos::text AS entrenador_nombre,
  COALESCE(sum(cc.monto_total) FILTER (WHERE cc.anulada = false), 0::numeric) AS total_deuda,
  COALESCE(sum(cc.total_cobrado) FILTER (WHERE cc.anulada = false), 0::numeric) AS total_cobrado,
  COALESCE(sum(
    CASE
      WHEN cc.es_anticipo THEN - cc.saldo_pendiente
      ELSE cc.saldo_pendiente
    END) FILTER (WHERE cc.anulada = false), 0::numeric) AS saldo_pendiente,
  count(cc.id) FILTER (WHERE (cc.estado::text = ANY (ARRAY['pendiente'::character varying::text, 'parcial'::character varying::text])) AND cc.anulada = false AND cc.es_anticipo = false) AS cxc_pendientes,
  count(cc.id) FILTER (WHERE cc.anulada = false) AS cxc_total,
  COALESCE(am.asistencias_actual, 0::bigint) AS asistencias_actual,
  COALESCE(am.asistencias_anterior, 0::bigint) AS asistencias_anterior,
  EXTRACT(year FROM CURRENT_DATE)::integer - EXTRACT(year FROM a.fecha_nacimiento)::integer AS sub,
  COALESCE(sum(cc.total_cobrado) FILTER (WHERE cc.anulada = false), 0::numeric) + COALESCE(a.ingresos_iniciales, 0::numeric) AS total_ingresos_historico,
  COALESCE(ms.meses_saasport, 0::bigint) + COALESCE(a.meses_permanencia_inicial, 0) AS cantidad_meses_actividad,
  COALESCE(a.fecha_inicio, a.created_at::date, ms.primera_fecha_saasport) AS fecha_inicio_consolidada,
  a.fecha_inicio,
  unaccent(lower(a.nombres::text)) AS nombres_search,
  unaccent(lower(a.apellidos::text)) AS apellidos_search,
  a.terminos_busqueda,
  ums.ultima_mensualidad,
  a.archivado
FROM alumnos a
LEFT JOIN sucursales s ON a.sucursal_id = s.id
LEFT JOIN grupos g ON a.grupo_id = g.id
LEFT JOIN horarios h ON a.horario_id = h.id
LEFT JOIN usuarios u ON a.profesor_asignado_id = u.id
LEFT JOIN v_cuentas_cobrar cc ON a.id = cc.alumno_id
LEFT JOIN asistencias_mes am ON a.id = am.alumno_id
LEFT JOIN meses_stats ms ON a.id = ms.alumno_id
LEFT JOIN ultima_mens_stats ums ON a.id = ums.alumno_id
WHERE a.archivado = false OR a.id IN (
  SELECT cc_filter.alumno_id
  FROM v_cuentas_cobrar cc_filter
  WHERE cc_filter.saldo_pendiente != 0
)
GROUP BY 
  a.id, a.escuela_id, a.nombres, a.apellidos, a.fecha_nacimiento, 
  a.sucursal_id, a.grupo_id, a.horario_id, a.profesor_asignado_id, 
  a.nombre_padre, a.telefono_padre, a.nombre_madre, a.telefono_madre, 
  a.whatsapp_preferido, a.meses_permanencia_inicial, a.ingresos_iniciales, 
  s.nombre, g.nombre, h.hora, u.nombres, u.apellidos, 
  am.asistencias_actual, am.asistencias_anterior, ms.meses_saasport, 
  ms.primera_fecha_saasport, a.fecha_inicio, a.created_at, 
  a.terminos_busqueda, ums.ultima_mensualidad, a.archivado;

GRANT SELECT ON public.v_alumnos_deuda TO authenticated;

