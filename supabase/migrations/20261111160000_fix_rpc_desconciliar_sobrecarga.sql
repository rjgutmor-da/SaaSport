-- ==============================================================================
-- SaaSport: Corrección de ambigüedad por sobrecarga en rpc_desconciliar_desde_fecha
-- ==============================================================================

-- Eliminar la firma anterior de 3 parámetros para que no choque con la de 5 parámetros con valores por defecto.
DROP FUNCTION IF EXISTS public.rpc_desconciliar_desde_fecha(UUID, TIMESTAMPTZ, TEXT);
