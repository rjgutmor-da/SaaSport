-- ==============================================================================
-- MIGRACIÓN: PERMITIR DESACTIVAR ENTRENADORES DIRECTAMENTE
-- Fecha: 2026-09-03
-- Descripción:
--   La migración 20260828214000_drop_rpc_reasignar_entrenador.sql eliminó la RPC
--   rpc_reasignar_y_desactivar_entrenador porque la asignación se gestiona
--   ahora mediante la configuración de grupos.
--   Sin embargo, la función trigger proteger_campos_sensibles_usuario mantenía
--   una comprobación estricta de app.reasignacion_entrenador = 'true' que impedía
--   desactivar usuarios con rol 'Entrenador'.
--   Esta migración actualiza la función para permitir la desactivación,
--   manteniendo la protección sobre la propia cuenta y revocando sesiones activas.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.proteger_campos_sensibles_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Un usuario autenticado no puede modificar sus propios permisos, estado ni alcance
  IF auth.uid() = OLD.id
     AND (
       OLD.rol IS DISTINCT FROM NEW.rol
       OR OLD.activo IS DISTINCT FROM NEW.activo
       OR OLD.escuela_id IS DISTINCT FROM NEW.escuela_id
       OR OLD.sucursal_id IS DISTINCT FROM NEW.sucursal_id
     ) THEN
    RAISE EXCEPTION 'No puedes modificar los permisos, estado o alcance de tu propia cuenta.'
      USING ERRCODE = '42501';
  END IF;

  -- Si el usuario es desactivado, revocar sus sesiones activas
  IF OLD.activo IS TRUE AND NEW.activo IS FALSE THEN
    UPDATE public.user_app_sessions
    SET revoked_at = now(),
        revoked_reason = 'usuario_desactivado'
    WHERE user_id = NEW.id
      AND revoked_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
