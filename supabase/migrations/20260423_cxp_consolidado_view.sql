CREATE OR REPLACE VIEW v_cxp_consolidado AS
WITH cxp_agrupado AS (
    SELECT
        escuela_id,
        proveedor_id,
        personal_id,
        SUM(deuda_restante) AS saldo_pendiente,
        COUNT(*) AS notas_pendientes,
        MIN(fecha_emision) AS fecha_mas_antigua
    FROM v_estado_cuentas_pagar
    WHERE estado != 'pagada'
    GROUP BY escuela_id, proveedor_id, personal_id
)
SELECT 
    p.id,
    p.escuela_id,
    'proveedor' AS tipo,
    p.nombre,
    COALESCE(p.categoria, 'otro') AS categoria,
    NULL AS cargo,
    p.telefono,
    COALESCE(c.saldo_pendiente, 0) AS saldo_pendiente,
    COALESCE(c.notas_pendientes, 0) AS notas_pendientes,
    c.fecha_mas_antigua,
    p.activo
FROM proveedores p
LEFT JOIN cxp_agrupado c ON p.id = c.proveedor_id AND p.escuela_id = c.escuela_id

UNION ALL

SELECT 
    ps.id,
    ps.escuela_id,
    'personal' AS tipo,
    ps.nombres || ' ' || ps.apellidos AS nombre,
    'personal_interno' AS categoria,
    ps.cargo,
    ps.telefono,
    COALESCE(c.saldo_pendiente, 0) AS saldo_pendiente,
    COALESCE(c.notas_pendientes, 0) AS notas_pendientes,
    c.fecha_mas_antigua,
    ps.activo
FROM personal ps
LEFT JOIN cxp_agrupado c ON ps.id = c.personal_id AND ps.escuela_id = c.escuela_id;
