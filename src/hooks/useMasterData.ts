import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export const queryKeys = {
  sucursales: ['sucursales'] as const,
  entrenadores: ['entrenadores'] as const,
  canchas: ['canchas'] as const,
  horarios: ['horarios'] as const,
  cuentas: ['cuentas'] as const,
};

const fetchSucursales = async () => {
  const { data, error } = await supabase.from('sucursales').select('*').order('nombre');
  if (error) throw error;
  return data;
};

const fetchEntrenadores = async () => {
  const { data, error } = await supabase.from('personal').select('*').eq('rol', 'Entrenador').eq('activo', true).order('nombres');
  if (error) throw error;
  return data;
};

const fetchCanchas = async () => {
  const { data, error } = await supabase.from('canchas').select('*').order('nombre');
  if (error) throw error;
  return data;
};

const fetchHorarios = async () => {
  const { data, error } = await supabase.from('horarios').select('*').order('hora');
  if (error) throw error;
  return data;
};

const fetchCuentasContables = async () => {
  const { data, error } = await supabase.from('cuentas_contables').select('*').order('codigo');
  if (error) throw error;
  return data;
};

const fetchAlumnosRelaciones = async () => {
  const { data, error } = await supabase
    .from('alumnos')
    .select('sucursal_id, cancha_id, horario_id, profesor_asignado_id')
    .eq('archivado', false);
  if (error) throw error;
  return data;
};

const fetchCatalogo = async (escuelaId: string | null) => {
  if (!escuelaId) return [];
  const { data, error } = await supabase
    .from('catalogo_items')
    .select(`
      *,
      stock:stock_productos(id, cantidad_disponible)
    `)
    .eq('escuela_id', escuelaId)
    .order('nombre');
  if (error) throw error;
  return data;
};

export const useSucursales = () => useQuery({ queryKey: queryKeys.sucursales, queryFn: fetchSucursales });
export const useEntrenadores = () => useQuery({ queryKey: queryKeys.entrenadores, queryFn: fetchEntrenadores });
export const useCanchas = () => useQuery({ queryKey: queryKeys.canchas, queryFn: fetchCanchas });
export const useHorarios = () => useQuery({ queryKey: queryKeys.horarios, queryFn: fetchHorarios });
export const useCuentasContables = () => useQuery({ queryKey: queryKeys.cuentas, queryFn: fetchCuentasContables });
export const useAlumnosRelaciones = () => useQuery({ queryKey: ['alumnos-relaciones'], queryFn: fetchAlumnosRelaciones });
export const useCatalogo = (escuelaId: string | null) => useQuery({ 
  queryKey: ['catalogo', escuelaId], 
  queryFn: () => fetchCatalogo(escuelaId),
  enabled: !!escuelaId 
});
