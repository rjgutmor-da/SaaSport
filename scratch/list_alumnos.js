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
  console.log("Signed in successfully. Fetching alumnos...");

  const { data: alumnos, error: errA } = await supabase
    .from('alumnos')
    .select('id, nombres, apellidos, escuela_id')
    .limit(100);
  
  if (errA) console.error("Error finding alumnos:", errA);
  else {
    console.log(`Total alumnos: ${alumnos.length}`);
    console.log("Alumnos:", alumnos);
  }
}

run();
