/**
 * DetalleProveedorCxP.tsx
 * Modal de detalle de un Proveedor/Entidad del módulo CxP.
 * Muestra el historial de Notas de Pago del proveedor y permite
 * registrar pagos o crear nuevas notas, similar a DetalleAlumnoCxc.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { esNotaVencida } from '../../lib/vencimientoUtils';
import {
  X, DollarSign, Calendar, RefreshCw,
  AlertCircle, Check, CreditCard, CheckCircle2,
  FileText, TrendingDown, Edit2, Wallet, Eye,
  User, Clock, Plus
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { formatFecha, getHoyISO, getHoraLocal, FECHA_MINIMA_MOVIMIENTO_FINANCIERO, validarFechaMovimientoFinanciero } from '../../lib/dateUtils';
import { usePagoMultiple } from './usePagoMultiple';
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
  const [filtroVencimiento, setFiltroVencimiento] = useState('');
  const [modoAnticipo, setModoAnticipo] = useState(false);

  // Modales internos
  const [mostrarNuevaNota, setMostrarNuevaNota] = useState(false);
  const [notaSeleccionada, setNotaSeleccionada] = useState<any>(null);
  const [mostrarFichaAnticipos, setMostrarFichaAnticipos] = useState(false);
  const [verNotaId, setVerNotaId] = useState<string | null>(null);
  const [detallesItems, setDetallesItems] = useState<Record<string, any[]>>({});
  const [historialPagos, setHistorialPagos] = useState<Record<string, any[]>>({});

  // Pago Múltiple
  const isMobile = useIsMobile();
  const [cajasBancos, setCajasBancos] = useState<any[]>([]);
  const [pagoCxpId, setPagoCxpId] = useState<string | null>(null);
  const [pagoCuentaId, setPagoCuentaId] = useState('');
  const [pagoNroDoc, setPagoNroDoc] = useState('');
  const [pagoFecha, setPagoFecha] = useState('');
  const [guardandoPago, setGuardandoPago] = useState(false);
  const [pagoError, setPagoError] = useState<string | null>(null);

  const pagoMultiple = usePagoMultiple(notas);

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

      // Cargar historial de pagos por nota
      const { data: todosPagos } = await supabase
        .from('pagos_aplicados')
        .select('id, cuenta_pagar_id, monto_aplicado, fecha, caja_id, cajas_bancos:caja_id(nombre)')
        .in('cuenta_pagar_id', notaIds)
        .order('fecha', { ascending: false });

      const pagosMap: Record<string, any[]> = {};
      todosPagos?.forEach((pago: any) => {
        if (!pagosMap[pago.cuenta_pagar_id]) pagosMap[pago.cuenta_pagar_id] = [];
        pagosMap[pago.cuenta_pagar_id].push({ ...pago, caja_nombre: pago.cajas_bancos?.nombre });
      });
      setHistorialPagos(pagosMap);
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

  const cargarCajasBancos = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const { data } = await supabase
        .from('cajas_bancos')
        .select('id, nombre')
        .eq('escuela_id', usr.escuela_id)
        .eq('activo', true)
        .order('nombre');

      setCajasBancos(data ?? []);
    } catch (err) {
      console.error('Error al cargar cajas/bancos:', err);
    }
  };

  const registrarPagoMultiple = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!entidad) return;
    setPagoError(null);

    const totalAPagar = pagoMultiple.obtenerTotalPagado();
    if (totalAPagar <= 0) {
      setPagoError('El monto total a pagar debe ser mayor a 0.');
      return;
    }

    if (!pagoCuentaId) {
      setPagoError('Selecciona la caja/banco de salida.');
      return;
    }

    const pagosPayload = pagoMultiple.generarPayloadPagos();
    const pFechaStr = pagoFecha || getHoyISO();
    const errorFecha = validarFechaMovimientoFinanciero(pFechaStr);
    if (errorFecha) { setPagoError(errorFecha); return; }
    for (const p of pagosPayload) {
      const matchingNota = notas.find(n => n.id === p.cuenta_pagar_id);
      if (matchingNota) {
        const fNota = matchingNota.fecha_emision || (matchingNota as any).created_at;
        const fNotaSoloFecha = fNota ? fNota.split('T')[0] : '';
        if (fNotaSoloFecha && pFechaStr < fNotaSoloFecha) {
          setPagoError(`La fecha de pago no puede ser anterior a la fecha de emisión de la Nota de Servicio (${fNotaSoloFecha}).`);
          return;
        }
      }
    }

    setGuardandoPago(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado.');

      const { data: usr } = await supabase
        .from('usuarios')
        .select('id, escuela_id, sucursal_id')
        .eq('id', user.id)
        .single();
      if (!usr) throw new Error('Error al obtener contexto del usuario.');

      const pagosPayload = pagoMultiple.generarPayloadPagos();

      const { error: errRpc } = await supabase.rpc('rpc_pagar_multiple_cxp', {
        p_payload: {
          escuela_id: usr.escuela_id,
          sucursal_id: usr.sucursal_id,
          usuario_id: usr.id,
          cuenta_pago_id: pagoCuentaId,
          fecha: `${pagoFecha || getHoyISO()}T${getHoraLocal()}:00`,
          nro_comprobante: pagoNroDoc.trim() || null,
          pagos: pagosPayload
        }
      });

      if (errRpc) throw errRpc;

      setPagoCxpId(null);
      cargarNotas();
      onActualizar();
    } catch (err: any) {
      console.error(err);
      setPagoError(err.message || 'Error al registrar el pago múltiple.');
    } finally {
      setGuardandoPago(false);
    }
  };

  useEffect(() => {
    if (visible && entidad) {
      cargarNotas();
      cargarCajasBancos();
      setPagoCxpId(null);
    }
  }, [visible, entidad]);

  /** Notas filtradas por estado y vencimiento */
  const notasFiltradas = useMemo(() => {
    if (filtroEstado === 'anticipo') {
      return notas.filter(n => (n as any).es_anticipo);
    }
    let lista = !filtroEstado ? notas : notas.filter(n => n.estado === filtroEstado && !(n as any).es_anticipo);
    if (filtroVencimiento === 'vencidas') {
      lista = lista.filter(n => esNotaVencida(n.fecha_vencimiento, n.estado));
    } else if (filtroVencimiento === 'no_vencidas') {
      lista = lista.filter(n => !esNotaVencida(n.fecha_vencimiento, n.estado));
    }
    return lista;
  }, [notas, filtroEstado, filtroVencimiento]);

  /** Estadísticas rápidas */
  const stats = useMemo(() => ({
    total:          notas.length,
    pendientes:     notas.filter(n => Number(n.deuda_restante) > 0).length,
    montoPendiente: notas.reduce((s, n) => s + ((n as any).es_anticipo ? -n.deuda_restante : n.deuda_restante), 0),
    montoPagado:    notas.reduce((s, n) => s + n.monto_pagado, 0),
  }), [notas]);

  /** Etiqueta de categoría */
  const labelCategoria = (cat?: string) =>
    CATEGORIAS_PROVEEDOR.find(c => c.value === cat)?.label ?? 'Sin categoría';

  if (!visible || !entidad) return null;

  const tipoGastoInicial = entidad.tipo === 'proveedor' ? 'proveedor' : 'personal';

  return (
    <div className="cxc-modal-overlay" onClick={isMobile ? undefined : undefined} style={isMobile ? { padding: 0 } : undefined}>
      <div
        className="cxc-modal cxc-modal--detalle cxc-modal--wide"
        onClick={e => e.stopPropagation()}
        style={isMobile ? {
          width: '100%', maxWidth: '100vw', height: '100vh', maxHeight: '100vh',
          borderRadius: 0, display: 'flex', flexDirection: 'column',
          boxSizing: 'border-box', overflow: 'hidden'
        } : undefined}
      >
        {isMobile ? (
          /* ── Header Móvil Compacto ── */
          <div style={{ padding: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {entidad.nombre}
              </h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.75rem', flexWrap: 'wrap' }}>
                {entidad.tipo === 'proveedor' && entidad.categoria && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <TrendingDown size={11} style={{ color: '#f87171' }} /> {labelCategoria(entidad.categoria)}
                  </span>
                )}
                {entidad.cargo && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                    <User size={11} style={{ color: '#4ade80' }} /> {entidad.cargo}
                  </span>
                )}
                <span style={{ color: 'var(--secondary)', display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
                  <Clock size={11} /> {entidad.tipo === 'proveedor' ? 'Proveedor' : 'Personal'}
                </span>
              </div>
            </div>
            <button onClick={onCerrar} style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: '0.25rem' }}>
              <X size={22} />
            </button>
          </div>
        ) : (
          <div className="modal-header-glass" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
                {entidad.nombre}
              </h2>
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem', flexWrap: 'wrap' }}>
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
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--secondary)' }}>
                  <Clock size={14} /> {entidad.tipo === 'proveedor' ? 'Proveedor' : 'Personal'}
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
              {stats.montoPendiente > 0 && (
                <button 
                  onClick={() => {
                    setPagoCxpId('TODO');
                    pagoMultiple.inicializar();
                    setPagoFecha(getHoyISO());
                    setPagoCuentaId('');
                    setPagoNroDoc('');
                    setPagoError(null);
                  }}
                  className="btn-premium"
                  style={{ 
                    padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                    fontWeight: 700, background: '#10b981', borderRadius: '10px'
                  }}
                >
                  <DollarSign size={18} /> PAGAR
                </button>
              )}
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
        )}

        {/* ── Botones de acción móvil ── */}
        {isMobile && (
          <div style={{ display: 'flex', gap: '0.5rem', padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            {stats.montoPendiente > 0 && (
              <button 
                onClick={() => {
                  setPagoCxpId('TODO');
                  pagoMultiple.inicializar();
                  setPagoFecha(getHoyISO());
                  setPagoCuentaId('');
                  setPagoNroDoc('');
                  setPagoError(null);
                }}
                style={{
                  flex: 1, background: '#10b981', color: '#ffffff', border: 'none',
                  borderRadius: '10px', padding: '0.6rem', fontWeight: 800, fontSize: '0.85rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', cursor: 'pointer'
                }}
              >
                <DollarSign size={15} /> $ PAGAR
              </button>
            )}
            <button 
              onClick={() => { setMostrarNuevaNota(true); setModoAnticipo(false); }}
              style={{
                flex: 1, background: '#3b82f6', color: '#ffffff', border: 'none',
                borderRadius: '10px', padding: '0.6rem', fontWeight: 800, fontSize: '0.85rem',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem', cursor: 'pointer'
              }}
            >
              <Plus size={15} /> + NUEVA NOTA
            </button>
          </div>
        )}

        {/* ── Ficha Premium de 4 Columnas (solo desktop) ── */}
        {!isMobile && (
          <div className="detalle-resumen-premium" style={{ gap: '1.25rem', padding: '1.5rem 2rem', background: 'transparent', borderBottom: '1px solid var(--border)' }}>
            {(() => {
              const esSaldoAFavor = stats.montoPendiente < 0;
              return (
                <div className="resumen-card" style={{ border: esSaldoAFavor ? '1px solid rgba(74,222,128,0.2)' : '1px solid rgba(248,113,113,0.2)' }}>
                  <span className="resumen-label">{esSaldoAFavor ? 'SALDO A FAVOR' : 'DEUDA PENDIENTE'}</span>
                  <span className={`resumen-valor ${esSaldoAFavor ? 'color-ingreso' : 'color-deuda'}`}>
                    Bs {fmtMonto(Math.abs(stats.montoPendiente))}
                  </span>
                  <div className="resumen-footer">
                    {esSaldoAFavor ? <Check size={12} /> : <AlertCircle size={12} />} 
                    {esSaldoAFavor ? 'Crédito disponible' : `${stats.pendientes} notas por pagar`}
                  </div>
                  <div className="resumen-icon-bg" style={{ opacity: 0.15 }}>
                    {esSaldoAFavor ? <CheckCircle2 size={28} className="color-ingreso" /> : <AlertCircle size={28} className="color-deuda" />}
                  </div>
                </div>
              );
            })()}

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
        )}

        {/* Mobile Multi-Payment Form Panel */}
        {isMobile && pagoCxpId === 'TODO' && (
          <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.02)', borderBottom: '1px solid rgba(16, 185, 129, 0.2)', borderTop: '1px solid var(--border)' }}>
            <form onSubmit={registrarPagoMultiple}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.85rem' }}>PAGO MÚLTIPLE (SALIDA)</span>
                  <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1.05rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.35rem 0.75rem', borderRadius: '6px', textAlign: 'center' }}>
                    Total a Pagar: Bs {fmtMonto(pagoMultiple.obtenerTotalPagado())}
                  </span>
                </div>
                <select value={pagoCuentaId} onChange={e => setPagoCuentaId(e.target.value)} required className="detalle-cobro-select" style={{ width: '100%' }}>
                  <option value="">Origen Caja/Banco *</option>
                  {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
                <input type="text" value={pagoNroDoc} onChange={e => setPagoNroDoc(e.target.value)} placeholder="Nro Transacción" style={{ width: '100%' }} className="detalle-cobro-input" />
                <input type="date" value={pagoFecha} min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO} onChange={e => setPagoFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '100%' }} />
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', background: 'var(--bg-main)', padding: '0.5rem', borderRadius: '6px', border: '1px solid var(--border)', maxHeight: '150px', overflowY: 'auto' }}>
                  {[...notas].filter(n => !(n as any).anulada && Number(n.deuda_restante) > 0 && !n.es_anticipo).sort((a, b) => new Date(a.fecha_emision || a.created_at).getTime() - new Date(b.fecha_emision || b.created_at).getTime()).map(nota => {
                    const seleccionado = !!pagoMultiple.seleccionados[nota.id];
                    const montoCxp = pagoMultiple.montos[nota.id] || '';
                    return (
                      <div key={nota.id} style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between', padding: '0.4rem 0.6rem', background: 'var(--bg-card)', border: seleccionado ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border)', borderRadius: '6px', opacity: seleccionado ? 1 : 0.65 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input 
                            type="checkbox" 
                            checked={seleccionado} 
                            onChange={() => pagoMultiple.toggleSeleccion(nota.id, nota.deuda_restante)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#10b981' }}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.7rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '120px' }}>
                              {nota.descripcion || 'Nota'}
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                              Saldo: <strong style={{ color: '#38bdf8' }}>Bs {fmtMonto(nota.deuda_restante)}</strong>
                            </span>
                          </div>
                        </div>
                        {seleccionado && (
                          <input 
                            type="number" 
                            step="0.01"
                            min="0"
                            max={nota.deuda_restante}
                            value={montoCxp}
                            onChange={(e) => pagoMultiple.cambiarMonto(nota.id, e.target.value, nota.deuda_restante)}
                            placeholder="0.00"
                            style={{ 
                              width: '75px', 
                              padding: '0.2rem 0.3rem', 
                              borderRadius: '4px', 
                              border: '1px solid var(--border)', 
                              background: 'var(--bg-main)', 
                              color: 'var(--text-primary)', 
                              fontWeight: 700,
                              fontSize: '0.75rem',
                              textAlign: 'right'
                            }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>

                {pagoError && <p style={{ color: '#f87171', fontSize: '0.75rem', margin: 0 }}>{pagoError}</p>}
                
                <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
                  <button type="submit" disabled={guardandoPago || pagoMultiple.obtenerTotalPagado() <= 0} className="btn-guardar-cuenta" style={{ flex: 1, padding: '0.5rem', background: '#10b981', fontWeight: 700, fontSize: '0.8rem' }}>
                    {guardandoPago ? '...' : 'Registrar Pago'}
                  </button>
                  <button type="button" onClick={() => setPagoCxpId(null)} className="btn-refrescar" style={{ padding: '0.5rem', fontSize: '0.8rem' }}>Cancelar</button>
                </div>
              </div>
            </form>
          </div>
        )}

        {/* ── Lista de notas estilo Excel ── */}
        <div className="detalle-cxc-lista" style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto', flex: isMobile ? 1 : undefined, maxHeight: isMobile ? undefined : '55vh' }}>
          {/* Filtros de estado y vencimiento */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem', paddingTop: '0.75rem' }}>
            <select
              value={filtroEstado}
              onChange={e => setFiltroEstado(e.target.value)}
              className="filtro-select"
              style={{ fontSize: '0.8rem', minWidth: '140px' }}
            >
              <option value="">Todos los estados</option>
              <option value="pendiente">Pendiente</option>
              <option value="parcial">Parcial</option>
              <option value="pagada">Pagada</option>
              <option value="vencida">Vencida</option>
              <option value="anticipo">Anticipos</option>
            </select>
            <select
              value={filtroVencimiento}
              onChange={e => setFiltroVencimiento(e.target.value)}
              className="filtro-select"
              style={{ fontSize: '0.8rem', minWidth: '140px' }}
            >
              <option value="">Vencimiento: Todas</option>
              <option value="vencidas">⚠ Vencidas</option>
              <option value="no_vencidas">✓ No vencidas</option>
            </select>
          </div>
          {isMobile ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {notasFiltradas.map(nota => {
                const isAnticipo = (nota as any).es_anticipo;
                const badge = isAnticipo 
                  ? { label: 'Anticipo', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' }
                  : (BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente);
                const tieneSaldo = nota.deuda_restante > 0;
                
                return (
                  <div key={nota.id} style={{ background: 'var(--bg-card)', padding: '0.85rem', borderRadius: '8px', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                        {nota.descripcion || 'Sin descripción'}
                        {esNotaVencida(nota.fecha_vencimiento, nota.estado) && (
                          <span style={{
                            background: 'rgba(248,113,113,0.15)', color: '#f87171',
                            borderRadius: '4px', padding: '1px 5px',
                            fontSize: '0.65rem', fontWeight: 700, marginLeft: '0.35rem'
                          }}>⚠ Vencida</span>
                        )}
                      </span>
                      <span style={{ background: badge.bg, color: badge.color, borderRadius: '4px', padding: '1px 6px', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase' }}>
                        {badge.label}
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      <div>Fecha: <strong>{fmtFecha(nota.fecha_emision || nota.created_at)}</strong></div>
                      <div style={{ textAlign: 'right' }}>Total: <strong>Bs {fmtMonto(isAnticipo ? 0 : nota.monto_total)}</strong></div>
                      <div>Abonado: <strong style={{ color: '#4ade80' }}>Bs {fmtMonto(isAnticipo ? nota.monto_pagado : (Number(nota.monto_total) - Number(nota.deuda_restante)))}</strong></div>
                      <div style={{ textAlign: 'right' }}>Saldo: <strong style={{ color: isAnticipo ? '#a855f7' : (tieneSaldo ? '#38bdf8' : '#4ade80') }}>Bs {fmtMonto(nota.deuda_restante)}</strong></div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border)' }}>
                      <button className="btn-compact-action" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setVerNotaId(nota.id)}><Eye size={12}/> Ver</button>
                      <button className="btn-compact-action action-green" style={{ padding: '0.25rem 0.5rem' }} onClick={() => setNotaSeleccionada({...nota})}><CreditCard size={12}/> Pagar</button>
                      <button className="btn-compact-action action-red" style={{ padding: '0.25rem 0.5rem' }} onClick={() => handleAnularNota(nota.id)}><X size={12}/> Anular</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-table-header)', color: 'var(--text-table-header)' }}>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', fontSize: '0.7rem', fontWeight: 800 }}>CONCEPTO / DETALLE</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 800 }}>FECHA</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '120px', fontSize: '0.7rem', fontWeight: 800 }}>ESTADO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>TOTAL</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>ABONADO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', width: '130px', fontSize: '0.7rem', fontWeight: 800 }}>SALDO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '100px', fontSize: '0.7rem', fontWeight: 800 }}>ULT. PAGO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '140px', fontSize: '0.7rem', fontWeight: 800 }}>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {pagoCxpId === 'TODO' && (
                  <tr>
                    <td colSpan={8} style={{ padding: '1.25rem', background: 'rgba(16, 185, 129, 0.02)', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>
                      <form onSubmit={registrarPagoMultiple}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                              <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.95rem' }}>PAGO MÚLTIPLE DE DEUDA</span>
                              <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1.1rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.35rem 0.75rem', borderRadius: '6px' }}>
                                Total a Pagar: Bs {fmtMonto(pagoMultiple.obtenerTotalPagado())}
                              </span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                              <select value={pagoCuentaId} onChange={e => setPagoCuentaId(e.target.value)} required className="detalle-cobro-select" style={{ width: '220px' }}>
                                <option value="">Origen Caja/Banco *</option>
                                {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                              </select>
                              <input type="text" value={pagoNroDoc} onChange={e => setPagoNroDoc(e.target.value)} placeholder="Nro Transacción" style={{ width: '130px' }} className="detalle-cobro-input" />
                              <input type="date" value={pagoFecha} min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO} onChange={e => setPagoFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '160px' }} />
                              <button type="submit" disabled={guardandoPago || pagoMultiple.obtenerTotalPagado() <= 0} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0.55rem 1.25rem', background: '#10b981', fontWeight: 700 }}>
                                {guardandoPago ? '...' : 'Registrar Pago'}
                              </button>
                              <button type="button" onClick={() => setPagoCxpId(null)} className="btn-refrescar" style={{ width: 'auto', padding: '0.55rem 1rem' }}>Cancelar</button>
                            </div>
                          </div>

                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem', background: 'var(--bg-main)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
                            {[...notas].filter(n => !(n as any).anulada && Number(n.deuda_restante) > 0 && !n.es_anticipo).sort((a, b) => new Date(a.fecha_emision || a.created_at).getTime() - new Date(b.fecha_emision || b.created_at).getTime()).map(nota => {
                              const seleccionado = !!pagoMultiple.seleccionados[nota.id];
                              const montoCxp = pagoMultiple.montos[nota.id] || '';
                              return (
                                <div key={nota.id} style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--bg-card)', border: seleccionado ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border)', borderRadius: '6px', opacity: seleccionado ? 1 : 0.65, transition: 'all 0.2s' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                    <input 
                                      type="checkbox" 
                                      checked={seleccionado} 
                                      onChange={() => pagoMultiple.toggleSeleccion(nota.id, nota.deuda_restante)}
                                      style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#10b981' }}
                                    />
                                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                                      <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>
                                        {nota.descripcion || 'Nota'}
                                      </span>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                        Saldo: <strong style={{ color: '#38bdf8' }}>Bs {fmtMonto(nota.deuda_restante)}</strong>
                                      </span>
                                    </div>
                                  </div>
                                  {seleccionado && (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Monto:</span>
                                      <input 
                                        type="number" 
                                        step="0.01"
                                        min="0"
                                        max={nota.deuda_restante}
                                        value={montoCxp}
                                        onChange={(e) => pagoMultiple.cambiarMonto(nota.id, e.target.value, nota.deuda_restante)}
                                        placeholder="0.00"
                                        style={{ 
                                          width: '85px', 
                                          padding: '0.25rem 0.4rem', 
                                          borderRadius: '4px', 
                                          border: '1px solid var(--border)', 
                                          background: 'var(--bg-main)', 
                                          color: 'var(--text-primary)', 
                                          fontWeight: 700,
                                          fontSize: '0.8rem',
                                          textAlign: 'right'
                                        }}
                                      />
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {pagoError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{pagoError}</p>}
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
                {notasFiltradas.map(nota => {
                  const isAnticipo = (nota as any).es_anticipo;
                  const badge = isAnticipo 
                    ? { label: 'Anticipo', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' }
                    : (BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente);
                  const tieneSaldo = nota.deuda_restante > 0;
                  
                  // Buscar último pago
                  const pagos = historialPagos[nota.id] ?? [];
                  const ultimoPago = pagos[0];

                  return (
                    <tr key={nota.id} className="hover-row">
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 700 }}>{nota.descripcion || 'Sin descripción'}</span>
                          {esNotaVencida(nota.fecha_vencimiento, nota.estado) && (
                            <span style={{
                              display: 'inline-block', marginTop: '2px',
                              background: 'rgba(248,113,113,0.15)', color: '#f87171',
                              borderRadius: '4px', padding: '1px 5px',
                              fontSize: '0.65rem', fontWeight: 700, width: 'fit-content'
                            }}>⚠ Vencida</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center' }}>
                        {fmtFecha(nota.fecha_emision || nota.created_at)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center' }}>
                        <span className="badge-premium" style={{ background: badge.bg, color: badge.color, borderRadius: '6px', padding: '0.2rem 0.5rem', fontWeight: 700, fontSize: '0.75rem' }}>
                          {badge.label}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', fontWeight: 700 }}>
                        Bs {fmtMonto(isAnticipo ? 0 : nota.monto_total)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', color: '#4ade80', fontWeight: 700 }}>
                        Bs {fmtMonto(isAnticipo ? nota.monto_pagado : (Number(nota.monto_total) - Number(nota.deuda_restante)))}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', textAlign: 'right', fontWeight: 800, color: isAnticipo ? '#a855f7' : (tieneSaldo ? '#38bdf8' : '#4ade80') }}>
                        Bs {fmtMonto(nota.deuda_restante)}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {ultimoPago ? fmtFecha(ultimoPago.fecha) : '—'}
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', border: '1px solid var(--border)' }}>
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
          )}
        </div>

        {/* ── Modales Internos ── */}
        <NotaPago
          visible={mostrarNuevaNota}
          tipoInicial={tipoGastoInicial}
          esAnticipo={modoAnticipo}
          proveedorIdInicial={entidad.tipo === 'proveedor' ? entidad.id : undefined}
          personalIdInicial={entidad.tipo === 'personal' ? entidad.id : undefined}
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
