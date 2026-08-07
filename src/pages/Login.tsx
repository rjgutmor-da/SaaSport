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
import { getAsisportUrl } from '../lib/navegacion';
import { Eye, EyeOff, AlertCircle, ShieldX } from 'lucide-react';
import { signInSaaSport } from '../lib/sessionLimit';

interface LoginProps {
  onLoginExitoso: () => void;
}

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
      const session = await signInSaaSport(emailLimpio, passLimpio);
      const { data, error: authError } = await supabase.auth.setSession(session);

      if (authError) {
        if (authError.message.includes('Invalid login credentials')) {
          throw new Error('Credenciales incorrectas. Verifica tu email y contraseña.');
        }
        throw new Error(authError.message || 'Error al conectar con el servidor.');
      }

      if (!data?.user) {
        throw new Error('El servidor no devolvió un usuario.');
      }

      // 2. ¡Acceso autorizado! (El AuthContext se encargará de verificar el perfil y los roles)
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
            SaaSport es el módulo financiero exclusivo para Administradores.
            <br />
            Como <strong>{rolUsuario}</strong>, tu aplicación es <strong style={{ color: 'var(--primary)' }}>AsiSport</strong>.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <a
              href={getAsisportUrl()}
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
          <h1 className="login-titulo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
            SaaSport
            <img src="/saasport-app-icon-v3.png" alt="Logo" style={{ width: '80px', height: '80px' }} />
          </h1>
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
              href={`${getAsisportUrl()}/recuperar-contrasena`}
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
