/**
 * Login.tsx — Pantalla de inicio de sesión para SaaSport.
 *
 * Rediseñada para igualar la estética de AsisPort:
 * - Fondo oscuro con card central
 * - Validación de credenciales + verificación de rol
 * - Solo Admin, Dueño y SuperAdministrador pueden acceder a SaaSport
 * - Entrenadores reciben mensaje claro de acceso denegado
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Eye, EyeOff, AlertCircle, ShieldX } from 'lucide-react';

interface LoginProps {
  onLoginExitoso: () => void;
}

/** Roles que tienen acceso a SaaSport */
const ROLES_PERMITIDOS = ['SuperAdministrador', 'Dueño', 'Administrador'];
const ASISPORT_URL = 'https://asisport.saasport.pro';

const Login: React.FC<LoginProps> = ({ onLoginExitoso }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [accesoRolDenegado, setAccesoRolDenegado] = useState(false);
  const [rolUsuario, setRolUsuario] = useState<string | null>(null);

  // Limpiar error al escribir
  useEffect(() => {
    if (error && !accesoRolDenegado) setError(null);
  }, [email, password]);

  const manejarLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setAccesoRolDenegado(false);
    setCargando(true);

    const emailLimpio = email.trim();
    const passLimpio = password.trim();

    if (!emailLimpio || !passLimpio) {
      setError('Por favor, completa todos los campos.');
      setCargando(false);
      return;
    }

    try {
      // 1. Autenticación con Supabase
      const { data, error: authError } = await supabase.auth.signInWithPassword({
        email: emailLimpio,
        password: passLimpio,
      });

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Credenciales incorrectas. Verifica tu email y contraseña.');
        }
        throw new Error(authError.message || 'Error al conectar con el servidor.');
      }

      if (!data?.user) {
        throw new Error('El servidor no devolvió un usuario.');
      }

      // 2. Verificar el rol del usuario en la tabla usuarios
      const { data: perfil, error: perfilError } = await supabase
        .from('usuarios')
        .select('rol, activo')
        .eq('id', data.user.id)
        .single();

      if (perfilError || !perfil) {
        // Si no hay perfil, cerrar sesión y mostrar error
        await supabase.auth.signOut();
        throw new Error('No se encontró tu perfil de usuario. Contacta al administrador.');
      }

      if (!perfil.activo) {
        await supabase.auth.signOut();
        throw new Error('Tu cuenta está desactivada. Contacta al administrador.');
      }

      // 3. Verificar que el rol tenga acceso a SaaSport
      if (!ROLES_PERMITIDOS.includes(perfil.rol)) {
        // Rol no permitido → cerrar sesión y mostrar pantalla de acceso denegado
        await supabase.auth.signOut();
        setRolUsuario(perfil.rol);
        setAccesoRolDenegado(true);
        setCargando(false);
        return;
      }

      // 4. ¡Acceso autorizado!
      onLoginExitoso();

    } catch (err: any) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  // === Pantalla de acceso denegado por rol ===
  if (accesoRolDenegado) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center', gap: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.5rem' }}>
            <ShieldX size={56} style={{ color: 'var(--error)' }} />
          </div>
          <div className="login-brand">
            <h1 className="login-titulo" style={{ color: 'var(--error)' }}>Acceso Denegado</h1>
            <p className="login-subtitulo">
              Tu rol de <strong style={{ color: 'var(--text-primary)' }}>{rolUsuario}</strong> no tiene acceso a SaaSport.
            </p>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.6' }}>
            SaaSport es el módulo financiero exclusivo para Administradores y Dueños.
            <br />
            Como <strong>{rolUsuario}</strong>, tu aplicación es <strong style={{ color: 'var(--primary)' }}>AsiSport</strong>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <a
              href={ASISPORT_URL}
              className="login-btn"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
            >
              Ir a AsiSport →
            </a>
            <button
              className="btn-volver"
              onClick={() => {
                setAccesoRolDenegado(false);
                setRolUsuario(null);
                setEmail('');
                setPassword('');
              }}
              style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', cursor: 'pointer' }}
            >
              ← Intentar con otra cuenta
            </button>
          </div>
        </div>
      </div>
    );
  }

  // === Pantalla principal de login ===
  return (
    <div className="login-container">
      <div className="login-card">

        {/* Logo / Brand */}
        <div className="login-brand">
          <h1 className="login-titulo">SaaSport</h1>
          <p className="login-subtitulo">Gestión financiera de tu academia deportiva</p>
        </div>

        {/* Formulario */}
        <form className="login-form" onSubmit={manejarLogin} noValidate>

          {/* Email */}
          <div className="login-campo">
            <label htmlFor="login-email" className="login-label">Correo electrónico</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="administrador@escuela.com"
              required
              className="login-input"
              autoComplete="email"
              disabled={cargando}
            />
          </div>

          {/* Contraseña */}
          <div className="login-campo">
            <label htmlFor="login-password" className="login-label">Contraseña</label>
            <div className="login-password-wrapper">
              <input
                id="login-password"
                type={mostrarPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="login-input"
                autoComplete="current-password"
                disabled={cargando}
              />
              <button
                type="button"
                className="login-toggle-password"
                onClick={() => setMostrarPassword(!mostrarPassword)}
                tabIndex={-1}
                aria-label={mostrarPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {mostrarPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error" role="alert">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Botón de login */}
          <button
            type="submit"
            className="login-btn"
            id="btn-iniciar-sesion"
            disabled={cargando}
          >
            {cargando ? (
              <>
                <span className="spin" style={{ display: 'inline-flex' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                  </svg>
                </span>
                Verificando...
              </>
            ) : (
              'Iniciar Sesión'
            )}
          </button>
        </form>

        {/* Nota de recuperación → se redirige a AsisPort */}
        <div style={{ textAlign: 'center', marginTop: '0.5rem' }}>
          <p className="login-nota">
            ¿Olvidaste tu contraseña?{' '}
            <a
              href={`${ASISPORT_URL}/recuperar-contrasena`}
              style={{ color: 'var(--primary)', textDecoration: 'none' }}
            >
              Recupérala en AsiSport
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
