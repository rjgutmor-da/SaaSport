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

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
