/**
 * authHelper.tsx — Contexto de autenticación para SaaSport.
 *
 * Obtiene el perfil completo del usuario desde la tabla `usuarios`
 * de Supabase y expone rol, escuela_id y sucursal_id.
 *
 * Reglas de acceso a SaaSport:
 *   ✅ SuperAdministrador → acceso total + Panel Escuela + eliminación
 *   ✅ Administrador      → acceso con restricción de sucursal (si aplica)
 *   ❌ Entrenador         → BLOQUEADO, solo puede usar AsisPort
 *   ❌ Entrenarqueros     → BLOQUEADO, solo puede usar AsisPort
 */
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import type { ReactNode } from 'react';
import { can } from '../config/roles';
import type { Role } from '../config/roles';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

export interface PerfilUsuario {
  id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol: Role;
  escuela_id: string;
  sucursal_id: string | null;
  activo: boolean;
}

export interface EscuelaInfo {
  id: string;
  nombre: string;
  zona_horaria: string | null;
  activa: boolean;
  logo_url: string | null;
  slogan: string | null;
}

interface AuthContextValue {
  session: Session | null;
  perfil: PerfilUsuario | null;
  escuela: EscuelaInfo | null;
  cargando: boolean;
  /** true si el usuario puede acceder a SaaSport */
  tieneAcceso: boolean;
  /** true si el usuario es SuperAdministrador */
  esSuperAdmin: boolean;
  /** true si el usuario tiene permisos de eliminación */
  puedeEliminar: boolean;
  /** sucursal_id para filtrar datos (null = sin restricción) */
  sucursalId: string | null;
  escuelaId: string | null;
  cerrarSesion: () => Promise<void>;
  recargarDatosAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const useAuthSaaSport = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthSaaSport debe usarse dentro de AuthProviderSaaSport');
  return ctx;
};

/** Roles con acceso a SaaSport */
export const AuthProviderSaaSport = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null);
  const [escuela, setEscuela] = useState<EscuelaInfo | null>(null);
  const [cargando, setCargando] = useState(true);

  // Refs para evitar loops de carga innecesarios en onAuthStateChange
  const inicializado = useRef(false);
  const procesandoId = useRef<string | null>(null);

  /** Obtener perfil y escuela activa con timeout de seguridad */
  const cargarPerfil = async (userId: string): Promise<void> => {
    try {
      const queryPromise = supabase
        .from('usuarios')
        .select('*')
        .eq('id', userId)
        .single();

      // Timeout de 15 segundos para evitar bloqueos infinitos
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout al cargar perfil')), 15000)
      );

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]) as any;

      if (error) {
        console.error('Error al cargar perfil:', error);
        setPerfil(null);
        setEscuela(null);
        return;
      }

      const perfilData = data as PerfilUsuario;
      setPerfil(perfilData);

      // Cargar información de la escuela si tiene escuela_id
      if (perfilData?.escuela_id) {
        const { data: escuelaData, error: escuelaError } = await supabase
          .from('escuelas')
          .select('*')
          .eq('id', perfilData.escuela_id)
          .single();

        if (escuelaError) {
          console.error('Error al cargar datos de la escuela:', escuelaError);
          setEscuela(null);
        } else {
          setEscuela(escuelaData as EscuelaInfo);
        }
      } else {
        setEscuela(null);
      }
    } catch (err) {
      console.error('Error inesperado al cargar perfil:', err);
      setPerfil(null);
      setEscuela(null);
    }
  };

  const recargarDatosAuth = async (): Promise<void> => {
    if (session?.user?.id) {
      await cargarPerfil(session.user.id);
    }
  };

  useEffect(() => {
    /**
     * Procesa los cambios de sesión de forma centralizada.
     * Implementa condición estricta para evitar re-activar el cargando si el usuario es el mismo.
     */
    const procesarSesion = async (s: Session | null, event: string) => {
      console.log(`[Auth] Evento: ${event}`, s?.user?.email);

      // Condición estricta: solo activar carga si hay un cambio real de usuario
      if (inicializado.current && s?.user?.id && procesandoId.current !== s.user.id) {
        setCargando(true);
      }

      setSession(s);
      
      if (s?.user) {
        procesandoId.current = s.user.id;
        await cargarPerfil(s.user.id);
      } else {
        setPerfil(null);
        setEscuela(null);
        procesandoId.current = null;
      }

      setCargando(false);
      inicializado.current = true;
    };

    // Escuchar cambios de autenticación (onAuthStateChange emite INITIAL_SESSION automáticamente al montarse)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      procesarSesion(s, event);
    });

    return () => subscription.unsubscribe();
  }, []);

  const cerrarSesion = async (): Promise<void> => {
    await supabase.auth.signOut();
    setPerfil(null);
    setEscuela(null);
    setSession(null);
  };

  const tieneAcceso = perfil
    ? can(perfil.rol, 'saasport.access') && perfil.activo
    : false;

  const esSuperAdmin = perfil
    ? can(perfil.rol, 'school.manage') && perfil.activo
    : false;

  const puedeEliminar = perfil ? can(perfil.rol, 'finance.delete') && perfil.activo : false;

  const value = React.useMemo(() => ({
    session,
    perfil,
    escuela,
    cargando,
    tieneAcceso,
    esSuperAdmin,
    puedeEliminar,
    sucursalId: perfil?.sucursal_id ?? null,
    escuelaId: perfil?.escuela_id ?? null,
    cerrarSesion,
    recargarDatosAuth,
  }), [session, perfil, escuela, cargando, tieneAcceso, esSuperAdmin, puedeEliminar, cerrarSesion]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProviderSaaSport;
