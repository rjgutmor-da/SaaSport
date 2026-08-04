import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Obtener el directorio raíz del proyecto SaaSport
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../');

/**
 * Carga de forma segura las variables de entorno desde un archivo .env si existe.
 */
function cargarArchivoEnv(nombreArchivo) {
  const rutaEnv = path.join(projectRoot, nombreArchivo);
  if (!fs.existsSync(rutaEnv)) return;

  const contenido = fs.readFileSync(rutaEnv, 'utf8');
  for (const linea of contenido.split(/\r?\n/)) {
    const lineaLimpia = linea.trim();
    if (!lineaLimpia || lineaLimpia.startsWith('#')) continue;

    const indiceIgual = lineaLimpia.indexOf('=');
    if (indiceIgual > -1) {
      const clave = lineaLimpia.substring(0, indiceIgual).trim();
      let valor = lineaLimpia.substring(indiceIgual + 1).trim();

      if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
        valor = valor.slice(1, -1);
      }

      if (!process.env[clave]) {
        process.env[clave] = valor;
      }
    }
  }
}

// Cargar variables de entorno en orden de prioridad
cargarArchivoEnv('.env.admin');
cargarArchivoEnv('.env.local');
cargarArchivoEnv('.env');

const urlSupabase = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://uqrmmotcbnyazmadzfvd.supabase.co';
const claveServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!claveServiceRole) {
  console.warn('[Seguridad SaaSport] Advertencia: SUPABASE_SERVICE_ROLE_KEY no encontrada en .env.admin ni en process.env');
}

/**
 * Cliente Supabase Administrativo (bypassea RLS).
 */
export const supabaseAdmin = createClient(
  urlSupabase,
  claveServiceRole || 'CLAVE_NO_CONFIGURADA',
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

/**
 * Retorna el cliente administrativo asegurando que la clave esté presente.
 */
export function obtenerClienteSupabaseAdmin() {
  if (!claveServiceRole) {
    throw new Error('[Seguridad SaaSport] Error: No se ha provisto SUPABASE_SERVICE_ROLE_KEY en .env.admin ni en las variables de entorno.');
  }
  return supabaseAdmin;
}

export default supabaseAdmin;
