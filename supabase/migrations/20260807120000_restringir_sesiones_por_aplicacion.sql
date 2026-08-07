-- Copia canónica de la migración compartida del límite de sesiones.
-- Se aplica una sola vez al proyecto Supabase; este archivo mantiene ambos repos sincronizados.

CREATE TABLE IF NOT EXISTS public.user_app_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  application text NOT NULL CHECK (application IN ('asisport', 'saasport')),
  session_id uuid NOT NULL,
  device_id text NOT NULL,
  device_label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  UNIQUE (user_id, application, session_id)
);

CREATE INDEX IF NOT EXISTS idx_user_app_sessions_active
  ON public.user_app_sessions (user_id, application, revoked_at, last_seen_at);

ALTER TABLE public.user_app_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_app_sessions_select_own_or_school_admin" ON public.user_app_sessions;
CREATE POLICY "user_app_sessions_select_own_or_school_admin"
  ON public.user_app_sessions FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid()) OR EXISTS (
      SELECT 1 FROM public.usuarios actor
      JOIN public.usuarios target ON target.id = user_app_sessions.user_id
      WHERE actor.id = (SELECT auth.uid())
        AND actor.rol IN ('SuperAdministrador', 'Administrador')
        AND actor.escuela_id = target.escuela_id
    )
  );

REVOKE UPDATE ON public.user_app_sessions FROM authenticated;
GRANT SELECT ON public.user_app_sessions TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_register_login_session(
  p_user_id uuid, p_session_id uuid, p_application text,
  p_device_id text, p_device_label text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role text;
  v_existing public.user_app_sessions%ROWTYPE;
  v_active_count integer;
  v_revoked_session uuid;
BEGIN
  IF p_application NOT IN ('asisport', 'saasport') OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_request');
  END IF;
  SELECT rol INTO v_role FROM public.usuarios
    WHERE id = p_user_id AND activo = true FOR UPDATE;
  IF v_role IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive_or_missing_user');
  END IF;
  IF p_application = 'saasport'
     AND v_role NOT IN ('SuperAdministrador', 'Administrador', 'Asistente') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'application_not_allowed');
  END IF;
  SELECT * INTO v_existing FROM public.user_app_sessions
    WHERE user_id = p_user_id AND application = p_application
      AND session_id = p_session_id FOR UPDATE;
  IF v_existing.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_revoked');
  END IF;
  IF v_existing.id IS NULL THEN
    INSERT INTO public.user_app_sessions (user_id, application, session_id, device_id, device_label)
    VALUES (p_user_id, p_application, p_session_id,
      COALESCE(NULLIF(p_device_id, ''), 'unknown-device'), NULLIF(p_device_label, ''));
  ELSE
    UPDATE public.user_app_sessions SET last_seen_at = now(),
      device_id = COALESCE(NULLIF(p_device_id, ''), device_id),
      device_label = COALESCE(NULLIF(p_device_label, ''), device_label)
      WHERE id = v_existing.id;
  END IF;
  SELECT count(*)::integer INTO v_active_count FROM public.user_app_sessions
    WHERE user_id = p_user_id AND application = p_application AND revoked_at IS NULL;
  IF v_active_count > 2 THEN
    UPDATE public.user_app_sessions SET revoked_at = now(), revoked_reason = 'replaced_by_newer_session'
      WHERE id = (SELECT id FROM public.user_app_sessions
        WHERE user_id = p_user_id AND application = p_application
          AND session_id <> p_session_id AND revoked_at IS NULL
        ORDER BY last_seen_at ASC, created_at ASC LIMIT 1)
      RETURNING session_id INTO v_revoked_session;
  END IF;
  UPDATE public.user_app_sessions SET last_seen_at = now()
    WHERE user_id = p_user_id AND application = p_application
      AND session_id = p_session_id AND revoked_at IS NULL;
  RETURN jsonb_build_object('ok', true, 'application', p_application,
    'revoked_session_id', v_revoked_session);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_register_login_session(uuid, uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_register_login_session(uuid, uuid, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rpc_revoke_user_app_session(p_session_row_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_app_sessions target
    WHERE target.id = p_session_row_id
      AND (target.user_id = auth.uid() OR EXISTS (
        SELECT 1 FROM public.usuarios actor
        JOIN public.usuarios owner ON owner.id = target.user_id
        WHERE actor.id = auth.uid()
          AND actor.rol IN ('SuperAdministrador', 'Administrador')
          AND actor.escuela_id = owner.escuela_id
      ))
  ) THEN RETURN false; END IF;
  UPDATE public.user_app_sessions SET revoked_at = COALESCE(revoked_at, now()),
    revoked_reason = COALESCE(revoked_reason, 'revoked_by_user_or_admin')
    WHERE id = p_session_row_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.rpc_revoke_user_app_session(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_guard_active_app_session()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_claims jsonb; v_user_id uuid; v_session_id uuid;
BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims IS NULL OR COALESCE(v_claims->>'role', 'anon') <> 'authenticated' THEN RETURN; END IF;
  v_user_id := NULLIF(v_claims->>'sub', '')::uuid;
  v_session_id := NULLIF(v_claims->>'session_id', '')::uuid;
  IF v_user_id IS NULL OR v_session_id IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.user_app_sessions
      WHERE user_id = v_user_id AND session_id = v_session_id AND revoked_at IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM public.user_app_sessions
      WHERE user_id = v_user_id AND session_id = v_session_id AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'La sesión de este dispositivo ya no está activa.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.user_app_sessions SET last_seen_at = now()
    WHERE user_id = v_user_id AND session_id = v_session_id AND revoked_at IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.fn_guard_active_app_session() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_guard_active_app_session() TO authenticator;
ALTER ROLE authenticator SET pgrst.db_pre_request = 'public.fn_guard_active_app_session';
NOTIFY pgrst, 'reload config';
