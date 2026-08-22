-- Simplifica las categorías visibles de CxP y protege las notas mensuales de sueldos.
-- La CLI de Supabase no está instalada en este entorno; se conserva el formato
-- versionado del repositorio para aplicarlo mediante el flujo controlado del proyecto.

BEGIN;

-- Las categorías históricas de proveedores se consolidan sin tocar personal.
UPDATE public.proveedores
SET categoria = CASE
  WHEN categoria = 'uniforme' THEN 'uniforme'
  ELSE 'otro'
END
WHERE categoria IS DISTINCT FROM 'uniforme'
   OR categoria IS NULL;

ALTER TABLE public.proveedores
  DROP CONSTRAINT IF EXISTS proveedores_categoria_check;

ALTER TABLE public.proveedores
  ADD CONSTRAINT proveedores_categoria_check
  CHECK (categoria IN ('uniforme', 'otro')) NOT VALID;

ALTER TABLE public.proveedores
  VALIDATE CONSTRAINT proveedores_categoria_check;

-- La vista entrega exactamente las tres categorías que consume la interfaz.
CREATE OR REPLACE VIEW public.v_cxp_consolidado
WITH (security_invoker = true)
AS
WITH cxp_agrupado AS (
  SELECT
    escuela_id,
    proveedor_id,
    personal_id,
    SUM(deuda_restante) AS saldo_pendiente,
    COUNT(*) AS notas_pendientes,
    MIN(fecha_emision) AS fecha_mas_antigua
  FROM public.v_estado_cuentas_pagar
  WHERE estado <> 'pagada'
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

-- El periodo YYYY-MM solo se asigna a salarios desde la UI. Este índice evita
-- dos notas activas para la misma persona y mes, incluso ante solicitudes simultáneas.
CREATE UNIQUE INDEX IF NOT EXISTS ux_cxp_sueldo_personal_periodo_activo
  ON public.cuentas_pagar (escuela_id, personal_id, periodo)
  WHERE personal_id IS NOT NULL
    AND periodo IS NOT NULL
    AND COALESCE(anulada, false) = false
    AND COALESCE(es_anticipo, false) = false;

COMMIT;
