import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://uqrmmotcbnyazmadzfvd.supabase.co';
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVxcm1tb3RjYm55YXptYWR6ZnZkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MDEyODI2NCwiZXhwIjoyMDg1NzA0MjY0fQ.rcdIczkJN0dnfIL9XoCDgDq4V3Pczl8zrOPPWBC1BRE';

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("Querying table columns for cxc_detalle...");
  // We can query pg_attribute or information_schema.columns
  const { data: cols, error: errCols } = await supabase.rpc('rpc_execute_sql', {
    sql: `
      SELECT column_name, data_type, is_nullable, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'cxc_detalle' AND table_schema = 'public';
    `
  });

  if (errCols) {
    // If the RPC rpc_execute_sql doesn't exist, we can use a different method.
    console.error("Error with RPC:", errCols);
    
    // Let's try to query information_schema or other tables via PostgREST if permitted,
    // but PostgREST doesn't expose system catalogs unless we do it.
    // Let's print this error first.
  } else {
    console.log("Columns:", cols);
  }
}

run();
