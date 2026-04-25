/**
 * Cliente Supabase para SaaSport
 * Comparte la misma instancia de base de datos que AsiSport (MVP).
 * Las credenciales se leen desde variables de entorno (.env).
 */
import { createClient } from '@supabase/supabase-js'
import Cookies from 'js-cookie'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    '⚠️ Variables de entorno de Supabase no encontradas.\n' +
    'Asegúrate de tener un archivo .env con VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY'
  )
}

/**
 * Storage personalizado usando js-cookie para compartir la sesión entre subdominios (.saasport.pro).
 */
const cookieStorage = {
  getItem: (key: string) => {
    return Cookies.get(key) || null;
  },
  setItem: (key: string, value: string) => {
    Cookies.set(key, value, {
      expires: 365,
      domain: '.saasport.pro',
      path: '/',
      sameSite: 'lax',
      secure: true
    });
  },
  removeItem: (key: string) => {
    Cookies.remove(key, { domain: '.saasport.pro', path: '/' });
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
