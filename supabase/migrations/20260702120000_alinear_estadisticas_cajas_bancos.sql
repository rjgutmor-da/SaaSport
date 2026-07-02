-- Alinea las tortas de Estadisticas con las cajas/bancos activas.
--
-- La fuente de efectivo real de la pantalla Caja y Bancos son
-- cobros_aplicados/pagos_aplicados: sus triggers mantienen saldo_actual.
-- Por ello el resumen parte de esas mismas filas y no de las notas devengadas.

CREATE OR REPLACE FUNCTION public.rpc_resumen_financiero(
  p_escuela_id UUID,
  p_desde DATE,
  p_hasta DATE
)
RETURNS TABLE (tipo TEXT, nombre TEXT, monto NUMERIC, porcentaje NUMERIC)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_desde IS NULL OR p_hasta IS NULL OR p_desde > p_hasta THEN
    RAISE EXCEPTION 'El rango de fechas no es valido.';
  END IF;

  RETURN QUERY
  WITH
    cajas_activas AS (
      SELECT cb.id
      FROM public.cajas_bancos cb
      WHERE cb.escuela_id = p_escuela_id
        AND cb.activo IS TRUE
    ),

    -- Una fila por concepto. Se calcula antes de unir aplicaciones para evitar
    -- que varios pagos de una misma nota multipliquen el denominador.
    ingreso_detalles AS (
      SELECT
        d.cuenta_cobrar_id AS cuenta_id,
        d.id AS detalle_id,
        COALESCE(ci.nombre, 'Otros Ingresos')::TEXT AS nombre,
        d.subtotal::NUMERIC AS subtotal,
        SUM(d.subtotal) OVER (PARTITION BY d.cuenta_cobrar_id)::NUMERIC AS total_detalle,
        ROW_NUMBER() OVER (PARTITION BY d.cuenta_cobrar_id ORDER BY d.id) AS posicion,
        COUNT(*) OVER (PARTITION BY d.cuenta_cobrar_id) AS cantidad_detalles
      FROM public.cxc_detalle d
      LEFT JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE d.escuela_id = p_escuela_id
        AND d.subtotal > 0
    ),
    egreso_detalles AS (
      SELECT
        d.cuenta_pagar_id AS cuenta_id,
        d.id AS detalle_id,
        COALESCE(ci.nombre, 'Otros Egresos')::TEXT AS nombre,
        d.subtotal::NUMERIC AS subtotal,
        SUM(d.subtotal) OVER (PARTITION BY d.cuenta_pagar_id)::NUMERIC AS total_detalle,
        ROW_NUMBER() OVER (PARTITION BY d.cuenta_pagar_id ORDER BY d.id) AS posicion,
        COUNT(*) OVER (PARTITION BY d.cuenta_pagar_id) AS cantidad_detalles
      FROM public.cxp_detalle d
      LEFT JOIN public.catalogo_items ci ON ci.id = d.catalogo_item_id
      WHERE d.escuela_id = p_escuela_id
        AND d.subtotal > 0
    ),

    -- Movimientos de caja. Las transferencias internas se descartan en ambos
    -- extremos antes de calcular el saldo previo y los totales del periodo.
    movimientos_raw AS (
      SELECT
        ('c:' || ca.id::TEXT) AS movimiento_id,
        ca.fecha::DATE AS fecha,
        ca.cuenta_cobrar_id AS cuenta_id,
        ca.monto_aplicado::NUMERIC AS importe_firmado,
        CASE WHEN ca.monto_aplicado >= 0 THEN 'ingreso' ELSE 'egreso' END::TEXT AS tipo,
        ABS(ca.monto_aplicado)::NUMERIC AS monto,
        COALESCE(cc.descripcion, 'Otros Ingresos')::TEXT AS nombre_fallback,
        'ingreso'::TEXT AS origen_detalle,
        (COALESCE(cc.descripcion, '') ~* '^\s*\[INGRESO TRF\]') AS es_transferencia,
        REGEXP_REPLACE(COALESCE(cc.descripcion, ''), '^\s*\[INGRESO TRF\]\s*', '', 'i') AS transferencia_clave
      FROM public.cobros_aplicados ca
      JOIN cajas_activas caja ON caja.id = ca.caja_id
      JOIN public.cuentas_cobrar cc
        ON cc.id = ca.cuenta_cobrar_id
       AND cc.escuela_id = p_escuela_id
      WHERE ca.escuela_id = p_escuela_id
        AND ca.monto_aplicado <> 0

      UNION ALL

      SELECT
        ('p:' || pa.id::TEXT) AS movimiento_id,
        pa.fecha::DATE AS fecha,
        pa.cuenta_pagar_id AS cuenta_id,
        -pa.monto_aplicado::NUMERIC AS importe_firmado,
        'egreso'::TEXT AS tipo,
        pa.monto_aplicado::NUMERIC AS monto,
        COALESCE(cp.descripcion, 'Otros Egresos')::TEXT AS nombre_fallback,
        'egreso'::TEXT AS origen_detalle,
        (COALESCE(cp.descripcion, '') ~* '^\s*\[EGRESO TRF\]') AS es_transferencia,
        REGEXP_REPLACE(COALESCE(cp.descripcion, ''), '^\s*\[EGRESO TRF\]\s*', '', 'i') AS transferencia_clave
      FROM public.pagos_aplicados pa
      JOIN cajas_activas caja ON caja.id = pa.caja_id
      JOIN public.cuentas_pagar cp
        ON cp.id = pa.cuenta_pagar_id
       AND cp.escuela_id = p_escuela_id
      WHERE pa.escuela_id = p_escuela_id
        AND pa.monto_aplicado > 0
    ),
    movimientos AS (
      SELECT m.*
      FROM movimientos_raw m
      WHERE NOT m.es_transferencia
         OR NOT EXISTS (
           SELECT 1
           FROM movimientos_raw contraparte
           WHERE contraparte.es_transferencia
             AND contraparte.origen_detalle <> m.origen_detalle
             AND contraparte.fecha = m.fecha
             AND contraparte.monto = m.monto
             AND LOWER(BTRIM(contraparte.transferencia_clave)) = LOWER(BTRIM(m.transferencia_clave))
         )
    ),

    saldo_anterior AS (
      SELECT COALESCE(SUM(m.importe_firmado), 0)::NUMERIC AS monto
      FROM movimientos m
      WHERE m.fecha < p_desde
    ),

    movimientos_periodo AS (
      SELECT m.*
      FROM movimientos m
      WHERE m.fecha BETWEEN p_desde AND p_hasta
    ),

    -- Distribucion con ajuste en la ultima linea: la suma de los conceptos de
    -- cada movimiento siempre conserva exactamente el monto original.
    distribucion_ingresos AS (
      SELECT
        m.movimiento_id,
        m.tipo,
        COALESCE(d.nombre, m.nombre_fallback) AS nombre,
        CASE
          WHEN d.detalle_id IS NULL OR d.total_detalle <= 0 THEN m.monto
          WHEN d.posicion < d.cantidad_detalles
            THEN ROUND(m.monto * d.subtotal / d.total_detalle, 2)
          ELSE m.monto - COALESCE(
            SUM(ROUND(m.monto * d.subtotal / d.total_detalle, 2))
              FILTER (WHERE d.posicion < d.cantidad_detalles)
              OVER (PARTITION BY m.movimiento_id),
            0
          )
        END::NUMERIC AS monto
      FROM movimientos_periodo m
      LEFT JOIN ingreso_detalles d ON d.cuenta_id = m.cuenta_id
      WHERE m.origen_detalle = 'ingreso'
    ),
    distribucion_egresos AS (
      SELECT
        m.movimiento_id,
        m.tipo,
        COALESCE(d.nombre, m.nombre_fallback) AS nombre,
        CASE
          WHEN d.detalle_id IS NULL OR d.total_detalle <= 0 THEN m.monto
          WHEN d.posicion < d.cantidad_detalles
            THEN ROUND(m.monto * d.subtotal / d.total_detalle, 2)
          ELSE m.monto - COALESCE(
            SUM(ROUND(m.monto * d.subtotal / d.total_detalle, 2))
              FILTER (WHERE d.posicion < d.cantidad_detalles)
              OVER (PARTITION BY m.movimiento_id),
            0
          )
        END::NUMERIC AS monto
      FROM movimientos_periodo m
      LEFT JOIN egreso_detalles d ON d.cuenta_id = m.cuenta_id
      WHERE m.origen_detalle = 'egreso'
    ),

    conceptos AS (
      SELECT tipo, nombre, monto FROM distribucion_ingresos
      UNION ALL
      SELECT tipo, nombre, monto FROM distribucion_egresos
      UNION ALL
      SELECT
        CASE WHEN sa.monto >= 0 THEN 'ingreso' ELSE 'egreso' END::TEXT,
        'Saldo inicial'::TEXT,
        ABS(sa.monto)::NUMERIC
      FROM saldo_anterior sa
      -- En Total (desde 1900) normalmente es cero y no se muestra.
      WHERE sa.monto <> 0
    ),
    agrupados AS (
      SELECT c.tipo, c.nombre, ROUND(SUM(c.monto), 2)::NUMERIC AS monto
      FROM conceptos c
      WHERE c.monto <> 0
      GROUP BY c.tipo, c.nombre
    ),
    con_totales AS (
      SELECT
        a.tipo,
        a.nombre,
        a.monto,
        SUM(a.monto) OVER (PARTITION BY a.tipo) AS total_tipo
      FROM agrupados a
    )
  SELECT
    ct.tipo,
    ct.nombre,
    ct.monto,
    ROUND(
      CASE WHEN ct.total_tipo > 0 THEN ct.monto / ct.total_tipo * 100 ELSE 0 END,
      2
    )::NUMERIC AS porcentaje
  FROM con_totales ct
  ORDER BY ct.tipo, ct.monto DESC, ct.nombre;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_resumen_financiero(UUID, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_resumen_financiero(UUID, DATE, DATE) TO authenticated;

COMMENT ON FUNCTION public.rpc_resumen_financiero(UUID, DATE, DATE) IS
  'Resume exclusivamente movimientos de cajas/bancos activas; excluye transferencias internas y arrastra el saldo anterior al periodo.';
