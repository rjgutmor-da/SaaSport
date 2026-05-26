import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

// Parse .env
const envText = fs.readFileSync('.env', 'utf-8');
const env = {};
envText.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

console.log("Supabase URL:", supabaseUrl);

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: alumnos, error: errA } = await supabase
    .from('alumnos')
    .select('id, nombres, apellidos')
    .or('nombres.ilike.%tarek%,apellidos.ilike.%tarek%');
  
  if (errA) {
    console.error("Error finding alumno:", errA);
    return;
  }
  console.log("Alumnos found:", alumnos);

  if (alumnos.length === 0) return;
  const alumnoIds = alumnos.map(a => a.id);

  // Find all accounts receivable (cuentas_cobrar) for these students
  const { data: cxc, error: errCxc } = await supabase
    .from('cuentas_cobrar')
    .select('*, cxc_detalle(*, catalogo_items(*))')
    .in('alumno_id', alumnoIds);

  if (errCxc) {
    console.error("Error finding cxc:", errCxc);
    return;
  }
  console.log("Cuentas por cobrar:");
  console.dir(cxc, { depth: null });

  // Find all cobros aplicados and their related items
  const { data: cobros, error: errCobros } = await supabase
    .from('cobros_aplicados')
    .select('*, asientos_contables(*, movimientos_contables(*))')
    .in('cuenta_cobrar_id', cxc.map(c => c.id));
    
  if (errCobros) {
    console.error("Error finding cobros:", errCobros);
    return;
  }
  console.log("Cobros aplicados:");
  console.dir(cobros, { depth: null });
}

run();
