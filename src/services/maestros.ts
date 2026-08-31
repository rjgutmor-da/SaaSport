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
  horario_id?: string | null;
  horario_hora?: string | null;
  entrenador_id?: string | null;
  entrenador_nombre?: string | null;
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

  const { data, error } = await supabase.rpc('rpc_obtener_grupos_con_entrenador', {
    p_escuela_id: escuelaId
  });

  if (error) throw error;

  const gruposMap = new Map<string, Grupo>();

  ((data || []) as any[]).forEach((item) => {
    const horarioObj = item.horario_id ? { id: item.horario_id, hora: item.horario_hora, escuela_id: escuelaId, activo: true } : null;
    const horarios = horarioObj ? [horarioObj] : [];

    if (!gruposMap.has(item.id)) {
      gruposMap.set(item.id, {
        id: item.id,
        nombre: item.nombre,
        escuela_id: escuelaId,
        sucursal_id: item.sucursal_id,
        activo: item.activo,
        sucursal: item.sucursal_id ? { id: item.sucursal_id, nombre: item.sucursal_nombre } : null,
        horarios,
        horario_ids: item.horario_id ? [item.horario_id] : [],
        horario_id: item.horario_id || null,
        horario_hora: item.horario_hora || null,
        entrenador_id: item.entrenador_id || null,
        entrenador_nombre: item.entrenador_nombre || null
      });
    } else {
      const existing = gruposMap.get(item.id)!;
      if (item.horario_id && !existing.horario_ids?.includes(item.horario_id)) {
        existing.horario_ids?.push(item.horario_id);
        if (horarioObj) existing.horarios?.push(horarioObj);
      }
      if (!existing.entrenador_id && item.entrenador_id) {
        existing.entrenador_id = item.entrenador_id;
        existing.entrenador_nombre = item.entrenador_nombre;
      }
    }
  });

  return Array.from(gruposMap.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
};

export const createGrupo = async (
  escuelaId: string,
  nombre: string,
  sucursalId: string | null,
  horarioId: string | null = null,
  entrenadorId: string | null = null
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre del grupo es obligatorio.');
  }

  const { data, error } = await supabase.rpc('rpc_guardar_grupo_completo', {
    p_grupo_id: null,
    p_nombre: nombre.trim(),
    p_sucursal_id: sucursalId || null,
    p_horario_id: horarioId || null,
    p_entrenador_id: entrenadorId || null
  });

  if (error) throw error;
  return data as Grupo;
};

export const updateGrupo = async (
  escuelaId: string,
  id: string,
  nombre: string,
  sucursalId: string | null,
  horarioId: string | null = null,
  entrenadorId: string | null = null
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID del grupo es requerido.');
  if (!nombre || nombre.trim() === '') {
    throw new Error('El nombre del grupo es obligatorio.');
  }

  const { data, error } = await supabase.rpc('rpc_guardar_grupo_completo', {
    p_grupo_id: id,
    p_nombre: nombre.trim(),
    p_sucursal_id: sucursalId || null,
    p_horario_id: horarioId || null,
    p_entrenador_id: entrenadorId || null
  });

  if (error) throw error;
  return data as Grupo;
};

export const toggleGrupoStatus = async (
  escuelaId: string,
  id: string,
  currentStatus: boolean
): Promise<Grupo> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!id) throw new Error('El ID del grupo es requerido.');

  const { data, error } = await supabase
    .from('grupos')
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
  if (!id) throw new Error('El ID del grupo es requerido.');

  // Verificar si tiene alumnos asignados
  const { count, error: countError } = await supabase
    .from('alumnos')
    .select('id', { count: 'exact', head: true })
    .eq('grupo_id', id);

  if (countError) throw countError;

  if ((count || 0) > 0) {
    throw new Error(`No se puede eliminar el grupo porque tiene ${count} alumno(s) asignado(s). Puedes desactivarlo en su lugar para impedir nuevas asignaciones.`);
  }

  // Eliminar relaciones en grupos_horarios
  await supabase.from('grupos_horarios').delete().eq('grupo_id', id);

  // Eliminar el grupo
  const { error } = await supabase
    .from('grupos')
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
