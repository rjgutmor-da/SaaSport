-- ============================================================================
-- SaaSport: trazabilidad confiable de movimientos financieros
--
-- El usuario se toma de auth.uid() en la base de datos, no del nombre enviado
-- por el navegador. Las filas anteriores pueden quedar sin usuario porque no
-- existe evidencia suficiente para atribuirlas retroactivamente.
-- ============================================================================

BEGIN;

ALTER TABLE public.cobros_aplicados
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editado_at TIMESTAMPTZ;

ALTER TABLE public.pagos_aplicados
  ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES public.usuarios(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS editado_at TIMESTAMPTZ;

COMMENT ON COLUMN public.cobros_aplicados.usuario_id IS
  'Usuario autenticado que registró el cobro; NULL únicamente identifica registros históricos sin trazabilidad.';
COMMENT ON COLUMN public.cobros_aplicados.editado_por IS
  'Usuario autenticado que realizó la última edición del cobro.';
COMMENT ON COLUMN public.pagos_aplicados.usuario_id IS
  'Usuario autenticado que registró el pago; NULL únicamente identifica registros históricos sin trazabilidad.';
COMMENT ON COLUMN public.pagos_aplicados.editado_por IS
  'Usuario autenticado que realizó la última edición del pago.';

CREATE INDEX IF NOT EXISTS idx_cobros_aplicados_usuario_id
  ON public.cobros_aplicados(usuario_id);
CREATE INDEX IF NOT EXISTS idx_pagos_aplicados_usuario_id
  ON public.pagos_aplicados(usuario_id);

-- Backfill conservador: solo atribuye un movimiento cuando existe una única
-- auditoría previa con la misma nota, monto y creación prácticamente simultánea.
WITH candidatos AS (
  SELECT
    ca.id,
    al.usuario_id,
    COUNT(*) OVER (PARTITION BY ca.id) AS coincidencias
  FROM public.cobros_aplicados ca
  JOIN public.audit_log al
    ON al.entidad_id = ca.cuenta_cobrar_id::TEXT
   AND al.modulo = 'cxc'
   AND al.accion = 'cobro'
   AND (al.detalle->>'monto')::NUMERIC = ca.monto_aplicado
   AND ABS(EXTRACT(EPOCH FROM (al.created_at - ca.created_at))) <= 120
  WHERE ca.usuario_id IS NULL
    AND al.usuario_id IS NOT NULL
)
UPDATE public.cobros_aplicados ca
SET usuario_id = c.usuario_id
FROM candidatos c
WHERE ca.id = c.id
  AND c.coincidencias = 1;

WITH candidatos AS (
  SELECT
    pa.id,
    al.usuario_id,
    COUNT(*) OVER (PARTITION BY pa.id) AS coincidencias
  FROM public.pagos_aplicados pa
  JOIN public.audit_log al
    ON al.entidad_id = pa.cuenta_pagar_id::TEXT
   AND al.modulo = 'cxp'
   AND al.accion = 'pago'
   AND (al.detalle->>'monto')::NUMERIC = pa.monto_aplicado
   AND ABS(EXTRACT(EPOCH FROM (al.created_at - pa.created_at))) <= 120
  WHERE pa.usuario_id IS NULL
    AND al.usuario_id IS NOT NULL
)
UPDATE public.pagos_aplicados pa
SET usuario_id = c.usuario_id
FROM candidatos c
WHERE pa.id = c.id
  AND c.coincidencias = 1;

-- Nunca aceptar desde el cliente un usuario distinto al autenticado.
CREATE OR REPLACE FUNCTION public.fn_finanzas_stamp_actor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No se puede registrar un movimiento financiero sin usuario autenticado.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.usuario_id := v_actor;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.editado_por := v_actor;
    NEW.editado_at := NOW();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finanzas_stamp_actor_cobros ON public.cobros_aplicados;
CREATE TRIGGER trg_finanzas_stamp_actor_cobros
BEFORE INSERT OR UPDATE ON public.cobros_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_finanzas_stamp_actor();

DROP TRIGGER IF EXISTS trg_finanzas_stamp_actor_pagos ON public.pagos_aplicados;
CREATE TRIGGER trg_finanzas_stamp_actor_pagos
BEFORE INSERT OR UPDATE ON public.pagos_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_finanzas_stamp_actor();

-- Auditoría canónica de INSERT/UPDATE/DELETE con snapshot antes/después.
CREATE OR REPLACE FUNCTION public.fn_finanzas_auditar_movimiento()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old JSONB;
  v_new JSONB;
  v_row JSONB;
  v_actor UUID;
  v_actor_nombre TEXT;
  v_escuela_id UUID;
  v_parent_id UUID;
  v_alumno_id UUID;
  v_caja_id UUID;
  v_accion TEXT;
  v_modulo TEXT;
  v_monto NUMERIC;
  v_fecha TIMESTAMPTZ;
  v_referencia TEXT;
  v_es_aplicacion_anticipo BOOLEAN;
  v_alumno_nombre TEXT;
  v_caja_nombre TEXT;
BEGIN
  v_old := CASE WHEN TG_OP <> 'INSERT' THEN TO_JSONB(OLD) ELSE NULL END;
  v_new := CASE WHEN TG_OP <> 'DELETE' THEN TO_JSONB(NEW) ELSE NULL END;
  v_row := COALESCE(v_new, v_old);

  v_escuela_id := (v_row->>'escuela_id')::UUID;
  v_parent_id := CASE
    WHEN TG_TABLE_NAME = 'cobros_aplicados' THEN (v_row->>'cuenta_cobrar_id')::UUID
    ELSE (v_row->>'cuenta_pagar_id')::UUID
  END;
  v_alumno_id := CASE
    WHEN TG_TABLE_NAME = 'cobros_aplicados'
      THEN (SELECT alumno_id FROM public.cuentas_cobrar WHERE id = v_parent_id)
    ELSE NULL
  END;
  v_caja_id := (v_row->>'caja_id')::UUID;
  v_monto := (v_row->>'monto_aplicado')::NUMERIC;
  v_fecha := (v_row->>'fecha')::TIMESTAMPTZ;
  v_referencia := COALESCE(v_row->>'documento_referencia', v_row->>'referencia');
  v_es_aplicacion_anticipo := COALESCE((v_row->>'es_aplicacion_anticipo')::BOOLEAN, FALSE);
  v_modulo := CASE WHEN TG_TABLE_NAME = 'cobros_aplicados' THEN 'cxc' ELSE 'cxp' END;

  v_actor := CASE
    WHEN TG_OP = 'INSERT' THEN (v_new->>'usuario_id')::UUID
    WHEN TG_OP = 'UPDATE' THEN (v_new->>'editado_por')::UUID
    ELSE auth.uid()
  END;

  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No se puede auditar un movimiento financiero sin usuario autenticado.';
  END IF;

  SELECT NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellidos)), '')
  INTO v_actor_nombre
  FROM public.usuarios u
  WHERE u.id = v_actor
    AND u.escuela_id = v_escuela_id;

  IF v_actor_nombre IS NULL THEN
    RAISE EXCEPTION 'El usuario % no tiene un perfil válido en la escuela %.', v_actor, v_escuela_id;
  END IF;

  SELECT NULLIF(TRIM(CONCAT_WS(' ', a.nombres, a.apellidos)), '')
  INTO v_alumno_nombre
  FROM public.alumnos a
  WHERE a.id = v_alumno_id;

  SELECT cb.nombre
  INTO v_caja_nombre
  FROM public.cajas_bancos cb
  WHERE cb.id = v_caja_id;

  IF TG_OP = 'INSERT' THEN
    v_accion := CASE WHEN TG_TABLE_NAME = 'cobros_aplicados'
      THEN 'movimiento_cobro_registrado' ELSE 'movimiento_pago_registrado' END;
  ELSIF TG_OP = 'DELETE' THEN
    v_accion := CASE WHEN TG_TABLE_NAME = 'cobros_aplicados'
      THEN 'movimiento_cobro_eliminado' ELSE 'movimiento_pago_eliminado' END;
  ELSIF (v_new->>'conciliado') IS DISTINCT FROM (v_old->>'conciliado')
    AND (v_new - 'conciliado' - 'editado_por' - 'editado_at')
        = (v_old - 'conciliado' - 'editado_por' - 'editado_at') THEN
    v_accion := 'movimiento_conciliacion_cambiada';
  ELSE
    v_accion := CASE WHEN TG_TABLE_NAME = 'cobros_aplicados'
      THEN 'movimiento_cobro_editado' ELSE 'movimiento_pago_editado' END;
  END IF;

  INSERT INTO public.audit_log (
    escuela_id, usuario_id, usuario_nombre, accion, modulo, entidad_id, detalle, ip_address
  ) VALUES (
    v_escuela_id,
    v_actor,
    v_actor_nombre,
    v_accion,
    v_modulo,
    COALESCE(v_row->>'id', v_parent_id::TEXT),
    jsonb_build_object(
      'tabla', TG_TABLE_NAME,
      'operacion', TG_OP,
      'movimiento_id', v_row->>'id',
      'cuenta_id', v_parent_id,
      'alumno_id', v_alumno_id,
      'alumno', v_alumno_nombre,
      'monto', v_monto,
      'fecha_movimiento', v_fecha,
      'caja_id', v_caja_id,
      'caja', v_caja_nombre,
      'referencia', v_referencia,
      'es_aplicacion_anticipo', v_es_aplicacion_anticipo,
      'registrado_por', CASE WHEN TG_OP <> 'DELETE' THEN v_new->>'usuario_id' ELSE v_old->>'usuario_id' END,
      'editado_por', CASE WHEN TG_OP <> 'INSERT' THEN v_new->>'editado_por' ELSE NULL END,
      'antes', v_old,
      'despues', v_new
    ),
    'SaaSport:database'
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finanzas_auditar_cobros ON public.cobros_aplicados;
CREATE TRIGGER trg_finanzas_auditar_cobros
AFTER INSERT OR UPDATE OR DELETE ON public.cobros_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_finanzas_auditar_movimiento();

DROP TRIGGER IF EXISTS trg_finanzas_auditar_pagos ON public.pagos_aplicados;
CREATE TRIGGER trg_finanzas_auditar_pagos
AFTER INSERT OR UPDATE OR DELETE ON public.pagos_aplicados
FOR EACH ROW EXECUTE FUNCTION public.fn_finanzas_auditar_movimiento();

-- Normaliza las auditorías creadas desde frontend: el nombre proviene del
-- perfil de la base y no de un payload manipulable.
CREATE OR REPLACE FUNCTION public.fn_finanzas_normalizar_actor_auditoria()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_nombre TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'No se puede crear una auditoría sin usuario autenticado.';
  END IF;

  SELECT NULLIF(TRIM(CONCAT_WS(' ', u.nombres, u.apellidos)), '')
  INTO v_nombre
  FROM public.usuarios u
  WHERE u.id = v_actor
    AND u.escuela_id = NEW.escuela_id;

  IF v_nombre IS NULL THEN
    RAISE EXCEPTION 'El usuario % no tiene un perfil válido para esta auditoría.', v_actor;
  END IF;

  NEW.usuario_id := v_actor;
  NEW.usuario_nombre := v_nombre;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_finanzas_normalizar_actor_auditoria ON public.audit_log;
CREATE TRIGGER trg_finanzas_normalizar_actor_auditoria
BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION public.fn_finanzas_normalizar_actor_auditoria();

COMMIT;
