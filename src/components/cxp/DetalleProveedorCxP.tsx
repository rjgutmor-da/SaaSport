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
  FileText, TrendingDown, Edit2, Wallet, Eye
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
        descripcion, tipo_gasto, proveedor_id, personal_id, es_anticipo
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
    montoPendiente: notas.reduce((s, n) => s + n.deuda_restante, 0),
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
          <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', marginBottom: '1.2rem', flexWrap: 'wrap' }}>
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
              style={{ flex: 1, minWidth: '180px' }}
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagada">Pagada</option>
              <option value="vencida">Vencida</option>
              <option value="anticipo">Anticipos</option>
            </select>

            <button
              className="btn-anticipo"
              onClick={() => {
                // Abrir formulario de nota pero forzando modo anticipo
                setMostrarNuevaNota(true);
                setModoAnticipo(true);
              }}
              style={{ flexShrink: 0 }}
            >
              <DollarSign size={15} /> Registrar Anticipo
            </button>

            <button
              className="btn-anticipo"
              onClick={() => setMostrarFichaAnticipos(true)}
              style={{ flexShrink: 0 }}
            >
              <Wallet size={15} /> Ver Anticipos
            </button>

            <span style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginLeft: '0.5rem', whiteSpace: 'nowrap' }}>
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
                      <th className="cxc-th">Concepto / Detalle</th>
                      <th className="cxc-th cxc-th-center">Fecha</th>
                      <th className="cxc-th cxc-th-center">Estado</th>
                      <th className="cxc-th cxc-th-right">Total</th>
                      <th className="cxc-th cxc-th-right">Abonado</th>
                      <th className="cxc-th cxc-th-right">Saldo</th>
                      <th className="cxc-th cxc-th-acciones">Acciones</th>
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
                        <tr
                          key={nota.id}
                          className={`cxc-tr ${tieneSaldo ? 'cxc-tr--deuda' : ''} ${isAnticipo ? 'cxc-tr--anticipo' : ''}`}
                        >
                          <td className="cxc-td">
                            {/* Concepto principal */}
                            <div style={{ fontWeight: 600, fontSize: '0.87rem', marginBottom: '0.15rem' }}>
                              {nota.descripcion || '(Sin descripción)'}
                            </div>
                            {/* Detalle de ítems visible a primera vista */}
                            {itemsDeLaNota.length > 0 && (
                              <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                                {itemsDeLaNota.map((item: any, i: number) => (
                                  <span key={i} style={{
                                    fontSize: '0.68rem', padding: '1px 6px', borderRadius: '10px',
                                    background: 'rgba(245,158,11,0.1)', color: '#fbbf24',
                                    border: '1px solid rgba(245,158,11,0.2)'
                                  }}>
                                    {item.item_nombre}{item.descripcion ? ` — ${item.descripcion}` : ''}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="cxc-td cxc-td-center" style={{ fontSize: '0.83rem', color: '#94a3b8' }}>
                            <Calendar size={12} style={{ marginRight: '0.3rem' }} />
                            {fmtFecha(nota.created_at || nota.fecha_emision)}
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
                          <td className="cxc-td cxc-td-right" style={{ color: '#4ade80', fontSize: '0.87rem', fontWeight: 500 }}>
                            Bs {fmtMonto(Number(nota.monto_total) - Number(nota.deuda_restante))}
                          </td>
                          <td className="cxc-td cxc-td-right">
                            {isAnticipo ? (
                              <span style={{ 
                                color: nota.deuda_restante > 0 ? '#a855f7' : '#94a3b8', 
                                fontWeight: 600,
                                opacity: nota.deuda_restante > 0 ? 1 : 0.6
                              }}>
                                Bs {fmtMonto(nota.deuda_restante)} {nota.deuda_restante > 0 ? '(Disp.)' : '(Aplicado)'}
                              </span>
                            ) : tieneSaldo
                              ? <span className="cxc-monto-deuda">Bs {fmtMonto(nota.deuda_restante)}</span>
                              : <span className="cxc-al-dia">✓ Pagada</span>
                            }
                          </td>
                          <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                              {/* Ver documento completo */}
                              <button
                                className="cxc-accion-btn"
                                onClick={() => setVerNotaId(nota.id)}
                                title="Ver documento completo"
                                style={{ padding: '4px 8px', borderColor: 'rgba(255,255,255,0.1)' }}
                              >
                                <Eye size={13} />
                              </button>
                              {/* Pagar / Editar */}
                              <button
                                className="cxc-accion-btn cxc-accion-btn--nota"
                                onClick={() => setNotaSeleccionada({
                                  ...nota,
                                  proveedor_nombre: entidad.tipo === 'proveedor' ? entidad.nombre : undefined,
                                  personal_nombre:  entidad.tipo === 'personal'  ? entidad.nombre : undefined,
                                })}
                                title={tieneSaldo && !isAnticipo ? 'Pagar / Editar' : 'Ver detalles'}
                                style={{ padding: '4px 8px' }}
                              >
                                {tieneSaldo && !isAnticipo ? <CreditCard size={13} /> : <Edit2 size={13} />}
                              </button>
                              {/* Anular */}
                              <button
                                className="cxc-accion-btn"
                                onClick={() => handleAnularNota(nota.id)}
                                title="Anular nota"
                                style={{ padding: '4px 8px', color: 'var(--danger)', borderColor: 'rgba(239,68,68,0.2)' }}
                              >
                                <X size={13} />
                              </button>
                            </div>
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
        esAnticipo={modoAnticipo}
        onCerrar={() => { setMostrarNuevaNota(false); setModoAnticipo(false); }}
        onCreada={() => { setMostrarNuevaNota(false); setModoAnticipo(false); cargarNotas(); onActualizar(); }}
      />

      {/* Modal: Detalle y pago de nota */}
      <DetalleCxP
        nota={notaSeleccionada}
        visible={!!notaSeleccionada}
        onCerrar={() => setNotaSeleccionada(null)}
        onActualizar={() => { cargarNotas(); onActualizar(); }}
      />

      {/* Ficha de Anticipos a Proveedores */}
      <FichaAnticiposCxP
        visible={mostrarFichaAnticipos}
        onCerrar={() => setMostrarFichaAnticipos(false)}
        onActualizar={() => { cargarNotas(); onActualizar(); }}
      />

      {/* Modal Ver Documento Completo */}
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
  );
};

export default DetalleProveedorCxP;
