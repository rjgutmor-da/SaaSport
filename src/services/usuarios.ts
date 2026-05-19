import { supabase } from '../lib/supabaseClient';

export interface Usuario {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: 'SuperAdministrador' | 'Administrador' | 'Entrenador' | 'Entrenarqueros' | 'Dueño';
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
  creado_a?: string;
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
    .select('*')
    .eq('escuela_id', escuelaId);

  // Filtrar por sucursal si es Administrador o Entrenador
  if (userProfile && userProfile.rol !== 'Dueño' && userProfile.rol !== 'SuperAdministrador') {
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
  const validRoles = ['Dueño', 'SuperAdministrador', 'Administrador', 'Entrenador', 'Entrenarqueros'];
  if (!validRoles.includes(newRole)) {
    throw new Error('Rol no válido');
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
