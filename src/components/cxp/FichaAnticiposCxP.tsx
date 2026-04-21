/**
 * FichaAnticiposCxP.tsx
 * Ficha para gestionar anticipos a proveedores/personal en el módulo CxP.
 * Permite ver todos los anticipos disponibles (saldo a favor) por entidad,
 * y aplicarlos a notas de pago pendientes.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  RefreshCw, ChevronDown, ChevronRight,
  CheckCircle2, AlertCircle, Wallet, ArrowRight,
  TrendingDown, X
} from 'lucide-react';
import { formatFecha } from '../../lib/dateUtils';

// ── Tipos ──────────────────────────────────────────────────────────────
interface AnticipoCxP {
  id: string;
  descripcion: string | null;
  fecha_emision: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number; // Saldo disponible del anticipo
  proveedor_id: string | null;
  personal_id: string | null;
  proveedor_nombre?: string;
  personal_nombre?: string;
}

interface NotaPendiente {
  id: string;
  descripcion: string | null;
  fecha_emision: string;
  monto_total: number;
  deuda_restante: number;
  estado: string;
}

interface Props {
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Componente principal ────────────────────────────────────────────────
const FichaAnticiposCxP: React.FC<Props> = ({ visible, onCerrar, onActualizar }) => {
  const [anticipos, setAnticipos] = useState<AnticipoCxP[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  // Estado de aplicación de anticipo
  const [notasPendientes, setNotasPendientes] = useState<NotaPendiente[]>([]);
  const [cargandoNotas, setCargandoNotas] = useState(false);
  const [notaSelId, setNotaSelId] = useState('');
  const [montoAplicar, setMontoAplicar] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // ── Carga de anticipos ────────────────────────────────────────────────
  const cargarAnticipos = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: u } = await supabase.from('usuarios')
      .select('escuela_id').eq('id', user.id).single();

    const { data } = await supabase
      .from('v_estado_cuentas_pagar')
      .select('id, descripcion, fecha_emision, monto_total, monto_pagado, deuda_restante, proveedor_id, personal_id')
      .eq('es_anticipo', true)
      .gt('deuda_restante', 0)
      .order('fecha_emision', { ascending: false });

    // Enriquecer con nombres de proveedores y personal
    const provIds = [...new Set((data ?? []).filter(r => r.proveedor_id).map(r => r.proveedor_id))];
    const persIds = [...new Set((data ?? []).filter(r => r.personal_id).map(r => r.personal_id))];
    const [resProvs, persPers] = await Promise.all([
      provIds.length > 0
        ? supabase.from('proveedores').select('id, nombre').in('id', provIds)
        : Promise.resolve({ data: [] }),
      persIds.length > 0
        ? supabase.from('personal').select('id, nombres, apellidos').in('id', persIds)
        : Promise.resolve({ data: [] }),
    ]);
    const mapProv: Record<string, string> = {};
    (resProvs.data ?? []).forEach((p: any) => { mapProv[p.id] = p.nombre; });
    const mapPers: Record<string, string> = {};
    (persPers.data ?? []).forEach((p: any) => { mapPers[p.id] = `${p.nombres} ${p.apellidos}`; });

    setAnticipos(
      (data ?? []).map((r: any) => ({
        ...r,
        monto_total: Number(r.monto_total),
        monto_pagado: Number(r.monto_pagado),
        deuda_restante: Number(r.deuda_restante),
        proveedor_nombre: r.proveedor_id ? mapProv[r.proveedor_id] : undefined,
        personal_nombre: r.personal_id ? mapPers[r.personal_id] : undefined,
      }))
    );
    setCargando(false);
  };

  useEffect(() => {
    if (visible) cargarAnticipos();
    else {
      setExpandidoId(null);
      setNotasPendientes([]);
      setNotaSelId('');
      setMontoAplicar('');
      setMensajeError(null);
      setMensajeExito(null);
    }
  }, [visible]);

  // ── Cargar notas pendientes para el anticipo seleccionado ──────────────
  const expandirAnticipo = async (anticipo: AnticipoCxP) => {
    if (expandidoId === anticipo.id) {
      setExpandidoId(null);
      return;
    }
    setExpandidoId(anticipo.id);
    setNotaSelId('');
    setMontoAplicar('');
    setMensajeError(null);
    setMensajeExito(null);
    setCargandoNotas(true);

    let query = supabase
      .from('v_estado_cuentas_pagar')
      .select('id, descripcion, fecha_emision, monto_total, deuda_restante, estado')
      .eq('es_anticipo', false)
      .gt('deuda_restante', 0)
      .in('estado', ['pendiente', 'parcial', 'vencida'])
      .order('fecha_emision', { ascending: true });

    if (anticipo.proveedor_id) query = query.eq('proveedor_id', anticipo.proveedor_id);
    else if (anticipo.personal_id) query = query.eq('personal_id', anticipo.personal_id);

    const { data } = await query;
    setNotasPendientes(
      (data ?? []).map((n: any) => ({
        ...n,
        monto_total: Number(n.monto_total),
        deuda_restante: Number(n.deuda_restante),
      }))
    );
    setCargandoNotas(false);
  };

  // ── Aplicar anticipo a una nota ────────────────────────────────────────
  const handleAplicar = async (anticipo: AnticipoCxP) => {
    if (!notaSelId) { setMensajeError('Selecciona una nota de pago.'); return; }
    const mp = parseFloat(montoAplicar);
    if (!mp || mp <= 0) { setMensajeError('Ingresa un monto válido.'); return; }
    if (mp > anticipo.deuda_restante) {
      setMensajeError(`El monto supera el saldo disponible (Bs ${fmtMonto(anticipo.deuda_restante)}).`);
      return;
    }
    const nota = notasPendientes.find(n => n.id === notaSelId);
    if (nota && mp > nota.deuda_restante) {
      setMensajeError(`El monto supera la deuda de la nota (Bs ${fmtMonto(nota.deuda_restante)}).`);
      return;
    }

    setAplicando(true);
    setMensajeError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMensajeError('Error de autenticación.'); setAplicando(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id').eq('id', user.id).single();
    if (!ctx) { setMensajeError('Error de contexto.'); setAplicando(false); return; }

    const { error } = await supabase.rpc('rpc_aplicar_anticipo_cxp', {
      p_payload: {
        nota_id: notaSelId,
        anticipo_id: anticipo.id,
        monto: mp,
        usuario_id: ctx.id,
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
      }
    });

    setAplicando(false);

    if (error) {
      setMensajeError(`Error: ${error.message}`);
      return;
    }

    setMensajeExito(`✅ Bs ${fmtMonto(mp)} aplicados correctamente a la nota.`);
    setNotaSelId('');
    setMontoAplicar('');

    // Recargar
    await cargarAnticipos();
    onActualizar();

    setTimeout(() => setMensajeExito(null), 4000);
  };

  // ── Estadísticas ───────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: anticipos.length,
    totalSaldo: anticipos.reduce((s, a) => s + a.deuda_restante, 0),
  }), [anticipos]);

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay">
      <div
        className="cxc-modal"
        style={{ maxWidth: '680px', width: '96vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="cxc-modal-header" style={{ borderLeft: '8px solid #a855f7', paddingLeft: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Wallet size={22} style={{ color: '#a855f7' }} />
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Anticipos a Proveedores</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Saldos disponibles para aplicar a notas de pago
              </p>
            </div>
          </div>
          <button onClick={onCerrar}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1rem' }}>
          {/* Resumen rápido */}
          <div style={{
            display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap'
          }}>
            <div style={{
              flex: 1, minWidth: '140px',
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '10px', padding: '0.8rem 1rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Anticipos activos
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#a855f7' }}>
                {stats.total}
              </div>
            </div>
            <div style={{
              flex: 2, minWidth: '180px',
              background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)',
              borderRadius: '10px', padding: '0.8rem 1rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Total disponible para aplicar
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#a855f7' }}>
                Bs {fmtMonto(stats.totalSaldo)}
              </div>
            </div>
          </div>

          {/* Lista de anticipos */}
          {cargando ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <RefreshCw size={28} className="spin" style={{ color: '#a855f7' }} />
            </div>
          ) : anticipos.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '3rem 1rem',
              color: 'var(--text-tertiary)'
            }}>
              <Wallet size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
              <p style={{ margin: 0 }}>No hay anticipos disponibles.</p>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem' }}>
                Para registrar un anticipo, usa el botón "Registrar Anticipo" en el listado CxP.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {anticipos.map(anticipo => {
                const entidad = anticipo.proveedor_nombre || anticipo.personal_nombre || '(Sin asignar)';
                const isExp = expandidoId === anticipo.id;
                const notaSel = notasPendientes.find(n => n.id === notaSelId);

                return (
                  <div
                    key={anticipo.id}
                    style={{
                      border: isExp ? '1px solid rgba(168,85,247,0.5)' : '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      overflow: 'hidden',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    {/* Encabezado del anticipo */}
                    <div
                      onClick={() => expandirAnticipo(anticipo)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.75rem',
                        padding: '0.9rem 1rem', cursor: 'pointer',
                        background: isExp ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)',
                        transition: 'background 0.2s',
                      }}
                    >
                      {isExp
                        ? <ChevronDown size={16} style={{ color: '#a855f7', flexShrink: 0 }} />
                        : <ChevronRight size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                      }

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: '0.93rem', color: '#e2e8f0' }}>
                          {entidad}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.1rem' }}>
                          {anticipo.descripcion || 'Anticipo'} · {formatFecha(anticipo.fecha_emision)}
                        </div>
                      </div>

                      {/* Saldo disponible */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Disponible</div>
                        <div style={{ fontWeight: 700, color: '#a855f7', fontSize: '1.05rem' }}>
                          Bs {fmtMonto(anticipo.deuda_restante)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          de Bs {fmtMonto(anticipo.monto_total)}
                        </div>
                      </div>
                    </div>

                    {/* Panel de aplicación = expandido */}
                    {isExp && (
                      <div style={{
                        padding: '1rem',
                        borderTop: '1px solid rgba(168,85,247,0.15)',
                        background: 'rgba(0,0,0,0.15)',
                      }}>
                        <p style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.75rem' }}>
                          <ArrowRight size={13} style={{ marginRight: '0.3rem', color: '#a855f7' }} />
                          APLICAR A UNA NOTA PENDIENTE DE {entidad.toUpperCase()}
                        </p>

                        {cargandoNotas ? (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
                            <RefreshCw size={20} className="spin" style={{ color: '#a855f7' }} />
                          </div>
                        ) : notasPendientes.length === 0 ? (
                          <div style={{
                            padding: '0.75rem', background: 'rgba(248,113,113,0.08)',
                            borderRadius: '8px', fontSize: '0.83rem', color: '#f87171',
                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                          }}>
                            <AlertCircle size={14} />
                            No hay notas de pago pendientes para esta entidad.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {/* Selector de nota */}
                            <div>
                              <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>
                                Nota de pago a aplicar:
                              </label>
                              <select
                                value={notaSelId}
                                onChange={e => {
                                  setNotaSelId(e.target.value);
                                  const n = notasPendientes.find(x => x.id === e.target.value);
                                  if (n) {
                                    const max = Math.min(anticipo.deuda_restante, n.deuda_restante);
                                    setMontoAplicar(String(max));
                                  }
                                  setMensajeError(null);
                                }}
                                className="nota-pago-select"
                                style={{ width: '100%', borderColor: '#a855f7' }}
                              >
                                <option value="">— Seleccionar nota —</option>
                                {notasPendientes.map(n => (
                                  <option key={n.id} value={n.id}>
                                    {formatFecha(n.fecha_emision)}
                                    {' · '}{n.descripcion || 'Nota de Pago'}
                                    {' · Saldo: Bs '}{fmtMonto(n.deuda_restante)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Info de la nota seleccionada */}
                            {notaSel && (
                              <div style={{
                                display: 'flex', justifyContent: 'space-between',
                                padding: '0.5rem 0.75rem', borderRadius: '8px',
                                background: 'rgba(239,68,68,0.07)', fontSize: '0.82rem'
                              }}>
                                <span style={{ color: '#94a3b8' }}>
                                  <TrendingDown size={12} style={{ marginRight: '0.2rem' }} />
                                  Saldo nota:
                                </span>
                                <span style={{ color: '#f87171', fontWeight: 600 }}>
                                  Bs {fmtMonto(notaSel.deuda_restante)}
                                </span>
                              </div>
                            )}

                            {/* Monto a aplicar */}
                            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
                              <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>
                                  Monto a aplicar (Bs):
                                </label>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  max={notaSel
                                    ? Math.min(anticipo.deuda_restante, notaSel.deuda_restante)
                                    : anticipo.deuda_restante
                                  }
                                  value={montoAplicar}
                                  onChange={e => setMontoAplicar(e.target.value)}
                                  placeholder="Monto"
                                  className="nota-pago-input"
                                  disabled={aplicando}
                                  style={{ width: '100%', borderColor: '#a855f7' }}
                                />
                              </div>
                              <button
                                onClick={() => handleAplicar(anticipo)}
                                disabled={aplicando || !notaSelId || !montoAplicar}
                                className="btn-guardar-cuenta"
                                style={{
                                  background: aplicando ? '#64748b' : '#a855f7',
                                  borderColor: '#a855f7',
                                  minWidth: '120px',
                                  justifyContent: 'center'
                                }}
                              >
                                {aplicando ? (
                                  <RefreshCw size={14} className="spin" />
                                ) : (
                                  <CheckCircle2 size={14} />
                                )}
                                {aplicando ? 'Aplicando...' : 'Aplicar'}
                              </button>
                            </div>

                            {/* Mensajes */}
                            {mensajeError && (
                              <div className="form-msg form-msg--error">
                                <AlertCircle size={13} /> {mensajeError}
                              </div>
                            )}
                            {mensajeExito && (
                              <div className="form-msg form-msg--exito">
                                <CheckCircle2 size={13} /> {mensajeExito}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Botón actualizar */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.25rem', gap: '0.5rem' }}>
            <button
              className="btn-refrescar"
              onClick={cargarAnticipos}
              disabled={cargando}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.83rem' }}
            >
              <RefreshCw size={14} className={cargando ? 'spin' : ''} />
              Actualizar
            </button>
            <button
              onClick={onCerrar}
              className="btn-refrescar"
              style={{ fontSize: '0.83rem' }}
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FichaAnticiposCxP;
