import { obtenerClienteSupabaseAdmin } from '../scripts/config/cliente_supabase_admin.js';

const supabase = obtenerClienteSupabaseAdmin();

async function run() {
  console.log("Testing insert into cxc_detalle...");
  // Create a temporary cuentas_cobrar record first
  const { data: cxc, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
    escuela_id: '218ea007-49c4-4fa2-9e81-3b6663496f26',
    monto_total: 100,
    descripcion: 'Test Temp'
  }).select('id').single();

  if (errCxc) {
    console.error("Error creating cxc:", errCxc);
    return;
  }
  console.log("Created temp cxc:", cxc.id);

  // Now insert cxc_detalle without catalogo_item_id
  const { data: det, error: errDet } = await supabase.from('cxc_detalle').insert({
    escuela_id: '218ea007-49c4-4fa2-9e81-3b6663496f26',
    cuenta_cobrar_id: cxc.id,
    cantidad: 1,
    precio_unitario: 100
  }).select();

  if (errDet) {
    console.error("Error creating cxc_detalle:", errDet);
  } else {
    console.log("Inserted cxc_detalle:", det);
  }

  // Clean up
  console.log("Cleaning up temp cxc...");
  await supabase.from('cuentas_cobrar').delete().eq('id', cxc.id);
}

run();
