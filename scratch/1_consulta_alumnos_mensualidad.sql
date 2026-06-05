-- ============================================================================
-- Nombre: 1_consulta_alumnos_mensualidad.sql
-- Descripción: Consulta para pre-visualizar las mensualidades de mayo y junio 
--              de 2026 para los alumnos activos de Planeta FC y determinar 
--              cuál será su nueva mensualidad asignada (el monto más alto).
-- ============================================================================

WITH mensualidades_por_mes AS (
    -- Obtener los detalles de mensualidades de mayo y junio de 2026
    SELECT 
        cc.alumno_id,
        -- Monto de mensualidad para Mayo 2026
        MAX(CASE WHEN cd.periodo_meses ? 'May' THEN cd.precio_unitario ELSE 0 END) as mensualidad_mayo,
        -- Monto de mensualidad para Junio 2026
        MAX(CASE WHEN cd.periodo_meses ? 'Jun' THEN cd.precio_unitario ELSE 0 END) as mensualidad_junio
    FROM public.cuentas_cobrar cc
    JOIN public.cxc_detalle cd ON cc.id = cd.cuenta_cobrar_id
    WHERE cc.escuela_id = '218ea007-49c4-4fa2-9e81-3b6663496f26' -- PLANETA FC
      AND cc.anulada IS NOT TRUE -- Excluir cuentas anuladas
      AND cd.catalogo_item_id = '4f9e99c0-991b-40f0-b77c-7eaf79ee7d56' -- Item Mensualidad
      -- Filtrar por facturas emitidas en el año 2026
      AND cc.fecha_emision >= '2026-01-01' AND cc.fecha_emision <= '2026-12-31'
    GROUP BY cc.alumno_id
),
calculo_actualizacion AS (
    SELECT 
        a.id as alumno_id,
        a.nombres || ' ' || a.apellidos as nombre_completo,
        a.estado,
        a.mensualidad as mensualidad_actual,
        COALESCE(m.mensualidad_mayo, 0) as mayo_2026,
        COALESCE(m.mensualidad_junio, 0) as junio_2026,
        -- Determinar el monto más alto
        GREATEST(COALESCE(m.mensualidad_mayo, 0), COALESCE(m.mensualidad_junio, 0)) as monto_mas_alto
    FROM public.alumnos a
    LEFT JOIN mensualidades_por_mes m ON a.id = m.alumno_id
    WHERE a.escuela_id = '218ea007-49c4-4fa2-9e81-3b6663496f26' -- PLANETA FC
      AND a.archivado = false -- Alumnos activos (no archivados)
      AND a.estado != 'ELIMINADO SISTEMA'
)
SELECT 
    alumno_id,
    nombre_completo,
    estado,
    mensualidad_actual,
    mayo_2026,
    junio_2026,
    monto_mas_alto,
    -- Indicar qué acción se tomará
    CASE 
        WHEN monto_mas_alto > 0 THEN 'Se actualizará a ' || monto_mas_alto
        ELSE 'Se mantiene intacta (' || COALESCE(mensualidad_actual, 0) || ')'
    END as accion_propuesta
FROM calculo_actualizacion
ORDER BY nombre_completo;
