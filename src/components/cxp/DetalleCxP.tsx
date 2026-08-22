/**
 * DetalleCxP.tsx
 * Modal de detalle de una Nota de Pago (CxP).
 * Versión simplificada — saldos simples, sin contabilidad de doble partida.
 * Distribución copiada de CxC (Total / Pagado / Saldo Pendiente).
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  X, DollarSign, Calendar, RefreshCw,
  AlertCircle, Check, CreditCard, CheckCircle2, Hash, Building2, Pencil, Trash2
} from 'lucide-react';
import { formatFecha, getHoyISO, getHoraLocal, FECHA_MINIMA_MOVIMIENTO_FINANCIERO, validarFechaMovimientoFinanciero } from '../../lib/dateUtils';
import ModalEditarPagoCxP from './ModalEditarPagoCxP';
import ModalEditarItemCxP from './ModalEditarItemCxP';
import ModalEditarCabeceraCxP from './ModalEditarCabeceraCxP';
import type { CajaBanco } from '../../types/finanzas';

interface CxPItem {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  proveedor_id: string | null;
  personal_id: string | null;
  tipo_gasto: string;
  estado: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  periodo?: string | null;
  descripcion: string | null;
  observaciones: string | null;
  proveedor_nombre?: string;
  personal_nombre?: string;
  anulada?: boolean;
}

interface PagoRealizado {
  id: string;
  monto_aplicado: number;
  fecha: string;
  referencia: string;
  es_aplicacion_anticipo: boolean;
  conciliado: boolean;
  caja_id?: string;
  caja_nombre?: string;
}

interface DetalleCxPItem {
  id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string | null;
}

interface Props {
  nota: CxPItem | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPeriodo = (periodo?: string | null) => periodo
  ? new Intl.DateTimeFormat('es-BO', { month: 'long', year: 'numeric' }).format(new Date(`${periodo}-01T12:00:00`))
  : null;

const BADGE_ESTADOS: Record<string, { label: string; color: string; bg: string }> = {
  pendiente: { label: 'Pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
  parcial:   { label: 'Parcial',   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
  pagada:    { label: 'Pagada',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
  vencida:   { label: 'Vencida',   color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
};

const DetalleCxP: React.FC<Props> = ({ nota, visible, onCerrar, onActualizar }) => {
  const [pagosRealizados, setPagosRealizados] = useState<PagoRealizado[]>([]);
  const [detalleItems, setDetalleItems] = useState<DetalleCxPItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<CajaBanco[]>([]);
  const [anticiposDisponibles, setAnticiposDisponibles] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);
  const [notaActual, setNotaActual] = useState<CxPItem | null>(null);

  // Estados para Edición y Eliminación
  const [movEditar, setMovEditar] = useState<PagoRealizado | null>(null);
  const [itemEditar, setItemEditar] = useState<any>(null);
  const [cabeceraEditar, setCabeceraEditar] = useState<boolean>(false);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const { puedeEliminar } = useAuthSaaSport();

  // Formulario de pago
  const [montoPago, setMontoPago] = useState('');
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [registrandoPago, setRegistrandoPago] = useState(false);
  const [fechaPago, setFechaPago] = useState(getHoyISO());
  const [usarAnticipo, setUsarAnticipo] = useState(false);
  const [anticipoId, setAnticipoId] = useState('');
  const [errorPago, setErrorPago] = useState<string | null>(null);
  const [exitoPago, setExitoPago] = useState<string | null>(null);

  const cargarDetalle = async () => {
    if (!nota) return;
    setCargando(true);
    setErrorPago(null); setExitoPago(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: usr } = await supabase.from('usuarios')
      .select('escuela_id, sucursal_id').eq('id', user.id).single();

    const [resPagos, resItems, resCajas, resNota] = await Promise.all([
      supabase.from('pagos_aplicados')
        .select('id, monto_aplicado, fecha, referencia, es_aplicacion_anticipo, conciliado, caja_id, cajas_bancos(nombre)')
        .eq('cuenta_pagar_id', nota.id)
        .order('fecha', { ascending: false }),
      supabase.from('cxp_detalle')
        .select(`id, cantidad, precio_unitario, subtotal, descripcion,
                 catalogo_items!inner(nombre, tipo)`)
        .eq('cuenta_pagar_id', nota.id),
      supabase.from('cajas_bancos').select('*')
        .eq('escuela_id', usr?.escuela_id).eq('activo', true).order('nombre'),
      supabase.from('v_estado_cuentas_pagar')
        .select('*')
        .eq('id', nota.id)
        .single()
    ]);

    setPagosRealizados((resPagos.data as any[])?.map(p => ({
        ...p,
        caja_nombre: p.cajas_bancos?.nombre
    })) ?? []);
    
    setDetalleItems((resItems.data as any[])?.map((d: any) => ({
      id: d.id,
      nombre: d.catalogo_items?.nombre || '—',
      tipo: d.catalogo_items?.tipo || 'servicio',
      cantidad: d.cantidad,
      precio_unitario: Number(d.precio_unitario),
      subtotal: Number(d.subtotal),
      descripcion: d.descripcion,
    })) ?? []);
    
    setCajasBancos(resCajas.data ?? []);

    if (resNota.data) {
      const n = resNota.data;
      const updatedNota: CxPItem = {
        ...n,
        monto_total: Number(n.monto_total),
        monto_pagado: Number(n.monto_pagado),
        deuda_restante: Number(n.deuda_restante),
        proveedor_nombre: nota.proveedor_nombre,
        personal_nombre: nota.personal_nombre,
        anulada: !!n.anulada,
      };
      setNotaActual(updatedNota);
      setMontoPago(String(updatedNota.deuda_restante));
    }

    let qAnticipos = supabase.from('v_estado_cuentas_pagar')
      .select('*')
      .eq('es_anticipo', true)
      .gt('deuda_restante', 0);
    if (nota.proveedor_id) qAnticipos = qAnticipos.eq('proveedor_id', nota.proveedor_id);
    else if (nota.personal_id) qAnticipos = qAnticipos.eq('personal_id', nota.personal_id);
    else qAnticipos = qAnticipos.is('id', null);
    const { data: resAnt } = await qAnticipos;
    setAnticiposDisponibles(resAnt || []);

    setCargando(false);
  };

  useEffect(() => {
    if (!visible || !nota) return;
    setNotaActual(nota);
    setMontoPago(String(nota.deuda_restante));
    setCuentaPagoId(''); setNroComprobante('');
    setFechaPago(getHoyISO());
    cargarDetalle();
    setUsarAnticipo(false);
    setAnticipoId('');
  }, [visible, nota]);

  const registrarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!notaActual) return;
    setErrorPago(null); setExitoPago(null);

    const mp = parseFloat(montoPago);
    if (!mp || mp <= 0) { setErrorPago('Monto inválido.'); return; }
    if (!usarAnticipo && !cuentaPagoId) { setErrorPago('Selecciona la caja/banco de pago.'); return; }
    const errorFecha = validarFechaMovimientoFinanciero(fechaPago);
    if (errorFecha) { setErrorPago(errorFecha); return; }
    if (mp > notaActual.deuda_restante) { setErrorPago(`El monto supera la deuda restante de Bs ${fmtMonto(notaActual.deuda_restante)}.`); return; }

    const fNotaSoloFecha = notaActual.fecha_emision ? notaActual.fecha_emision.split('T')[0] : '';
    if (fNotaSoloFecha && fechaPago < fNotaSoloFecha) {
      setErrorPago(`La fecha de pago no puede ser anterior a la fecha de emisión de la Nota de Servicio (${fNotaSoloFecha}).`);
      return;
    }

    setRegistrandoPago(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Error de autenticación.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id').eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      if (usarAnticipo) {
        if (!anticipoId) throw new Error('Selecciona un anticipo.');
        
        const { error: rpcErr } = await supabase.rpc('rpc_aplicar_anticipo_cxp', {
          p_payload: {
            nota_id: notaActual.id,
            anticipo_id: anticipoId,
            monto: mp,
            usuario_id: ctx.id,
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            fecha: `${fechaPago}T${getHoraLocal()}:00`,
          }
        });

        if (rpcErr) throw rpcErr;

      } else {
        // PAGO DIRECTO — Usar RPC para mantener consistencia
        const { error: errRpc } = await supabase.rpc('rpc_registrar_pago_cxp', {
          p_payload: {
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            usuario_id: ctx.id,
            cuenta_pagar_id: notaActual.id,
            monto: mp,
            cuenta_pago_id: cuentaPagoId,
            fecha: `${fechaPago}T${getHoraLocal()}:00`,
            nro_comprobante: nroComprobante.trim() || null,
            metodo_pago: 'efectivo'
          }
        });
        if (errRpc) throw errRpc;
      }

      setExitoPago(`✅ Aplicación de Bs ${fmtMonto(mp)} registrada correctamente.`);
      setRegistrandoPago(false);

      setTimeout(() => {
        onActualizar();
        onCerrar();
      }, 1500);

    } catch (err: any) {
      setErrorPago(`Error: ${err.message}`);
      setRegistrandoPago(false);
    }
  };

  const handleEliminarPago = async (pagoId: string) => {
    if (!window.confirm('¿Está seguro de eliminar este movimiento aplicado? Esto recalculará la deuda de la nota.')) return;
    setEliminandoId(pagoId);
    try {
      const { error } = await supabase.rpc('rpc_eliminar_movimiento_aplicado', { p_id: pagoId, p_tipo: 'pago' });
      if (error) throw error;
      onActualizar();
      onCerrar(); 
    } catch (err: any) {
      alert(`Error al eliminar movimiento: ${err.message}`);
    } finally {
      setEliminandoId(null);
    }
  };

  if (!visible || !notaActual) return null;

  const badge = BADGE_ESTADOS[notaActual.estado] ?? BADGE_ESTADOS.pendiente;
  const nombreEntidad = notaActual.proveedor_nombre || notaActual.personal_nombre || notaActual.descripcion || '(Sin asignar)';
  const yaPagada = notaActual.estado === 'pagada';

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', margin: 0, color: 'var(--text-primary)' }}>
              <DollarSign size={20} /> Detalle — Nota de Pago
            </h2>
            {!notaActual.anulada && !pagosRealizados.some(p => p.conciliado) && (
              <button 
                onClick={() => setCabeceraEditar(true)}
                className="btn-compact-action action-blue"
                title="Editar cabecera de la nota"
                style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)' }}
              >
                <Pencil size={14} /> Editar
              </button>
            )}
          </div>
          <button onClick={onCerrar} disabled={registrandoPago}><X size={20} /></button>
        </div>

        {cargando ? (
          <div className="pc-cargando"><RefreshCw size={28} className="spin" /><p>Cargando detalle...</p></div>
        ) : (
          <div style={{ padding: '1.25rem 1.5rem' }}>

            <div style={{
              background: 'var(--bg-glass)',
              borderRadius: '12px',
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              border: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
                    {nombreEntidad}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={13} /> Emitida: {formatFecha(notaActual.fecha_emision)}
                    </span>
                    {fmtPeriodo(notaActual.periodo) && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Calendar size={13} /> Ciclo: {fmtPeriodo(notaActual.periodo)}
                      </span>
                    )}
                    {notaActual.fecha_vencimiento && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <AlertCircle size={13} /> Vence: {formatFecha(notaActual.fecha_vencimiento)}
                      </span>
                    )}
                    {notaActual.tipo_gasto && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        📦 {notaActual.tipo_gasto === 'proveedor' ? 'Proveedor' : 'Personal'}
                      </span>
                    )}
                  </div>
                </div>
                <span style={{
                  background: badge.bg,
                  color: badge.color,
                  borderRadius: '20px',
                  padding: '4px 14px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap'
                }}>
                  {badge.label}
                </span>
              </div>

              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '1rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700 }}>Bs {fmtMonto(notaActual.monto_total)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pagado</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#4ade80' }}>Bs {fmtMonto(notaActual.monto_pagado)}</span>
                  </div>
                </div>
                <div style={{ 
                  textAlign: 'right',
                  padding: '0.5rem 1rem',
                  background: notaActual.deuda_restante > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
                  borderRadius: '10px',
                  border: `1px solid ${notaActual.deuda_restante > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`
                }}>
                  <span style={{ fontSize: '0.75rem', color: notaActual.deuda_restante > 0 ? '#f87171' : '#4ade80', display: 'block', fontWeight: 600 }}>SALDO PENDIENTE</span>
                  <span style={{ fontSize: '1.4rem', fontWeight: 900, color: notaActual.deuda_restante > 0 ? '#f87171' : '#4ade80' }}>
                    Bs {fmtMonto(notaActual.deuda_restante)}
                  </span>
                </div>
              </div>
            </div>

            {detalleItems.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{
                  fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem',
                  display: 'flex', alignItems: 'center', gap: '0.5rem'
                }}>
                  📋 Ítems de la Nota
                </p>
                <div style={{
                  background: 'var(--bg-glass)',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  overflow: 'hidden'
                }}>
                  {detalleItems.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: idx < detalleItems.length - 1 ? '1px solid var(--border)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{item.nombre}</span>
                          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', marginLeft: '0.6rem' }}>
                            × {item.cantidad} @ Bs {fmtMonto(item.precio_unitario)}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                          <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                            Bs {fmtMonto(item.subtotal)}
                          </span>
                          {!notaActual.anulada && !pagosRealizados.some(p => p.conciliado) && (
                            <button 
                              onClick={() => setItemEditar(item)} 
                              className="cxc-accion-btn" 
                              style={{ background: 'var(--bg-glass)', color: 'var(--primary)', padding: '0.3rem 0.5rem', borderRadius: '4px' }} 
                              title="Editar Ítem"
                            >
                              <Pencil size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      {item.descripcion && (
                        <p style={{ marginTop: '0.3rem', fontSize: '0.78rem', color: '#a78bfa', fontStyle: 'italic' }}>
                          📝 {item.descripcion}
                        </p>
                      )}
                    </div>
                  ))}
                  {/* Total */}
                  <div style={{
                    padding: '0.75rem 1rem',
                    background: 'var(--bg-glass-hover)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 800,
                    fontSize: '1rem'
                  }}>
                    <span>TOTAL</span>
                    <span>Bs {fmtMonto(notaActual.monto_total)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* ── Observaciones ── */}
            {notaActual.observaciones && (
              <div style={{
                marginBottom: '1.25rem',
                padding: '0.9rem 1rem',
                background: 'rgba(168,85,247,0.06)',
                borderRadius: '10px',
                border: '1px solid rgba(168,85,247,0.15)'
              }}>
                <p style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#a855f7',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem'
                }}>
                  📝 Observaciones
                </p>
                <p style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  {notaActual.observaciones}
                </p>
              </div>
            )}

            {/* ── Historial de Pagos ── */}
            {pagosRealizados.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{
                  fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem',
                  display: 'flex', alignItems: 'center', gap: '0.5rem'
                }}>
                  💰 Historial de Pagos ({pagosRealizados.length})
                </p>
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  overflow: 'hidden'
                }}>
                  {pagosRealizados.map((p, idx) => (
                    <div key={p.id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '0.6rem 1rem',
                        borderBottom: idx < pagosRealizados.length - 1 ? '1px solid var(--border)' : 'none',
                        background: p.es_aplicacion_anticipo ? 'rgba(168,85,247,0.04)' : 'transparent'
                      }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                        <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                          {formatFecha(p.fecha)}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                          {p.es_aplicacion_anticipo
                            ? '🔄 Aplicación de anticipo'
                            : (p.caja_nombre || 'Caja no especificada')}
                          {p.referencia && ` — ${p.referencia}`}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                        <span style={{ color: '#4ade80', fontWeight: 700, fontSize: '0.9rem' }}>
                          Bs {fmtMonto(Number(p.monto_aplicado))}
                        </span>
                        <div style={{ display: 'flex', gap: '0.3rem' }}>
                          {!p.conciliado ? (
                            <>
                              <button
                                className="btn-compact-action action-blue"
                                onClick={() => setMovEditar(p)}
                                disabled={eliminandoId === p.id}
                                title="Editar pago"
                              >
                                <Pencil size={12} />
                              </button>
                              {/* Solo SuperAdministrador puede eliminar */}
                              {puedeEliminar && (
                                <button
                                  className="btn-compact-action action-red"
                                  onClick={() => handleEliminarPago(p.id)}
                                  disabled={eliminandoId === p.id}
                                  title="Eliminar movimiento"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '0.2rem' }} title="Pago Conciliado">
                              <CheckCircle2 size={12} /> Conciliado
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Formulario de pago (simplificado — sin selector de método de pago) ── */}
            {!yaPagada && (
              <form onSubmit={registrarPago}>
                <div style={{ border: '1px solid var(--secondary)', borderRadius: '10px', padding: '1rem', background: 'var(--bg-glass)' }}>
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--secondary)' }}>
                    <CreditCard size={14} style={{ marginRight: '0.4rem' }} /> Registrar Pago
                  </p>

                  <div style={{ marginBottom: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                      <input type="checkbox" checked={usarAnticipo} onChange={e => setUsarAnticipo(e.target.checked)} disabled={registrandoPago || anticiposDisponibles.length === 0} />
                      <span style={{ color: anticiposDisponibles.length > 0 ? '#a855f7' : '#64748b', fontWeight: 600 }}>
                        {anticiposDisponibles.length > 0 ? `Usar Saldo a Favor (Anticipo) disponible` : 'No hay anticipos disponibles'}
                      </span>
                    </label>
                  </div>

                  {usarAnticipo && (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <select value={anticipoId} onChange={e => { setAnticipoId(e.target.value); const ant = anticiposDisponibles.find((a: any) => a.id === e.target.value); if (ant) setMontoPago(String(Math.min(notaActual.deuda_restante, Number(ant.deuda_restante)))); }} className="nota-pago-select" style={{ width: '100%', borderColor: '#a855f7' }} required>
                        <option value="">— Seleccionar Anticipo —</option>
                        {anticiposDisponibles.map((a: any) => <option key={a.id} value={a.id}>{formatFecha(a.fecha_emision)} — Bs {fmtMonto(a.deuda_restante)}</option>)}
                      </select>
                    </div>
                  )}

                  {/* Fecha y Monto */}
                  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <input 
                      type="date" 
                      value={fechaPago} 
                      min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO}
                      onChange={e => setFechaPago(e.target.value)} 
                      className="nota-pago-input" 
                      disabled={registrandoPago} 
                      style={{ flex: 1 }} 
                    />
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0.01" 
                      max={notaActual.deuda_restante} 
                      value={montoPago} 
                      onChange={e => setMontoPago(e.target.value)} 
                      placeholder="Monto" 
                      className="nota-pago-input" 
                      disabled={registrandoPago} 
                      style={{ flex: 1 }} 
                    />
                  </div>

                  {!usarAnticipo && (
                    <>
                      <select value={cuentaPagoId} onChange={e => setCuentaPagoId(e.target.value)} required disabled={registrandoPago} className="nota-pago-select" style={{ width: '100%', marginBottom: '0.75rem' }}>
                        <option value="">Caja / Banco de salida</option>
                        {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                      </select>
                      <input type="text" value={nroComprobante} onChange={e => setNroComprobante(e.target.value)} placeholder="Referencia / Nro. Comprobante" className="nota-pago-input" disabled={registrandoPago} style={{ width: '100%' }} />
                    </>
                  )}

                  {errorPago && <div className="form-msg form-msg--error" style={{ marginTop: '0.5rem' }}><AlertCircle size={13} /> {errorPago}</div>}
                  {exitoPago && <div className="form-msg form-msg--exito" style={{ marginTop: '0.5rem' }}><Check size={13} /> {exitoPago}</div>}

                  <button type="submit" className="btn-guardar-cuenta" style={{ width: '100%', justifyContent: 'center', marginTop: '0.75rem' }} disabled={registrandoPago}>
                    <Check size={16} /> {registrandoPago ? 'Registrando...' : 'Confirmar Pago'}
                  </button>
                </div>
              </form>
            )}

            {yaPagada && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem', background: 'rgba(74,222,128,0.1)', borderRadius: '8px', color: '#4ade80', fontWeight: 600 }}>
                <CheckCircle2 size={18} /> Esta Nota de Pago está totalmente cancelada.
              </div>
            )}
          </div>
        )}

        {movEditar && (
          <ModalEditarPagoCxP
            visible={!!movEditar}
            pago={movEditar}
            cajas={cajasBancos}
            fechaEmisionNota={notaActual?.fecha_emision}
            onCerrar={() => setMovEditar(null)}
            onActualizar={() => {
              setMovEditar(null);
              cargarDetalle();
              onActualizar();
            }}
          />
        )}

        {itemEditar && (
          <ModalEditarItemCxP
            visible={!!itemEditar}
            item={itemEditar}
            notaId={notaActual.id}
            onCerrar={() => setItemEditar(null)}
            onActualizar={() => {
              setItemEditar(null);
              cargarDetalle();
              onActualizar();
            }}
          />
        )}

        {cabeceraEditar && (
          <ModalEditarCabeceraCxP
            visible={cabeceraEditar}
            nota={notaActual}
            onCerrar={() => setCabeceraEditar(false)}
            onActualizar={() => {
              cargarDetalle();
              onActualizar();
            }}
          />
        )}
      </div>
    </div>
  );
};

export default DetalleCxP;
