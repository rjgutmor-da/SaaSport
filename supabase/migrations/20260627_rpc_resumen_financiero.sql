-- Migración para crear la función rpc_resumen_financiero
-- Creado: 2026-06-27

CREATE OR REPLACE FUNCTION rpc_resumen_financiero(
  p_escuela_id UUID,
  p_desde DATE,
  p_hasta DATE
)
RETURNS TABLE (tipo TEXT, nombre TEXT, monto NUMERIC, porcentaje NUMERIC)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- 1. Obtener IDs de cajas activas
  -- 2. CTE "ingresos_raw": JOIN cobros_aplicados → cuentas_cobrar → cxc_detalle → catalogo_items
  --    - Filtros: escuela_id, caja_id IN (cajas activas), fecha en rango, NOT anulada, monto > 0
  --    - Cálculo de proporción: subtotal_detalle / SUM(subtotal) OVER (PARTITION BY cuenta_cobrar_id)
  --    - Monto prorrateado: monto_aplicado * proporción
  --    - Agrupación por COALESCE(catalogo_items.nombre, cuentas_cobrar.descripcion, 'Otros Ingresos')
  -- 3. CTE "egresos_raw": equivalente para pagos_aplicados → cuentas_pagar → cxp_detalle
  -- 4. Unión de ambos CTEs con cálculo de porcentaje:
  --    porcentaje = monto / SUM(monto) OVER (PARTITION BY tipo) * 100
  RETURN QUERY
  WITH
    cajas AS (
      SELECT id FROM cajas_bancos
      WHERE escuela_id = p_escuela_id AND activo = true
    ),
    -- Ingresos: cobros con caja real, prorrateados por ítem
    ingresos_detalle AS (
      SELECT
        COALESCE(ci.nombre, cc.descripcion, 'Otros Ingresos')::TEXT AS item_nombre,
        ca.monto_aplicado * (
          CASE
            WHEN SUM(d.subtotal) OVER (PARTITION BY ca.cuenta_cobrar_id) > 0
            THEN d.subtotal / SUM(d.subtotal) OVER (PARTITION BY ca.cuenta_cobrar_id)
            ELSE 1
          END
        ) AS monto_prorrateado
      FROM cobros_aplicados ca
      JOIN cuentas_cobrar cc ON cc.id = ca.cuenta_cobrar_id
      LEFT JOIN cxc_detalle d ON d.cuenta_cobrar_id = cc.id
      LEFT JOIN catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE ca.escuela_id = p_escuela_id
        AND ca.caja_id IN (SELECT id FROM cajas)
        AND ca.fecha::date BETWEEN p_desde AND p_hasta
        AND cc.anulada IS NOT TRUE
        AND ca.monto_aplicado > 0
    ),
    -- Caso especial: cobros sin detalles
    ingresos_sin_detalle AS (
      SELECT
        COALESCE(cc.descripcion, 'Otros Ingresos')::TEXT AS item_nombre,
        ca.monto_aplicado AS monto_prorrateado
      FROM cobros_aplicados ca
      JOIN cuentas_cobrar cc ON cc.id = ca.cuenta_cobrar_id
      WHERE ca.escuela_id = p_escuela_id
        AND ca.caja_id IN (SELECT id FROM cajas)
        AND ca.fecha::date BETWEEN p_desde AND p_hasta
        AND cc.anulada IS NOT TRUE
        AND ca.monto_aplicado > 0
        AND NOT EXISTS (
          SELECT 1 FROM cxc_detalle d
          WHERE d.cuenta_cobrar_id = cc.id
            AND d.subtotal > 0
        )
    ),
    ingresos_agrupados AS (
      SELECT item_nombre, SUM(monto_prorrateado) AS monto
      FROM (
        SELECT * FROM ingresos_detalle
        WHERE item_nombre IS NOT NULL  -- excluir filas de JOINs vacíos
        UNION ALL
        SELECT * FROM ingresos_sin_detalle
      ) t
      GROUP BY item_nombre
    ),
    -- Egresos: misma lógica para pagos
    egresos_detalle AS (
      SELECT
        COALESCE(ci.nombre, cp.descripcion, 'Otros Egresos')::TEXT AS item_nombre,
        pa.monto_aplicado * (
          CASE
            WHEN SUM(d.subtotal) OVER (PARTITION BY pa.cuenta_pagar_id) > 0
            THEN d.subtotal / SUM(d.subtotal) OVER (PARTITION BY pa.cuenta_pagar_id)
            ELSE 1
          END
        ) AS monto_prorrateado
      FROM pagos_aplicados pa
      JOIN cuentas_pagar cp ON cp.id = pa.cuenta_pagar_id
      LEFT JOIN cxp_detalle d ON d.cuenta_pagar_id = cp.id
      LEFT JOIN catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE pa.escuela_id = p_escuela_id
        AND pa.caja_id IN (SELECT id FROM cajas)
        AND pa.fecha::date BETWEEN p_desde AND p_hasta
        AND cp.anulada IS NOT TRUE
        AND pa.monto_aplicado > 0
    ),
    egresos_sin_detalle AS (
      SELECT
        COALESCE(cp.descripcion, 'Otros Egresos')::TEXT AS item_nombre,
        pa.monto_aplicado AS monto_prorrateado
      FROM pagos_aplicados pa
      JOIN cuentas_pagar cp ON cp.id = pa.cuenta_pagar_id
      WHERE pa.escuela_id = p_escuela_id
        AND pa.caja_id IN (SELECT id FROM cajas)
        AND pa.fecha::date BETWEEN p_desde AND p_hasta
        AND cp.anulada IS NOT TRUE
        AND pa.monto_aplicado > 0
        AND NOT EXISTS (
          SELECT 1 FROM cxp_detalle d
          WHERE d.cuenta_pagar_id = cp.id
            AND d.subtotal > 0
        )
    ),
    egresos_agrupados AS (
      SELECT item_nombre, SUM(monto_prorrateado) AS monto
      FROM (
        SELECT * FROM egresos_detalle
        WHERE item_nombre IS NOT NULL
        UNION ALL
        SELECT * FROM egresos_sin_detalle
      ) t
      GROUP BY item_nombre
    )
  -- Resultado final con porcentajes
  SELECT
    'ingreso'::TEXT AS tipo,
    ia.item_nombre::TEXT AS nombre,
    ROUND(ia.monto::NUMERIC, 2) AS monto,
    ROUND(
      (CASE WHEN SUM(ia.monto) OVER () > 0
        THEN ia.monto / SUM(ia.monto) OVER () * 100
        ELSE 0
      END)::NUMERIC, 2
    ) AS porcentaje
  FROM ingresos_agrupados ia
  UNION ALL
  SELECT
    'egreso'::TEXT AS tipo,
    ea.item_nombre::TEXT AS nombre,
    ROUND(ea.monto::NUMERIC, 2) AS monto,
    ROUND(
      (CASE WHEN SUM(ea.monto) OVER () > 0
        THEN ea.monto / SUM(ea.monto) OVER () * 100
        ELSE 0
      END)::NUMERIC, 2
    ) AS porcentaje
  FROM egresos_agrupados ea
  ORDER BY tipo, monto DESC;
END;
$$;

-- Permisos
GRANT EXECUTE ON FUNCTION rpc_resumen_financiero(UUID, DATE, DATE)
  TO authenticated;
