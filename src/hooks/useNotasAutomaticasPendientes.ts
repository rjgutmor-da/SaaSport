import { useQuery, useQueryClient } from '@tanstack/react-query';
import { can, ROLE_MATRIX } from '../config/roles';
import { useAuthSaaSport } from '../lib/authHelper';
import { supabase } from '../lib/supabaseClient';

const queryRoot = 'notas-automaticas-pendientes';

export function useNotasAutomaticasPendientes() {
  const { session, perfil, escuelaId, sucursalId, cargando } = useAuthSaaSport();
  const usuarioId = session?.user.id;
  const alcance = perfil ? ROLE_MATRIX[perfil.rol].dataScope : null;
  const sucursalFiltro = alcance === 'branch' ? sucursalId : null;
  const habilitado = !cargando && !!usuarioId && perfil?.id === usuarioId
    && !!escuelaId && can(perfil?.rol, 'finance.cxc.view');

  const consulta = useQuery({
    queryKey: [queryRoot, usuarioId, escuelaId, alcance, sucursalFiltro],
    enabled: habilitado,
    queryFn: async ({ signal }) => {
      if (!escuelaId) return false;
      let query = supabase.from('cuentas_cobrar')
        .select('id')
        .eq('escuela_id', escuelaId)
        .eq('origen_facturacion', 'automatico')
        .eq('estado', 'borrador');
      if (sucursalFiltro) query = query.eq('sucursal_id', sucursalFiltro);
      const { data, error } = await query.limit(1).abortSignal(signal);
      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });

  return habilitado && consulta.data === true;
}

export function useActualizarNotasAutomaticasPendientes() {
  const queryClient = useQueryClient();
  const { session, escuelaId } = useAuthSaaSport();
  return () => queryClient.invalidateQueries({
    queryKey: [queryRoot, session?.user.id, escuelaId],
  });
}
