-- ============================================================================
-- Nombre: 2_actualizacion_mensualidad.sql
-- Descripción: Script SQL para realizar la actualización masiva de la columna 
--              `mensualidad` en la tabla `alumnos` para la escuela Planeta FC.
--              Asigna el monto más alto registrado entre Mayo y Junio de 2026.
-- ============================================================================

BEGIN;

UPDATE public.alumnos a
SET 
    mensualidad = m.monto_mas_alto,
    updated_at = NOW()
FROM (
    -- Subconsulta para calcular el monto más alto de mensualidad entre mayo y junio de 2026
    SELECT 
        cc.alumno_id,
        GREATEST(
            MAX(CASE WHEN cd.periodo_meses ? 'May' THEN cd.precio_unitario ELSE 0 END),
            MAX(CASE WHEN cd.periodo_meses ? 'Jun' THEN cd.precio_unitario ELSE 0 END)
        ) as monto_mas_alto
    FROM public.cuentas_cobrar cc
    JOIN public.cxc_detalle cd ON cc.id = cd.cuenta_cobrar_id
    WHERE cc.escuela_id = '218ea007-49c4-4fa2-9e81-3b6663496f26' -- PLANETA FC
      AND cc.anulada IS NOT TRUE -- Excluir cuentas anuladas
      AND cd.catalogo_item_id = '4f9e99c0-991b-40f0-b77c-7eaf79ee7d56' -- Item Mensualidad
      AND cc.fecha_emision >= '2026-01-01' AND cc.fecha_emision <= '2026-12-31'
    GROUP BY cc.alumno_id
) m
WHERE a.id = m.alumno_id
  AND a.escuela_id = '218ea007-49c4-4fa2-9e81-3b6663496f26' -- PLANETA FC
  AND a.archivado = false -- Solo alumnos activos (no archivados)
  AND a.estado != 'ELIMINADO SISTEMA'
  AND m.monto_mas_alto > 0; -- Solo actualizar si se encontró un monto válido mayor a 0

COMMIT;
