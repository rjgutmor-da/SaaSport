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
import { 
  Settings, Sun, Moon, Monitor, LogOut, 
  HandCoins, PieChart, Landmark, BookOpen, Package
} from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { AuthProviderSaaSport, useAuthSaaSport } from './lib/authHelper';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CuentasPagar from './pages/cxp/CuentasPagar';
import Cuentas from './pages/cuentas/Cuentas';
import Configuraciones from './pages/config/Configuraciones';
import AuditLog from './pages/config/AuditLog';
import PanelEscuela from './pages/config/PanelEscuela';
import CajasBancos from './pages/cajas-bancos/CajasBancos';

const ASISPORT_URL = 'https://asisport.saasport.pro';

// ─── Sidebar Context ─────────────────────────────────────────────────────────

export const SidebarContext = React.createContext<{
  setExtra: (content: React.ReactNode) => void;
}>({ setExtra: () => {} });

// ─── Sidebar ────────────────────────────────────────────────────────────────

interface SidebarProps {
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
  extra?: React.ReactNode;
}

const Sidebar: React.FC<SidebarProps> = ({ onLogout, theme, onCycleTheme, extra }) => {
  const getThemeIcon = () => {
    if (theme === 'light') return <Sun size={18} />;
    if (theme === 'dark') return <Moon size={18} />;
    return <Monitor size={18} />;
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        SaaSport
        <img src="/saasport-app-icon-v3.png" alt="Logo" style={{ width: '42px', height: '42px' }} />
      </div>
      
      <nav className="sidebar-nav">
        <div className="sidebar-item-group">
          <NavLink to="/cxc" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
            <HandCoins size={20} strokeWidth={1.5} />
            <span>Alumnos (CxC)</span>
          </NavLink>
        </div>
        
        <div className="sidebar-item-group">
          <NavLink to="/cxp" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
            <PieChart size={20} strokeWidth={1.5} />
            <span>Proveedores (CxP)</span>
          </NavLink>
        </div>
        
        <div className="sidebar-item-group">
          <NavLink to="/cajas-bancos" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
            <Landmark size={20} strokeWidth={1.5} />
            <span>Cajas y Bancos</span>
          </NavLink>
        </div>

        <div className="sidebar-item-group">
          <NavLink to="/cuentas" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
            <BookOpen size={20} strokeWidth={1.5} />
            <span>Cuentas</span>
          </NavLink>
        </div>

        {/* Sección de filtros/stats imbuidos */}
        {extra && (
          <div className="sidebar-extra">
            {extra}
          </div>
        )}
      </nav>

      <div className="sidebar-footer">
        <button className="sidebar-link" onClick={onCycleTheme} title="Cambiar tema">
          {getThemeIcon()}
          <span>Tema: {theme === 'system' ? 'Sistema' : theme === 'light' ? 'Claro' : 'Oscuro'}</span>
        </button>

        <NavLink to="/configuraciones" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
          <Settings size={20} strokeWidth={1.5} />
          <span>Configuraciones</span>
        </NavLink>

        <button className="sidebar-link" onClick={onLogout} style={{ color: 'var(--danger)' }}>
          <LogOut size={20} strokeWidth={1.5} />
          <span>Cerrar Sesión</span>
        </button>
      </div>
    </aside>
  );
};

// ─── Layout ─────────────────────────────────────────────────────────────────

interface LayoutProps {
  children: React.ReactNode;
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
}

const Layout: React.FC<LayoutProps> = ({ children, onLogout, theme, onCycleTheme }) => {
  const [extra, setExtra] = useState<React.ReactNode>(null);

  return (
    <SidebarContext.Provider value={{ setExtra }}>
      <div className="app-container">
        <Sidebar onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme} extra={extra} />
        <div className="main-wrapper">
          {children}
        </div>
      </div>
    </SidebarContext.Provider>
  );
};

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
          <h1 className="login-titulo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
            SaaSport
            <img src="/saasport-app-icon-v3.png" alt="Logo" style={{ width: '72px', height: '72px' }} />
          </h1>
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
          {/* Al abrir se ve siempre primero Alumnos */}
          <Route path="/" element={<CuentasCobrar />} />

          <Route path="/cxc" element={<CuentasCobrar />} />
          <Route path="/cxp" element={<CuentasPagar />} />
          <Route path="/cuentas" element={<Cuentas />} />
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
          <h1 className="login-titulo" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
            SaaSport
            <img src="/saasport-app-icon-v3.png" alt="Logo" style={{ width: '72px', height: '72px' }} />
          </h1>
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
