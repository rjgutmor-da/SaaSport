/**
 * Login.tsx
 * Pantalla de inicio de sesión para SaaSport.
 * Reutiliza los usuarios ya creados en AsiSport (misma base de datos Supabase).
 */
import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';

interface LoginProps {
  onLoginExitoso: () => void;
}

const Login: React.FC<LoginProps> = ({ onLoginExitoso }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);

  const manejarLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const { error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError) {
      // Mensajes en español
      if (authError.message.includes('Invalid login credentials')) {
        setError('Credenciales inválidas. Verifica tu email y contraseña.');
      } else if (authError.message.includes('Email not confirmed')) {
        setError('Tu email no ha sido confirmado. Revisa tu bandeja de entrada.');
      } else {
        setError(`Error de autenticación: ${authError.message}`);
      }
      setCargando(false);
      return;
    }

    onLoginExitoso();
    setCargando(false);
  };

  return (
    <div className="login-container">
      <div className="login-card">
        {/* Logo / Brand */}
        <div className="login-brand">
          <h1 className="login-titulo">SaaSport</h1>
          <p className="login-subtitulo">Módulo Financiero</p>
        </div>

        {/* Formulario */}
        <form className="login-form" onSubmit={manejarLogin}>
          {/* Email */}
          <div className="login-campo">
            <label htmlFor="login-email" className="login-label">Correo electrónico</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@correo.com"
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
              >
                {mostrarPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {/* Botón de login */}
          <button
            type="submit"
            className="login-btn"
            disabled={cargando}
          >
            {cargando ? (
              <span className="spin" style={{ display: 'inline-flex' }}>
                <LogIn size={18} />
              </span>
            ) : (
              <LogIn size={18} />
            )}
            {cargando ? 'Ingresando...' : 'Iniciar Sesión'}
          </button>
        </form>

        {/* Nota */}
        <p className="login-nota">
          Usa las mismas credenciales que en AsiSport
        </p>
      </div>
    </div>
  );
};

export default Login;
