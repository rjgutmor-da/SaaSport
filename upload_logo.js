import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function uploadLogo() {
  try {
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: 'interstarsbolivia0@gmail.com',
      password: 'fred7102'
    });
    if (authError) throw authError;

    const fileContent = fs.readFileSync('public/logo-interstars.png');
    const fileName = `logos_escuelas/logo_fundacion_interstars_${Date.now()}.png`;

    const { data, error } = await supabase.storage
      .from('avatars')
      .upload(fileName, fileContent, {
        contentType: 'image/png',
        upsert: true
      });

    if (error) {
      console.error("Upload Error:", error);
      return;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('avatars')
      .getPublicUrl(fileName);

    console.log("Uploaded successfully. Public URL:", publicUrl);

    // Update database
    const { error: dbError } = await supabase
      .from('escuelas')
      .update({ logo_url: publicUrl })
      .eq('nombre', 'Fundación Inter Stars');

    if (dbError) {
      console.error("DB Update Error:", dbError);
    } else {
      console.log("Database updated successfully.");
    }
  } catch (err) {
    console.error("Script Error:", err);
  }
}

uploadLogo();
