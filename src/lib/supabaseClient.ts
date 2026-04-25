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

const CHUNK_SIZE = 3000;

/**
 * Storage personalizado usando js-cookie con fragmentación (chunking).
 * Permite guardar sesiones grandes dividiéndolas en múltiples cookies de 3KB.
 */
const cookieStorage = {
  getItem: (key: string): string | null => {
    const first = Cookies.get(key);
    if (!first) return null;
    if (!first.startsWith('chunk_0:')) return first;
    
    let result = '';
    let i = 0;
    while (true) {
      const chunk = Cookies.get(`${key}_chunk_${i}`);
      if (!chunk) break;
      result += chunk;
      i++;
    }
    return result || null;
  },
  setItem: (key: string, value: string): void => {
    const opts = {
      domain: '.saasport.pro',
      expires: 7,
      path: '/',
      sameSite: 'lax' as const,
      secure: true,
    };

    if (value.length <= CHUNK_SIZE) {
      Cookies.set(key, value, opts);
      return;
    }

    // Dividir en chunks
    const chunks = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }

    Cookies.set(key, `chunk_0:${chunks.length}`, opts);
    chunks.forEach((chunk, i) => {
      Cookies.set(`${key}_chunk_${i}`, chunk, opts);
    });
  },
  removeItem: (key: string): void => {
    const opts = { domain: '.saasport.pro', path: '/' };
    const first = Cookies.get(key);
    
    if (first?.startsWith('chunk_0:')) {
      const count = parseInt(first.split(':')[1]);
      for (let i = 0; i < count; i++) {
        Cookies.remove(`${key}_chunk_${i}`, opts);
      }
    }
    Cookies.remove(key, opts);
  },
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
