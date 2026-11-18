-- 1. Agregar columna fecha_nacimiento a public.personal
ALTER TABLE public.personal
ADD COLUMN IF NOT EXISTS fecha_nacimiento date;

-- 2. Actualizar vista public.v_cxp_consolidado agregando fecha_nacimiento al final
CREATE OR REPLACE VIEW public.v_cxp_consolidado
WITH (security_invoker = true)
AS
WITH cxp_agrupado AS (
  SELECT v_estado_cuentas_pagar.escuela_id,
    v_estado_cuentas_pagar.proveedor_id,
    v_estado_cuentas_pagar.personal_id,
    sum(
      CASE
        WHEN COALESCE(v_estado_cuentas_pagar.es_anticipo, false) THEN - v_estado_cuentas_pagar.deuda_restante
        ELSE v_estado_cuentas_pagar.deuda_restante
      END
    ) AS saldo_pendiente,
    count(*) FILTER (WHERE COALESCE(v_estado_cuentas_pagar.es_anticipo, false) = false) AS notas_pendientes,
    min(v_estado_cuentas_pagar.fecha_emision) FILTER (WHERE COALESCE(v_estado_cuentas_pagar.es_anticipo, false) = false) AS fecha_mas_antigua
  FROM public.v_estado_cuentas_pagar
  WHERE (COALESCE(v_estado_cuentas_pagar.es_anticipo, false) = false AND v_estado_cuentas_pagar.estado::text <> 'pagada'::text)
     OR (COALESCE(v_estado_cuentas_pagar.es_anticipo, false) = true AND v_estado_cuentas_pagar.deuda_restante > 0::numeric)
  GROUP BY v_estado_cuentas_pagar.escuela_id, v_estado_cuentas_pagar.proveedor_id, v_estado_cuentas_pagar.personal_id
)
SELECT p.id,
  p.escuela_id,
  'proveedor'::text AS tipo,
  p.nombre,
  CASE
    WHEN p.categoria = 'uniforme'::text THEN 'uniforme'::text
    ELSE 'otro'::text
  END AS categoria,
  NULL::character varying AS cargo,
  p.telefono,
  COALESCE(c.saldo_pendiente, 0::numeric) AS saldo_pendiente,
  COALESCE(c.notas_pendientes, 0::bigint) AS notas_pendientes,
  c.fecha_mas_antigua,
  p.activo,
  NULL::date AS fecha_nacimiento
FROM public.proveedores p
LEFT JOIN cxp_agrupado c ON p.id = c.proveedor_id AND p.escuela_id = c.escuela_id
UNION ALL
SELECT ps.id,
  ps.escuela_id,
  'personal'::text AS tipo,
  (ps.nombres::text || ' '::text) || ps.apellidos::text AS nombre,
  'personal'::text AS categoria,
  ps.cargo,
  ps.telefono,
  COALESCE(c.saldo_pendiente, 0::numeric) AS saldo_pendiente,
  COALESCE(c.notas_pendientes, 0::bigint) AS notas_pendientes,
  c.fecha_mas_antigua,
  ps.activo,
  ps.fecha_nacimiento
FROM public.personal ps
LEFT JOIN cxp_agrupado c ON ps.id = c.personal_id AND ps.escuela_id = c.escuela_id;
