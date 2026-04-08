/**
 * DetalleProveedorCxP.tsx
 * Modal de detalle de un Proveedor/Entidad del módulo CxP.
 * Muestra el historial de Notas de Pago del proveedor y permite
 * registrar pagos o crear nuevas notas, similar a DetalleAlumnoCxc.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  X, DollarSign, Calendar, RefreshCw,
  AlertCircle, Check, CreditCard, CheckCircle2,
  FileText, TrendingDown, Edit2
} from 'lucide-react';
import NotaPago from './NotaPago';
import DetalleCxP from './DetalleCxP';
import { CATEGORIAS_PROVEEDOR } from './FiltrosCxP';

/** Tipos */
interface EntidadCxP {
  id: string;
  tipo: 'proveedor' | 'personal';
  nombre: string;
  categoria?: string;
  cargo?: string;
  telefono?: string;
  saldo_pendiente: number;
  notas_pendientes: number;
}

interface NotaResumen {
  id: string;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  estado: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number;
  descripcion: string | null;
  tipo_gasto: string;
  proveedor_nombre?: string;
  personal_nombre?: string;
}

interface Props {
  entidad: EntidadCxP | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (f: string) => {
  const [y, m, d] = f.split('-');
  return `${d}/${m}/${y}`;
};

const BADGE_ESTADOS: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
  parcial:   { label: 'Parcial',   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)'  },
  pagada:    { label: 'Pagada',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)'  },
  vencida:   { label: 'Vencida',   color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

const DetalleProveedorCxP: React.FC<Props> = ({ entidad, visible, onCerrar, onActualizar }) => {
  const [notas, setNotas] = useState<NotaResumen[]>([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEstado, setFiltroEstado] = useState('');

  // Modales internos
  const [mostrarNuevaNota, setMostrarNuevaNota] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<any>(null);

  /** Carga las notas del proveedor/personal */
  const cargarNotas = async () => {
    if (!entidad) return;
    setCargando(true);

    let query = supabase
      .from('v_estado_cuentas_pagar')
      .select(`
        id, fecha_emision, fecha_vencimiento, estado,
        monto_total, monto_pagado, deuda_restante,
        descripcion, tipo_gasto, proveedor_id, personal_id
      `)
      .order('fecha_emision', { ascending: false });

    if (entidad.tipo === 'proveedor') {
      query = query.eq('proveedor_id', entidad.id);
    } else {
      query = query.eq('personal_id', entidad.id);
    }

    const { data } = await query;
    setNotas(
      (data ?? []).map((n: any) => ({
        ...n,
        monto_total:    Number(n.monto_total),
        monto_pagado:   Number(n.monto_pagado),
        deuda_restante: Number(n.deuda_restante),
        proveedor_nombre: entidad.tipo === 'proveedor' ? entidad.nombre : undefined,
        personal_nombre:  entidad.tipo === 'personal'  ? entidad.nombre : undefined,
      }))
    );
    setCargando(false);
  };

  useEffect(() => {
    if (visible && entidad) cargarNotas();
  }, [visible, entidad]);

  /** Notas filtradas por estado */
  const notasFiltradas = useMemo(() => {
    if (!filtroEstado) return notas;
    return notas.filter(n => n.estado === filtroEstado);
  }, [notas, filtroEstado]);

  /** Estadísticas rápidas */
  const stats = useMemo(() => ({
    total:          notas.length,
    pendientes:     notas.filter(n => n.estado !== 'pagada').length,
    montoPendiente: notas.reduce((s, n) => s + n.deuda_restante, 0),
    montoPagado:    notas.reduce((s, n) => s + n.monto_pagado, 0),
  }), [notas]);

  /** Etiqueta de categoría */
  const labelCategoria = (cat?: string) =>
    CATEGORIAS_PROVEEDOR.find(c => c.value === cat)?.label ?? 'Sin categoría';

  if (!visible || !entidad) return null;

  const tipoGastoInicial = entidad.tipo === 'proveedor' ? 'proveedor' : 'personal';

  return (
    <div className="cxc-modal-overlay" onClick={() => { if (!mostrarNuevaNota && !notaSeleccionada) onCerrar(); }}>
      <div
        className="cxc-modal"
        style={{ maxWidth: '800px', width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Cabecera del modal ── */}
        <div className="cxc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <TrendingDown size={20} style={{ color: 'var(--danger)' }} />
            {entidad.nombre}
          </h2>
          <button onClick={onCerrar}><X size={20} /></button>
        </div>

        <div style={{ padding: '1rem' }}>
          {/* ── Info de la entidad ── */}
          <div style={{
            display: 'flex', gap: '1rem', flexWrap: 'wrap',
            background: 'rgba(255,255,255,0.04)', borderRadius: '10px',
            padding: '0.8rem 1rem', marginBottom: '1rem',
            fontSize: '0.85rem', color: '#94a3b8'
          }}>
            {entidad.tipo === 'proveedor' && entidad.categoria && (
              <span>🏷️ {labelCategoria(entidad.categoria)}</span>
            )}
            {entidad.cargo && <span>💼 {entidad.cargo}</span>}
            {entidad.telefono && <span>📞 {entidad.telefono}</span>}
          </div>

          {/* ── Mini stats ── */}
          <div style={{ display: 'flex', gap: '0.6rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <div className="cxc-mini-stat" style={{ flex: 1, minWidth: '100px' }}>
              <DollarSign size={14} />
              <span className="cxc-mini-num">{stats.total}</span>
              <span className="cxc-mini-label">Notas</span>
            </div>
            <div className="cxc-mini-stat cxc-mini-stat--deuda" style={{ flex: 1, minWidth: '100px' }}>
              <AlertCircle size={14} />
              <span className="cxc-mini-num cxc-mini-num--warn">{stats.pendientes}</span>
              <span className="cxc-mini-label">Pendientes</span>
            </div>
            <div className="cxc-mini-stat cxc-mini-stat--total" style={{ flex: 2, minWidth: '140px' }}>
              <TrendingDown size={14} />
              <span className="cxc-mini-num cxc-mini-num--danger">Bs {fmtMonto(stats.montoPendiente)}</span>
              <span className="cxc-mini-label">Por pagar</span>
            </div>
            <div className="cxc-mini-stat" style={{ flex: 2, minWidth: '140px', borderColor: 'rgba(74,222,128,0.3)' }}>
              <CheckCircle2 size={14} />
              <span className="cxc-mini-num" style={{ color: '#4ade80' }}>Bs {fmtMonto(stats.montoPagado)}</span>
              <span className="cxc-mini-label">Pagado</span>
            </div>
          </div>

          {/* ── Barra de acciones y filtro ── */}
          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
            <button
              className="btn-nueva-cuenta"
              onClick={() => setMostrarNuevaNota(true)}
              style={{ flexShrink: 0 }}
            >
              <FileText size={15} /> Nueva Nota
            </button>
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="cxc-filtro-select"
              style={{ flex: 1, minWidth: '140px' }}
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagada">Pagada</option>
              <option value="vencida">Vencida</option>
            </select>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
              {notasFiltradas.length} nota{notasFiltradas.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* ── Lista de notas ── */}
          {cargando ? (
            <div className="pc-cargando">
              <RefreshCw size={28} className="spin" />
              <p>Cargando notas...</p>
            </div>
          ) : notasFiltradas.length === 0 ? (
            <div className="arbol-vacio" style={{ padding: '2rem' }}>
              <DollarSign size={36} style={{ opacity: 0.3, marginBottom: '0.5rem' }} />
              <p>No hay notas de pago{filtroEstado ? ' con el estado seleccionado' : ''}.</p>
            </div>
          ) : (
            <>
              {/* Tabla de notas */}
              <div className="cxc-tabla-wrapper" style={{ maxHeight: '380px' }}>
                <table className="cxc-tabla">
                  <thead>
                    <tr>
                      <th className="cxc-th">Descripción</th>
                      <th className="cxc-th cxc-th-center">Fecha</th>
                      <th className="cxc-th cxc-th-center">Estado</th>
                      <th className="cxc-th cxc-th-right">Total</th>
                      <th className="cxc-th cxc-th-right">Pagado</th>
                      <th className="cxc-th cxc-th-right">Saldo</th>
                      <th className="cxc-th cxc-th-center">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {notasFiltradas.map(nota => {
                      const badge = BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente;
                      const tieneSaldo = nota.deuda_restante > 0;
                      return (
                        <tr
                          key={nota.id}
                          className={`cxc-tr ${tieneSaldo ? 'cxc-tr--deuda' : ''}`}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setNotaSeleccionada({
                            ...nota,
                            proveedor_nombre: entidad.tipo === 'proveedor' ? entidad.nombre : undefined,
                            personal_nombre:  entidad.tipo === 'personal'  ? entidad.nombre : undefined,
                          })}
                        >
                          <td className="cxc-td">
                            <span style={{ fontSize: '0.87rem' }}>
                              {nota.descripcion || '(Sin descripción)'}
                            </span>
                          </td>
                          <td className="cxc-td cxc-td-center" style={{ fontSize: '0.83rem', color: '#94a3b8' }}>
                            <Calendar size={12} style={{ marginRight: '0.3rem' }} />
                            {fmtFecha(nota.fecha_emision)}
                          </td>
                          <td className="cxc-td cxc-td-center">
                            <span style={{
                              background: badge.bg, color: badge.color,
                              borderRadius: '20px', padding: '2px 10px',
                              fontSize: '0.76rem', fontWeight: 600,
                            }}>
                              {badge.label}
                            </span>
                          </td>
                          <td className="cxc-td cxc-td-right" style={{ color: '#94a3b8', fontSize: '0.87rem' }}>
                            Bs {fmtMonto(nota.monto_total)}
                          </td>
                          <td className="cxc-td cxc-td-right" style={{ color: '#4ade80', fontSize: '0.87rem' }}>
                            Bs {fmtMonto(nota.monto_pagado)}
                          </td>
                          <td className="cxc-td cxc-td-right">
                            {tieneSaldo
                              ? <span className="cxc-monto-deuda">Bs {fmtMonto(nota.deuda_restante)}</span>
                              : <span className="cxc-al-dia">✓ Pagada</span>
                            }
                          </td>
                          <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                            <button
                              className="cxc-accion-btn cxc-accion-btn--nota"
                              onClick={() => setNotaSeleccionada({
                                ...nota,
                                proveedor_nombre: entidad.tipo === 'proveedor' ? entidad.nombre : undefined,
                                personal_nombre:  entidad.tipo === 'personal'  ? entidad.nombre : undefined,
                              })}
                              title="Ver detalle / Pagar"
                            >
                              {tieneSaldo ? <CreditCard size={13} /> : <Edit2 size={13} />}
                              <span>{tieneSaldo ? 'Pagar' : 'Ver'}</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Modal: Nueva Nota de Pago */}
      <NotaPago
        visible={mostrarNuevaNota}
        tipoInicial={tipoGastoInicial}
        onCerrar={() => setMostrarNuevaNota(false)}
        onCreada={() => { setMostrarNuevaNota(false); cargarNotas(); onActualizar(); }}
      />

      {/* Modal: Detalle y pago de nota */}
      <DetalleCxP
        nota={notaSeleccionada}
        visible={!!notaSeleccionada}
        onCerrar={() => setNotaSeleccionada(null)}
        onActualizar={() => { cargarNotas(); onActualizar(); }}
      />
    </div>
  );
};

export default DetalleProveedorCxP;
