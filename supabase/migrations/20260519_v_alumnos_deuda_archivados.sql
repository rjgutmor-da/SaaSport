-- ==============================================================================
-- SaaSport: Migración de Vista v_alumnos_deuda para incluir alumnos archivados con deudas pendientes
-- Fecha: 2026-05-19
-- ==============================================================================

CREATE OR REPLACE VIEW public.v_alumnos_deuda AS
 WITH asistencias_mes AS (
         SELECT combined.alumno_id,
            count(*) FILTER (WHERE combined.estado::text = 'Presente'::text AND date_trunc('month'::text, combined.fecha::timestamp with time zone) = date_trunc('month'::text, CURRENT_DATE::timestamp with time zone)) AS asistencias_actual,
            count(*) FILTER (WHERE combined.estado::text = 'Presente'::text AND date_trunc('month'::text, combined.fecha::timestamp with time zone) = date_trunc('month'::text, CURRENT_DATE - '1 mon'::interval)) AS asistencias_anterior
           FROM ( SELECT asistencias_normales.alumno_id,
                    asistencias_normales.fecha,
                    asistencias_normales.estado
                   FROM asistencias_normales
                UNION ALL
                 SELECT asistencias_arqueros.alumno_id,
                    asistencias_arqueros.fecha,
                    asistencias_arqueros.estado
                   FROM asistencias_arqueros) combined
          GROUP BY combined.alumno_id
        ), meses_stats AS (
         SELECT cc_1.alumno_id,
            min(cc_1.fecha_emision) AS primera_fecha_saasport,
            count(DISTINCT m.mes) AS meses_saasport
           FROM cuentas_cobrar cc_1
             JOIN cxc_detalle cd ON cc_1.id = cd.cuenta_cobrar_id
             JOIN catalogo_items ci ON cd.catalogo_item_id = ci.id
             CROSS JOIN LATERAL jsonb_array_elements_text(cd.periodo_meses) m(mes)
          WHERE cc_1.anulada IS NOT TRUE AND ci.nombre::text ~~* '%mensualidad%'::text
          GROUP BY cc_1.alumno_id
        ), ultima_mens_stats AS (
         SELECT DISTINCT ON (cc_1.alumno_id) cc_1.alumno_id,
            cd.periodo_meses ->> '-1'::integer AS ultima_mensualidad
           FROM cuentas_cobrar cc_1
             JOIN cxc_detalle cd ON cc_1.id = cd.cuenta_cobrar_id
             JOIN catalogo_items ci ON cd.catalogo_item_id = ci.id
          WHERE cc_1.anulada IS NOT TRUE AND ci.nombre::text ~~* '%mensualidad%'::text
          ORDER BY cc_1.alumno_id, cc_1.fecha_emision DESC, cd.id DESC
        )
 SELECT a.id AS alumno_id,
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
    c.nombre AS grupo_nombre,
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
    ums.ultima_mensualidad
   FROM alumnos a
     LEFT JOIN sucursales s ON a.sucursal_id = s.id
     LEFT JOIN canchas c ON a.cancha_id = c.id
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
  GROUP BY a.id, a.escuela_id, a.nombres, a.apellidos, a.fecha_nacimiento, a.sucursal_id, a.cancha_id, a.horario_id, a.profesor_asignado_id, a.nombre_padre, a.telefono_padre, a.nombre_madre, a.telefono_madre, a.whatsapp_preferido, a.meses_permanencia_inicial, a.ingresos_iniciales, s.nombre, c.nombre, h.hora, u.nombres, u.apellidos, am.asistencias_actual, am.asistencias_anterior, ms.meses_saasport, ms.primera_fecha_saasport, a.fecha_inicio, a.created_at, a.terminos_busqueda, ums.ultima_mensualidad;
