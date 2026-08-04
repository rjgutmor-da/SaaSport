import { obtenerClienteSupabaseAdmin } from '../scripts/config/cliente_supabase_admin.js';

const supabase = obtenerClienteSupabaseAdmin();

async function run() {
  const cxcIds = [
    "48d5b721-a9e8-4b9e-a25d-46e7bbd78d88",
    "d3dc8e75-9074-4a1f-954e-06c92e121359",
    "bc7a024f-e6a7-43bb-9acb-67b954f8ee61",
    "f2466b28-b426-41ae-9139-c27ae018df0a",
    "f5c69dcf-e3dc-4bf0-a207-a7234b28bdef"
  ];

  console.log("Querying cobros_aplicados for cxcIds...");
  const { data: cobros, error } = await supabase
    .from('cobros_aplicados')
    .select('*')
    .in('cuenta_cobrar_id', cxcIds);

  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Cobros aplicados:", cobros);
  }
}

run();
