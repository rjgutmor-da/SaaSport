/** Servicio para consultar el plan contratado y el consumo de cupos en PostgreSQL. */
import { supabase } from '../lib/supabaseClient';
import type { EstadoPlanEscuela } from '../types/planes';

export const obtenerPlanYCuposEscuela = async (escuelaId: string): Promise<EstadoPlanEscuela> => {
  if (!escuelaId) {
    throw new Error('El identificador de la escuela es requerido para consultar su plan.');
  }

  const { data, error } = await supabase.rpc('rpc_obtener_plan_y_cupos_escuela', {
    p_escuela_id: escuelaId,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo obtener el estado del plan y cupos de la escuela.');
  }

  if (!data) {
    throw new Error('La respuesta del servidor sobre el plan de la escuela está vacía.');
  }

  return data as EstadoPlanEscuela;
};
