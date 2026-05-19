import { supabase } from '../lib/supabaseClient';

export interface Cancha {
  id: string;
  nombre: string;
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
  sucursal?: {
    id: string;
    nombre: string;
  } | null;
}

export interface Horario {
  id: string;
  hora: string;
  escuela_id: string;
  activo: boolean;
}

// ============================================================================
// CRUD de Canchas
// ============================================================================

export const getAllCanchas = async (escuelaId: string): Promise<Cancha[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  const { data, error } = await supabase
    .from('canchas')
    .select('*, sucursal:sucursales(id, nombre)')
    .eq('escuela_id', escuelaId)
    .order('nombre', { ascending: true });

  if (error) throw error;
  return (data as Cancha[]) || [];
};

export const createCancha = async (
  escuelaId: string,
  nombre: string,
  sucursalId: string
): Promise<Cancha> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la cancha es obligatorio.');
  }
  if (!sucursalId) {
    throw new Error('Debes seleccionar una sucursal para la cancha.');
  }

  // Validar duplicados dentro de la misma sucursal
  const { data: existing } = await supabase
    .from('canchas')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim())
    .eq('sucursal_id', sucursalId)
    .maybeSingle();

  if (existing) {
    throw new Error('Ya existe una cancha con este nombre en esa sucursal.');
  }

  const { data, error } = await supabase
    .from('canchas')
    .insert([
      {
        nombre: nombre.trim(),
        escuela_id: escuelaId,
        sucursal_id: sucursalId,
        activo: true,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as Cancha;
};

export const updateCancha = async (
  escuelaId: string,
  id: string,
  nombre: string,
  sucursalId: string
): Promise<Cancha> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la cancha es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la cancha es obligatorio.');
  }
  if (!sucursalId) {
    throw new Error('Debes seleccionar una sucursal para la cancha.');
  }

  // Validar duplicados (excepto la misma cancha, dentro de la misma sucursal)
  const { data: existing } = await supabase
    .from('canchas')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim())
    .eq('sucursal_id', sucursalId)
    .neq('id', id)
    .maybeSingle();

  if (existing) {
    throw new Error('Ya existe una cancha con este nombre en esa sucursal.');
  }

  const { data, error } = await supabase
    .from('canchas')
    .update({ nombre: nombre.trim(), sucursal_id: sucursalId })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data as Cancha;
};

export const toggleCanchaStatus = async (
  escuelaId: string,
  id: string,
  currentStatus: boolean
): Promise<Cancha> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la cancha es requerido.');

  // Si está activando, permitir directamente
  if (!currentStatus) {
    const { data, error } = await supabase
      .from('canchas')
      .update({ activo: true })
      .eq('id', id)
      .eq('escuela_id', escuelaId)
      .select()
      .single();

    if (error) throw error;
    return data as Cancha;
  }

  // Si está desactivando, verificar que no tenga alumnos activos
  const { count, error: countError } = await supabase
    .from('alumnos')
    .select('id', { count: 'exact', head: true })
    .eq('cancha_id', id)
    .eq('archivado', false);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    throw new Error(`No se puede desactivar. Hay ${count} alumno(s) activo(s) asignado(s) a esta cancha.`);
  }

  const { data, error } = await supabase
    .from('canchas')
    .update({ activo: false })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data as Cancha;
};

// ============================================================================
// CRUD de Horarios
// ============================================================================

export const getAllHorarios = async (escuelaId: string): Promise<Horario[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  const { data, error } = await supabase
    .from('horarios')
    .select('*')
    .eq('escuela_id', escuelaId)
    .order('hora', { ascending: true });

  if (error) throw error;
  return (data as Horario[]) || [];
};

export const createHorario = async (escuelaId: string, hora: string): Promise<Horario> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!hora || hora.trim() === '') {
    throw new Error('La hora es obligatoria.');
  }

  // Validar formato HH:MM
  const horaRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!horaRegex.test(hora.trim())) {
    throw new Error('Formato de hora inválido. Use HH:MM (ejemplo: 18:00).');
  }

  // Validar duplicados
  const { data: existing } = await supabase
    .from('horarios')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('hora', hora.trim())
    .maybeSingle();

  if (existing) {
    throw new Error('Ya existe un horario con esta hora.');
  }

  const { data, error } = await supabase
    .from('horarios')
    .insert([
      {
        hora: hora.trim(),
        escuela_id: escuelaId,
        activo: true,
      },
    ])
    .select()
    .single();

  if (error) throw error;
  return data as Horario;
};

export const updateHorario = async (
  escuelaId: string,
  id: string,
  hora: string
): Promise<Horario> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID del horario es requerido.');
  if (!hora || hora.trim() === '') {
    throw new Error('La hora es obligatoria.');
  }

  // Validar formato HH:MM
  const horaRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!horaRegex.test(hora.trim())) {
    throw new Error('Formato de hora inválido. Use HH:MM (ejemplo: 18:00).');
  }

  // Validar duplicados (excepto el mismo horario)
  const { data: existing } = await supabase
    .from('horarios')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('hora', hora.trim())
    .neq('id', id)
    .maybeSingle();

  if (existing) {
    throw new Error('Ya existe un horario con esta hora.');
  }

  const { data, error } = await supabase
    .from('horarios')
    .update({ hora: hora.trim() })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data as Horario;
};

export const toggleHorarioStatus = async (
  escuelaId: string,
  id: string,
  currentStatus: boolean
): Promise<Horario> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID del horario es requerido.');

  // Si está activando, permitir directamente
  if (!currentStatus) {
    const { data, error } = await supabase
      .from('horarios')
      .update({ activo: true })
      .eq('id', id)
      .eq('escuela_id', escuelaId)
      .select()
      .single();

    if (error) throw error;
    return data as Horario;
  }

  // Si está desactivando, verificar que no tenga alumnos activos
  const { count, error: countError } = await supabase
    .from('alumnos')
    .select('id', { count: 'exact', head: true })
    .eq('horario_id', id)
    .eq('archivado', false);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    throw new Error(`No se puede desactivar. Hay ${count} alumno(s) activo(s) asignado(s) a este horario.`);
  }

  const { data, error } = await supabase
    .from('horarios')
    .update({ activo: false })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data as Horario;
};
