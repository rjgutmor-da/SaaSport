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
  FileText, TrendingDown, Edit2, Wallet, Eye,
  User, Clock, Plus
} from 'lucide-react';
import { formatFecha } from '../../lib/dateUtils';
import NotaPago from './NotaPago';
import DetalleCxP from './DetalleCxP';
import ModalVerNotaCxP from './ModalVerNotaCxP';
import FichaAnticiposCxP from './FichaAnticiposCxP';
import { CATEGORIAS_PROVEEDOR } from './FiltrosCxP';
import type { EntidadCxP, NotaResumenCxP as NotaResumen } from '../../types/cxp';



interface Props {
  entidad: EntidadCxP | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFecha = (f: any) => {
  if (!f) return '—';
  return formatFecha(f);
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
  const [modoAnticipo, setModoAnticipo] = useState(false);

  // Modales internos
  const [mostrarNuevaNota, setMostrarNuevaNota] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<any>(null);
  const [mostrarFichaAnticipos, setMostrarFichaAnticipos] = useState(false);
  const [verNotaId, setVerNotaId] = useState<string | null>(null);
  const [detallesItems, setDetallesItems] = useState<Record<string, any[]>>({});

  /** Carga las notas del proveedor/personal */
  const cargarNotas = async () => {
    if (!entidad) return;
    setCargando(true);

    let query = supabase
      .from('v_estado_cuentas_pagar')
      .select(`
        id, fecha_emision, fecha_vencimiento, estado,
        monto_total, monto_pagado, deuda_restante,
        descripcion, tipo_gasto, proveedor_id, personal_id, es_anticipo,
        observaciones
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

    // Cargar ítems del detalle por nota
    const notaIds = (data ?? []).map((n: any) => n.id);
    if (notaIds.length > 0) {
      const { data: todosItems } = await supabase
        .from('cxp_detalle')
        .select('cuenta_pagar_id, cantidad, precio_unitario, descripcion, catalogo_items!inner(nombre)')
        .in('cuenta_pagar_id', notaIds);
      const itemsMap: Record<string, any[]> = {};
      todosItems?.forEach((item: any) => {
        if (!itemsMap[item.cuenta_pagar_id]) itemsMap[item.cuenta_pagar_id] = [];
        itemsMap[item.cuenta_pagar_id].push({ ...item, item_nombre: item.catalogo_items?.nombre });
      });
      setDetallesItems(itemsMap);
    }

    setCargando(false);
  };

  /** Anular nota */
  const handleAnularNota = async (id: string) => {
    if (!window.confirm('¿Está seguro de anular esta nota? Esta acción no se puede deshacer.')) return;
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado');

      const { error } = await supabase.rpc('rpc_anular_cuenta_pagar', {
        p_id: id,
        p_usuario_id: user.id
      });

      if (error) throw error;
      
      cargarNotas();
      onActualizar();
    } catch (err: any) {
      alert('Error al anular nota: ' + err.message);
    }
  };

  useEffect(() => {
    if (visible && entidad) cargarNotas();
  }, [visible, entidad]);

  /** Notas filtradas por estado */
  const notasFiltradas = useMemo(() => {
    if (filtroEstado === 'anticipo') {
      return notas.filter(n => (n as any).es_anticipo);
    }
    if (!filtroEstado) return notas;
    return notas.filter(n => n.estado === filtroEstado && !(n as any).es_anticipo);
  }, [notas, filtroEstado]);

  /** Estadísticas rápidas */
  const stats = useMemo(() => ({
    total:          notas.length,
    pendientes:     notas.filter(n => n.estado !== 'pagada').length,
    montoPendiente: notas.reduce((s, n) => s + ((n as any).es_anticipo ? -n.deuda_restante : n.deuda_restante), 0),
    montoPagado:    notas.reduce((s, n) => s + n.monto_pagado, 0),
  }), [notas]);

  /** Etiqueta de categoría */
  const labelCategoria = (cat?: string) =>
    CATEGORIAS_PROVEEDOR.find(c => c.value === cat)?.label ?? 'Sin categoría';

  if (!visible || !entidad) return null;

  const tipoGastoInicial = entidad.tipo === 'proveedor' ? 'proveedor' : 'personal';

  return (
    <div className="cxc-modal-overlay">
      <div
        className="cxc-modal cxc-modal--detalle cxc-modal--wide"
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header con Metadatos Premium ── */}
        <div className="modal-header-glass" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
            <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.025em', color: '#fff' }}>
              {entidad.nombre}
            </h2>
            <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', color: '#94a3b8', fontSize: '0.85rem', flexWrap: 'wrap' }}>
              {entidad.tipo === 'proveedor' && entidad.categoria && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <TrendingDown size={14} style={{ color: '#f87171' }} /> {labelCategoria(entidad.categoria)}
                </span>
              )}
              {entidad.cargo && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <User size={14} style={{ color: '#4ade80' }} /> {entidad.cargo}
                </span>
              )}
              {entidad.telefono && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Calendar size={14} style={{ color: '#fbbf24' }} /> {entidad.telefono}
                </span>
              )}
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                <Clock size={14} /> {entidad.tipo === 'proveedor' ? 'Proveedor' : 'Personal'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
            <button 
              onClick={() => { setMostrarNuevaNota(true); setModoAnticipo(false); }}
              className="btn-premium"
              style={{ 
                padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                fontWeight: 700, background: '#3b82f6', borderRadius: '10px'
              }}
            >
              <Plus size={18} /> NUEVA NOTA
            </button>
            <button 
              onClick={() => setMostrarFichaAnticipos(true)}
              className="btn-premium"
              style={{ 
                padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                fontWeight: 700, background: '#8b5cf6', borderRadius: '10px'
              }}
            >
              <Wallet size={18} /> ANTICIPOS
            </button>
            <button onClick={onCerrar} className="btn-close-circle" style={{ borderRadius: '10px' }}><X size={20}/></button>
          </div>
        </div>

        {/* ── Ficha Premium de 4 Columnas ── */}
        <div className="detalle-resumen-premium" style={{ gap: '1.25rem', padding: '1.5rem 2rem' }}>
          <div className="resumen-card" style={{ border: '1px solid rgba(248,113,113,0.2)' }}>
            <span className="resumen-label">DEUDA PENDIENTE</span>
            <span className="resumen-valor color-deuda">Bs {fmtMonto(stats.montoPendiente)}</span>
            <div className="resumen-footer">
              <AlertCircle size={12} /> {stats.pendientes} notas por pagar
            </div>
            <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><AlertCircle size={28} className="color-deuda" /></div>
          </div>

          <div className="resumen-card" style={{ border: '1px solid rgba(74,222,128,0.2)' }}>
            <span className="resumen-label">TOTAL PAGADO</span>
            <span className="resumen-valor color-ingreso">Bs {fmtMonto(stats.montoPagado)}</span>
            <div className="resumen-footer">
              <CheckCircle2 size={12} /> Histórico desembolsado
            </div>
            <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><Wallet size={28} className="color-ingreso" /></div>
          </div>

          <div className="resumen-card" style={{ border: '1px solid rgba(56,189,248,0.2)' }}>
            <span className="resumen-label">TOTAL NOTAS</span>
            <span className="resumen-valor color-meses">{stats.total} <small style={{ fontSize: '0.9rem' }}>Docs</small></span>
            <div className="resumen-footer">
              <FileText size={12} /> Movimientos registrados
            </div>
            <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><FileText size={28} className="color-meses" /></div>
          </div>

          <div className="resumen-card" style={{ border: '1px solid rgba(168,85,247,0.2)' }}>
            <span className="resumen-label">ESTADO GENERAL</span>
            <span className="resumen-valor" style={{ color: '#a855f7' }}>{stats.pendientes > 0 ? 'Con Deuda' : 'Al día'}</span>
            <div className="resumen-footer">
              <Clock size={12} /> Situación financiera
            </div>
            <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><Check size={28} style={{ color: '#a855f7' }} /></div>
          </div>
        </div>

        {/* ── Lista de notas estilo Excel ── */}
        <div className="detalle-cxc-lista" style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto', maxHeight: '55vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-table-header)', color: 'var(--text-table-header)' }}>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', fontSize: '0.7rem', fontWeight: 800 }}>CONCEPTO / DETALLE</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 800 }}>FECHA</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 800 }}>ESTADO</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>TOTAL</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>ABONADO</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>SALDO</th>
                <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '140px', fontSize: '0.7rem', fontWeight: 800 }}>ACCIONES</th>
              </tr>
            </thead>
            <tbody>
              {notasFiltradas.map(nota => {
                const isAnticipo = (nota as any).es_anticipo;
                const badge = isAnticipo 
                  ? { label: 'Anticipo', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' }
                  : (BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente);
                const tieneSaldo = nota.deuda_restante > 0;
                const itemsDeLaNota = detallesItems[nota.id] || [];
                
                return (
                  <tr key={nota.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 700, color: '#fff' }}>
                            {nota.descripcion || 'Sin descripción'}
                          </div>
                          {!isAnticipo && itemsDeLaNota.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                              {itemsDeLaNota.map((item: any, i: number) => (
                                <span key={i} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}>
                                  {item.item_nombre}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        {(nota as any).observaciones && (
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontStyle: 'italic', borderLeft: '2px solid rgba(255,255,255,0.1)', paddingLeft: '0.5rem' }}>
                            {(nota as any).observaciones}
                          </div>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.8rem', color: '#94a3b8' }}>
                      {fmtFecha(nota.created_at || nota.fecha_emision)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <span style={{ background: badge.bg, color: badge.color, borderRadius: '4px', padding: '2px 8px', fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase' }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>
                      Bs {fmtMonto(isAnticipo ? 0 : nota.monto_total)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', border: '1px solid rgba(255,255,255,0.08)', color: '#4ade80', fontWeight: 600 }}>
                      Bs {fmtMonto(isAnticipo ? nota.monto_pagado : (Number(nota.monto_total) - Number(nota.deuda_restante)))}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'right', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 700, color: isAnticipo ? '#a855f7' : (tieneSaldo ? '#38bdf8' : '#4ade80') }}>
                      {isAnticipo ? '-' : ''} Bs {fmtMonto(nota.deuda_restante)}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', border: '1px solid rgba(255,255,255,0.08)' }}>
                      <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                        <button className="btn-compact-action" onClick={() => setVerNotaId(nota.id)} title="Ver documento"><Eye size={14}/></button>
                        <button className="btn-compact-action action-green" onClick={() => setNotaSeleccionada({...nota})} title="Pagar/Editar"><CreditCard size={14}/></button>
                        <button className="btn-compact-action action-red" onClick={() => handleAnularNota(nota.id)} title="Anular"><X size={14}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Modales Internos ── */}
        <NotaPago
          visible={mostrarNuevaNota}
          tipoInicial={tipoGastoInicial}
          esAnticipo={modoAnticipo}
          onCerrar={() => { setMostrarNuevaNota(false); setModoAnticipo(false); }}
          onCreada={() => { setMostrarNuevaNota(false); setModoAnticipo(false); cargarNotas(); onActualizar(); }}
        />
        <DetalleCxP
          nota={notaSeleccionada}
          visible={!!notaSeleccionada}
          onCerrar={() => setNotaSeleccionada(null)}
          onActualizar={() => { cargarNotas(); onActualizar(); }}
        />
        <FichaAnticiposCxP
          visible={mostrarFichaAnticipos}
          entidadId={entidad.id}
          tipoEntidad={entidad.tipo}
          onCerrar={() => setMostrarFichaAnticipos(false)}
          onActualizar={() => { cargarNotas(); onActualizar(); }}
          onRegistrar={() => {
            setMostrarFichaAnticipos(false);
            setModoAnticipo(true);
            setMostrarNuevaNota(true);
          }}
        />
        <ModalVerNotaCxP
          visible={!!verNotaId}
          cxpId={verNotaId}
          onCerrar={() => setVerNotaId(null)}
          onActualizar={() => { cargarNotas(); onActualizar(); }}
          onEditar={() => {
            const nota = notas.find(n => n.id === verNotaId);
            if (nota) {
              setVerNotaId(null);
              setNotaSeleccionada({
                ...nota,
                proveedor_nombre: entidad!.tipo === 'proveedor' ? entidad!.nombre : undefined,
                personal_nombre:  entidad!.tipo === 'personal'  ? entidad!.nombre : undefined,
              });
            }
          }}
        />
      </div>
    </div>
  );
};

export default DetalleProveedorCxP;
