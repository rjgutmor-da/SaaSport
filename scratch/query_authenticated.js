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
  console.log("Signing in...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: 'interstarsbolivia0@gmail.com',
    password: 'fred7102'
  });

  if (authError) {
    console.error("Auth error:", authError);
    return;
  }
  console.log("Signed in successfully as:", authData.user.email);

  // Now query
  const { data: alumnos, error: errA } = await supabase
    .from('alumnos')
    .select('id, nombres, apellidos')
    .or('nombres.ilike.%tarek%,apellidos.ilike.%tarek%');
  
  if (errA) console.error("Error finding alumno:", errA);
  else console.log("Alumnos found:", alumnos);

  if (alumnos && alumnos.length > 0) {
    const alumnoIds = alumnos.map(a => a.id);
    const { data: cxc, error: errCxc } = await supabase
      .from('cuentas_cobrar')
      .select('*, cxc_detalle(*, catalogo_items(*))')
      .in('alumno_id', alumnoIds);

    if (errCxc) console.error("Error finding cxc:", errCxc);
    else console.log("Cuentas por cobrar:", JSON.stringify(cxc, null, 2));

    const { data: cobros, error: errCobros } = await supabase
      .from('cobros_aplicados')
      .select('*, cuentas_cobrar(*), asientos_contables(*, movimientos_contables(*))')
      .in('cuenta_cobrar_id', cxc ? cxc.map(c => c.id) : []);
    
    if (errCobros) console.error("Error finding cobros:", errCobros);
    else console.log("Cobros aplicados:", JSON.stringify(cobros, null, 2));
  } else {
    // Let's search by document_referencia directly in cobros_aplicados
    const { data: cobros, error: errCobros } = await supabase
      .from('cobros_aplicados')
      .select('*, cuentas_cobrar(*, alumnos(*), cxc_detalle(*, catalogo_items(*))))')
      .eq('documento_referencia', '312193508');
    
    if (errCobros) console.error("Error in cobros:", errCobros);
    else console.log("Cobros by doc:", JSON.stringify(cobros, null, 2));
  }
}

run();
