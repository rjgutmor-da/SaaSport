-- Un Administrador ya puede editar una Nota de Servicio de su escuela.
-- Debe poder reemplazar también sus detalles; de lo contrario el frontend
-- insertaba nuevas líneas después de un DELETE bloqueado por RLS.
DROP POLICY IF EXISTS eliminar_cxcdet ON public.cxc_detalle;

CREATE POLICY eliminar_cxcdet_admin_escuela
  ON public.cxc_detalle
  FOR DELETE
  TO authenticated
  USING (
    (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador')
    AND escuela_id = (SELECT public.current_user_escuela_id())
  );

-- Reparación conservadora: elimina únicamente líneas repetidas cuando, al
-- conservar la primera de cada grupo idéntico, el detalle vuelve a coincidir
-- exactamente con el monto original de la nota. No modifica notas anuladas
-- ni líneas iguales que forman parte legítima de su total.
WITH detalles_ordenados AS (
  SELECT
    cd.id,
    cd.cuenta_cobrar_id,
    cd.catalogo_item_id,
    cd.cantidad,
    cd.precio_unitario,
    COALESCE(cd.periodo_meses, '[]'::jsonb) AS periodo_meses_key,
    COALESCE(NULLIF(cd.detalle_extra, ''), '') AS detalle_extra_key,
    cd.created_at,
    cd.cantidad * cd.precio_unitario AS importe,
    row_number() OVER (
      PARTITION BY
        cd.cuenta_cobrar_id,
        cd.catalogo_item_id,
        cd.cantidad,
        cd.precio_unitario,
        COALESCE(cd.periodo_meses, '[]'::jsonb),
        COALESCE(NULLIF(cd.detalle_extra, ''), '')
      ORDER BY cd.created_at, cd.id
    ) AS posicion
  FROM public.cxc_detalle cd
), resumen_notas AS (
  SELECT
    cc.id AS nota_id,
    cc.monto_total,
    SUM(d.importe) AS total_actual,
    SUM(CASE WHEN d.posicion = 1 THEN d.importe ELSE 0 END) AS total_corregido
  FROM public.cuentas_cobrar cc
  JOIN detalles_ordenados d ON d.cuenta_cobrar_id = cc.id
  WHERE NOT COALESCE(cc.anulada, false)
  GROUP BY cc.id, cc.monto_total
)
DELETE FROM public.cxc_detalle cd
USING detalles_ordenados d
JOIN resumen_notas r ON r.nota_id = d.cuenta_cobrar_id
WHERE cd.id = d.id
  AND d.posicion > 1
  AND r.total_actual > r.monto_total
  AND r.total_corregido = r.monto_total;
