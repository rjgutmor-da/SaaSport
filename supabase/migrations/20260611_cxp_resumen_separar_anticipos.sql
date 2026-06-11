-- Separar deudas y anticipos en el resumen de CxP.
-- Antes: total_pendiente = SUM(saldo_pendiente) (restaba anticipos).
-- Ahora: total_pendiente = solo deudas (saldo > 0), total_anticipos = solo anticipos (saldo < 0).
CREATE OR REPLACE VIEW v_cxp_resumen AS
SELECT
    escuela_id,
    count(*) AS total_entidades,
    count(*) FILTER (WHERE saldo_pendiente > 0) AS con_deuda,
    COALESCE(sum(saldo_pendiente) FILTER (WHERE saldo_pendiente > 0), 0) AS total_pendiente,
    COALESCE(sum(saldo_pendiente) FILTER (WHERE saldo_pendiente < 0), 0) AS total_anticipos
FROM v_cxp_consolidado
GROUP BY escuela_id;
