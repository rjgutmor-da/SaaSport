/**
 * ModalVerNotaCxC.tsx
 * Modal de solo lectura que muestra toda la información completa de una Nota de Servicios.
 * Incluye: datos generales, ítems con detalle (meses, torneos), observaciones,
 * historial de cobros, barra de progreso y datos de auditoría.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  X, FileText, Calendar, Eye, DollarSign, Check,
  Clock, User, AlertCircle, CreditCard, Hash, MessageSquare,
  ChevronDown, ChevronUp, Pencil, Trash2, RefreshCw
} from 'lucide-react';
import ModalEditarCobroCxC from './ModalEditarCobroCxC';
import type { CajaBanco } from '../../types/finanzas';
import { formatFecha, formatFechaHora, ordenarMesesCalendario, formatCicloMensualidad, formatearMesCorto } from '../../lib/dateUtils';
import { can } from '../../config/roles';
import { esObservacionAnticipoAutomatica } from '../../lib/cxcUtils';

interface Props {
  visible: boolean;
  cxcId: string | null;
  onCerrar: () => void;
  onEditar?: () => void; 
  onActualizar?: () => void;
  soloLectura?: boolean;
}

interface DetalleItem {
  id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  periodo_meses: string[] | null;
  detalle_extra: string | null;
  ciclo_inicio: string | null;
  ciclo_fin: string | null;
  periodo_estadistico: string | null;
}

interface CobroAplicado {
  id: string;
  monto_aplicado: number;
  fecha: string;
  caja_nombre?: string;
  caja_id?: string;
  es_aplicacion_anticipo?: boolean;
  documento_referencia?: string;
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ModalVerNotaCxC: React.FC<Props> = ({ visible, cxcId, onCerrar, onEditar, onActualizar, soloLectura = false }) => {
  const [cargando, setCargando] = useState(true);
  const [nota, setNota] = useState<any>(null);
  const [items, setItems] = useState<DetalleItem[]>([]);
  const [cobros, setCobros] = useState<CobroAplicado[]>([]);
  const [mostrarCobros, setMostrarCobros] = useState(true);

  // Estados para edición/eliminación
  const [movEditar, setMovEditar] = useState<CobroAplicado | null>(null);
  const [cajas, setCajas] = useState<CajaBanco[]>([]);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  const { puedeEliminar, perfil } = useAuthSaaSport();
  const puedeEditar = can(perfil?.rol, 'finance.cxc.edit');

  const cargarCajas = async () => {
    const { data } = await supabase.from('cajas_bancos').select('*').order('nombre');
    setCajas(data || []);
  };

  const cargarDatos = async () => {
    if (!cxcId) return;
    setCargando(true);

    // Nota principal
    const { data: notaData } = await supabase
      .from('v_cuentas_cobrar')
      .select('*')
      .eq('id', cxcId)
      .single();
    setNota(notaData);

    // Ítems del detalle con join al catálogo
    const consultaItems = await supabase
      .from('cxc_detalle')
      .select(`
        id, cantidad, precio_unitario, subtotal, periodo_meses, detalle_extra,
        ciclo_inicio, ciclo_fin, periodo_estadistico,
        catalogo_items!inner(nombre, tipo)
      `)
      .eq('cuenta_cobrar_id', cxcId)
      .order('created_at');

    let itemsData: any[] | null = consultaItems.data as any[] | null;
    if (consultaItems.error) {
      const consultaItemsLegacy = await supabase
        .from('cxc_detalle')
        .select(`
          id, cantidad, precio_unitario, subtotal, periodo_meses, detalle_extra,
          catalogo_items!inner(nombre, tipo)
        `)
        .eq('cuenta_cobrar_id', cxcId)
        .order('created_at');

      if (consultaItemsLegacy.error) {
        console.error('No se pudieron cargar los ítems de la nota:', consultaItemsLegacy.error);
        itemsData = null;
      } else {
        itemsData = consultaItemsLegacy.data as any[] | null;
      }
    }

    setItems(
      (itemsData as any[])?.map((d: any) => ({
        id: d.id,
        nombre: d.catalogo_items?.nombre || '—',
        tipo: d.catalogo_items?.tipo || 'servicio',
        cantidad: d.cantidad,
        precio_unitario: Number(d.precio_unitario),
        subtotal: Number(d.subtotal),
        periodo_meses: d.periodo_meses,
        detalle_extra: d.detalle_extra,
        ciclo_inicio: d.ciclo_inicio,
        ciclo_fin: d.ciclo_fin,
        periodo_estadistico: d.periodo_estadistico,
      })) ?? []
    );

    // Cobros aplicados
    const { data: cobrosData } = await supabase
      .from('cobros_aplicados')
      .select('id, monto_aplicado, fecha, es_aplicacion_anticipo, documento_referencia, caja_id, cajas_bancos(nombre)')
      .eq('cuenta_cobrar_id', cxcId)
      .order('fecha', { ascending: false });

    setCobros(
      (cobrosData as any[])?.map(c => ({
        ...c,
        caja_nombre: c.cajas_bancos?.nombre,
      })) ?? []
    );

    setCargando(false);
  };

  useEffect(() => {
    if (visible && cxcId) {
      cargarDatos();
      cargarCajas();
    }
  }, [visible, cxcId]);

  const handleEliminarCobro = async (cobroId: string) => {
    if (soloLectura) return;
    if (!confirm('¿Estás seguro de eliminar este cobro? El saldo se restará de la caja/banco.')) return;
    setEliminandoId(cobroId);
    try {
      const { data, error } = await supabase.rpc('rpc_eliminar_movimiento_aplicado', {
        p_id: cobroId,
        p_tipo: 'cobro'
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

  if (!visible || !cxcId) return null;

  const saldoPendiente = nota ? Number(nota.saldo_pendiente) : 0;
  const montoTotal = nota ? Number(nota.monto_total) : 0;
  const totalCobrado = nota ? Number(nota.total_cobrado) : 0;


  const BADGE_ESTADOS: Record<string, { label: string; color: string; bg: string }> = {
    pendiente: { label: 'Pendiente', color: '#facc15', bg: 'rgba(250,204,21,0.15)' },
    parcial:   { label: 'Parcial',   color: '#38bdf8', bg: 'rgba(56,189,248,0.15)' },
    pagada:    { label: 'Pagada',    color: '#4ade80', bg: 'rgba(74,222,128,0.15)' },
    vencida:   { label: 'Vencida',   color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
    anulada:   { label: 'Anulada',   color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
  };

  const badge = nota ? (nota.anulada
    ? BADGE_ESTADOS.anulada
    : (BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente)
  ) : BADGE_ESTADOS.pendiente;

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
            <FileText size={20} style={{ color: '#3b82f6' }} />
            Nota de Servicio — Detalle Completo
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {!soloLectura && puedeEditar && onEditar && !nota?.anulada && (
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
              background: 'var(--bg-glass)',
              borderRadius: '12px',
              padding: '1rem 1.25rem',
              marginBottom: '1.25rem',
              border: '1px solid var(--border)'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                <div>
                  <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                    {nota.alumno_nombres || nota.alumno_apellidos 
                      ? `${nota.alumno_nombres || ''} ${nota.alumno_apellidos || ''}`.trim() 
                      : (nota.descripcion || 'Sin descripción')}
                  </p>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: 'var(--text-tertiary)', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Calendar size={13} /> Emitida: {formatFecha(nota.fecha_emision)}
                    </span>
                    {nota.fecha_vencimiento && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <AlertCircle size={13} /> Vence: {formatFecha(nota.fecha_vencimiento)}
                      </span>
                    )}
                    {nota.nro_recibo && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <Hash size={13} /> Recibo: {nota.nro_recibo}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  {/* Tarjeta Saldo Pendiente */}
                  <div style={{ 
                    textAlign: 'right',
                    padding: '0.4rem 0.8rem',
                    background: saldoPendiente > 0 ? 'rgba(248,113,113,0.1)' : 'rgba(74,222,128,0.1)',
                    borderRadius: '8px',
                    border: `1px solid ${saldoPendiente > 0 ? 'rgba(248,113,113,0.2)' : 'rgba(74,222,128,0.2)'}`
                  }}>
                    <span style={{ fontSize: '0.65rem', color: saldoPendiente > 0 ? '#f87171' : '#4ade80', display: 'block', fontWeight: 600 }}>SALDO PENDIENTE</span>
                    <span style={{ fontSize: '1rem', fontWeight: 700, color: saldoPendiente > 0 ? '#f87171' : '#4ade80' }}>
                      Bs {fmtMonto(saldoPendiente)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Ítems del Detalle ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <p style={{
                fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)',
                textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.8rem',
                display: 'flex', alignItems: 'center', gap: '0.5rem'
              }}>
                <FileText size={16} style={{ color: '#3b82f6' }} />
                Ítems de la Nota
              </p>
              {items.length === 0 ? (
                <p style={{ fontSize: '0.85rem', color: '#64748b', fontStyle: 'italic' }}>Sin detalle de ítems</p>
              ) : (
                <div style={{
                  background: 'var(--bg-glass)',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  overflow: 'hidden'
                }}>
                  {items.map((item, idx) => (
                    <div
                      key={item.id}
                      style={{
                        padding: '0.75rem 1rem',
                        borderBottom: idx < items.length - 1 ? '1px solid var(--border)' : 'none'
                      }}
                    >
                      {/* Layout principal del ítem: en móvil se apila, en desktop queda en fila */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap' }}>
                        {/* Columna izquierda: nombre + cantidad + badges */}
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', flexWrap: 'wrap', flex: '1 1 auto', minWidth: 0 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.4rem', width: '100%' }}>
                            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{item.nombre}</span>
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>
                              × {item.cantidad} @ Bs {fmtMonto(item.precio_unitario)}
                            </span>
                          </div>
                          {/* Para ciclos parciales se muestra el rango real en lugar del mes genérico. */}
                          {item.periodo_meses && item.periodo_meses.length > 0 &&
                           !(
                             item.nombre?.toLowerCase().includes('mensualidad') &&
                             formatCicloMensualidad(
                               item.ciclo_inicio || nota?.ciclo_inicio,
                               item.ciclo_fin || nota?.ciclo_fin,
                               item.detalle_extra,
                             )
                           ) && (
                            <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', alignItems: 'center', width: '100%', marginTop: '0.25rem' }}>
                              {ordenarMesesCalendario(item.periodo_meses).map((mes: string) => (
                                <span key={mes} style={{
                                  background: 'rgba(59,130,246,0.15)',
                                  color: '#60a5fa',
                                  padding: '2px 8px',
                                  borderRadius: '12px',
                                  fontSize: '0.7rem',
                                  fontWeight: 600
                                }}>
                                  {formatearMesCorto(mes)}
                                </span>
                              ))}
                            </div>
                          )}
                          {/* Detalle extra o fechas de ciclo */}
                          {(() => {
                            const esMensualidad = item.nombre?.toLowerCase().includes('mensualidad');
                            if (esMensualidad) {
                              const cicloFormateado = formatCicloMensualidad(
                                item.ciclo_inicio || nota?.ciclo_inicio,
                                item.ciclo_fin || nota?.ciclo_fin,
                                item.detalle_extra,
                              );
                              if (cicloFormateado) {
                                return (
                                  <span style={{
                                    fontSize: '0.78rem', color: '#a78bfa', fontStyle: 'italic',
                                    display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                    width: '100%', marginTop: item.periodo_meses && item.periodo_meses.length > 0 ? '0.15rem' : '0.25rem'
                                  }}>
                                    🏷️ {cicloFormateado}
                                  </span>
                                );
                              }
                            } else if (item.detalle_extra) {
                              return (
                                <span style={{
                                  fontSize: '0.78rem', color: '#a78bfa', fontStyle: 'italic',
                                  display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
                                  width: '100%', marginTop: item.periodo_meses && item.periodo_meses.length > 0 ? '0.15rem' : '0.25rem'
                                }}>
                                  🏷️ {item.detalle_extra}
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        {/* Subtotal: alineado a la derecha, no se encoge */}
                        <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem', whiteSpace: 'nowrap', flexShrink: 0 }}>
                          Bs {fmtMonto(item.subtotal)}
                        </span>
                      </div>
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
                    <span>Bs {fmtMonto(montoTotal)}</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Observaciones Generales ── */}
            {nota.observaciones && !(nota.es_anticipo && esObservacionAnticipoAutomatica(nota.observaciones)) && (
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
                <p style={{ fontSize: '0.87rem', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
                  {nota.observaciones}
                </p>
              </div>
            )}

            {/* ── Historial de Pagos ── */}
            <div style={{ marginBottom: '1.25rem' }}>
              <button
                type="button"
                onClick={() => setMostrarCobros(!mostrarCobros)}
                style={{
                  fontSize: '0.85rem',
                  fontWeight: 800,
                  color: 'var(--text-primary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: '0.8rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  fontFamily: 'inherit'
                }}
              >
                <CreditCard size={16} style={{ color: '#3b82f6' }} />
                Historial de Pagos ({cobros.length})
                {mostrarCobros ? <ChevronUp size={16} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-tertiary)' }} />}
              </button>

              {mostrarCobros && (
                cobros.length === 0 ? (
                  <p style={{ fontSize: '0.83rem', color: '#64748b', fontStyle: 'italic' }}>
                    No hay cobros registrados aún.
                  </p>
                ) : (
                  <div style={{
                    background: 'var(--bg-glass)',
                    borderRadius: '10px',
                    border: '1px solid var(--border)',
                    overflow: 'hidden'
                  }}>
                    {cobros.map((cobro, idx) => (
                      <div
                        key={cobro.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '0.6rem 1rem',
                          borderBottom: idx < cobros.length - 1 ? '1px solid var(--border)' : 'none',
                          background: cobro.es_aplicacion_anticipo ? 'rgba(168,85,247,0.04)' : 'transparent'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                          <span style={{ fontSize: '0.83rem', color: 'var(--text-secondary)' }}>
                            {formatFecha(cobro.fecha)}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {cobro.es_aplicacion_anticipo
                              ? '🔄 Aplicación de anticipo'
                              : (cobro.caja_nombre || 'Caja no especificada')}
                            {cobro.documento_referencia && ` — ${cobro.documento_referencia}`}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <span style={{
                            color: '#4ade80',
                            fontWeight: 700,
                            fontSize: '0.9rem'
                          }}>
                            Bs {fmtMonto(Number(cobro.monto_aplicado))}
                          </span>

                          {!soloLectura && !nota.anulada && (puedeEditar || puedeEliminar) && (
                            <div style={{ display: 'flex', gap: '0.4rem' }}>
                              {puedeEditar && <button
                                onClick={() => setMovEditar({
                                  ...cobro,
                                  caja_id: (cobro as any).caja_id,
                                })}
                                style={{
                                  background: 'var(--bg-glass)',
                                  border: 'none',
                                  color: 'var(--text-tertiary)',
                                  padding: '0.35rem',
                                  borderRadius: '6px',
                                  cursor: 'pointer',
                                  transition: 'all 0.2s'
                                }}
                                title="Editar Cobro"
                              >
                                <Pencil size={14} />
                              </button>}
                              {/* Solo SuperAdministrador puede eliminar cobros */}
                              {puedeEliminar && (
                                <button
                                  onClick={() => handleEliminarCobro(cobro.id)}
                                  disabled={eliminandoId === cobro.id}
                                  style={{
                                    background: 'rgba(248,113,113,0.1)',
                                    border: 'none',
                                    color: '#f87171',
                                    padding: '0.35rem',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s'
                                  }}
                                  title="Eliminar Cobro"
                                >
                                  {eliminandoId === cobro.id ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
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

            {/* Modal de edición de cobro */}
            {!soloLectura && <ModalEditarCobroCxC
              visible={!!movEditar}
              cobro={movEditar}
              cajas={cajas}
              fechaEmisionNota={nota?.fecha_emision}
              descripcionNota={nota?.descripcion}
              onCerrar={() => setMovEditar(null)}
              onActualizar={async () => {
                setMovEditar(null);
                await cargarDatos();
                onActualizar?.();
              }}
            />}

            {/* ── Datos de Auditoría ── */}
            {(nota.editado || nota.anulada) && (
              <div style={{
                padding: '0.75rem 1rem',
                background: 'var(--bg-glass)',
                borderRadius: '8px',
                fontSize: '0.75rem',
                color: 'var(--text-tertiary)',
                border: '1px solid var(--border)'
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

export default ModalVerNotaCxC;
