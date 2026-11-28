/** Hook de TanStack Query para el listado paginado en servidor de Alumnos en SaaSport. */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { listarAlumnosSaaSport } from '../services/alumnos';
import type { FiltrosAlumnosSaaSport } from '../types/alumnos';

export interface AlcanceAlumnosSaaSport {
  userId: string | null;
  escuelaId: string | null;
  sucursalId: string | null;
}

export const alumnosSaaSportKey = (
  alcance: AlcanceAlumnosSaaSport,
  filtros: FiltrosAlumnosSaaSport,
) => ['alumnos-saasport', alcance, filtros] as const;

export const useAlumnosSaaSport = (
  alcance: AlcanceAlumnosSaaSport,
  filtros: FiltrosAlumnosSaaSport,
  enabled = true,
) =>
  useQuery({
    queryKey: alumnosSaaSportKey(alcance, filtros),
    queryFn: ({ signal }) => listarAlumnosSaaSport(filtros, signal),
    enabled: Boolean(alcance.userId && alcance.escuelaId) && enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

export const useInvalidarAlumnosSaaSport = () => {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['alumnos-saasport'] }),
      queryClient.invalidateQueries({ queryKey: ['cxc-busqueda'] }),
      queryClient.invalidateQueries({ queryKey: ['plan-escuela'] }),
      queryClient.invalidateQueries({ queryKey: ['alumnos-relaciones'] }),
    ]);
  };
};
