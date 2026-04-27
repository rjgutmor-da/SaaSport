/**
 * DetalleAlumnoCxc.tsx
 * Modal flotante que muestra todas las deudas de un alumno.
 * Versión simplificada sin lógica contable.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda, CuentaCobrar, CxcDetalle, LineaNota } from '../../types/cxc';
import type { CajaBanco } from '../../types/finanzas';
import { 
  AlertCircle, Check, CreditCard, Pencil, Ban, MessageCircle, X, 
  Calendar, Eye, Hash, Wallet, DollarSign, Plus, ChevronDown
} from 'lucide-react';
import NotaServicios from './NotaServicios';
import ModalEditarMovimiento from '../cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../cajas-bancos/ModalDetalleMovimiento';
import FichaAnticiposCxC from './FichaAnticiposCxC';
import { getHoraLocal, getHoyISO, formatFecha } from '../../lib/dateUtils';

interface DetalleAlumnoProps {
  alumno: AlumnoDeuda | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const DetalleAlumnoCxc: React.FC<DetalleAlumnoProps> = ({
  alumno, visible, onCerrar, onActualizar
}) => {
  const [cxcs, setCxcs] = useState<CuentaCobrar[]>([]);
  const [detalles, setDetalles] = useState<Record<string, CxcDetalle[]>>({});
  const [cargando, setCargando] = useState(false);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [modalNotaVisible, setModalNotaVisible] = useState(false);
  const [modoModal, setModoModal] = useState<'ver' | 'editar' | 'crear'>('crear');
  const [cxcParaEditar, setCxcParaEditar] = useState<any>(null);
  const [cuentasCobro, setCuentasCobro] = useState<CajaBanco[]>([]);
  const [userRol, setUserRol] = useState('');

  // Modal de cobro inline
  const [cobroCxcId, setCobroCxcId] = useState<string | null>(null);
  const [mostrarNuevaNotaManual, setMostrarNuevaNotaManual] = useState(false);
  const [cobroMonto, setCobroMonto] = useState('');
  const [cobroCuentaId, setCobroCuentaId] = useState('');
  const [cobroBancoOrigen, setCobroBancoOrigen] = useState('');
  const [cobroHora, setCobroHora] = useState(getHoraLocal());
  const [cobroFecha, setCobroFecha] = useState(getHoyISO());
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [cobroError, setCobroError] = useState<string | null>(null);
  const [cobroExito, setCobroExito] = useState<string | null>(null);
  
  const [mensajePagoWA, setMensajePagoWA] = useState<{ texto: string; telefono: string } | null>(null);
  const [historialCobros, setHistorialCobros] = useState<Record<string, any[]>>({});
  const [anticiposDisponibles, setAnticiposDisponibles] = useState<any[]>([]);
  const [usarAnticipo, setUsarAnticipo] = useState(false);
  const [anticipoId, setAnticipoId] = useState('');
  const [mostrarNotaAnticipo, setMostrarNotaAnticipo] = useState(false);
  const [mostrarFichaAnticipos, setMostrarFichaAnticipos] = useState(false);
  const [movDetalleId, setMovDetalleId] = useState<string | null>(null);
  const [showAnticiposMenu, setShowAnticiposMenu] = useState(false);

  useEffect(() => {
    if (!visible || !alumno) return;

    const cargar = async () => {
      setCargando(true);
      const { data: { user } } = await supabase.auth.getUser();
      let esAdmin = false;
      let userSucursal = '';
      let escuelaId = '';
      if (user) {
        const { data: usr } = await supabase.from('usuarios')
          .select('rol, sucursal_id, escuela_id').eq('id', user.id).single();
        setUserRol(usr?.rol || '');
        esAdmin = usr?.rol === 'SuperAdministrador' || usr?.rol === 'Dueño';
        userSucursal = usr?.sucursal_id || '';
        escuelaId = usr?.escuela_id || '';
      }

      let qCuentas = supabase.from('cajas_bancos').select('*').eq('activo', true).eq('escuela_id', escuelaId);
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resCxc, resCuentas] = await Promise.all([
        supabase.from('v_cuentas_cobrar').select('*')
          .eq('alumno_id', alumno.alumno_id)
          .order('created_at', { ascending: false }),
        qCuentas.order('nombre'),
      ]);

      setCxcs((resCxc.data as unknown as CuentaCobrar[]) ?? []);
      setCuentasCobro(resCuentas.data ?? []);
      
      const cxcIds = (resCxc.data as any[])?.map(c => c.id) || [];
      if (cxcIds.length > 0) {
        const { data: todosCobros } = await supabase
          .from('cobros_aplicados')
          .select('*, cajas_bancos(nombre)')
          .in('cuenta_cobrar_id', cxcIds)
          .order('fecha', { ascending: false });

        const historyMap: Record<string, any[]> = {};
        todosCobros?.forEach(cobro => {
          if (!historyMap[cobro.cuenta_cobrar_id]) historyMap[cobro.cuenta_cobrar_id] = [];
          historyMap[cobro.cuenta_cobrar_id].push({ ...cobro, caja_nombre: cobro.cajas_bancos?.nombre });
        });
        setHistorialCobros(historyMap);
      }

      const { data: resAnt } = await supabase.from('v_cuentas_cobrar')
        .select('*').eq('alumno_id', alumno.alumno_id).eq('es_anticipo', true).gt('saldo_pendiente', 0);
      setAnticiposDisponibles(resAnt || []);
      setCargando(false);
    };
    cargar();

    setUsarAnticipo(false); setAnticipoId('');
    setCobroCxcId(null); setExpandida(null); setMensajePagoWA(null);
  }, [visible, alumno]);

  const registrarCobro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobroCxcId || !alumno) return;
    setCobroError(null); setCobroExito(null);

    const monto = parseFloat(cobroMonto);
    if (!monto || monto <= 0) { setCobroError('Monto inválido.'); return; }
    if (!usarAnticipo && !cobroCuentaId) { setCobroError('Selecciona la caja/banco destino.'); return; }

    setGuardandoCobro(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Error de autenticación.');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      const cxcActual = cxcs.find(c => c.id === cobroCxcId);
      if (!cxcActual) throw new Error('No se encontró la deuda.');

      if (usarAnticipo) {
        if (!anticipoId) throw new Error('Seleccione un anticipo.');
        
        // 1. Aplicación en la nota actual
        await supabase.from('cobros_aplicados').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: cobroCxcId,
          monto_aplicado: monto,
          fecha: `${cobroFecha}T${cobroHora}:00`,
          es_aplicacion_anticipo: true,
          caja_id: null
        });

        // 2. Aplicación en el anticipo
        await supabase.from('cobros_aplicados').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: anticipoId,
          monto_aplicado: monto,
          fecha: `${cobroFecha}T${cobroHora}:00`,
          es_aplicacion_anticipo: true,
          caja_id: null
        });

        // 3. Actualizar estado del anticipo
        const { data: antData } = await supabase.from('v_cuentas_cobrar').select('*').eq('id', anticipoId).single();
        if (antData) {
            const saldoRestante = Number(antData.saldo_pendiente) - monto;
            const nuevoEstado = saldoRestante <= 0 ? 'pagada' : (saldoRestante < Number(antData.monto_total) ? 'parcial' : 'pendiente');
            await supabase.from('cuentas_cobrar').update({ estado: nuevoEstado }).eq('id', anticipoId);
        }
      } else {
        const partesRef = [];
        if (cobroBancoOrigen.trim()) partesRef.push(`Banco: ${cobroBancoOrigen.trim()}`);
        if (cobroHora.trim()) partesRef.push(`He: ${cobroHora.trim()}`);
        const concatDoc = partesRef.join(' | ');

        // 1. Registrar cobro
        await supabase.from('cobros_aplicados').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: cobroCxcId,
          monto_aplicado: monto,
          caja_id: cobroCuentaId,
          fecha: `${cobroFecha}T${cobroHora}:00`,
          documento_referencia: concatDoc || null
        });

        // 2. Actualizar Saldo Caja
        const caja = cuentasCobro.find(c => c.id === cobroCuentaId);
        const nuevoSaldo = (Number(caja?.saldo_actual) || 0) + monto;
        await supabase.from('cajas_bancos').update({ saldo_actual: nuevoSaldo }).eq('id', cobroCuentaId);
      }

      // 4. Actualizar estado de la nota actual
      const saldoRestanteActual = Number(cxcActual.saldo_pendiente) - monto;
      const nuevoEstadoNota = saldoRestanteActual <= 0 ? 'pagada' : (saldoRestanteActual < Number(cxcActual.monto_total) ? 'parcial' : 'pendiente');
      await supabase.from('cuentas_cobrar').update({ estado: nuevoEstadoNota }).eq('id', cobroCxcId);

      setCobroExito(`✅ Cobro de Bs ${fmtMonto(monto)} registrado correctamente.`);
      
      // WhatsApp Logic (Simplified)
      const esPadre = alumno.whatsapp_preferido === 'padre';
      const telefono = esPadre ? (alumno.telefono_padre || alumno.telefono_madre) : (alumno.telefono_madre || alumno.telefono_padre);
      if (telefono) {
          const telLimpio = telefono.replace(/\D/g, '');
          const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
          setMensajePagoWA({ texto: `Gracias por el pago de Bs ${fmtMonto(monto)}.`, telefono: telFinal });
      }

      setTimeout(() => { onActualizar(); setCobroCxcId(null); }, 1500);

    } catch (err: any) {
      setCobroError(`Error: ${err.message}`);
    } finally {
      setGuardandoCobro(false);
    }
  };

  const anularNota = async (cxcId: string) => {
    if (!confirm('¿Estás seguro de anular esta nota de servicios?')) return;
    try {
      const { error: err } = await supabase.from('cuentas_cobrar').update({ estado: 'anulada', anulada: true }).eq('id', cxcId);
      if (err) throw err;
      onActualizar();
    } catch (err: any) { alert(`Error al anular: ${err.message}`); }
  };

  if (!visible || !alumno) return null;

  return (
    <>
      <div className="cxc-modal-overlay">
        <div className="cxc-modal cxc-modal--detalle cxc-modal--wide" onClick={e => e.stopPropagation()}>
          <div className="cxc-modal-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <div className="cxc-alumno-avatar" style={{ width: '48px', height: '48px', fontSize: '1.2rem' }}>
                {alumno.nombres[0]}{alumno.apellidos[0]}
              </div>
              <div>
                <h2 style={{ margin: 0 }}>{alumno.nombres} {alumno.apellidos}</h2>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#94a3b8' }}>{alumno.sucursal_nombre || 'Sede Central'}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-premium-square" onClick={() => setMostrarNuevaNotaManual(true)} style={{ background: '#3b82f6' }}><Plus size={15} /> Nueva Nota</button>
              <button onClick={onCerrar} className="btn-refrescar"><X size={20} /></button>
            </div>
          </div>

          <div className="detalle-resumen-premium" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', padding: '1rem' }}>
            <div className="resumen-card">
              <span className="resumen-label">Saldo Pendiente</span>
              <span className="resumen-valor color-deuda">Bs {fmtMonto(Number(alumno.saldo_pendiente))}</span>
            </div>
            <div className="resumen-card">
              <span className="resumen-label">Total Recaudado</span>
              <span className="resumen-valor color-ingreso">Bs {fmtMonto(alumno.total_ingresos_historico || 0)}</span>
            </div>
            <div className="resumen-card">
              <span className="resumen-label">Mensualidades</span>
              <span className="resumen-valor color-meses">{alumno.cxc_pendientes} Pendientes</span>
            </div>
          </div>

          <div className="detalle-cxc-lista" style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>Fecha</th>
                  <th style={{ padding: '0.75rem' }}>Concepto</th>
                  <th style={{ padding: '0.75rem' }}>Total</th>
                  <th style={{ padding: '0.75rem' }}>Saldo</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cxcs.map(cxc => {
                  const isExp = expandida === cxc.id;
                  const isCobro = cobroCxcId === cxc.id;
                  return (
                    <React.Fragment key={cxc.id}>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: isExp ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                        <td style={{ padding: '0.75rem' }}>{formatFecha(cxc.fecha_emision)}</td>
                        <td style={{ padding: '0.75rem' }}>{cxc.descripcion || 'Sin descripción'} {cxc.anulada && '(Anulada)'}</td>
                        <td style={{ padding: '0.75rem' }}>Bs {fmtMonto(Number(cxc.monto_total))}</td>
                        <td style={{ padding: '0.75rem', fontWeight: 700, color: Number(cxc.saldo_pendiente) > 0 ? '#facc15' : '#4ade80' }}>Bs {fmtMonto(Number(cxc.saldo_pendiente))}</td>
                        <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                            <button onClick={() => setExpandida(isExp ? null : cxc.id)} className="cxc-btn-editar-visible"><Eye size={14} /></button>
                            {!cxc.anulada && cxc.estado !== 'pagada' && (
                              <button onClick={() => { setCobroCxcId(cxc.id); setCobroMonto(String(cxc.saldo_pendiente)); }} style={{ color: '#4ade80', borderColor: '#4ade80' }} className="cxc-btn-editar-visible"><DollarSign size={14} /></button>
                            )}
                            {puedeAnular() && !cxc.anulada && (
                              <button onClick={() => anularNota(cxc.id)} style={{ color: '#f87171', borderColor: '#f87171' }} className="cxc-btn-editar-visible"><Ban size={14} /></button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isCobro && (
                        <tr>
                          <td colSpan={5} style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.05)', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
                            <form onSubmit={registrarCobro}>
                              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', cursor: 'pointer' }}>
                                  <input type="checkbox" checked={usarAnticipo} onChange={e => setUsarAnticipo(e.target.checked)} disabled={anticiposDisponibles.length === 0} />
                                  Usar Anticipo
                                </label>
                                {usarAnticipo ? (
                                  <select value={anticipoId} onChange={e => setAnticipoId(e.target.value)} required className="detalle-cobro-select" style={{ flex: 1 }}>
                                    <option value="">— Seleccionar —</option>
                                    {anticiposDisponibles.map(a => <option key={a.id} value={a.id}>{formatFecha(a.fecha_emision)} - Bs {fmtMonto(a.saldo_pendiente)}</option>)}
                                  </select>
                                ) : (
                                  <select value={cobroCuentaId} onChange={e => setCobroCuentaId(e.target.value)} required className="detalle-cobro-select" style={{ flex: 1 }}>
                                    <option value="">Destino Caja/Banco</option>
                                    {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                  </select>
                                )}
                                <input type="number" step="0.01" value={cobroMonto} onChange={e => setCobroMonto(e.target.value)} placeholder="Monto" required style={{ width: '100px' }} className="detalle-cobro-input" />
                                <button type="submit" disabled={guardandoCobro} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0.5rem 1rem' }}>{guardandoCobro ? '...' : 'Cobrar'}</button>
                                <button type="button" onClick={() => setCobroCxcId(null)} className="btn-refrescar" style={{ width: 'auto', padding: '0.5rem' }}>Cancelar</button>
                              </div>
                              {cobroError && <p style={{ color: '#f87171', fontSize: '0.75rem', marginTop: '0.5rem' }}>{cobroError}</p>}
                            </form>
                          </td>
                        </tr>
                      )}

                      {isExp && !isCobro && (
                        <tr>
                          <td colSpan={5} style={{ padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                            <div style={{ fontSize: '0.8rem' }}>
                              <p style={{ fontWeight: 700, marginBottom: '0.5rem', color: '#94a3b8' }}>HISTORIAL DE PAGOS</p>
                              {historialCobros[cxc.id]?.length > 0 ? (
                                historialCobros[cxc.id].map(p => (
                                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                    <span>{formatFecha(p.fecha)} {p.caja_nombre && `(${p.caja_nombre})`}</span>
                                    <span style={{ color: '#4ade80', fontWeight: 700 }}>Bs {fmtMonto(Number(p.monto_aplicado))}</span>
                                  </div>
                                ))
                              ) : <p>No hay pagos registrados.</p>}
                              {cxc.observaciones && <p style={{ marginTop: '0.75rem', color: '#94a3b8' }}>📝 {cxc.observaciones}</p>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <NotaServicios visible={mostrarNuevaNotaManual} onCerrar={() => setMostrarNuevaNotaManual(false)} onCreada={() => { setMostrarNuevaNotaManual(false); onActualizar(); }} alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }} />
    </>
  );

  function puedeAnular() { return userRol === 'SuperAdministrador' || userRol === 'Dueño' || userRol === 'Administrador'; }
};

export default DetalleAlumnoCxc;
