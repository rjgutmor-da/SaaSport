import { supabase } from '../lib/supabaseClient';
import { ROLES } from '../config/roles';
import type { Role } from '../config/roles';

export interface Usuario {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: Role;
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
  creado_a?: string;
}

export interface GrupoReasignacionEntrenador {
  clave: string;
  sucursal_id: string | null;
  grupo_id: string | null;
  horario_id: string | null;
  sucursal_nombre: string;
  grupo_nombre: string;
  horario_nombre: string;
  alumnos_activos: number;
  alumnos_archivados: number;
}

export interface ResultadoReasignacionEntrenador {
  alumnos_reasignados: number;
  grupos_reasignados: number;
  sesiones_revocadas: number;
}

/**
 * Obtiene todos los usuarios de una escuela, filtrando opcionalmente por sucursal
 * según el rol del usuario que consulta.
 */
export const getUsuarios = async (
  escuelaId: string,
  userProfile: { rol: string; sucursal_id: string | null }
): Promise<Usuario[]> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');

  let query = supabase
    .from('usuarios')
    .select('id, email, nombres, apellidos, rol, sucursal_id, activo, escuela_id')
    .eq('escuela_id', escuelaId);

  // Filtrar por sucursal si es Administrador o Entrenador
  if (userProfile && userProfile.rol !== 'SuperAdministrador') {
    if (userProfile.sucursal_id) {
      query = query.eq('sucursal_id', userProfile.sucursal_id);
    }
  }

  const { data, error } = await query.order('nombres', { ascending: true });

  if (error) throw error;
  return (data as Usuario[]) || [];
};

/**
 * Actualiza el rol de un usuario.
 */
export const updateUserRole = async (userId: string, newRole: string): Promise<Usuario> => {
  if (!ROLES.includes(newRole as Role)) {
    throw new Error('Rol no válido');
  }

  // Regla de negocio: El rol 'Medico' solo está permitido si la escuela tiene habilitada la Ficha Médica
  if (newRole === 'Medico') {
    const { data: userProfile } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', userId)
      .single();

    if (userProfile?.escuela_id) {
      const { data: escuela } = await supabase
        .from('escuelas')
        .select('ficha_medica_habilitada')
        .eq('id', userProfile.escuela_id)
        .single();

      if (!escuela?.ficha_medica_habilitada) {
        throw new Error('El rol de Médico no se puede asignar porque la escuela no tiene habilitado el módulo de Ficha Médica.');
      }
    }
  }

  // Regla de negocio: El rol 'SuperAdministrador' debe ser único por escuela
  if (newRole === 'SuperAdministrador') {
    const { data: userProfile, error: profileError } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', userId)
      .single();

    if (profileError) throw new Error('No se pudo encontrar el perfil del usuario.');

    const escuelaId = userProfile.escuela_id;

    const { data: existingSuperAdmin, error: checkError } = await supabase
      .from('usuarios')
      .select('id, nombres, apellidos')
      .eq('escuela_id', escuelaId)
      .eq('rol', 'SuperAdministrador')
      .eq('activo', true)
      .neq('id', userId)
      .maybeSingle();

    if (checkError) console.error('Error al verificar SuperAdministrador existente:', checkError);
    if (existingSuperAdmin) {
      throw new Error(`Ya existe un SuperAdministrador: ${existingSuperAdmin.nombres} ${existingSuperAdmin.apellidos}. Solo puede haber un SuperAdministrador por escuela.`);
    }
  }

  const { data, error } = await supabase
    .from('usuarios')
    .update({ rol: newRole })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as Usuario;
};

/**
 * Activa o desactiva a un usuario.
 */
export const toggleUserStatus = async (userId: string, currentStatus: boolean): Promise<Usuario> => {
  // Regla de negocio: si se está activando (pasa de inactivo a activo)
  if (!currentStatus) {
    const { data: userProfile, error: profileError } = await supabase
      .from('usuarios')
      .select('rol, escuela_id')
      .eq('id', userId)
      .single();

    if (profileError) throw new Error('No se pudo encontrar el perfil del usuario.');

    if (userProfile.rol === 'SuperAdministrador') {
      const { data: existingSuperAdmin, error: checkError } = await supabase
        .from('usuarios')
        .select('id, nombres, apellidos')
        .eq('escuela_id', userProfile.escuela_id)
        .eq('rol', 'SuperAdministrador')
        .eq('activo', true)
        .neq('id', userId)
        .maybeSingle();

      if (checkError) console.error('Error al verificar SuperAdministrador existente:', checkError);
      if (existingSuperAdmin) {
        throw new Error(`Ya existe un SuperAdministrador activo: ${existingSuperAdmin.nombres} ${existingSuperAdmin.apellidos}. Solo puede haber un SuperAdministrador activo por escuela.`);
      }
    }
  }

  const { data, error } = await supabase
    .from('usuarios')
    .update({ activo: !currentStatus })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as Usuario;
};

/**
 * Elimina de forma definitiva un usuario que no tenga historial ni relaciones.
 * La validación de permisos, relaciones y el borrado de Auth ocurren en la
 * Edge Function; nunca se expone una service_role key en el navegador.
 */
export const deleteUser = async (userId: string): Promise<void> => {
  if (!userId) throw new Error('El ID del usuario es requerido.');

  const { error } = await supabase.functions.invoke('delete-user', {
    body: { userId },
  });

  if (!error) return;

  const context = (error as { context?: { json?: () => Promise<any> } }).context;
  if (context?.json) {
    try {
      const body = await context.json();
      if (body?.error) throw new Error(body.error);
    } catch (contextError) {
      if (contextError instanceof Error && contextError.message !== 'Unexpected end of JSON input') {
        throw contextError;
      }
    }
  }

  throw new Error(error.message || 'No se pudo eliminar el usuario.');
};

/** Obtiene la vista previa agrupada para una baja de entrenador. */
export const getGruposReasignacionEntrenador = async (
  escuelaId: string,
  entrenadorId: string
): Promise<GrupoReasignacionEntrenador[]> => {
  const { data, error } = await supabase
    .from('alumnos')
    .select(`
      sucursal_id,
      grupo_id,
      horario_id,
      archivado,
      sucursal:sucursales(nombre),
      grupo:grupos(nombre),
      horario:horarios(hora)
    `)
    .eq('escuela_id', escuelaId)
    .eq('profesor_asignado_id', entrenadorId);

  if (error) throw error;

  const grupos = new Map<string, GrupoReasignacionEntrenador>();
  for (const alumno of data || []) {
    const row = alumno as any;
    const clave = [row.sucursal_id ?? 'sin-sucursal', row.grupo_id ?? 'sin-grupo', row.horario_id ?? 'sin-horario'].join('|');
    const grupo = grupos.get(clave) || {
      clave,
      sucursal_id: row.sucursal_id ?? null,
      grupo_id: row.grupo_id ?? null,
      horario_id: row.horario_id ?? null,
      sucursal_nombre: row.sucursal?.nombre || 'Sin sucursal',
      grupo_nombre: row.grupo?.nombre || 'Sin grupo',
      horario_nombre: row.horario?.hora || 'Sin horario',
      alumnos_activos: 0,
      alumnos_archivados: 0,
    };

    if (row.archivado) grupo.alumnos_archivados += 1;
    else grupo.alumnos_activos += 1;
    grupos.set(clave, grupo);
  }

  return Array.from(grupos.values()).sort((a, b) =>
    `${a.sucursal_nombre}-${a.grupo_nombre}-${a.horario_nombre}`.localeCompare(
      `${b.sucursal_nombre}-${b.grupo_nombre}-${b.horario_nombre}`,
      'es'
    )
  );
};

/** Reasigna grupos completos y deja inactivo al entrenador en una única transacción. */
export const reasignarYDesactivarEntrenador = async (
  entrenadorSalienteId: string,
  grupos: Array<GrupoReasignacionEntrenador & { entrenador_destino_id: string }>
): Promise<ResultadoReasignacionEntrenador> => {
  const asignaciones = grupos.map(({ sucursal_id, grupo_id, horario_id, entrenador_destino_id }) => ({
    sucursal_id,
    grupo_id,
    horario_id,
    entrenador_destino_id,
  }));

  const { data, error } = await supabase.rpc('rpc_reasignar_y_desactivar_entrenador', {
    p_entrenador_saliente: entrenadorSalienteId,
    p_asignaciones: asignaciones,
  });

  if (error) throw error;
  const resultado = Array.isArray(data) ? data[0] : data;
  if (!resultado) throw new Error('La reasignación no devolvió un resultado.');
  return resultado as ResultadoReasignacionEntrenador;
};

/**
 * Actualiza la sucursal de un usuario.
 */
export const updateUserSucursal = async (userId: string, sucursalId: string | null): Promise<Usuario> => {
  const newValue = sucursalId ? sucursalId : null;
  const { data, error } = await supabase
    .from('usuarios')
    .update({ sucursal_id: newValue })
    .eq('id', userId)
    .select()
    .single();

  if (error) throw error;
  return data as Usuario;
};

/**
 * Crea un usuario directamente creando primero su registro en Auth de Supabase (con un cliente alternativo)
 * y luego registrando el perfil en la tabla de usuarios.
 */
export const createUserDirectly = async (escuelaId: string, userData: any): Promise<{ id: string; email: string }> => {
  if (!escuelaId) throw new Error('El ID de la escuela es requerido.');
  if (!userData.email?.trim()) throw new Error('El correo electrónico es obligatorio.');
  if (!userData.password || userData.password.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres.');
  if (!userData.nombres?.trim()) throw new Error('El nombre es obligatorio.');
  if (!userData.apellidos?.trim()) throw new Error('Los apellidos son obligatorios.');

  // Regla de negocio: El rol 'SuperAdministrador' debe ser único por escuela
  if (userData.rol === 'SuperAdministrador') {
    const { data: existingSuperAdmin, error: checkError } = await supabase
      .from('usuarios')
      .select('id, nombres, apellidos')
      .eq('escuela_id', escuelaId)
      .eq('rol', 'SuperAdministrador')
      .eq('activo', true)
      .maybeSingle();

    if (checkError) console.error('Error al verificar SuperAdministrador existente:', checkError);
    if (existingSuperAdmin) {
      throw new Error(`Ya existe un SuperAdministrador: ${existingSuperAdmin.nombres} ${existingSuperAdmin.apellidos}. Solo puede haber un SuperAdministrador por escuela.`);
    }
  }

  // Importar createClient dinámicamente para instanciar cliente secundario
  const { createClient } = await import('@supabase/supabase-js');
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Variables de entorno de Supabase no configuradas.');
  }

  const tempClient = createClient(
    supabaseUrl,
    supabaseAnonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  const emailLimpio = userData.email.trim().toLowerCase();
  
  // Registrar en Auth
  const { data: authData, error: authError } = await tempClient.auth.signUp({
    email: emailLimpio,
    password: userData.password,
  });

  if (authError) {
    if (authError.message.includes('already registered') || authError.message.includes('already been registered')) {
      throw new Error(`El correo ${emailLimpio} ya está registrado en el sistema.`);
    }
    if (authError.message.includes('invalid email')) {
      throw new Error('El formato del correo electrónico no es válido.');
    }
    if (authError.message.includes('Password')) {
      throw new Error('La contraseña no cumple los requisitos mínimos (al menos 6 caracteres).');
    }
    throw new Error('Error al crear la cuenta: ' + authError.message);
  }

  if (!authData.user) {
    throw new Error(`El correo ${emailLimpio} ya existe en el sistema pero no ha sido confirmado.`);
  }

  const authUserId = authData.user.id;

  // Registrar en la tabla usuarios
  const newProfile = {
    id: authUserId,
    email: emailLimpio,
    nombres: userData.nombres.trim(),
    apellidos: userData.apellidos.trim(),
    rol: userData.rol,
    sucursal_id: userData.sucursal_id || null,
    escuela_id: escuelaId,
    activo: true
  };

  const { error: dbError } = await supabase
    .from('usuarios')
    .upsert(newProfile, { onConflict: 'id' });

  if (dbError) {
    console.error('Error al guardar perfil, el usuario de Auth fue creado con ID:', authUserId);
    throw new Error(
      'La cuenta se creó en Auth pero no se pudo guardar el perfil. ' +
      'Detalle técnico: ' + dbError.message
    );
  }

  return { id: authUserId, email: emailLimpio };
};
