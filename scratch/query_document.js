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

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Searching in cobros_aplicados where documento_referencia is '312193508'...");
  const { data: cobros, error: errCobros } = await supabase
    .from('cobros_aplicados')
    .select('*, cuentas_cobrar(*, alumnos(*), cxc_detalle(*, catalogo_items(*))))')
    .eq('documento_referencia', '312193508');
  
  if (errCobros) console.error("Error in cobros:", errCobros);
  else console.log("Cobros:", JSON.stringify(cobros, null, 2));

  console.log("Searching in cuentas_cobrar where descripcion contains '312193508' or similar...");
  const { data: cxc, error: errCxc } = await supabase
    .from('cuentas_cobrar')
    .select('*, alumnos(*), cxc_detalle(*, catalogo_items(*))')
    .or('descripcion.ilike.%312193508%');
  
  if (errCxc) console.error("Error in cxc:", errCxc);
  else console.log("CxC by description:", JSON.stringify(cxc, null, 2));
}

run();
