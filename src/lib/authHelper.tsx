/**
 * authHelper.ts — Contexto de autenticación para SaaSport.
 *
 * Obtiene el perfil completo del usuario desde la tabla `usuarios`
 * de Supabase y expone rol, escuela_id y sucursal_id.
 *
 * Reglas de acceso a SaaSport:
 *   ✅ SuperAdministrador → acceso completo + Panel Escuela
 *   ✅ Dueño              → acceso completo + Panel Escuela
 *   ✅ Administrador      → acceso con restricción de sucursal (si aplica)
 *   ❌ Entrenador         → BLOQUEADO, solo puede usar AsisPort
 *   ❌ Entrenarqueros     → BLOQUEADO, solo puede usar AsisPort
 */
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

export interface PerfilUsuario {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: 'SuperAdministrador' | 'Dueño' | 'Administrador' | 'Entrenador' | 'Entrenarqueros';
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
}

interface AuthContextValue {
  session: Session | null;
  perfil: PerfilUsuario | null;
  cargando: boolean;
  /** true si el usuario puede acceder a SaaSport */
  tieneAcceso: boolean;
  /** true si el usuario puede ver Panel de Escuela */
  esSuperAdmin: boolean;
  /** sucursal_id para filtrar datos (null = sin restricción) */
  sucursalId: string | null;
  escuelaId: string | null;
  cerrarSesion: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuthSaaSport = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthSaaSport debe usarse dentro de AuthProviderSaaSport');
  return ctx;
};

/** Roles con acceso a SaaSport */
const ROLES_PERMITIDOS = ['SuperAdministrador', 'Dueño', 'Administrador'];

export const AuthProviderSaaSport = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [cargando, setCargando] = useState(true);

  /** Obtener perfil desde la tabla usuarios con timeout de seguridad */
  const cargarPerfil = async (userId: string): Promise<void> => {
    try {
      const queryPromise = supabase
        .from('usuarios')
        .select('*')
        .eq('id', userId)
        .single();

      // Timeout de 8 segundos para evitar bloqueos infinitos
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al cargar perfil')), 15000)
      );

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as any;

      if (error) {
        console.error('Error al cargar perfil:', error);
        setPerfil(null);
        return;
      }

      setPerfil(data as PerfilUsuario);
    } catch (err) {
      console.error('Error inesperado al cargar perfil:', err);
      setPerfil(null);
    }
  };

  useEffect(() => {
    // 1. Verificar sesión activa al cargar
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        await cargarPerfil(s.user.id);
      }
      setCargando(false);
    });

    // 2. Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      console.log("[Auth] Evento de sesión:", event);
      setCargando(true);
      setSession(s);
      if (s?.user) {
        await cargarPerfil(s.user.id);
      } else {
        setPerfil(null);
      }
      setCargando(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const cerrarSesion = async (): Promise<void> => {
    await supabase.auth.signOut();
    setPerfil(null);
    setSession(null);
  };

  const tieneAcceso = perfil
    ? ROLES_PERMITIDOS.includes(perfil.rol) && perfil.activo
    : false;

  const esSuperAdmin = perfil
    ? (perfil.rol === 'SuperAdministrador' || perfil.rol === 'Dueño') && perfil.activo
    : false;

  const value = React.useMemo(() => ({
    session,
    perfil,
    cargando,
    tieneAcceso,
    esSuperAdmin,
    sucursalId: perfil?.sucursal_id ?? null,
    escuelaId: perfil?.escuela_id ?? null,
    cerrarSesion,
  }), [session, perfil, cargando, tieneAcceso, esSuperAdmin, cerrarSesion]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProviderSaaSport;
