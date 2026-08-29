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

  const [gruposRes, entrenadoresRes] = await Promise.all([
    supabase
      .from('grupos')
      .select('*, sucursal:sucursales(id, nombre), grupos_horarios(horarios(id, hora, activo))')
      .eq('escuela_id', escuelaId)
      .order('nombre', { ascending: true }),
    supabase
      .from('grupos_gestion')
      .select(`
        grupo_id,
        horario_id,
        entrenadores:entrenadores_grupos(
          estado,
          entrenador_id,
          entrenador:usuarios(id, nombres, apellidos)
        ),
        gestion:gestiones_deportivas!inner(estado)
      `)
      .eq('escuela_id', escuelaId)
      .eq('gestiones_deportivas.estado', 'activa')
  ]);

  if (gruposRes.error) throw gruposRes.error;

  // Mapa de grupo_id a entrenador activo
  const entrenadorPorGrupo = new Map<string, { id: string; nombre: string }>();
  (entrenadoresRes.data || []).forEach((gg: any) => {
    const act = (gg.entrenadores || []).find((e: any) => e.estado === 'activa');
    if (act?.entrenador) {
      entrenadorPorGrupo.set(gg.grupo_id, {
        id: act.entrenador_id,
        nombre: `${act.entrenador.nombres || ''} ${act.entrenador.apellidos || ''}`.trim()
      });
    }
  });

  return ((gruposRes.data || []) as any[]).map((item) => {
    const horarios = (item.grupos_horarios || [])
      .map((gh: any) => gh.horarios)
      .filter((h: any) => h != null)
      .sort((a: any, b: any) => (a.hora || '').localeCompare(b.hora || ''));

    const primerHorario = horarios[0] || null;
    const coach = entrenadorPorGrupo.get(item.id);

    return {
      id: item.id,
      nombre: item.nombre,
      escuela_id: item.escuela_id,
      sucursal_id: item.sucursal_id,
      activo: item.activo,
      sucursal: item.sucursal,
      horarios,
      horario_ids: horarios.map((h: any) => h.id),
      horario_id: primerHorario?.id || null,
      horario_hora: primerHorario?.hora || null,
      entrenador_id: coach?.id || null,
      entrenador_nombre: coach?.nombre || null
    };
  }) as Grupo[];
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
