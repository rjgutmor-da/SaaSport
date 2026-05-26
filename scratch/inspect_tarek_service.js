import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabaseUrl = 'https://uqrmmotcbnyazmadzfvd.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcm1tb3RjYm55YXptYWR6ZnZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDEyODI2NCwiZXhwIjoyMDg1NzA0MjY0fQ.rcdIczkJN0dnfIL9XoCDgDq4V3Pczl8zrOPPWBC1BRE';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  const result = {};

  const { data: alumnos } = await supabase
    .from('alumnos')
    .select('*')
    .or('nombres.ilike.%tarek%,apellidos.ilike.%tarek%');

  result.alumnos = alumnos;

  if (alumnos && alumnos.length > 0) {
    const alumnoId = alumnos[0].id;
    const escuelaId = alumnos[0].escuela_id;

    // 1. Fetch cuentas_cobrar
    const { data: cxcs } = await supabase
      .from('cuentas_cobrar')
      .select('*')
      .eq('alumno_id', alumnoId);
    result.cxcs = cxcs;

    // 2. Fetch cxc_detalle
    if (cxcs && cxcs.length > 0) {
      const cxcIds = cxcs.map(c => c.id);
      const { data: detalles } = await supabase
        .from('cxc_detalle')
        .select('*, catalogo_items(*)')
        .in('cuenta_cobrar_id', cxcIds);
      result.detalles = detalles;

      const { data: cobros } = await supabase
        .from('cobros_aplicados')
        .select('*, asientos_contables(*, movimientos_contables(*))')
        .in('cuenta_cobrar_id', cxcIds);
      result.cobros = cobros;
    }

    // 3. Fetch catalog
    const { data: catalogo } = await supabase
      .from('catalogo_items')
      .select('*')
      .eq('escuela_id', escuelaId);
    result.catalogo = catalogo;
  }

  fs.writeFileSync('scratch/tarek_output.json', JSON.stringify(result, null, 2));
  console.log("Written output to scratch/tarek_output.json");
}

run();
