/**
 * FichaAnticiposCxC.tsx
 * Ficha para gestionar los saldos a favor (anticipos) de alumnos en CxC.
 * Permite ver todos los anticipos disponibles de un alumno específico
 * y aplicarlos a notas de servicio pendientes.
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
interface AnticipoAlumno {
  id: string;
  descripcion: string | null;
  fecha_emision: string;
  monto_total: number;
  total_cobrado: number;
  saldo_pendiente: number; // Saldo disponible del anticipo
  alumno_id: string | null;
  alumno_nombres?: string;
  alumno_apellidos?: string;
}

interface NotaPendienteCxC {
  id: string;
  descripcion: string | null;
  fecha_emision: string;
  monto_total: number;
  saldo_pendiente: number;
  estado: string;
}

// ── Props ──────────────────────────────────────────────────────────────
// Modo 1: alumno específico (desde DetalleAlumnoCxc)
// Modo 2: todo la escuela (desde una pantalla global)
interface Props {
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
  alumnoId?: string;        // Si se provee, solo muestra anticipos de ese alumno
  alumnoNombre?: string;    // Nombre para el titular del modal
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Componente principal ───────────────────────────────────────────────
const FichaAnticiposCxC: React.FC<Props> = ({
  visible, onCerrar, onActualizar, alumnoId, alumnoNombre
}) => {
  const [anticipos, setAnticipos] = useState<AnticipoAlumno[]>([]);
  const [cargando, setCargando] = useState(true);
  const [expandidoId, setExpandidoId] = useState<string | null>(null);

  // Estado de aplicación
  const [notasPendientes, setNotasPendientes] = useState<NotaPendienteCxC[]>([]);
  const [cargandoNotas, setCargandoNotas] = useState(false);
  const [notaSelId, setNotaSelId] = useState('');
  const [montoAplicar, setMontoAplicar] = useState('');
  const [aplicando, setAplicando] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [mensajeExito, setMensajeExito] = useState<string | null>(null);

  // ── Carga de anticipos ─────────────────────────────────────────────
  const cargarAnticipos = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let query = supabase
      .from('v_cuentas_cobrar')
      .select('id, descripcion, fecha_emision, monto_total, total_cobrado, saldo_pendiente, alumno_id, alumno_nombres, alumno_apellidos')
      .eq('es_anticipo', true)
      .gt('saldo_pendiente', 0)
      .order('fecha_emision', { ascending: false });

    if (alumnoId) query = query.eq('alumno_id', alumnoId);

    const { data } = await query;
    setAnticipos(
      (data ?? []).map((r: any) => ({
        ...r,
        monto_total: Number(r.monto_total),
        total_cobrado: Number(r.total_cobrado),
        saldo_pendiente: Number(r.saldo_pendiente),
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
  }, [visible, alumnoId]);

  // ── Expandir anticipo y cargar notas pendientes del mismo alumno ────
  const expandirAnticipo = async (anticipo: AnticipoAlumno) => {
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

    if (!anticipo.alumno_id) {
      setNotasPendientes([]);
      setCargandoNotas(false);
      return;
    }

    const { data } = await supabase
      .from('v_cuentas_cobrar')
      .select('id, descripcion, fecha_emision, monto_total, saldo_pendiente, estado')
      .eq('alumno_id', anticipo.alumno_id)
      .eq('es_anticipo', false)
      .gt('saldo_pendiente', 0)
      .in('estado', ['pendiente', 'parcial', 'vencida'])
      .order('fecha_emision', { ascending: true });

    setNotasPendientes(
      (data ?? []).map((n: any) => ({
        ...n,
        monto_total: Number(n.monto_total),
        saldo_pendiente: Number(n.saldo_pendiente),
      }))
    );
    setCargandoNotas(false);
  };

  // ── Aplicar anticipo a nota de servicios ──────────────────────────
  const handleAplicar = async (anticipo: AnticipoAlumno) => {
    if (!notaSelId) { setMensajeError('Selecciona una nota de servicio.'); return; }
    const mp = parseFloat(montoAplicar);
    if (!mp || mp <= 0) { setMensajeError('Ingresa un monto válido.'); return; }
    if (mp > anticipo.saldo_pendiente) {
      setMensajeError(`El monto supera el saldo disponible (Bs ${fmtMonto(anticipo.saldo_pendiente)}).`);
      return;
    }
    const nota = notasPendientes.find(n => n.id === notaSelId);
    if (nota && mp > nota.saldo_pendiente) {
      setMensajeError(`El monto supera la deuda de la nota (Bs ${fmtMonto(nota.saldo_pendiente)}).`);
      return;
    }

    setAplicando(true);
    setMensajeError(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setMensajeError('Error de autenticación.'); setAplicando(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id').eq('id', user.id).single();
    if (!ctx) { setMensajeError('Error de contexto.'); setAplicando(false); return; }

    const { error } = await supabase.rpc('rpc_aplicar_anticipo_cxc', {
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

    await cargarAnticipos();
    onActualizar();
    setTimeout(() => setMensajeExito(null), 4000);
  };

  // ── Estadísticas ──────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: anticipos.length,
    totalSaldo: anticipos.reduce((s, a) => s + a.saldo_pendiente, 0),
  }), [anticipos]);

  if (!visible) return null;

  const tituloModal = alumnoNombre
    ? `Saldos a Favor — ${alumnoNombre}`
    : 'Saldos a Favor de Alumnos';

  return (
    <div className="cxc-modal-overlay">
      <div
        className="cxc-modal"
        style={{ maxWidth: '680px', width: '96vw', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="cxc-modal-header" style={{ borderLeft: '8px solid var(--secondary)', paddingLeft: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Wallet size={22} style={{ color: 'var(--secondary)' }} />
            <div>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{tituloModal}</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Anticipos disponibles para aplicar a notas de servicio
              </p>
            </div>
          </div>
          <button onClick={onCerrar}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '1rem' }}>
          {/* Resumen */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <div style={{
              flex: 1, minWidth: '140px',
              background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
              borderRadius: '10px', padding: '0.8rem 1rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Anticipos activos
              </div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--secondary)' }}>
                {stats.total}
              </div>
            </div>
            <div style={{
              flex: 2, minWidth: '180px',
              background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.2)',
              borderRadius: '10px', padding: '0.8rem 1rem'
            }}>
              <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                Total disponible para aplicar
              </div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--secondary)' }}>
                Bs {fmtMonto(stats.totalSaldo)}
              </div>
            </div>
          </div>

          {/* Lista de anticipos */}
          {cargando ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
              <RefreshCw size={28} className="spin" style={{ color: 'var(--secondary)' }} />
            </div>
          ) : anticipos.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--text-tertiary)' }}>
              <Wallet size={40} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
              <p style={{ margin: 0 }}>No hay saldos a favor disponibles.</p>
              <p style={{ margin: '0.3rem 0 0', fontSize: '0.82rem' }}>
                Para registrar un saldo a favor, usa el botón "Registrar Saldo a Favor" en la ficha del alumno.
              </p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {anticipos.map(anticipo => {
                const nombreAlumno = anticipo.alumno_nombres
                  ? `${anticipo.alumno_nombres} ${anticipo.alumno_apellidos}`
                  : '(Sin alumno)';
                const isExp = expandidoId === anticipo.id;
                const notaSel = notasPendientes.find(n => n.id === notaSelId);

                return (
                  <div
                    key={anticipo.id}
                    style={{
                      border: isExp
                        ? '1px solid rgba(74,222,128,0.4)'
                        : '1px solid rgba(255,255,255,0.08)',
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
                        background: isExp ? 'rgba(74,222,128,0.06)' : 'rgba(255,255,255,0.02)',
                        transition: 'background 0.2s',
                      }}
                    >
                      {isExp
                        ? <ChevronDown size={16} style={{ color: 'var(--secondary)', flexShrink: 0 }} />
                        : <ChevronRight size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                      }

                      <div style={{ flex: 1, minWidth: 0 }}>
                        {/* Nombre del alumno (solo si es modo global) */}
                        {!alumnoId && (
                          <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600 }}>
                            {nombreAlumno}
                          </div>
                        )}
                        <div style={{ fontWeight: 600, fontSize: '0.93rem', color: '#e2e8f0' }}>
                          {anticipo.descripcion || 'Saldo a Favor'}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', marginTop: '0.1rem' }}>
                          {formatFecha(anticipo.fecha_emision)}
                        </div>
                      </div>

                      {/* Saldo disponible */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Disponible</div>
                        <div style={{ fontWeight: 700, color: 'var(--secondary)', fontSize: '1.05rem' }}>
                          Bs {fmtMonto(anticipo.saldo_pendiente)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                          de Bs {fmtMonto(anticipo.monto_total)}
                        </div>
                      </div>
                    </div>

                    {/* Panel de aplicación */}
                    {isExp && (
                      <div style={{
                        padding: '1rem',
                        borderTop: '1px solid rgba(74,222,128,0.15)',
                        background: 'rgba(0,0,0,0.15)',
                      }}>
                        <p style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 600, marginBottom: '0.75rem' }}>
                          <ArrowRight size={13} style={{ marginRight: '0.3rem', color: 'var(--secondary)' }} />
                          APLICAR A UNA NOTA DE SERVICIO PENDIENTE
                          {!alumnoId && ` DE ${nombreAlumno.toUpperCase()}`}
                        </p>

                        {cargandoNotas ? (
                          <div style={{ display: 'flex', justifyContent: 'center', padding: '1rem' }}>
                            <RefreshCw size={20} className="spin" style={{ color: 'var(--secondary)' }} />
                          </div>
                        ) : notasPendientes.length === 0 ? (
                          <div style={{
                            padding: '0.75rem', background: 'rgba(248,113,113,0.08)',
                            borderRadius: '8px', fontSize: '0.83rem', color: '#f87171',
                            display: 'flex', alignItems: 'center', gap: '0.4rem'
                          }}>
                            <AlertCircle size={14} />
                            No hay notas de servicio pendientes para este alumno.
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                            {/* Selector de nota */}
                            <div>
                              <label style={{ fontSize: '0.78rem', color: '#94a3b8', display: 'block', marginBottom: '0.3rem' }}>
                                Nota de servicio a aplicar:
                              </label>
                              <select
                                value={notaSelId}
                                onChange={e => {
                                  setNotaSelId(e.target.value);
                                  const n = notasPendientes.find(x => x.id === e.target.value);
                                  if (n) {
                                    const max = Math.min(anticipo.saldo_pendiente, n.saldo_pendiente);
                                    setMontoAplicar(String(max));
                                  }
                                  setMensajeError(null);
                                }}
                                className="nota-pago-select"
                                style={{ width: '100%', borderColor: 'var(--secondary)' }}
                              >
                                <option value="">— Seleccionar nota —</option>
                                {notasPendientes.map(n => (
                                  <option key={n.id} value={n.id}>
                                    {formatFecha(n.fecha_emision)}
                                    {' · '}{n.descripcion || 'Nota de Servicio'}
                                    {' · Saldo: Bs '}{fmtMonto(n.saldo_pendiente)}
                                  </option>
                                ))}
                              </select>
                            </div>

                            {/* Info nota seleccionada */}
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
                                  Bs {fmtMonto(notaSel.saldo_pendiente)}
                                </span>
                              </div>
                            )}

                            {/* Monto + Botón */}
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
                                    ? Math.min(anticipo.saldo_pendiente, notaSel.saldo_pendiente)
                                    : anticipo.saldo_pendiente
                                  }
                                  value={montoAplicar}
                                  onChange={e => setMontoAplicar(e.target.value)}
                                  placeholder="Monto"
                                  className="nota-pago-input"
                                  disabled={aplicando}
                                  style={{ width: '100%', borderColor: 'var(--secondary)' }}
                                />
                              </div>
                              <button
                                onClick={() => handleAplicar(anticipo)}
                                disabled={aplicando || !notaSelId || !montoAplicar}
                                className="btn-guardar-cuenta"
                                style={{
                                  background: aplicando ? '#64748b' : 'var(--secondary)',
                                  minWidth: '120px',
                                  justifyContent: 'center'
                                }}
                              >
                                {aplicando
                                  ? <RefreshCw size={14} className="spin" />
                                  : <CheckCircle2 size={14} />
                                }
                                {aplicando ? 'Aplicando...' : 'Aplicar'}
                              </button>
                            </div>

                            {/* Mensajes feedback */}
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

          {/* Footer */}
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

export default FichaAnticiposCxC;
