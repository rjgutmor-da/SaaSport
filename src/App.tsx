/**
 * App.tsx — Punto de entrada principal de SaaSport.
 * Controla la autenticación, Layout persistente (Navbar) y todas las rutas.
 */
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { supabase } from './lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import FinanzasHub from './pages/finanzas/FinanzasHub';
import PlanCuentas from './pages/finanzas/PlanCuentas';
import LibroDiario from './pages/finanzas/LibroDiario';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CuentasPagar from './pages/cxp/CuentasPagar';
import Inventarios from './pages/inventarios/Inventarios';
import Configuraciones from './pages/config/Configuraciones';
import AuditLog from './pages/config/AuditLog';
import CajasBancos from './pages/cajas-bancos/CajasBancos';


/** Barra de navegación superior */
const Navbar = ({ onLogout }: { onLogout: () => void }) => {
  return (
    <nav className="navbar">
      <div className="nav-brand">SaaSport</div>
      <ul className="nav-links">
        <li>
          <NavLink to="/" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')} end>Inicio</NavLink>
        </li>
        <li>
          <NavLink to="/cxc" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Cuentas x Cobrar</NavLink>
        </li>
        <li>
          <NavLink to="/cxp" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Cuentas x Pagar</NavLink>
        </li>
        <li>
          <NavLink to="/inventarios" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Inventarios</NavLink>
        </li>
        <li>
          <NavLink to="/finanzas" className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>Finanzas</NavLink>
        </li>
      </ul>
      <div className="nav-acciones">
        <button className="nav-config" onClick={onLogout} title="Cerrar sesión">
          <Settings size={32} strokeWidth={1.5} />
        </button>
      </div>
    </nav>
  );
};

/** Layout envolvente con Navbar persistente */
const Layout = ({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) => {
  return (
    <div className="app-container">
      <Navbar onLogout={onLogout} />
      {children}
    </div>
  );
};

/** Router interno (solo se renderiza cuando hay sesión) */
const AppRouter = ({ onLogout }: { onLogout: () => void }) => {
  return (
    <BrowserRouter>
      <Layout onLogout={onLogout}>
        <Routes>
          {/* Dashboard principal */}
          <Route path="/" element={<Dashboard />} />

          {/* Módulo Finanzas (sub-rutas) */}
          <Route path="/finanzas" element={<FinanzasHub />} />
          <Route path="/finanzas/plan-cuentas" element={<PlanCuentas />} />
          <Route path="/finanzas/libro-diario" element={<LibroDiario />} />

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
  return <AppRouter onLogout={cerrarSesion} />;
}

export default App;
