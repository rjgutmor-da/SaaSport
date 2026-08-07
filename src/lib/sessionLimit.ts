import type { Session } from '@supabase/supabase-js';

const APP = 'saasport' as const;
const DEVICE_ID_KEY = 'saasport-device-id';

const getDeviceId = (): string => {
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const generated = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  window.localStorage.setItem(DEVICE_ID_KEY, generated);
  return generated;
};

const getDeviceLabel = (): string => {
  const browser = navigator.userAgent.includes('Edg') ? 'Edge'
    : navigator.userAgent.includes('Chrome') ? 'Chrome'
      : navigator.userAgent.includes('Firefox') ? 'Firefox' : 'Navegador';
  const platform = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 'móvil' : 'computadora';
  return `${browser} · ${platform}`;
};

const callFunction = async (path: string, session: Session, body: Record<string, string>) => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.reason === 'session_revoked'
      ? 'Esta sesión de SaaSport ya no está activa en este dispositivo.'
      : payload?.reason === 'application_not_allowed'
        ? 'Tu rol no tiene acceso a SaaSport.'
        : payload?.error || 'No se pudo validar la sesión de SaaSport.');
  }
  return payload;
};

export async function registerCurrentSaaSportSession(session: Session): Promise<void> {
  await callFunction('session-gate', session, {
    application: APP,
    deviceId: getDeviceId(),
    deviceLabel: getDeviceLabel(),
  });
}

export async function signInSaaSport(email: string, password: string) {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/login-proxy`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password, application: APP, deviceId: getDeviceId(), deviceLabel: getDeviceLabel() }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.session) throw new Error(payload?.error || 'Error al iniciar sesión.');
  return payload.session;
}
