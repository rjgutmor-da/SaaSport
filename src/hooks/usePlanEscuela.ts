/** Hook de TanStack Query para cachear el plan y los cupos de la escuela activa. */
import { useQuery } from '@tanstack/react-query';
import { obtenerPlanYCuposEscuela } from '../services/planes';

export const planEscuelaKey = (escuelaId: string | null) => ['plan-escuela', escuelaId] as const;

export const usePlanEscuela = (escuelaId: string | null, enabled = true) =>
  useQuery({
    queryKey: planEscuelaKey(escuelaId),
    queryFn: () => obtenerPlanYCuposEscuela(escuelaId!),
    enabled: Boolean(escuelaId) && enabled,
    staleTime: 1000 * 60 * 5,
  });
