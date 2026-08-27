import { supabase } from '../lib/supabaseClient';

export type EstadoGestion = 'planificacion' | 'activa' | 'cerrada';
export type EstadoAsignacion = 'planificada' | 'activa' | 'cerrada';
export type DecisionMigracion = 'migrara' | 'no_continua' | 'pendiente';

export interface GestionDeportiva {
  id: string;
  escuela_id: string;
  anio: number;
  estado: EstadoGestion;
  creada_por: string | null;
  activada_por: string | null;
  activada_en: string | null;
  created_at: string;
  updated_at: string;
}

export interface GrupoGestion {
  id: string;
  escuela_id: string;
  gestion_id: string;
  sucursal_id: string | null;
  grupo_id: string | null;
  horario_id: string | null;
  nombre_snapshot: string;
  hora_snapshot: string | null;
}

export interface AlumnoGrupo {
  id: string;
  escuela_id: string;
  alumno_id: string;
  grupo_gestion_id: string;
  gestion_id: string;
  estado: EstadoAsignacion;
  decision: DecisionMigracion;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  motivo: string;
  alumno?: { id: string; nombres: string; apellidos: string; archivado: boolean } | null;
}

export interface EntrenadorGrupo {
  id: string;
  escuela_id: string;
  entrenador_id: string;
  grupo_gestion_id: string;
  gestion_id: string;
  estado: EstadoAsignacion;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  motivo: string;
}

export interface NuevaGestionResultado {
  gestion_id: string;
  anio: number;
  grupos_copiados: number;
  alumnos_planificados: number;
  entrenadores_planificados: number;
}

export interface ActivarGestionResultado {
  alumnos_migrados: number;
  alumnos_no_continuan: number;
  grupos_activados: number;
}

const unwrapRpc = <T>(data: T | T[] | null): T => {
  const value = Array.isArray(data) ? data[0] : data;
  if (!value) throw new Error('La operación no devolvió resultado.');
  return value;
};

export const getGestionesDeportivas = async (escuelaId: string): Promise<GestionDeportiva[]> => {
  const { data, error } = await supabase
    .from('gestiones_deportivas')
    .select('*')
    .eq('escuela_id', escuelaId)
    .order('anio', { ascending: false });
  if (error) throw error;
  return (data || []) as GestionDeportiva[];
};

export const getGestion = async (gestionId: string): Promise<GestionDeportiva> => {
  const { data, error } = await supabase
    .from('gestiones_deportivas')
    .select('*')
    .eq('id', gestionId)
    .single();
  if (error) throw error;
  return data as GestionDeportiva;
};

export const getGruposGestion = async (gestionId: string): Promise<GrupoGestion[]> => {
  const { data, error } = await supabase
    .from('grupos_gestion')
    .select('*')
    .eq('gestion_id', gestionId)
    .order('nombre_snapshot', { ascending: true })
    .order('hora_snapshot', { ascending: true });
  if (error) throw error;
  return (data || []) as GrupoGestion[];
};

export const getAlumnosGruposGestion = async (gestionId: string): Promise<AlumnoGrupo[]> => {
  const { data, error } = await supabase
    .from('alumnos_grupos')
    .select('*, alumno:alumnos(id, nombres, apellidos, archivado)')
    .eq('gestion_id', gestionId);
  if (error) throw error;
  return (data || []) as AlumnoGrupo[];
};

export const getEntrenadoresGruposGestion = async (gestionId: string): Promise<EntrenadorGrupo[]> => {
  const { data, error } = await supabase
    .from('entrenadores_grupos')
    .select('*')
    .eq('gestion_id', gestionId);
  if (error) throw error;
  return (data || []) as EntrenadorGrupo[];
};

export const crearGestionSiguiente = async (): Promise<NuevaGestionResultado> => {
  const { data, error } = await supabase.rpc('rpc_crear_gestion_siguiente');
  if (error) throw error;
  return unwrapRpc(data as NuevaGestionResultado | NuevaGestionResultado[] | null);
};

export interface PlanGestionPayload {
  grupos?: Array<Pick<GrupoGestion, 'id' | 'nombre_snapshot' | 'hora_snapshot' | 'sucursal_id' | 'grupo_id' | 'horario_id'>>;
  alumnos?: Array<Pick<AlumnoGrupo, 'alumno_id' | 'grupo_gestion_id' | 'decision'>>;
  entrenadores?: Array<Pick<EntrenadorGrupo, 'grupo_gestion_id' | 'entrenador_id'>>;
}

export const guardarPlanificacionGestion = async (
  gestionId: string,
  plan: PlanGestionPayload
): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase.rpc('rpc_guardar_planificacion_gestion', {
    p_gestion_id: gestionId,
    p_plan: plan,
  });
  if (error) throw error;
  return (data || {}) as Record<string, unknown>;
};

export const activarGestion = async (gestionId: string): Promise<ActivarGestionResultado> => {
  const { data, error } = await supabase.rpc('rpc_activar_gestion', { p_gestion_id: gestionId });
  if (error) throw error;
  return unwrapRpc(data as ActivarGestionResultado | ActivarGestionResultado[] | null);
};

export const trasladarAlumno = async (
  alumnoId: string,
  grupoDestinoId: string,
  motivo = 'traslado'
): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase.rpc('rpc_trasladar_alumno', {
    p_alumno_id: alumnoId,
    p_grupo_destino_id: grupoDestinoId,
    p_motivo: motivo,
  });
  if (error) throw error;
  return (data || {}) as Record<string, unknown>;
};

export const asignarEntrenadorGrupo = async (
  grupoGestionId: string,
  entrenadorId: string,
  motivo = 'asignacion'
): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase.rpc('rpc_asignar_entrenador_grupo', {
    p_grupo_gestion_id: grupoGestionId,
    p_entrenador_id: entrenadorId,
    p_motivo: motivo,
  });
  if (error) throw error;
  return (data || {}) as Record<string, unknown>;
};

export const cambiarEntrenadorGrupo = async (
  grupoGestionId: string,
  entrenadorId: string,
  motivo = 'cambio_profesor'
): Promise<Record<string, unknown>> => {
  const { data, error } = await supabase.rpc('rpc_cambiar_entrenador_grupo', {
    p_grupo_gestion_id: grupoGestionId,
    p_entrenador_id: entrenadorId,
    p_motivo: motivo,
  });
  if (error) throw error;
  return (data || {}) as Record<string, unknown>;
};
