import { supabase } from '../lib/supabaseClient';

export interface Grupo {
  id: string;
  nombre: string;
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
  sucursal?: {
    id: string;
    nombre: string;
  } | null;
  horarios?: Horario[];
  horario_ids?: string[];
}

export interface Horario {
  id: string;
  hora: string;
  escuela_id: string;
  activo: boolean;
}

// ============================================================================
// CRUD de Grupos
// ============================================================================

export const getAllGrupos = async (escuelaId: string): Promise<Grupo[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  const { data, error } = await supabase
    .from('canchas')
    .select('*, sucursal:sucursales(id, nombre), canchas_horarios(horarios(id, hora, activo))')
    .eq('escuela_id', escuelaId)
    .order('nombre', { ascending: true });

  if (error) throw error;

  return ((data || []) as any[]).map((item) => {
    const horarios = (item.canchas_horarios || [])
      .map((ch: any) => ch.horarios)
      .filter((h: any) => h != null)
      .sort((a: any, b: any) => (a.hora || '').localeCompare(b.hora || ''));

    return {
      id: item.id,
      nombre: item.nombre,
      escuela_id: item.escuela_id,
      sucursal_id: item.sucursal_id,
      activo: item.activo,
      sucursal: item.sucursal,
      horarios,
      horario_ids: horarios.map((h: any) => h.id)
    };
  }) as Grupo[];
};

export const createGrupo = async (
  escuelaId: string,
  nombre: string,
  sucursalId: string | null,
  horarioIds: string[] = []
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la grupo es obligatorio.');
  }

  // Validar duplicados dentro de la misma sucursal
  let query = supabase
    .from('canchas')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim());

  if (sucursalId) {
    query = query.eq('sucursal_id', sucursalId);
  } else {
    query = query.is('sucursal_id', null);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    throw new Error('Ya existe una grupo con este nombre en esa configuración.');
  }

  const { data, error } = await supabase
    .from('canchas')
    .insert([
      {
        nombre: nombre.trim(),
        escuela_id: escuelaId,
        sucursal_id: sucursalId || null,
        activo: true,
      },
    ])
    .select()
    .single();

  if (error) throw error;

  // Insertar relaciones con horarios
  if (horarioIds && horarioIds.length > 0) {
    const relaciones = horarioIds.map((hId) => ({
      cancha_id: data.id,
      horario_id: hId
    }));

    const { error: relError } = await supabase
      .from('canchas_horarios')
      .insert(relaciones);

    if (relError) console.error('Error insertando horarios de la grupo:', relError);
  }

  return data as Grupo;
};

export const updateGrupo = async (
  escuelaId: string,
  id: string,
  nombre: string,
  sucursalId: string | null,
  horarioIds: string[] = []
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la grupo es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre de la grupo es obligatorio.');
  }

  // Validar duplicados (excepto la misma grupo, dentro de la misma sucursal)
  let query = supabase
    .from('canchas')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('nombre', nombre.trim())
    .neq('id', id);

  if (sucursalId) {
    query = query.eq('sucursal_id', sucursalId);
  } else {
    query = query.is('sucursal_id', null);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    throw new Error('Ya existe una grupo con este nombre en esa configuración.');
  }

  const { data, error } = await supabase
    .from('canchas')
    .update({ nombre: nombre.trim(), sucursal_id: sucursalId || null })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;

  // Actualizar relaciones con horarios (eliminar previas e insertar nuevas)
  await supabase
    .from('canchas_horarios')
    .delete()
    .eq('cancha_id', id);

  if (horarioIds && horarioIds.length > 0) {
    const relaciones = horarioIds.map((hId) => ({
      cancha_id: id,
      horario_id: hId
    }));

    const { error: relError } = await supabase
      .from('canchas_horarios')
      .insert(relaciones);

    if (relError) console.error('Error actualizando horarios de la grupo:', relError);
  }

  return data as Grupo;
};

export const toggleGrupoStatus = async (
  escuelaId: string,
  id: string,
  currentStatus: boolean
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la grupo es requerido.');

  const { data, error } = await supabase
    .from('canchas')
    .update({ activo: !currentStatus })
    .eq('id', id)
    .eq('escuela_id', escuelaId)
    .select()
    .single();

  if (error) throw error;
  return data as Grupo;
};

export const deleteGrupo = async (
  escuelaId: string,
  id: string
): Promise<void> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID de la grupo es requerido.');

  // Verificar si tiene alumnos asignados
  const { count, error: countError } = await supabase
    .from('alumnos')
    .select('id', { count: 'exact', head: true })
    .eq('cancha_id', id);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    throw new Error(`No se puede eliminar el grupo porque tiene ${count} alumno(s) asignado(s). Puedes desactivarlo en su lugar para impedir nuevas asignaciones.`);
  }

  // Eliminar relaciones en canchas_horarios
  await supabase.from('canchas_horarios').delete().eq('cancha_id', id);

  // Eliminar la grupo
  const { error } = await supabase
    .from('canchas')
    .delete()
    .eq('id', id)
    .eq('escuela_id', escuelaId);

  if (error) throw error;
};

// ============================================================================
// CRUD de Horarios
// ============================================================================

export const getAllHorarios = async (escuelaId: string): Promise<Horario[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  const { data, error } = await supabase
    .from('horarios')
    .select('id, hora, activo')
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
