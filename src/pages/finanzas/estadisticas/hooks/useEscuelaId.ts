/**
 * useEscuelaId.ts
 * Hook que obtiene el escuela_id del usuario actualmente autenticado en Supabase.
 * Se usa en múltiples hooks del módulo de Estadísticas para filtrar los datos.
 */
import { useState, useEffect } from 'react';
import { supabase } from '../../../../lib/supabaseClient';

export function useEscuelaId() {
  const [escuelaId, setEscuelaId] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setCargando(false); return; }
      const { data } = await supabase
        .from('usuarios')
        .select('escuela_id')
        .eq('id', user.id)
        .single();
      setEscuelaId(data?.escuela_id ?? null);
      setCargando(false);
    };
    cargar();
  }, []);

  return { escuelaId, cargando };
}
