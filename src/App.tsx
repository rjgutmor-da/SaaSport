/**
 * App.tsx — Punto de entrada principal de SaaSport.
 *
 * Cambios de integración:
 * - Usa AuthProviderSaaSport para control de roles
 * - Bloquea entrenadores con pantalla de acceso denegado
 * - Navbar: icono Settings → /configuraciones, botón LogOut separado
 * - Rutas: agregado /configuraciones/panel-escuela
 */
import React, { useEffect, useState, Suspense } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  Settings, Sun, Moon, Monitor, LogOut,
  HandCoins, PieChart, Landmark, BookOpen,
  School, Activity, BarChart2, Users
} from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import { AuthProviderSaaSport, useAuthSaaSport } from './lib/authHelper';
import { getAsisportUrl } from './lib/navegacion';
import { useIsMobile } from './hooks/useIsMobile';
import { MobileNav } from './components/MobileNav';
import { MobileHeader } from './components/MobileHeader';

// Estáticos — siempre en el bundle (móvil los necesita)
import Dashboard     from './pages/Dashboard';
import Login         from './pages/Login';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CajasBancos   from './pages/cajas-bancos/CajasBancos';

// Lazy — solo se descargan cuando el usuario navega a esa ruta
const CuentasPagar      = React.lazy(() => import('./pages/cxp/CuentasPagar'));
const Cuentas           = React.lazy(() => import('./pages/cuentas/Cuentas'));
const Configuraciones   = React.lazy(() => import('./pages/config/Configuraciones'));
const AuditLog          = React.lazy(() => import('./pages/config/AuditLog'));
const PanelEscuela      = React.lazy(() => import('./pages/config/PanelEscuela'));
const Estadisticas      = React.lazy(() => import('./pages/finanzas/estadisticas/Estadisticas'));
const RegistroActividad = React.lazy(() => import('./pages/finanzas/RegistroActividad'));
const GestorSucursales  = React.lazy(() => import('./pages/config/GestorSucursales'));
const AdminUsuarios     = React.lazy(() => import('./pages/config/AdminUsuarios'));
const ConfiguracionCanchas = React.lazy(() => import('./pages/config/ConfiguracionCanchas'));


import LogoPlaneta from './assets/LogoPlaneta.png';



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
  const { esSuperAdmin, escuela } = useAuthSaaSport();

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

        {esSuperAdmin && (
          <div className="sidebar-item-group">
            <NavLink to="/panel-escuela" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
              <School size={20} strokeWidth={1.5} />
              <span>Panel de Escuela</span>
            </NavLink>
          </div>
        )}

        <div className="sidebar-item-group">
          <NavLink to="/estadisticas" className={({ isActive }) => (isActive ? 'sidebar-link active' : 'sidebar-link')}>
            <BarChart2 size={20} strokeWidth={1.5} />
            <span>Estadísticas</span>
          </NavLink>
        </div>

        {/* Botón AsiSport Estético */}
        <div className="sidebar-asisport-container">
          <button 
            onClick={() => window.open(getAsisportUrl(), 'EcosistemaSaaSport')}
            className="sidebar-asisport-btn"
          >
            <Users size={24} className="asisport-icon" />
            <span className="asisport-text">AsiSport</span>
          </button>
        </div>

        {/* Sección de filtros/stats imbuidos */}
        {extra && (
          <div className="sidebar-extra">
            {extra}
          </div>
        )}
        <div className="sidebar-branding" style={{ 
          marginTop: 'auto', 
          padding: '1.5rem 0', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          textAlign: 'center',
          gap: '0.5rem',
          borderTop: '1px solid rgba(255,255,255,0.05)'
        }}>
          <img 
            src={escuela?.logo_url || LogoPlaneta} 
            alt={escuela?.nombre || "Logo Escuela"} 
            style={{ width: '160px', height: 'auto', maxHeight: '120px', objectFit: 'contain', transition: 'transform 0.3s ease' }} 
            className="hover-scale"
          />

        </div>
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
  const isMobile = useIsMobile();

  return (
    <SidebarContext.Provider value={{ setExtra }}>
      <div className="app-container">
        {!isMobile && <Sidebar onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme} extra={extra} />}
        {isMobile && <MobileHeader />}
        <div className="main-wrapper">
          {children}
        </div>
        {isMobile && <MobileNav />}
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
        SaaSport es el módulo financiero exclusivo para Administradores y SuperAdministradores.
        <br />Como <strong>{rol}</strong>, tu aplicación es <strong style={{ color: 'var(--primary)' }}>AsiSport</strong>.
      </p>
      <button
        onClick={() => window.open(getAsisportUrl(), 'EcosistemaSaaSport')}
        className="login-btn"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem' }}
      >
        Ir a AsiSport →
      </button>
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
  const isMobile = useIsMobile();

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
  if (perfil && !tieneAcceso) {
    return <AccesoDenegado rol={perfil.rol} onLogout={onLogout} />;
  }

  // Si no hay perfil pero cargando es false, algo falló al obtener los datos del usuario
  if (!perfil && !cargando) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center', gap: '1.5rem' }}>
          <div style={{ fontSize: '3rem' }}>⚠️</div>
          <h1 className="login-titulo">Error de Perfil</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            No pudimos cargar tu información de usuario. Esto puede deberse a un problema de conexión o a que tu cuenta no está configurada correctamente.
          </p>
          <button onClick={onLogout} className="login-btn">
            Intentar de nuevo (Cerrar Sesión)
          </button>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Layout onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme}>
        <Suspense fallback={
          <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
            Cargando módulo...
          </div>
        }>
          <Routes>
            {/* Rutas siempre disponibles (móvil y desktop) */}
            <Route path="/"              element={<CuentasCobrar />} />
            <Route path="/cxc"           element={<CuentasCobrar />} />
            <Route path="/cxp"           element={<CuentasPagar />} />
            <Route path="/cajas-bancos"  element={<CajasBancos />} />

            {/* Rutas solo para desktop — el celular nunca descarga estos módulos */}
            {!isMobile && (
              <>
                <Route path="/cuentas"            element={<Cuentas />} />
                <Route path="/estadisticas"       element={<Estadisticas />} />
                <Route path="/finanzas/registro-actividad" element={<RegistroActividad />} />
                <Route path="/configuraciones"    element={<Configuraciones />} />
                <Route path="/configuraciones/auditoria" element={<AuditLog />} />
                <Route path="/panel-escuela"      element={<PanelEscuela />} />
                <Route path="/configuraciones/panel-escuela" element={<PanelEscuela />} />
                <Route path="/panel-escuela/sucursales" element={<GestorSucursales />} />
                <Route path="/panel-escuela/usuarios" element={<AdminUsuarios />} />
                <Route path="/panel-escuela/canchas-horarios" element={<ConfiguracionCanchas />} />
              </>
            )}

            {/* Si un móvil intenta acceder a una ruta de desktop, redirigir al inicio */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
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
    const loginUrl = import.meta.env.VITE_URL_LOGIN || '';
    let resolvedLoginUrl = loginUrl;
    if (window.location.hostname !== 'finanzas.saasport.pro' && window.location.hostname !== 'saasport.pro') {
      if (loginUrl.includes('localhost') || loginUrl.includes('127.0.0.1') || /https?:\/\/\d+\.\d+\.\d+\.\d+/.test(loginUrl)) {
        const currentHostname = window.location.hostname;
        resolvedLoginUrl = loginUrl.replace(/(https?:\/\/)([^:/]+)(:\d+)?/, `$1${currentHostname}$3`);
      }
    }
    window.location.href = `${resolvedLoginUrl}?redirect=finanzas`;
    return null;
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
