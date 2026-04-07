/**
 * CuentasPagar.tsx
 * Pantalla principal del módulo Cuentas por Pagar (CxP).
 *
 * Muestra 4 tarjetas de acceso:
 *   1. Proveedores  — Notas de Pago a proveedores de uniformes/materiales
 *   2. Trabajadores — Notas de Pago de sueldos al personal
 *   3. Gastos Corrientes — Otros gastos operativos
 *   4. Administrar  — CRUD de proveedores y trabajadores
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  ChevronLeft, RefreshCw, Truck, Users, Zap, Settings,
  DollarSign, TrendingDown, Clock, CheckCircle2, Plus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Componentes del módulo
import ListadoCxP from '../../components/cxp/ListadoCxP';
import NotaPago from '../../components/cxp/NotaPago';
import AdminEntidadesCxP from '../../components/cxp/AdminEntidadesCxP';

/** Tipo de vista activa en el módulo */
type VistaActiva = 'menu' | 'proveedores' | 'trabajadores' | 'gastos' | 'admin';

/** Resumen estadístico del módulo */
interface ResumenCxP {
  totalPendiente: number;
  totalPagado: number;
  notasPendientes: number;
  notasHoy: number;
}

/** Formatea número como moneda boliviana */
const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CuentasPagar: React.FC = () => {
  const navigate = useNavigate();

  // Estado de la vista activa
  const [vista, setVista] = useState<VistaActiva>('menu');

  // Resumen global para las tarjetas de estadísticas
  const [resumen, setResumen] = useState<ResumenCxP>({
    totalPendiente: 0, totalPagado: 0, notasPendientes: 0, notasHoy: 0
  });
  const [cargandoResumen, setCargandoResumen] = useState(true);

  // Control del modal de Nueva Nota de Pago
  const [mostrarNota, setMostrarNota] = useState(false);
  const [tipoNotaInicial, setTipoNotaInicial] = useState<'proveedor' | 'personal' | 'gasto_corriente'>('proveedor');
  const [refreshKey, setRefreshKey] = useState(0);

  /** Carga el resumen de CxP para mostrar en las tarjetas */
  const cargarResumen = async () => {
    setCargandoResumen(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCargandoResumen(false); return; }

    const { data: usr } = await supabase
      .from('usuarios').select('escuela_id').eq('id', user.id).single();
    if (!usr?.escuela_id) { setCargandoResumen(false); return; }

    const { data } = await supabase
      .from('v_estado_cuentas_pagar')
      .select('monto_total, monto_pagado, estado, fecha_emision')
      .eq('escuela_id', usr.escuela_id);

    if (data) {
      const hoy = new Date().toISOString().split('T')[0];
      setResumen({
        totalPendiente: data.reduce((s, r) => s + (r.estado !== 'pagada' ? Number(r.monto_total) - Number(r.monto_pagado) : 0), 0),
        totalPagado: data.reduce((s, r) => s + Number(r.monto_pagado), 0),
        notasPendientes: data.filter(r => r.estado !== 'pagada').length,
        notasHoy: data.filter(r => r.fecha_emision === hoy).length,
      });
    }
    setCargandoResumen(false);
  };

  useEffect(() => { cargarResumen(); }, [refreshKey]);

  /** Abre la nota de pago para el tipo dado */
  const abrirNuevaNota = (tipo: 'proveedor' | 'personal' | 'gasto_corriente') => {
    setTipoNotaInicial(tipo);
    setMostrarNota(true);
  };

  // =========== TARJETAS DE MENÚ ===========
  const tarjetas = [
    {
      id: 'proveedores' as VistaActiva,
      titulo: 'Proveedores',
      subtitulo: 'Uniformes, materiales e insumos',
      icono: <Truck size={60} strokeWidth={1.5} />,
      hoverClass: 'hover-color-orange',
      tipo: 'proveedor' as const,
    },
    {
      id: 'trabajadores' as VistaActiva,
      titulo: 'Trabajadores',
      subtitulo: 'Sueldos y pagos al personal',
      icono: <Users size={60} strokeWidth={1.5} />,
      hoverClass: 'hover-color-green',
      tipo: 'personal' as const,
    },
    {
      id: 'gastos' as VistaActiva,
      titulo: 'Gastos Corrientes',
      subtitulo: 'Servicios, alquileres y otros gastos',
      icono: <Zap size={60} strokeWidth={1.5} />,
      hoverClass: 'hover-color-blue',
      tipo: 'gasto_corriente' as const,
    },
    {
      id: 'admin' as VistaActiva,
      titulo: 'Administrar',
      subtitulo: 'Registrar y editar proveedores y personal',
      icono: <Settings size={60} strokeWidth={1.5} />,
      hoverClass: 'hover-color-orange',
      tipo: null,
    },
  ];

  // =========== RENDER MENÚ PRINCIPAL ===========
  if (vista === 'menu') {
    return (
      <main className="main-content">
        {/* Header */}
        <div className="pc-header">
          <div className="pc-header-izq">
            <button className="btn-volver" onClick={() => navigate('/')} title="Volver al Dashboard">
              <ChevronLeft size={20} />
            </button>
            <div>
              <h1 className="pc-titulo">
                <TrendingDown size={28} style={{ marginRight: '0.5rem' }} />
                Cuentas por Pagar
              </h1>
              <p className="pc-subtitulo">
                Gestión de egresos — Proveedores, personal y gastos operativos
              </p>
            </div>
          </div>
          <div className="pc-header-acciones">
            <button className="btn-refrescar" onClick={cargarResumen} disabled={cargandoResumen}>
              <RefreshCw size={18} className={cargandoResumen ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* Tarjetas de estadísticas globales */}
        <div className="cxc-stats" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
          <div className="cxc-stat-card" style={{ flex: 1, borderColor: 'var(--danger-bg)' }}>
            <TrendingDown size={18} style={{ color: 'var(--danger)' }} />
            <div>
              <span className="cxc-stat-num" style={{ color: 'var(--danger)' }}>
                Bs {fmtMonto(resumen.totalPendiente)}
              </span>
              <span className="cxc-stat-label">Total pendiente</span>
            </div>
          </div>
          <div className="cxc-stat-card" style={{ flex: 1, borderColor: 'var(--success-bg)' }}>
            <CheckCircle2 size={18} style={{ color: 'var(--success)' }} />
            <div>
              <span className="cxc-stat-num" style={{ color: 'var(--success)' }}>
                Bs {fmtMonto(resumen.totalPagado)}
              </span>
              <span className="cxc-stat-label">Total pagado</span>
            </div>
          </div>
          <div className="cxc-stat-card" style={{ flex: 1 }}>
            <Clock size={18} />
            <div>
              <span className="cxc-stat-num">{resumen.notasPendientes}</span>
              <span className="cxc-stat-label">Notas pendientes</span>
            </div>
          </div>
          <div className="cxc-stat-card" style={{ flex: 1 }}>
            <DollarSign size={18} />
            <div>
              <span className="cxc-stat-num">{resumen.notasHoy}</span>
              <span className="cxc-stat-label">Emitidas hoy</span>
            </div>
          </div>
        </div>

        {/* Cuadrícula de 4 tarjetas */}
        <div className="cxp-menu-grid">
          {tarjetas.map(t => (
            <div
              key={t.id}
              className={`cxp-menu-card ${t.hoverClass}`}
              onClick={() => setVista(t.id)}
            >
              <div className="card-icon">{t.icono}</div>
              <div className="cxp-card-info">
                <span className="card-title">{t.titulo}</span>
                <span className="cxp-card-sub" style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>{t.subtitulo}</span>
              </div>
              {t.tipo && (
                <button
                  className="cxp-card-btn-nuevo"
                  style={{ background: 'var(--bg-glass)' }}
                  onClick={e => { e.stopPropagation(); abrirNuevaNota(t.tipo!); }}
                  title={`Nueva Nota de Pago — ${t.titulo}`}
                >
                  <Plus size={16} /> Nueva Nota
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Modal: Nueva Nota de Pago (desde el menú) */}
        <NotaPago
          visible={mostrarNota}
          tipoInicial={tipoNotaInicial}
          onCerrar={() => setMostrarNota(false)}
          onCreada={() => { setRefreshKey(k => k + 1); setMostrarNota(false); }}
        />
      </main>
    );
  }

  // =========== VISTA PANEL DE ADMINISTRACIÓN ===========
  if (vista === 'admin') {
    return (
      <AdminEntidadesCxP onVolver={() => setVista('menu')} />
    );
  }

  // =========== VISTAS DE LISTADO (Proveedores / Trabajadores / Gastos) ===========
  const configVista = {
    proveedores: { titulo: 'Proveedores', tipo: 'proveedor' as const, icono: <Truck size={22} />, color: 'var(--secondary)' },
    trabajadores: { titulo: 'Trabajadores', tipo: 'personal' as const, icono: <Users size={22} />, color: 'var(--success)' },
    gastos: { titulo: 'Gastos Corrientes', tipo: 'gasto_corriente' as const, icono: <Zap size={22} />, color: 'var(--warning)' },
  }[vista as 'proveedores' | 'trabajadores' | 'gastos'];

  return (
    <ListadoCxP
      titulo={configVista.titulo}
      tipoGasto={configVista.tipo}
      iconoTitulo={configVista.icono}
      colorAccento={configVista.color}
      onVolver={() => setVista('menu')}
    />
  );
};

export default CuentasPagar;
