/**
 * ModalCobroRapido.tsx
 * Modal de cobro rápido accesible desde la lista principal de alumnos.
 * Versión simplificada sin asientos contables.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda, CuentaCobrar } from '../../types/cxc';
import type { CajaBanco } from '../../types/finanzas';
import { X, CreditCard, AlertCircle, Check, MessageCircle, Users, FileText, RefreshCw, DollarSign, Building2, Info, Calendar, Hash, Clock } from 'lucide-react';
import { getHoyISO, getHoraLocal } from '../../lib/dateUtils';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  alumnoInicial: AlumnoDeuda | null;
  visible: boolean;
  onCerrar: () => void;
  onCobrado: () => void;
}

const ModalCobroRapido: React.FC<Props> = ({ alumnoInicial, visible, onCerrar, onCobrado }) => {
  const [alumnos, setAlumnos] = useState<AlumnoDeuda[]>([]);
  const [alumnoSel, setAlumnoSel] = useState<AlumnoDeuda | null>(alumnoInicial);
  const [cxcsPendientes, setCxcsPendientes] = useState<CuentaCobrar[]>([]);
  const [cxcSelId, setCxcSelId] = useState('');
  const [cuentasCobro, setCuentasCobro] = useState<CajaBanco[]>([]);

  const [monto, setMonto] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [bancoOrigen, setBancoOrigen] = useState('');
  const [fecha, setFecha] = useState(getHoyISO());
  const [hora, setHora] = useState(getHoraLocal());
  const [nroDoc, setNroDoc] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [mensajeWA, setMensajeWA] = useState<{ texto: string; telefono: string } | null>(null);
  // Info sobre exceso convertido en anticipo
  const [infoAnticipo, setInfoAnticipo] = useState<{ monto: number } | null>(null);

  // Cargar datos al abrir
  useEffect(() => {
    if (!visible) return;
    setError(null); setExito(null); setMensajeWA(null);
    // Sincronizar el alumno seleccionado con el alumno preseleccionado al abrir el modal
    setAlumnoSel(alumnoInicial);

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id, sucursal_id, rol')
        .eq('id', user.id).single();
      if (!usr) return;

      const esAdmin = usr.rol === 'SuperAdministrador' || usr.rol === 'Dueño';

      // Cargar lista de todos los alumnos
      const { data: listaAlumnos } = await supabase
        .from('v_alumnos_deuda')
        .select('*')
        .eq('escuela_id', usr.escuela_id);
      setAlumnos((listaAlumnos as unknown as AlumnoDeuda[]) ?? []);

      // Cargar cuentas (Cajas y Bancos) disponibles
      let q = supabase.from('cajas_bancos').select('*').eq('activo', true);
      if (!esAdmin && usr.sucursal_id) {
        q = q.or(`sucursal_id.eq.${usr.sucursal_id},sucursal_id.is.null`);
      }
      const { data: cuentas } = await q.order('orden');
      setCuentasCobro(cuentas ?? []);
      if (cuentas && cuentas.length > 0) {
        const pred = cuentas.find((c: any) => c.es_predeterminada);
        setCuentaId(pred ? pred.id : cuentas[0].id);
      }
    };
    cargar();
  }, [visible]);

  // Al cambiar alumno seleccionado, cargar sus CxC pendientes
  useEffect(() => {
    if (!alumnoSel) { setCxcsPendientes([]); setCxcSelId(''); return; }
    const cargarCxc = async () => {
      const { data } = await supabase
        .from('v_cuentas_cobrar')
        .select('*')
        .eq('alumno_id', alumnoSel.alumno_id)
        .gt('saldo_pendiente', 0)
        .eq('anulada', false)
        .order('fecha_emision', { ascending: true });
      const lista = (data as unknown as CuentaCobrar[]) ?? [];
      setCxcsPendientes(lista);
      if (lista.length > 0) {
        setCxcSelId(lista[0].id);
        setMonto(String(Number(lista[0].saldo_pendiente)));
      } else {
        setCxcSelId('anticipo');
        setMonto('');
      }
    };
    cargarCxc();
  }, [alumnoSel]);

  const handleChangeCxc = (id: string) => {
    setCxcSelId(id);
    if (id === 'anticipo') {
        setMonto('');
        return;
    }
    const cxc = cxcsPendientes.find(c => c.id === id);
    if (cxc) setMonto(String(Number(cxc.saldo_pendiente)));
  };

  const registrar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!alumnoSel || !cxcSelId) { setError('Selecciona un alumno y una nota pendiente o anticipo.'); return; }
    const montoNum = parseFloat(monto);
    if (!montoNum || montoNum <= 0) { setError('Monto inválido.'); return; }
    if (!cuentaId) { setError('Selecciona la caja/banco destino.'); return; }

    setGuardando(true); setError(null); setInfoAnticipo(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Error de autenticación.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id, nombres, apellidos')
        .eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      const partesRef: string[] = [];
      if (bancoOrigen.trim()) partesRef.push(bancoOrigen.trim());
      if (nroDoc.trim()) partesRef.push(nroDoc.trim());
      const concatDoc = partesRef.join(' | ');

      let montoCobrado = montoNum;
      let exceso = 0;

      // Si es una nota pendiente y el monto excede el saldo, separar exceso como anticipo
      if (cxcSelId !== 'anticipo') {
        const cxcSel = cxcsPendientes.find(c => c.id === cxcSelId);
        if (cxcSel && montoNum > Number(cxcSel.saldo_pendiente)) {
          exceso = parseFloat((montoNum - Number(cxcSel.saldo_pendiente)).toFixed(2));
          montoCobrado = Number(cxcSel.saldo_pendiente);
        }
      }

      let objetivoCxcId = cxcSelId;

      // Si es anticipo directo, creamos la nota de anticipo
      if (cxcSelId === 'anticipo') {
          const { data: nuevaNota, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
              escuela_id: ctx.escuela_id,
              sucursal_id: ctx.sucursal_id,
              alumno_id: alumnoSel.alumno_id,
              monto_total: montoNum,
              descripcion: 'Cobro Anticipado',
              estado: 'pendiente',
              es_anticipo: true,
          }).select('id').single();

          if (errCxc || !nuevaNota) throw new Error('Error al crear nota de anticipo.');
          objetivoCxcId = nuevaNota.id;

          await supabase.from('cxc_detalle').insert({
              escuela_id: ctx.escuela_id,
              cuenta_cobrar_id: nuevaNota.id,
              descripcion: 'Anticipo del cliente',
              cantidad: 1,
              precio_unitario: montoNum
          });
      }

      // Cobrar el monto exacto (o el saldo si hubo exceso)
      const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
        p_payload: {
          cuenta_cobrar_id: objetivoCxcId,
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          monto: montoCobrado,
          cuenta_cobro_id: cuentaId,
          nro_comprobante: concatDoc || null,
          fecha: `${fecha}T${getHoraLocal()}:00`
        }
      });
      if (rpcErr) throw rpcErr;

      // Si hubo exceso, registrar como anticipo
      if (exceso > 0) {
        const { data: notaAnticipo, error: errAnt } = await supabase.from('cuentas_cobrar').insert({
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          alumno_id: alumnoSel.alumno_id,
          monto_total: exceso,
          descripcion: 'Anticipo — Exceso de pago',
          estado: 'pendiente',
          es_anticipo: true,
          observaciones: `Generado automáticamente por pago de Bs ${fmtMonto(montoNum)} con exceso de Bs ${fmtMonto(exceso)}.`
        }).select('id').single();

        if (errAnt || !notaAnticipo) throw new Error('Error al registrar el anticipo del exceso.');

        await supabase.from('cxc_detalle').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaAnticipo.id,
          descripcion: 'Anticipo — Exceso de pago',
          cantidad: 1,
          precio_unitario: exceso
        });

        const { error: rpcAntErr } = await supabase.rpc('rpc_registrar_cobro', {
          p_payload: {
            cuenta_cobrar_id: notaAnticipo.id,
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            usuario_id: ctx.id,
            monto: exceso,
            cuenta_cobro_id: cuentaId,
            nro_comprobante: concatDoc || null,
            fecha: `${fecha}T${getHoraLocal()}:00`
          }
        });
        if (rpcAntErr) throw rpcAntErr;

        setInfoAnticipo({ monto: exceso });
      }

      // Auditoría
      try {
        const { logActivity } = await import('../../lib/auditLogger');
        logActivity({
          escuela_id: ctx.escuela_id,
          usuario_id: ctx.id,
          usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
          accion: 'cobro',
          modulo: 'cxc',
          entidad_id: objetivoCxcId,
          detalle: { 
            cliente: `${alumnoSel.nombres} ${alumnoSel.apellidos}`,
            monto: montoNum,
            exceso_anticipo: exceso > 0 ? exceso : undefined,
            descripcion: `Cobro de Bs ${fmtMonto(montoNum)} para ${alumnoSel.nombres}${exceso > 0 ? ` (Bs ${fmtMonto(exceso)} guardados como anticipo)` : ''}.`
          },
        });
      } catch (e) { console.error(e); }

      // Mensaje WhatsApp
      const esPadre = alumnoSel.whatsapp_preferido === 'padre';
      const telefono = esPadre
        ? (alumnoSel.telefono_padre || alumnoSel.telefono_madre)
        : (alumnoSel.telefono_madre || alumnoSel.telefono_padre);
      const cxcActual = cxcsPendientes.find(c => c.id === cxcSelId);

      if (telefono) {
        const telF = telefono.replace(/\D/g, '');
        const telFinal = telF.startsWith('591') ? telF : `591${telF}`;
        let texto = `Gracias por el pago de Bs ${fmtMonto(montoNum)} correspondiente a: ${cxcActual?.descripcion || 'servicios'}.`;
        if (exceso > 0) texto += ` El exceso de Bs ${fmtMonto(exceso)} fue guardado como anticipo a su favor.`;
        setMensajeWA({ texto, telefono: telFinal });
      }

      onCobrado();
      setGuardando(false);

      setTimeout(() => {
        if (!mensajeWA) onCerrar();
      }, 800);

    } catch (err: any) {
      setError(`Error: ${err.message}`);
      setGuardando(false);
    }
  };

  const enviarWA = () => {
    if (mensajeWA) {
      window.open(`https://wa.me/${mensajeWA.telefono}?text=${encodeURIComponent(mensajeWA.texto)}`, '_blank');
      setMensajeWA(null);
      onCerrar();
    }
  };

  if (!visible) return null;

  const cxcSel = cxcsPendientes.find(c => c.id === cxcSelId);
  const saldoCxc = cxcSel ? Number(cxcSel.saldo_pendiente) : 0;
  const montoIngresado = parseFloat(monto) || 0;
  const excesoCalculado = cxcSelId !== 'anticipo' && montoIngresado > saldoCxc && saldoCxc > 0
    ? parseFloat((montoIngresado - saldoCxc).toFixed(2))
    : 0;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal cxc-modal--cobro-rapido" onClick={e => e.stopPropagation()} style={{ maxWidth: '680px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: 'rgba(0, 210, 106, 0.15)',
              color: '#00D26A'
            }}>
              <CreditCard size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Registrar Pago</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {mensajeWA ? 'Recibo automático generado' : 'Registra el ingreso de dinero del alumno'}
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form">
          {mensajeWA ? (
            <div className="nota-wa-recibo">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                <div style={{ padding: '1.5rem', background: 'var(--bg-glass)', borderRadius: '12px', width: '100%', textAlign: 'left', border: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: '1.6' }}>{mensajeWA.texto}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', width: '100%', justifyContent: 'center' }}>
                  <button className="nota-wa-btn-enviar" onClick={enviarWA}>
                    <MessageCircle size={18} /> Enviar por WhatsApp
                  </button>
                  <button className="nota-wa-btn-omitir" onClick={onCerrar}>Omitir y cerrar</button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {/* Información del Alumno */}
              {!alumnoInicial ? (
                <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
                  <label><Users size={14} /> Alumno / Cliente *</label>
                  <select
                    value={alumnoSel?.alumno_id || ''}
                    onChange={e => setAlumnoSel(alumnos.find(a => a.alumno_id === e.target.value) || null)}
                    style={{ fontSize: '1rem', padding: '0.8rem' }}
                  >
                    <option value="">— Seleccionar alumno —</option>
                    {alumnos.sort((a, b) => `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`))
                      .map(a => (
                        <option key={a.alumno_id} value={a.alumno_id}>
                          {a.nombres} {a.apellidos} — Pendiente: Bs {fmtMonto(Number(a.saldo_pendiente))}
                        </option>
                      ))}
                  </select>
                </div>
              ) : (
                <div className="cxc-cobro-alumno" style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="cxc-alumno-avatar" style={{ width: '50px', height: '50px', fontSize: '1.2rem', borderRadius: '12px' }}>
                    {alumnoSel?.nombres[0]}{alumnoSel?.apellidos[0]}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{alumnoSel?.nombres} {alumnoSel?.apellidos}</div>
                    <div style={{ display: 'flex', gap: '1rem', marginTop: '0.2rem' }}>
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Deudor del sistema</span>
                        <span style={{ color: 'var(--warning)', fontWeight: 700, fontSize: '0.85rem' }}>Saldo Total: Bs {fmtMonto(Number(alumnoSel?.saldo_pendiente))}</span>
                    </div>
                  </div>
                </div>
              )}

              {alumnoSel && (
                <div className="form-campo full-width" style={{ marginBottom: '1.5rem' }}>
                  <label><FileText size={14} /> Nota / Concepto a Cobrar *</label>
                  <select 
                    value={cxcSelId} 
                    onChange={e => handleChangeCxc(e.target.value)}
                    style={{ background: 'var(--bg-glass)', fontWeight: 600 }}
                  >
                    {cxcsPendientes.length > 0 && <optgroup label="Notas Pendientes">
                      {cxcsPendientes.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.descripcion || 'Servicio'} — Saldo: Bs {fmtMonto(Number(c.saldo_pendiente))}
                        </option>
                      ))}
                    </optgroup>}
                    <optgroup label="Opciones Especiales">
                      <option value="anticipo">🌟 Registrar como Anticipo / Adelanto</option>
                    </optgroup>
                  </select>
                </div>
              )}

              {(cxcSel || cxcSelId === 'anticipo') && (
                <form onSubmit={registrar} style={{ display: 'contents' }}>
                  <div className="modal-form-grid">
                    <div className="form-campo">
                      <label><DollarSign size={14} /> Monto a cobrar *</label>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={monto}
                        onChange={e => setMonto(e.target.value)}
                        required disabled={guardando}
                        placeholder="0.00"
                        style={{ fontSize: '1.1rem', fontWeight: 700, color: excesoCalculado > 0 ? '#f59e0b' : 'var(--success)' }}
                      />
                      {/* Aviso de exceso → anticipo */}
                      {excesoCalculado > 0 && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.6rem 0.85rem',
                          background: 'rgba(245,158,11,0.1)',
                          border: '1px solid rgba(245,158,11,0.35)',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          color: '#f59e0b',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          lineHeight: 1.5
                        }}>
                          <Info size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
                          <span>
                            El pago excede el saldo en <strong>Bs {fmtMonto(excesoCalculado)}</strong>.
                            Se cobrará <strong>Bs {fmtMonto(saldoCxc)}</strong> a la nota y el exceso
                            se guardará como <strong>anticipo</strong> a favor del cliente.
                          </span>
                        </div>
                      )}
                      {/* Aviso de anticipo registrado exitosamente */}
                      {infoAnticipo && (
                        <div style={{
                          marginTop: '0.5rem',
                          padding: '0.6rem 0.85rem',
                          background: 'rgba(168,85,247,0.1)',
                          border: '1px solid rgba(168,85,247,0.35)',
                          borderRadius: '8px',
                          fontSize: '0.78rem',
                          color: '#a855f7',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: '0.5rem',
                          lineHeight: 1.5
                        }}>
                          <Check size={14} style={{ marginTop: '1px', flexShrink: 0 }} />
                          <span>
                            <strong>Bs {fmtMonto(infoAnticipo.monto)}</strong> guardados como anticipo exitosamente.
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="form-campo">
                      <label><Hash size={14} /> Nro. Transacción</label>
                      <input type="text" value={nroDoc} onChange={e => setNroDoc(e.target.value)} disabled={guardando} placeholder="Ej: 00123, REC-001..." />
                    </div>

                    <div className="form-campo">
                      <label><Calendar size={14} /> Fecha *</label>
                      <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required disabled={guardando} />
                    </div>



                    <div className="form-campo full-width">
                      <label><Building2 size={14} /> Caja o Banco Destino *</label>
                      <select value={cuentaId} onChange={e => setCuentaId(e.target.value)} required disabled={guardando}>
                        <option value="">— Seleccionar —</option>
                        {cuentasCobro.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>

                    <div className="form-campo full-width">
                      <label><Hash size={14} /> Referencia Extra (Opcional)</label>
                      <input type="text" placeholder="Ej: Banco, Hora, Ref..." value={bancoOrigen} onChange={e => setBancoOrigen(e.target.value)} disabled={guardando} />
                    </div>
                  </div>

                  {error && (
                    <div className="form-msg form-msg--error" style={{ marginTop: '1.5rem' }}>
                      <AlertCircle size={18} /> {error}
                    </div>
                  )}
                  
                  {exito && (
                    <div className="form-msg form-msg--exito" style={{ marginTop: '1.5rem' }}>
                      <Check size={18} /> {exito}
                    </div>
                  )}

                  <div className="cxc-modal-footer" style={{ 
                    marginTop: '2rem', 
                    paddingTop: '1.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '1rem'
                  }}>
                    <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando} style={{ borderRadius: '8px', padding: '0 1.5rem', width: 'auto' }}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !!exito} style={{ background: '#00D26A', borderColor: '#00D26A', padding: '0.6rem 2.5rem' }}>
                      {guardando ? (
                        <> <RefreshCw size={16} className="spin" /> Procesando... </>
                      ) : (
                        <> <Check size={18} /> Confirmar Cobro </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ModalCobroRapido;
