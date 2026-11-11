import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export const configuracionCobranzaKey = (escuelaId: string | null) =>
  ['configuracion-cobranza', escuelaId] as const;

export const useConfiguracionCobranza = (escuelaId: string | null, enabled = true) => useQuery({
  queryKey: configuracionCobranzaKey(escuelaId),
  queryFn: async (): Promise<string | null> => {
    const { data, error } = await supabase.from('configuracion_cobranza')
      .select('parrafo_final').eq('escuela_id', escuelaId!).maybeSingle();
    if (error) throw error;
    return data?.parrafo_final ?? null;
  },
  enabled: enabled && !!escuelaId,
  staleTime: 0,
});
