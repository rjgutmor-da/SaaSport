/**
 * App.tsx — Punto de entrada principal de SaaSport.
 * Controla la autenticación, Layout persistente (Navbar) y todas las rutas.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Settings, Sun, Moon, Monitor } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import ContabilidadHub from './pages/finanzas/ContabilidadHub';
import PlanCuentas from './pages/finanzas/PlanCuentas';
import LibroDiario from './pages/finanzas/LibroDiario';
import RegistroActividad from './pages/finanzas/RegistroActividad';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CuentasPagar from './pages/cxp/CuentasPagar';
import Inventarios from './pages/inventarios/Inventarios';
import Configuraciones from './pages/config/Configuraciones';
import AuditLog from './pages/config/AuditLog';
import CajasBancos from './pages/cajas-bancos/CajasBancos';


/** Barra de navegación superior */
const Navbar = ({ onLogout, theme, onCycleTheme }: { onLogout: () => void; theme: string; onCycleTheme: () => void }) => {
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
          <NavLink to="/" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end>Inicio</NavLink>
        </li>
        <li>
          <NavLink to="/cxc" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>CxC</NavLink>
        </li>
        <li>
          <NavLink to="/cxp" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>CxP</NavLink>
        </li>
        <li>
          <NavLink to="/cajas-bancos" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Cajas y Bancos</NavLink>
        </li>
        <li>
          <NavLink to="/inventarios" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Inventarios</NavLink>
        </li>
        <li>
          <NavLink to="/contabilidad" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Contabilidad</NavLink>
        </li>
      </ul>
      <div className="nav-acciones" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button 
          className="nav-theme-toggle" 
          onClick={onCycleTheme} 
          title={getThemeTitle()}
          style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center' }}
        >
          {getThemeIcon()}
        </button>
        <button className="nav-config" onClick={onLogout} title="Cerrar sesión">
          <Settings size={22} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  );
};

/** Layout envolvente con Navbar persistente */
const Layout = ({ children, onLogout, theme, onCycleTheme }: { 
  children: React.ReactNode; 
  onLogout: () => void;
  theme: string;
  onCycleTheme: () => void;
}) => {
  return (
    <div className="app-container">
      <Navbar onLogout={onLogout} theme={theme} onCycleTheme={onCycleTheme} />
      {children}
    </div>
  );
};

/** Router interno (solo se renderiza cuando hay sesión) */
const AppRouter = ({ onLogout, theme, onCycleTheme }: { onLogout: () => void; theme: string; onCycleTheme: () => void }) => {
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

          {/* Módulos pendientes (placeholders) */}
          <Route path="/cxc" element={<CuentasCobrar />} />
          <Route path="/cxp" element={<CuentasPagar />} />
          <Route path="/inventarios" element={<Inventarios />} />
          <Route path="/cajas-bancos" element={<CajasBancos />} />
          <Route path="/configuraciones" element={<Configuraciones />} />
          <Route path="/configuraciones/auditoria" element={<AuditLog />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
};

function App() {
  const [sesion, setSesion] = useState<Session | null>(null);
  const [verificando, setVerificando] = useState(true);

  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>(() => {
    return (localStorage.getItem('theme') as any) || 'system';
  });

  useEffect(() => {
    // Aplicar atributo de tema a la raíz
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const cycleTheme = () => {
    if (theme === 'system') setTheme('light');
    else if (theme === 'light') setTheme('dark');
    else setTheme('system');
  };

  useEffect(() => {
    // Verificar sesión existente al cargar
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSesion(session);
      setVerificando(false);
    });

    // Escuchar cambios de autenticación
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSesion(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Función para cerrar sesión
  const cerrarSesion = async () => {
    await supabase.auth.signOut();
    setSesion(null);
  };

  // Estado de carga inicial
  if (verificando) {
    return (
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <h1 className="login-titulo">SaaSport</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem' }}>Verificando sesión...</p>
        </div>
      </div>
    );
  }

  // Si no hay sesión, mostrar login
  if (!sesion) {
    return <Login onLoginExitoso={() => { /* onAuthStateChange se encarga */ }} />;
  }

  // Si hay sesión, mostrar la app completa
  return <AppRouter onLogout={cerrarSesion} theme={theme} onCycleTheme={cycleTheme} />;
}

export default App;
