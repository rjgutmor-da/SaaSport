-- CxC: búsqueda por alumnos archivados y aislamiento obligatorio por escuela.
-- Basada en la definición vigente de producción (incluye zona horaria de escuela).

CREATE OR REPLACE VIEW public.v_alumnos_deuda
WITH (security_invoker = true)
AS
WITH asistencias_mes AS (
  SELECT
    combined.alumno_id,
    count(*) FILTER (
      WHERE combined.estado::text = 'Presente'
        AND date_trunc('month', combined.fecha::timestamp with time zone) = date_trunc(
          'month',
          timezone(COALESCE(e.zona_horaria, 'America/La_Paz'), now())::date::timestamp with time zone
        )
    ) AS asistencias_actual,
    count(*) FILTER (
      WHERE combined.estado::text = 'Presente'
        AND date_trunc('month', combined.fecha::timestamp with time zone) = date_trunc(
          'month',
          timezone(COALESCE(e.zona_horaria, 'America/La_Paz'), now())::date::timestamp with time zone - interval '1 mon'
        )
    ) AS asistencias_anterior
  FROM (
    SELECT alumno_id, fecha, estado FROM public.asistencias_normales
    UNION ALL
    SELECT alumno_id, fecha, estado FROM public.asistencias_arqueros
  ) combined
  JOIN public.alumnos a_int ON a_int.id = combined.alumno_id
  LEFT JOIN public.escuelas e ON e.id = a_int.escuela_id
  GROUP BY combined.alumno_id
), meses_stats AS (
  SELECT
    cc.alumno_id,
    min(cc.fecha_emision) AS primera_fecha_saasport,
    count(DISTINCT m.mes) AS meses_saasport
  FROM public.cuentas_cobrar cc
  JOIN public.cxc_detalle cd ON cc.id = cd.cuenta_cobrar_id
  JOIN public.catalogo_items ci ON cd.catalogo_item_id = ci.id
  CROSS JOIN LATERAL jsonb_array_elements_text(cd.periodo_meses) m(mes)
  WHERE cc.anulada IS NOT TRUE
    AND ci.nombre ILIKE '%mensualidad%'
  GROUP BY cc.alumno_id
), ultima_mens_stats AS (
  SELECT DISTINCT ON (cc.alumno_id)
    cc.alumno_id,
    cd.periodo_meses ->> -1 AS ultima_mensualidad
  FROM public.cuentas_cobrar cc
  JOIN public.cxc_detalle cd ON cc.id = cd.cuenta_cobrar_id
  JOIN public.catalogo_items ci ON cd.catalogo_item_id = ci.id
  WHERE cc.anulada IS NOT TRUE
    AND ci.nombre ILIKE '%mensualidad%'
  ORDER BY cc.alumno_id, cc.fecha_emision DESC, cd.id DESC
)
SELECT
  a.id AS alumno_id,
  a.escuela_id,
  a.nombres,
  a.apellidos,
  a.fecha_nacimiento,
  a.sucursal_id,
  a.cancha_id,
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
  c.nombre AS cancha_nombre,
  h.hora AS horario_hora,
  (u.nombres::text || ' ') || u.apellidos::text AS entrenador_nombre,
  COALESCE(sum(cc.monto_total) FILTER (WHERE cc.anulada = false), 0::numeric) AS total_deuda,
  COALESCE(sum(cc.total_cobrado) FILTER (WHERE cc.anulada = false), 0::numeric) AS total_cobrado,
  COALESCE(sum(CASE WHEN cc.es_anticipo THEN -cc.saldo_pendiente ELSE cc.saldo_pendiente END) FILTER (WHERE cc.anulada = false), 0::numeric) AS saldo_pendiente,
  count(cc.id) FILTER (WHERE cc.estado::text = ANY (ARRAY['pendiente', 'parcial']) AND cc.anulada = false AND cc.es_anticipo = false) AS cxc_pendientes,
  count(cc.id) FILTER (WHERE cc.anulada = false) AS cxc_total,
  COALESCE(am.asistencias_actual, 0::bigint) AS asistencias_actual,
  COALESCE(am.asistencias_anterior, 0::bigint) AS asistencias_anterior,
  EXTRACT(year FROM timezone(COALESCE(esc.zona_horaria, 'America/La_Paz'), now())::date)::integer - EXTRACT(year FROM a.fecha_nacimiento)::integer AS sub,
  COALESCE(sum(cc.total_cobrado) FILTER (WHERE cc.anulada = false), 0::numeric) + COALESCE(a.ingresos_iniciales, 0::numeric) AS total_ingresos_historico,
  COALESCE(ms.meses_saasport, 0::bigint) + COALESCE(a.meses_permanencia_inicial, 0) AS cantidad_meses_actividad,
  COALESCE(a.fecha_inicio, a.created_at::date, ms.primera_fecha_saasport) AS fecha_inicio_consolidada,
  a.fecha_inicio,
  unaccent(lower(a.nombres::text)) AS nombres_search,
  unaccent(lower(a.apellidos::text)) AS apellidos_search,
  a.terminos_busqueda,
  ums.ultima_mensualidad,
  a.archivado
FROM public.alumnos a
LEFT JOIN public.sucursales s ON a.sucursal_id = s.id
LEFT JOIN public.canchas c ON a.cancha_id = c.id
LEFT JOIN public.horarios h ON a.horario_id = h.id
LEFT JOIN public.usuarios u ON a.profesor_asignado_id = u.id
LEFT JOIN public.v_cuentas_cobrar cc ON a.id = cc.alumno_id
LEFT JOIN asistencias_mes am ON a.id = am.alumno_id
LEFT JOIN meses_stats ms ON a.id = ms.alumno_id
LEFT JOIN ultima_mens_stats ums ON a.id = ums.alumno_id
LEFT JOIN public.escuelas esc ON a.escuela_id = esc.id
WHERE a.escuela_id = (SELECT public.current_user_escuela_id())
GROUP BY
  a.id, a.escuela_id, a.nombres, a.apellidos, a.fecha_nacimiento,
  a.sucursal_id, a.cancha_id, a.horario_id, a.profesor_asignado_id,
  a.nombre_padre, a.telefono_padre, a.nombre_madre, a.telefono_madre,
  a.whatsapp_preferido, a.meses_permanencia_inicial, a.ingresos_iniciales,
  s.nombre, c.nombre, h.hora, u.nombres, u.apellidos,
  am.asistencias_actual, am.asistencias_anterior, ms.meses_saasport,
  ms.primera_fecha_saasport, a.fecha_inicio, a.created_at,
  a.terminos_busqueda, ums.ultima_mensualidad, a.archivado, esc.zona_horaria;

REVOKE ALL ON TABLE public.v_alumnos_deuda FROM PUBLIC, anon;
GRANT SELECT ON TABLE public.v_alumnos_deuda TO authenticated;
