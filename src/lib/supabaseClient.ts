/**
 * Cliente Supabase para SaaSport
 * Comparte la misma instancia de base de datos que AsiSport (MVP).
 * Las credenciales se leen desde variables de entorno (.env).
 */
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '⚠️ Variables de entorno de Supabase no encontradas.\n' +
    'Asegúrate de tener un archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY'
  )
}

/**
 * Storage personalizado para compartir la sesión entre subdominios.
 * Guarda la sesión en una cookie en el dominio raíz (.saasport.pro).
 */
const isBrowser = typeof document !== 'undefined';
const domain = '.saasport.pro';

const cookieStorage = {
  getItem: (key: string) => {
    if (!isBrowser) return null;
    const name = `${key}=`;
    const decodedCookie = decodeURIComponent(document.cookie);
    const ca = decodedCookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i].trim();
      if (c.indexOf(name) === 0) {
        return c.substring(name.length, c.length);
      }
    }
    return null;
  },
  setItem: (key: string, value: string) => {
    if (!isBrowser) return;
    // Expira en 1 año
    const d = new Date();
    d.setTime(d.getTime() + (365 * 24 * 60 * 60 * 1000));
    const expires = "expires=" + d.toUTCString();
    document.cookie = `${key}=${value};${expires};domain=${domain};path=/;SameSite=Lax;Secure`;
  },
  removeItem: (key: string) => {
    if (!isBrowser) return;
    document.cookie = `${key}=;expires=Thu, 01 Jan 1970 00:00:00 UTC;domain=${domain};path=/;SameSite=Lax;Secure`;
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: cookieStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    flowType: 'pkce'
  }
})
