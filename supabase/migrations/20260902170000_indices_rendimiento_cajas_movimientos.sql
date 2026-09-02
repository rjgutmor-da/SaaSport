-- ==============================================================================
-- Migración: Índices de rendimiento para movimientos de Caja y Bancos
-- Evita escaneo completo de tablas y timeouts en PostgREST al ordenar por fecha
-- ==============================================================================

-- 1. Índice compuesto para cobros_aplicados por caja y fecha descendente
CREATE INDEX IF NOT EXISTS idx_cobros_caja_fecha_desc 
ON public.cobros_aplicados (caja_id, fecha DESC, created_at DESC);

-- 2. Índice compuesto para pagos_aplicados por caja y fecha descendente
CREATE INDEX IF NOT EXISTS idx_pagos_caja_fecha_desc 
ON public.pagos_aplicados (caja_id, fecha DESC, created_at DESC);
