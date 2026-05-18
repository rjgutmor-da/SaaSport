/**
 * ModalVerNotaCxP.tsx
 * Modal de solo lectura que muestra toda la información completa de una Nota de Pago (CxP).
 * Incluye: datos generales, ítems con detalle, observaciones,
 * historial de pagos, barra de progreso y datos de auditoría.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  X, FileText, Calendar, DollarSign, Check,
  Clock, AlertCircle, Hash, MessageSquare,
  ChevronDown, ChevronUp, Package, Pencil, Trash2, RefreshCw
} from 'lucide-react';
import ModalEditarMovimiento from '../cajas-bancos/ModalEditarMovimiento';
import type { CajaBanco } from '../../types/finanzas';
import { type MovimientoFinanciero } from '../../hooks/useFinanzas';
import { formatFecha, formatFechaHora } from '../../lib/dateUtils';

interface Props {
  visible: boolean;
  cxpId: string | null;
  onCerrar: () => void;
  onEditar?: () => void;
  onActualizar?: () => void;
}

interface DetalleItem {
  id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string | null;
}

interface PagoAplicado {
  id: string;
  monto_aplicado: number;
  fecha: string;
  caja_nombre?: string;
  es_aplicacion_anticipo?: boolean;
  referencia?: string;
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ModalVerNotaCxP: React.FC<Props> = ({ visible, cxpId, onCerrar, onEditar, onActualizar }) => {
  const [cargando, setCargando] = useState(true);
  const [nota, setNota] = useState<any>(null);
  const [items, setItems] = useState<DetalleItem[]>([]);
  const [pagos, setPagos] = useState<PagoAplicado[]>([]);
  const [mostrarPagos, setMostrarPagos] = useState(true);

  // Estados para edición/eliminación
  const [movEditar, setMovEditar] = useState<MovimientoFinanciero | null>(null);
  const [cajas, setCajas] = useState<CajaBanco[]>([]);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);
  const { puedeEliminar } = useAuthSaaSport();

  const cargarCajas = async () => {
    const { data } = await supabase.from('cajas_bancos').select('*').order('nombre');
    setCajas(data || []);
  };

  const cargarDatos = async () => {
    if (!cxpId) return;
    setCargando(true);
    
    // Nota principal
    const { data: notaData } = await supabase
      .from('v_estado_cuentas_pagar')
      .select('*')
      .eq('id', cxpId)
      .single();

    // También obtener observaciones de la tabla base
    const { data: notaBase } = await supabase
      .from('cuentas_pagar')
      .select('observaciones, editado, editado_por, editado_at, anulada, anulada_por, anulada_at, nro_recibo:comprobante_id')
      .eq('id', cxpId)
      .single();

    // Enriquecer con el nombre del proveedor o personal para mostrarlo en el título
    let proveedorNombre = '';
    let personalNombre = '';

    if (notaData?.proveedor_id) {
      const { data: prov } = await supabase
        .from('proveedores')
        .select('nombre')
        .eq('id', notaData.proveedor_id)
        .single();
      if (prov) proveedorNombre = prov.nombre;
    }

    if (notaData?.personal_id) {
      const { data: pers } = await supabase
        .from('personal')
        .select('nombres, apellidos')
        .eq('id', notaData.personal_id)
        .single();
      if (pers) personalNombre = `${pers.nombres} ${pers.apellidos}`.trim();
    }

    setNota({ 
      ...notaData, 
      ...notaBase,
      proveedor_nombre: proveedorNombre,
      personal_nombre: personalNombre
    });

    // Ítems del detalle
    const { data: itemsData } = await supabase
      .from('cxp_detalle')
      .select(`
        id, cantidad, precio_unitario, subtotal, descripcion,
        catalogo_items!inner(nombre, tipo)
      `)
      .eq('cuenta_pagar_id', cxpId)
      .order('created_at');

    setItems(
      (itemsData as any[])?.map((d: any) => ({
        id: d.id,
        nombre: d.catalogo_items?.nombre || '—',
        tipo: d.catalogo_items?.tipo || 'servicio',
        cantidad: d.cantidad,
        precio_unitario: Number(d.precio_unitario),
        subtotal: Number(d.subtotal),
        descripcion: d.descripcion,
      })) ?? []
    );

    // Pagos aplicados
    const { data: pagosData } = await supabase
      .from('pagos_aplicados')
      .select('id, monto_aplicado, fecha, es_aplicacion_anticipo, referencia, caja_id, cajas_bancos(nombre)')
      .eq('cuenta_pagar_id', cxpId)
      .order('fecha', { ascending: false });

    setPagos(
      (pagosData as any[])?.map(p => ({
        ...p,
        caja_nombre: p.cajas_bancos?.nombre,
      })) ?? []
    );

    setCargando(false);
  };

  useEffect(() => {
    if (visible && cxpId) {
      cargarDatos();
      cargarCajas();
    }
  }, [visible, cxpId]);

  const handleEliminarPago = async (pagoId: string) => {
    if (!confirm('¿Estás seguro de eliminar este pago? El saldo se devolverá a la caja/banco.')) return;
    setEliminandoId(pagoId);
    try {
      const { data, error } = await supabase.rpc('rpc_eliminar_movimiento_aplicado', {
        p_id: pagoId,
        p_tipo: 'pago'
      });
      if (error) throw error;
      if (data?.success === false) throw new Error(data.message);
      
      await cargarDatos();
      onActualizar?.();
    } catch (err: any) {
      alert('Error al eliminar: ' + err.message);
    } finally {
      setEliminandoId(null);
    }
  };

  if (!visible || !cxpId) return null;

  const montoTotal = nota ? Number(nota.monto_total) : 0;
  const montoPagado = nota ? Number(nota.monto_pagado) : 0;
  const deudaRestante = nota ? Number(nota.deuda_restante) : 0;

  const BADGE_ESTADOS: Record<string, { label: string; color: string; bg: string }> = {
    pendiente: { label: 'Pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
    parcial:   { label: 'Parcial',   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
    pagada:    { label: 'Pagada',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
    vencida:   { label: 'Vencida',   color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
    anulada:   { label: 'Anulada',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  };

  const esAnticipo = nota?.es_anticipo;
  const badge = nota?.anulada
    ? BADGE_ESTADOS.anulada
    : esAnticipo
      ? { label: 'Anticipo', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' }
      : (BADGE_ESTADOS[nota?.estado] ?? BADGE_ESTADOS.pendiente);

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div
        className="cxc-modal"
        style={{ maxWidth: '720px', width: '95vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="cxc-modal-header" style={{ padding: '1.25rem 1.5rem' }}>
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.15rem' }}>
            <Package size={20} style={{ color: '#f59e0b' }} />
            Nota de Pago — Detalle Completo
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {onEditar && !nota?.anulada && (
              <button
                onClick={onEditar}
                className="btn-premium btn-blue"
                style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Hash size={14} /> Editar
              </button>
            )}
            <button onClick={onCerrar}><X size={20} /></button>
          </div>
        </div>

        {cargando ? (
          <div className="pc-cargando" style={{ padding: '3rem' }}>
            <Clock size={28} className="spin" />
            <p>Cargando documento...</p>
          </div>
        ) : nota ? (
          <div style={{ padding: '1.25rem 1.5rem' }}>
            {/* ── Encabezado de la Nota ── */}
            <div style={{
              background: 'rgba(255,255,255,0.03)',
              borderRadius: '12px',
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              border: '1px solid rgba(255,255,255,0.06)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                    {nota.proveedor_nombre || nota.personal_nombre || nota.descripcion || 'Sin descripción'}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: '#94a3b8', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={13} /> Emitida: {formatFecha(nota.fecha_emision)}
                    </span>
                    {nota.fecha_vencimiento && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <AlertCircle size={13} /> Vence: {formatFecha(nota.fecha_vencimiento)}
                      </span>
                    )}
                    {nota.tipo_gasto && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        📦 Tipo: {nota.tipo_gasto === 'proveedor' ? 'Proveedor' : 'Personal'}
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

              {/* Resumen de Montos (estilo CxC — sin barra de progreso) */}
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'center', 
                marginTop: '1rem',
                paddingTop: '0.75rem',
                borderTop: '1px solid rgba(255,255,255,0.06)'
              }}>
                <div style={{ display: 'flex', gap: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700 }}>Bs {fmtMonto(montoTotal)}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pagado</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: '#4ade80' }}>Bs {fmtMonto(montoPagado)}</span>
                  </div>
                </div>
                <div style={{ 
                  textAlign: 'right',
                  padding: '0.5rem 1rem',
                  background: deudaRestante > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
                  borderRadius: '10px',
                  border: `1px solid ${deudaRestante > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`
                }}>
                  <span style={{ fontSize: '0.75rem', color: deudaRestante > 0 ? '#f87171' : '#4ade80', display: 'block', fontWeight: 600 }}>SALDO PENDIENTE</span>
                  <span style={{ fontSize: '1.4rem', fontWeight: 900, color: deudaRestante > 0 ? '#f87171' : '#4ade80' }}>
                    Bs {fmtMonto(deudaRestante)}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Ítems del Detalle ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{
                fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.6rem'
              }}>
                📋 Ítems de la Nota
              </p>
              {items.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>Sin detalle de ítems</p>
              ) : (
                <div style={{
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '10px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  overflow: 'hidden'
                }}>
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: idx < items.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.nombre}</span>
                          <span style={{ color: '#64748b', fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                            × {item.cantidad} @ Bs {fmtMonto(item.precio_unitario)}
                          </span>
                        </div>
                        <span style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.9rem' }}>
                          Bs {fmtMonto(item.subtotal)}
                        </span>
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
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontWeight: 800,
                    fontSize: '1rem'
                  }}>
                    <span>TOTAL</span>
                    <span>Bs {fmtMonto(montoTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Observaciones Generales ── */}
            {nota.observaciones && (
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
                  <MessageSquare size={13} style={{ display: 'inline', marginRight: '0.3rem' }} />
                  Observaciones
                </p>
                <p style={{ fontSize: '0.87rem', color: '#cbd5e1', lineHeight: '1.5' }}>
                  {nota.observaciones}
                </p>
              </div>
            )}

            {/* ── Historial de Pagos ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => setMostrarPagos(!mostrarPagos)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.5rem',
                  background: 'none', border: 'none', color: '#94a3b8',
                  cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem',
                  padding: 0
                }}
              >
                💰 Historial de Pagos ({pagos.length})
                {mostrarPagos ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {mostrarPagos && (
                pagos.length === 0 ? (
                  <p style={{ fontSize: '0.83rem', color: '#64748b', fontStyle: 'italic' }}>
                    No hay pagos registrados aún.
                  </p>
                ) : (
                  <div style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.05)',
                    overflow: 'hidden'
                  }}>
                    {pagos.map((pago, idx) => (
                      <div
                        key={pago.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.6rem 1rem',
                          borderBottom: idx < pagos.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                          background: pago.es_aplicacion_anticipo ? 'rgba(168,85,247,0.04)' : 'transparent'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span style={{ fontSize: '0.83rem', color: '#cbd5e1' }}>
                            {formatFecha(pago.fecha)}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {pago.es_aplicacion_anticipo
                              ? '🔄 Aplicación de anticipo'
                              : (pago.caja_nombre || 'Caja no especificada')}
                            {pago.referencia && ` — ${pago.referencia}`}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{
                            color: '#4ade80',
                            fontWeight: 700,
                            fontSize: '0.9rem'
                          }}>
                            Bs {fmtMonto(Number(pago.monto_aplicado))}
                          </span>
                          
                          {!nota.anulada && (
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              <button
                                onClick={() => setMovEditar({
                                  id: pago.id,
                                  descripcion: nota.descripcion,
                                  debe: 0,
                                  haber: pago.monto_aplicado,
                                  fecha: pago.fecha,
                                  cuenta_id: (pago as any).caja_id,
                                  cuenta_nombre: pago.caja_nombre || '',
                                  tipo_origen: 'pago',
                                  nro_transaccion: pago.referencia
                                } as any)}
                                style={{
                                  background: 'rgba(255,255,255,0.05)',
                                  border: 'none',
                                  color: '#94a3b8',
                                  padding: '0.35rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                title="Editar Pago"
                              >
                                <Pencil size={14} />
                              </button>
                              {/* Solo SuperAdministrador puede eliminar pagos */}
                              {puedeEliminar && (
                                <button
                                  onClick={() => handleEliminarPago(pago.id)}
                                  disabled={eliminandoId === pago.id}
                                  style={{
                                    background: 'rgba(248,113,113,0.1)',
                                    border: 'none',
                                    color: '#f87171',
                                    padding: '0.35rem',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                  }}
                                  title="Eliminar Pago"
                                >
                                  {eliminandoId === pago.id ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              )}
            </div>

            {/* Modal de edición */}
            <ModalEditarMovimiento
              visible={!!movEditar}
              movimiento={movEditar}
              cajas={cajas}
              onCerrar={() => setMovEditar(null)}
              onGuardado={async () => {
                setMovEditar(null);
                await cargarDatos();
                onActualizar?.();
              }}
            />

            {/* ── Datos de Auditoría ── */}
            {(nota.editado || nota.anulada) && (
              <div style={{
                padding: '0.75rem 1rem',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '8px',
                fontSize: '0.75rem',
                color: '#64748b',
                border: '1px solid rgba(255,255,255,0.04)'
              }}>
                {nota.editado && (
                  <p>✏️ Editada: {formatFechaHora(nota.editado_at)}</p>
                )}
                {nota.anulada && (
                  <p style={{ color: '#f87171' }}>🚫 Anulada: {formatFechaHora(nota.anulada_at)}</p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
            No se encontró la nota.
          </div>
        )}
      </div>
    </div>
  );
};

export default ModalVerNotaCxP;
