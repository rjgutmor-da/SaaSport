/**
 * App.tsx — Punto de entrada principal de SaaSport.
 *
 * Cambios de integración:
 * - Usa AuthProviderSaaSport para control de roles
 * - Bloquea entrenadores con pantalla de acceso denegado
 * - Navbar: icono Settings → /configuraciones, botón LogOut separado
 * - Rutas: agregado /configuraciones/panel-escuela
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Settings, Sun, Moon, Monitor, LogOut } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { AuthProviderSaaSport, useAuthSaaSport } from './lib/authHelper';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import ContabilidadHub from './pages/finanzas/ContabilidadHub';
import PlanCuentas from './pages/finanzas/PlanCuentas';
import LibroDiario from './pages/finanzas/LibroDiario';
import RegistroActividad from './pages/finanzas/RegistroActividad';
import Estadisticas from './pages/finanzas/estadisticas/Estadisticas';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CuentasPagar from './pages/cxp/CuentasPagar';
import Inventarios from './pages/inventarios/Inventarios';
import Configuraciones from './pages/config/Configuraciones';
import AuditLog from './pages/config/AuditLog';
import PanelEscuela from './pages/config/PanelEscuela';
import CajasBancos from './pages/cajas-bancos/CajasBancos';

const ASISPORT_URL = 'https://asisport.saasport.pro';

// ─── Navbar ────────────────────────────────────────────────────────────────

interface NavbarProps {
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ onLogout, theme, onCycleTheme }) => {
  const getThemeIcon = () => {
    if (theme === 'light') return <Sun size={20} />;
    if (theme === 'dark') return <Moon size={20} />;
    return <Monitor size={20} />;
  };

  const getThemeTitle = () => {
    if (theme === 'light') return 'Modo Claro';
    if (theme === 'dark') return 'Modo Oscuro';
    return 'Predeterminado del Sistema';
  };

  return (
    <nav className="navbar">
      <div className="nav-brand">SaaSport</div>
      <ul className="nav-links">
        <li>
          <NavLink to="/" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end>
            Inicio
          </NavLink>
        </li>
        <li>
          <NavLink to="/cxc" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>CxC</NavLink>
        </li>
        <li>
          <NavLink to="/cxp" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>CxP</NavLink>
        </li>
        <li>
          <NavLink to="/cajas-bancos" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Cajas y Bancos
          </NavLink>
        </li>
        <li>
          <NavLink to="/inventarios" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Inventarios
          </NavLink>
        </li>
        <li>
          <NavLink to="/contabilidad" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
            Contabilidad
          </NavLink>
        </li>
      </ul>
      <div className="nav-acciones" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        {/* Selector de tema */}
        <button
          className="nav-theme-toggle"
          onClick={onCycleTheme}
          title={getThemeTitle()}
          style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
        >
          {getThemeIcon()}
        </button>

        {/* Configuraciones → navega a /configuraciones */}
        <NavLink
          to="/configuraciones"
          className="nav-config"
          title="Configuraciones"
          style={{ display: 'flex', alignItems: 'center' }}
        >
          <Settings size={22} strokeWidth={1.5} />
        </NavLink>

        {/* Cerrar sesión (separado) */}
        <button
          className="nav-config"
          onClick={onLogout}
          title="Cerrar sesión"
          style={{ display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
        >
          <LogOut size={20} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  );
};

// ─── Layout ─────────────────────────────────────────────────────────────────

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, onLogout, theme, onCycleTheme }) => (
  <div className="app-container">
    <Navbar onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme} />
    {children}
  </div>
);

// ─── Pantalla de acceso denegado por rol ─────────────────────────────────────

const AccesoDenegado: React.FC<{ rol: string; onLogout: () => void }> = ({ rol, onLogout }) => (
  <div className="login-container">
    <div className="login-card" style={{ textAlign: 'center', gap: '1.5rem' }}>
      <div style={{ fontSize: '3rem' }}>🚫</div>
      <div className="login-brand">
        <h1 className="login-titulo" style={{ color: 'var(--error)' }}>Acceso Restringido</h1>
        <p className="login-subtitulo">
          Tu rol de <strong style={{ color: 'var(--text-primary)' }}>{rol}</strong> no tiene acceso a SaaSport.
        </p>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: '1.7' }}>
        SaaSport es el módulo financiero para Administradores y Dueños.
        <br />Como <strong>{rol}</strong>, tu aplicación es <strong style={{ color: 'var(--primary)' }}>AsiSport</strong>.
      </p>
      <a
        href={ASISPORT_URL}
        className="login-btn"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
      >
        Ir a AsiSport →
      </a>
      <button onClick={onLogout} style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', cursor: 'pointer' }}>
        Cerrar sesión
      </button>
    </div>
  </div>
);

// ─── Router interno con control de acceso ────────────────────────────────────

interface AppRouterProps {
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
}

const AppRouter: React.FC<AppRouterProps> = ({ onLogout, theme, onCycleTheme }) => {
  const { tieneAcceso, perfil, cargando } = useAuthSaaSport();

  if (cargando) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 className="login-titulo">SaaSport</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Verificando permisos...</p>
        </div>
      </div>
    );
  }

  // Bloquear roles no permitidos (entrenadores, etc.)
  if (!tieneAcceso && perfil) {
    return <AccesoDenegado rol={perfil.rol} onLogout={onLogout} />;
  }

  return (
    <BrowserRouter>
      <Layout onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme}>
        <Routes>
          {/* Dashboard principal */}
          <Route path="/" element={<Dashboard />} />

          {/* Módulo Contabilidad (sub-rutas) */}
          <Route path="/contabilidad" element={<ContabilidadHub />} />
          <Route path="/contabilidad/plan-cuentas" element={<PlanCuentas />} />
          <Route path="/contabilidad/libro-diario" element={<LibroDiario />} />
          <Route path="/contabilidad/registro-actividad" element={<RegistroActividad />} />
          <Route path="/contabilidad/estadisticas" element={<Estadisticas />} />

          {/* Módulos financieros */}
          <Route path="/cxc" element={<CuentasCobrar />} />
          <Route path="/cxp" element={<CuentasPagar />} />
          <Route path="/inventarios" element={<Inventarios />} />
          <Route path="/cajas-bancos" element={<CajasBancos />} />

          {/* Configuraciones */}
          <Route path="/configuraciones" element={<Configuraciones />} />
          <Route path="/configuraciones/auditoria" element={<AuditLog />} />
          <Route path="/configuraciones/panel-escuela" element={<PanelEscuela />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

// ─── Componente raíz ─────────────────────────────────────────────────────────

function AppInterna() {
  const { session, cargando, cerrarSesion } = useAuthSaaSport();

  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() =>
    (localStorage.getItem('theme') as any) || 'system'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  // Carga inicial
  if (cargando) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 className="login-titulo">SaaSport</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Verificando sesión...</p>
        </div>
      </div>
    );
  }

  // Sin sesión → login
  if (!session) {
    return <Login onLoginExitoso={() => { /* onAuthStateChange lo maneja */ }} />;
  }

  // Con sesión → app completa
  return <AppRouter onLogout={cerrarSesion} theme={theme} onCycleTheme={cycleTheme} />;
}

// ─── Export con provider ──────────────────────────────────────────────────────

function App() {
  return (
    <AuthProviderSaaSport>
      <AppInterna />
    </AuthProviderSaaSport>
  );
}

export default App;
