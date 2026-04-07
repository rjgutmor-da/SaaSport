/**
 * ListadoCxP.tsx
 * Lista de Notas de Pago filtradas por tipo de gasto:
 * proveedores, personal (trabajadores) o gastos corrientes.
 * Permite ver el estado de cada nota y registrar pagos.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  ChevronLeft, RefreshCw, Plus, Search, DollarSign,
  Clock, CheckCircle2, AlertTriangle, Eye
} from 'lucide-react';
import NotaPago from './NotaPago';
import DetalleCxP from './DetalleCxP';

/** Formato de una CxP para el listado */
interface CxPItem {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  proveedor_id: string | null;
  personal_id: string | null;
  cuenta_contable_id: string | null;
  tipo_gasto: string;
  estado: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  descripcion: string | null;
  observaciones: string | null;
  // Datos de la entidad relacionada
  proveedor_nombre?: string;
  personal_nombre?: string;
}

interface Props {
  titulo: string;
  tipoGasto: 'proveedor' | 'personal' | 'gasto_corriente';
  iconoTitulo: React.ReactNode;
  colorAccento: string;
  onVolver: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (f: string) => {
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
};

const BADGE_ESTADOS: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
  parcial:   { label: 'Parcial',   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
  pagada:    { label: 'Pagada',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  vencida:   { label: 'Vencida',   color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

const ListadoCxP: React.FC<Props> = ({ titulo, tipoGasto, iconoTitulo, colorAccento, onVolver }) => {
  const [notas, setNotas] = useState<CxPItem[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');

  // Modales
  const [mostrarNota, setMostrarNota] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<CxPItem | null>(null);

  /** Obtiene el contexto del usuario */
  const obtenerEscuelaId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    return data?.escuela_id ?? null;
  };

  /** Carga las notas de pago del tipo indicado */
  const cargarNotas = async () => {
    setCargando(true);
    setError(null);
    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) { setError('Error de autenticación.'); setCargando(false); return; }

    // Consultar la vista v_estado_cuentas_pagar uniendo con proveedores y personal
    const { data, error: err } = await supabase
      .from('v_estado_cuentas_pagar')
      .select(`
        id, escuela_id, sucursal_id, proveedor_id, personal_id,
        tipo_gasto, estado, monto_total, monto_pagado, deuda_restante,
        fecha_emision, fecha_vencimiento, descripcion, observaciones
      `)
      .eq('escuela_id', escuelaId)
      .eq('tipo_gasto', tipoGasto)
      .order('fecha_emision', { ascending: false });

    if (err) { setError(`Error al cargar: ${err.message}`); setCargando(false); return; }

    // Enriquecer con nombres de proveedores/personal
    const notasRaw = (data ?? []) as any[];

    // Obtener IDs de proveedores y personal únicos
    const provIds = [...new Set(notasRaw.filter(n => n.proveedor_id).map(n => n.proveedor_id))];
    const persIds = [...new Set(notasRaw.filter(n => n.personal_id).map(n => n.personal_id))];

    let provMap: Record<string, string> = {};
    let persMap: Record<string, string> = {};

    if (provIds.length > 0) {
      const { data: provs } = await supabase
        .from('proveedores').select('id, nombre').in('id', provIds);
      provMap = Object.fromEntries((provs ?? []).map(p => [p.id, p.nombre]));
    }

    if (persIds.length > 0) {
      const { data: pers } = await supabase
        .from('personal').select('id, nombres, apellidos').in('id', persIds);
      persMap = Object.fromEntries((pers ?? []).map(p => [p.id, `${p.nombres} ${p.apellidos}`]));
    }

    const notasEnriquecidas: CxPItem[] = notasRaw.map(n => ({
      ...n,
      monto_total: Number(n.monto_total),
      monto_pagado: Number(n.monto_pagado),
      deuda_restante: Number(n.deuda_restante),
      proveedor_nombre: n.proveedor_id ? provMap[n.proveedor_id] : undefined,
      personal_nombre: n.personal_id ? persMap[n.personal_id] : undefined,
    }));

    setNotas(notasEnriquecidas);
    setCargando(false);
  };

  useEffect(() => { cargarNotas(); }, [tipoGasto]);

  /** Nombre visible de la entidad pagada */
  const nombreEntidad = (n: CxPItem) =>
    n.proveedor_nombre || n.personal_nombre || n.descripcion || '(Sin asignar)';

  /** Filtrado */
  const notasFiltradas = useMemo(() => {
    let lista = notas;
    if (filtroEstado) lista = lista.filter(n => n.estado === filtroEstado);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(n =>
        (n.proveedor_nombre || '').toLowerCase().includes(q) ||
        (n.personal_nombre || '').toLowerCase().includes(q) ||
        (n.descripcion || '').toLowerCase().includes(q)
      );
    }
    return lista;
  }, [notas, filtroEstado, busqueda]);

  /** Estadísticas */
  const stats = useMemo(() => ({
    total: notas.length,
    pendiente: notas.filter(n => n.estado !== 'pagada').length,
    montoPendiente: notas.reduce((s, n) => s + n.deuda_restante, 0),
    montoPagado: notas.reduce((s, n) => s + n.monto_pagado, 0),
  }), [notas]);

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={onVolver} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo" style={{ color: colorAccento }}>
              {iconoTitulo}
              <span style={{ marginLeft: '0.5rem' }}>{titulo}</span>
            </h1>
            <p className="pc-subtitulo">
              {stats.total} notas — <strong style={{ color: '#facc15' }}>{stats.pendiente} pendientes</strong>
              {' '} — Por pagar: <strong style={{ color: '#f87171' }}>Bs {fmtMonto(stats.montoPendiente)}</strong>
            </p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button
            className="btn-nueva-cuenta"
            style={{ background: colorAccento }}
            onClick={() => setMostrarNota(true)}
          >
            <Plus size={18} /> Nueva Nota
          </button>
          <button className="btn-refrescar" onClick={cargarNotas} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Estadísticas */}
      <div className="cxc-stats" style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="cxc-stat-card" style={{ flex: 1 }}>
          <DollarSign size={18} />
          <div>
            <span className="cxc-stat-num">{stats.total}</span>
            <span className="cxc-stat-label">Total notas</span>
          </div>
        </div>
        <div className="cxc-stat-card" style={{ flex: 1, borderColor: 'rgba(250,204,21,0.3)' }}>
          <Clock size={18} style={{ color: '#facc15' }} />
          <div>
            <span className="cxc-stat-num" style={{ color: '#facc15' }}>{stats.pendiente}</span>
            <span className="cxc-stat-label">Por pagar</span>
          </div>
        </div>
        <div className="cxc-stat-card" style={{ flex: 1, borderColor: 'rgba(248,113,113,0.3)' }}>
          <AlertTriangle size={18} style={{ color: '#f87171' }} />
          <div>
            <span className="cxc-stat-num" style={{ color: '#f87171' }}>
              Bs {fmtMonto(stats.montoPendiente)}
            </span>
            <span className="cxc-stat-label">Monto por pagar</span>
          </div>
        </div>
        <div className="cxc-stat-card" style={{ flex: 1, borderColor: 'rgba(74,222,128,0.3)' }}>
          <CheckCircle2 size={18} style={{ color: '#4ade80' }} />
          <div>
            <span className="cxc-stat-num" style={{ color: '#4ade80' }}>
              Bs {fmtMonto(stats.montoPagado)}
            </span>
            <span className="cxc-stat-label">Ya pagado</span>
          </div>
        </div>
      </div>

      {/* Barra de búsqueda y filtro de estado */}
      <div className="pc-barra" style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <div className="pc-busqueda" style={{ flex: 1 }}>
          <Search size={18} className="pc-busqueda-icono" />
          <input
            type="text"
            placeholder={`Buscar en ${titulo.toLowerCase()}...`}
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pc-busqueda-input"
          />
        </div>
        <select
          value={filtroEstado}
          onChange={e => setFiltroEstado(e.target.value)}
          className="filtro-select"
          style={{ minWidth: '140px' }}
        >
          <option value="">Todos los estados</option>
          <option value="pendiente">Pendiente</option>
          <option value="parcial">Parcial</option>
          <option value="pagada">Pagada</option>
          <option value="vencida">Vencida</option>
        </select>
      </div>

      {/* Error */}
      {error && (
        <div className="pc-error">
          <p>⚠️ {error}</p>
          <button onClick={cargarNotas}>Reintentar</button>
        </div>
      )}

      {/* Lista de Notas de Pago */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando notas de pago...</p>
        </div>
      ) : notasFiltradas.length === 0 ? (
        <div className="arbol-vacio">
          <DollarSign size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>No hay notas de pago registradas{busqueda || filtroEstado ? ' con los filtros actuales.' : '.'}</p>
          <button
            className="btn-nueva-cuenta"
            style={{ background: colorAccento, marginTop: '1rem' }}
            onClick={() => setMostrarNota(true)}
          >
            <Plus size={16} /> Crear primera Nota de Pago
          </button>
        </div>
      ) : (
        <div className="cxc-lista">
          {/* Cabecera */}
          <div className="cxc-alumno-row cxc-alumno-row--header">
            <span>Beneficiario / Concepto</span>
            <span>Fecha emisión</span>
            <span className="cxc-col-center">Estado</span>
            <span className="cxc-col-right">Total</span>
            <span className="cxc-col-right">Pagado</span>
            <span className="cxc-col-right">Saldo</span>
            <span></span>
          </div>

          {/* Filas */}
          {notasFiltradas.map(nota => {
            const badge = BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente;
            const tieneSaldo = nota.deuda_restante > 0;
            return (
              <div
                key={nota.id}
                className={`cxc-alumno-row ${tieneSaldo ? 'cxc-alumno-row--deuda' : ''}`}
                onClick={() => setNotaSeleccionada(nota)}
                style={{ cursor: 'pointer' }}
              >
                <span className="cxc-alumno-nombre">
                  <DollarSign size={14} />
                  {nombreEntidad(nota)}
                </span>
                <span className="cxc-alumno-meta">{fmtFecha(nota.fecha_emision)}</span>
                <span className="cxc-col-center">
                  <span
                    style={{
                      background: badge.bg, color: badge.color,
                      borderRadius: '20px', padding: '2px 10px',
                      fontSize: '0.78rem', fontWeight: 600
                    }}
                  >
                    {badge.label}
                  </span>
                </span>
                <span className="cxc-col-right" style={{ color: '#94a3b8' }}>
                  Bs {fmtMonto(nota.monto_total)}
                </span>
                <span className="cxc-col-right" style={{ color: '#4ade80' }}>
                  Bs {fmtMonto(nota.monto_pagado)}
                </span>
                <span className={`cxc-col-right ${tieneSaldo ? 'cxc-deuda-monto cxc-deuda-monto--activa' : ''}`}>
                  {tieneSaldo ? `Bs ${fmtMonto(nota.deuda_restante)}` : <span style={{ color: '#4ade80' }}>✓ Pagada</span>}
                </span>
                <span>
                  <button
                    className="cxc-btn-nota-rapida"
                    onClick={e => { e.stopPropagation(); setNotaSeleccionada(nota); }}
                    title="Ver detalle"
                  >
                    <Eye size={14} />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Nueva Nota de Pago */}
      <NotaPago
        visible={mostrarNota}
        tipoInicial={tipoGasto}
        onCerrar={() => setMostrarNota(false)}
        onCreada={() => { setMostrarNota(false); cargarNotas(); }}
      />

      {/* Modal: Detalle de Nota de Pago */}
      <DetalleCxP
        nota={notaSeleccionada}
        visible={!!notaSeleccionada}
        onCerrar={() => setNotaSeleccionada(null)}
        onActualizar={cargarNotas}
      />
    </main>
  );
};

export default ListadoCxP;
