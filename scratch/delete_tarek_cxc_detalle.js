import { obtenerClienteSupabaseAdmin } from '../scripts/config/cliente_supabase_admin.js';

const supabase = obtenerClienteSupabaseAdmin();

async function run() {
  console.log("Deleting cxc_detalle for Tarek's anticipo...");
  const { data, error } = await supabase
    .from('cxc_detalle')
    .delete()
    .eq('cuenta_cobrar_id', 'f5c69dcf-e3dc-4bf0-a207-a7234b28bdef')
    .select();

  if (error) {
    console.error("Error deleting cxc_detalle:", error);
  } else {
    console.log("Deleted successfully:", data);
  }
}

run();
