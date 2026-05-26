import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uqrmmotcbnyazmadzfvd.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcm1tb3RjYm55YXptYWR6ZnZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDEyODI2NCwiZXhwIjoyMDg1NzA0MjY0fQ.rcdIczkJN0dnfIL9XoCDgDq4V3Pczl8zrOPPWBC1BRE';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("Updating cxc_detalle for Tarek's anticipo...");
  const { data, error } = await supabase
    .from('cxc_detalle')
    .update({ catalogo_item_id: null })
    .eq('cuenta_cobrar_id', 'f5c69dcf-e3dc-4bf0-a207-a7234b28bdef')
    .select();

  if (error) {
    console.error("Error updating cxc_detalle:", error);
  } else {
    console.log("Updated successfully:", data);
  }
}

run();
