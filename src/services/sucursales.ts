import { supabase } from '../lib/supabaseClient';

export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  escuela_id: string;
  creado_a?: string;
}

/**
 * Obtiene todas las sucursales de una escuela.
 */
export const getSucursales = async (escuelaId: string): Promise<Sucursal[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  const { data, error } = await supabase
    .from('sucursales')
    .select('*')
    .eq('escuela_id', escuelaId)
    .order('nombre', { ascending: true });

  if (error) throw error;
  return data || [];
};

/**
 * Crea una nueva sucursal.
 */
export const createSucursal = async (
  escuelaId: string,
  nombre: string,
  direccion: string = '',
  telefono: string = ''
): Promise<Sucursal> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la sucursal es obligatorio.');
  }

  // Validar duplicados por nombre en la misma escuela
  const { data: existente } = await supabase
    .from('sucursales')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim())
    .maybeSingle();

  if (existente) {
    throw new Error('Ya existe una sucursal con este nombre en tu escuela.');
  }

  const { data, error } = await supabase
    .from('sucursales')
    .insert([
      {
        nombre: nombre.trim(),
        direccion: direccion.trim() || null,
        telefono: telefono.trim() || null,
        escuela_id: escuelaId,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Actualiza una sucursal existente.
 */
export const updateSucursal = async (
  escuelaId: string,
  id: string,
  nombre: string,
  direccion: string = '',
  telefono: string = ''
): Promise<Sucursal> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la sucursal es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la sucursal es obligatorio.');
  }

  // Validar duplicados por nombre en la misma escuela excluyendo la actual
  const { data: existente } = await supabase
    .from('sucursales')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim())
    .neq('id', id)
    .maybeSingle();

  if (existente) {
    throw new Error('Ya existe otra sucursal con este nombre en tu escuela.');
  }

  const { data, error } = await supabase
    .from('sucursales')
    .update({
      nombre: nombre.trim(),
      direccion: direccion.trim() || null,
      telefono: telefono.trim() || null,
    })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data;
};

/**
 * Elimina una sucursal.
 * Verifica previamente que no haya alumnos ni usuarios activos asociados a esta sucursal.
 */
export const deleteSucursal = async (escuelaId: string, id: string): Promise<void> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la sucursal es requerido.');

  // 1. Verificar si hay alumnos activos
  const { count: countAlumnos, error: errAlumnos } = await supabase
    .from('alumnos')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', id)
    .eq('archivado', false);

  if (errAlumnos) throw errAlumnos;
  if ((countAlumnos || 0) > 0) {
    throw new Error(`No se puede eliminar. Hay ${countAlumnos} alumno(s) activo(s) en esta sucursal.`);
  }

  // 2. Verificar si hay usuarios/empleados activos
  const { count: countUsuarios, error: errUsuarios } = await supabase
    .from('usuarios')
    .select('id', { count: 'exact', head: true })
    .eq('sucursal_id', id)
    .eq('activo', true);

  if (errUsuarios) throw errUsuarios;
  if ((countUsuarios || 0) > 0) {
    throw new Error(`No se puede eliminar. Hay ${countUsuarios} usuario(s) activo(s) asignado(s) a esta sucursal.`);
  }

  // 3. Proceder a la eliminación
  const { error } = await supabase
    .from('sucursales')
    .delete()
    .eq('id', id)
    .eq('escuela_id', escuelaId);

  if (error) throw error;
};
