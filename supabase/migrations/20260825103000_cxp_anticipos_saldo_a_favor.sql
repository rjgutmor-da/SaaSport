-- Los anticipos desembolsados mantienen estado "pagada", pero su
-- deuda_restante representa crédito disponible a favor de la escuela.
-- El consolidado los incluye con signo negativo; las deudas normales
-- permanecen positivas.

CREATE OR REPLACE VIEW public.v_cxp_consolidado
WITH (security_invoker = true)
AS
WITH cxp_agrupado AS (
  SELECT
    escuela_id,
    proveedor_id,
    personal_id,
    SUM(
      CASE
        WHEN COALESCE(es_anticipo, false) THEN -deuda_restante
        ELSE deuda_restante
      END
    ) AS saldo_pendiente,
    COUNT(*) FILTER (WHERE COALESCE(es_anticipo, false) = false) AS notas_pendientes,
    MIN(fecha_emision) FILTER (WHERE COALESCE(es_anticipo, false) = false) AS fecha_mas_antigua
  FROM public.v_estado_cuentas_pagar
  WHERE (
    COALESCE(es_anticipo, false) = false
    AND estado <> 'pagada'
  ) OR (
    COALESCE(es_anticipo, false) = true
    AND deuda_restante > 0
  )
  GROUP BY escuela_id, proveedor_id, personal_id
)
SELECT
  p.id,
  p.escuela_id,
  'proveedor'::text AS tipo,
  p.nombre,
  CASE WHEN p.categoria = 'uniforme' THEN 'uniforme' ELSE 'otro' END AS categoria,
  NULL::varchar AS cargo,
  p.telefono,
  COALESCE(c.saldo_pendiente, 0) AS saldo_pendiente,
  COALESCE(c.notas_pendientes, 0) AS notas_pendientes,
  c.fecha_mas_antigua,
  p.activo
FROM public.proveedores p
LEFT JOIN cxp_agrupado c ON p.id = c.proveedor_id AND p.escuela_id = c.escuela_id

UNION ALL

SELECT
  ps.id,
  ps.escuela_id,
  'personal'::text AS tipo,
  ps.nombres || ' ' || ps.apellidos AS nombre,
  'personal'::text AS categoria,
  ps.cargo,
  ps.telefono,
  COALESCE(c.saldo_pendiente, 0) AS saldo_pendiente,
  COALESCE(c.notas_pendientes, 0) AS notas_pendientes,
  c.fecha_mas_antigua,
  ps.activo
FROM public.personal ps
LEFT JOIN cxp_agrupado c ON ps.id = c.personal_id AND ps.escuela_id = c.escuela_id;
