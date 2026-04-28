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
  Calendar, Eye, Hash, Wallet, DollarSign, Plus, ChevronDown,
  MapPin, User, Trophy, Clock
} from 'lucide-react';
import NotaServicios from './NotaServicios';
import ModalVerNotaCxC from './ModalVerNotaCxC';
import ModalEditarMovimiento from '../cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../cajas-bancos/ModalDetalleMovimiento';
import FichaAnticiposCxC from './FichaAnticiposCxC';
import { getHoraLocal, getHoyISO, formatFecha, formatFechaCorta } from '../../lib/dateUtils';

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

  // Modal Ver/Editar Nota completa
  const [verNotaId, setVerNotaId] = useState<string | null>(null);
  const [editarNotaId, setEditarNotaId] = useState<string | null>(null);
  const [detallesItems, setDetallesItems] = useState<Record<string, any[]>>({});

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
        // Cargar cobros
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

        // Cargar detalle de ítems por nota (concepto + detalle visible)
        const { data: todosItems } = await supabase
          .from('cxc_detalle')
          .select('cuenta_cobrar_id, cantidad, precio_unitario, periodo_meses, detalle_extra, catalogo_items!inner(nombre)')
          .in('cuenta_cobrar_id', cxcIds);
        const itemsMap: Record<string, any[]> = {};
        todosItems?.forEach((item: any) => {
          if (!itemsMap[item.cuenta_cobrar_id]) itemsMap[item.cuenta_cobrar_id] = [];
          itemsMap[item.cuenta_cobrar_id].push({ ...item, item_nombre: item.catalogo_items?.nombre });
        });
        setDetallesItems(itemsMap);
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
        
        const { error: rpcErr } = await supabase.rpc('rpc_aplicar_anticipo_cxc', {
          p_payload: {
            nota_id: cobroCxcId,
            anticipo_id: anticipoId,
            monto: monto,
            usuario_id: ctx.id,
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
          }
        });

        if (rpcErr) throw rpcErr;
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
      <div className="cxc-modal-overlay" onClick={onCerrar}>
        <div className="cxc-modal cxc-modal--detalle cxc-modal--wide" onClick={e => e.stopPropagation()}>
          {/* Header con Efecto Glass y Metadatos Premium */}
          <div className="modal-header-glass" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
              <div style={{ 
                width: '64px', height: '64px', borderRadius: '18px', background: 'var(--accent-gradient)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', fontWeight: 'bold', color: 'white',
                boxShadow: '0 8px 20px -4px rgba(249,115,22,0.4)',
                border: '2px solid rgba(255,255,255,0.1)'
              }}>
                {alumno.nombres[0]}{alumno.apellidos[0]}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.5rem', letterSpacing: '-0.02em' }}>{alumno.nombres} {alumno.apellidos}</h2>
                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                  <span className="cxc-modal-meta-line" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <MapPin size={14} className="color-deuda" /> {alumno.sucursal_nombre || 'Sede Central'}
                  </span>
                  <span className="cxc-modal-meta-line" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <User size={14} style={{ color: '#4ade80' }} /> {alumno.entrenador_nombre || 'Sin Asignar'}
                  </span>
                  <span className="cxc-modal-meta-line" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <Trophy size={14} style={{ color: '#facc15' }} /> {alumno.cancha_nombre || 'General'}
                  </span>
                  <span className="cxc-modal-meta-line" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem', color: '#94a3b8' }}>
                    <Clock size={14} className="color-meses" /> {alumno.horario_hora || '--:--'}
                  </span>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button 
                onClick={() => setMostrarNuevaNotaManual(true)}
                className="btn-premium btn-blue"
                style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                <Plus size={18} /> NUEVA NOTA
              </button>
              <button 
                className="btn-premium btn-teal"
                style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                <DollarSign size={18} /> PAGAR
              </button>
              <button 
                className="btn-premium btn-purple"
                style={{ padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontWeight: 600 }}
              >
                <CreditCard size={18} /> ANTICIPOS <ChevronDown size={14} />
              </button>
              <button onClick={onCerrar} className="btn-close-circle"><X size={20}/></button>
            </div>
          </div>

          {/* Ficha Premium de 4 Columnas */}
          <div className="detalle-resumen-premium">
            <div className="resumen-card">
              <div className="resumen-icon-bg"><AlertCircle size={24} className="color-deuda" /></div>
              <span className="resumen-label">Total Deuda</span>
              <span className="resumen-valor color-deuda">Bs {fmtMonto(alumno.saldo_pendiente || 0)}</span>
              <div className="resumen-footer">
                <AlertCircle size={10} style={{ display: 'inline', marginRight: '4px' }} />
                {alumno.cxc_pendientes || 0} pendientes
              </div>
            </div>

            <div className="resumen-card">
              <div className="resumen-icon-bg"><Wallet size={24} className="color-ingreso" /></div>
              <span className="resumen-label">Total Ingresos</span>
              <span className="resumen-valor color-ingreso">Bs {fmtMonto(alumno.total_ingresos_historico || 0)}</span>
              <div className="resumen-footer">
                <Check size={10} style={{ display: 'inline', marginRight: '4px' }} />
                Histórico recaudado
              </div>
            </div>

            <div className="resumen-card">
              <div className="resumen-icon-bg"><Calendar size={24} className="color-meses" /></div>
              <span className="resumen-label">Fecha de Inicio</span>
              <span className="resumen-valor color-meses">{formatFechaCorta(alumno.fecha_inicio_consolidada)}</span>
              <div className="resumen-footer">
                <Calendar size={10} style={{ display: 'inline', marginRight: '4px' }} />
                Inicio actividad
              </div>
            </div>

            <div className="resumen-card">
              <div className="resumen-icon-bg"><Clock size={24} style={{ color: '#38bdf8' }} /></div>
              <span className="resumen-label">Meses de Actividad</span>
              <span className="resumen-valor" style={{ color: '#38bdf8' }}>{alumno.cantidad_meses_actividad || 0} <small>Meses</small></span>
              <div className="resumen-footer">
                <Check size={10} style={{ display: 'inline', marginRight: '4px' }} />
                Financiera
              </div>
            </div>
          </div>

          <div className="detalle-cxc-lista" style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem' }}>Fecha</th>
                  <th style={{ padding: '0.75rem' }}>Concepto / Detalle</th>
                  <th style={{ padding: '0.75rem' }}>Total</th>
                  <th style={{ padding: '0.75rem' }}>Cobrado</th>
                  <th style={{ padding: '0.75rem' }}>Saldo</th>
                  <th style={{ padding: '0.75rem', textAlign: 'center' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {cxcs.map(cxc => {
                  const isCobro = cobroCxcId === cxc.id;
                  const isAnticipo = (cxc as any).es_anticipo;
                  const itemsDeLaNota = detallesItems[cxc.id] || [];
                  const cobrado = Number(cxc.monto_total) - Number(cxc.saldo_pendiente);
                  
                  return (
                    <React.Fragment key={cxc.id}>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: cxc.anulada ? 0.5 : 1 }}>
                        <td style={{ padding: '0.75rem', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{formatFecha(cxc.created_at || cxc.fecha_emision)}</td>
                        <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>
                          {/* Concepto principal */}
                          <div style={{ fontWeight: 600, marginBottom: '0.2rem' }}>
                            {cxc.descripcion || 'Sin descripción'}
                            {cxc.anulada && <span style={{ color: '#f87171', marginLeft: '0.4rem', fontSize: '0.75rem' }}>(Anulada)</span>}
                            {isAnticipo && <span style={{ color: '#a855f7', marginLeft: '0.4rem', fontSize: '0.75rem' }}>(Anticipo)</span>}
                          </div>
                          {/* Detalle de ítems visible a primera vista */}
                          {itemsDeLaNota.length > 0 && (
                            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
                              {itemsDeLaNota.map((item: any, i: number) => {
                                const meses = item.periodo_meses;
                                const detExtra = item.detalle_extra;
                                let detalle = item.item_nombre;
                                if (meses && meses.length > 0) detalle += ` (${meses.join(', ')})`;
                                else if (detExtra) detalle += ` — ${detExtra}`;
                                return (
                                  <span key={i} style={{
                                    fontSize: '0.7rem', padding: '1px 7px', borderRadius: '10px',
                                    background: 'rgba(59,130,246,0.1)', color: '#60a5fa',
                                    border: '1px solid rgba(59,130,246,0.2)'
                                  }}>
                                    {detalle}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                          {/* Observaciones generales si las hay */}
                          {cxc.observaciones && (
                            <p style={{ fontSize: '0.72rem', color: '#a78bfa', marginTop: '0.2rem', fontStyle: 'italic' }}>📝 {cxc.observaciones}</p>
                          )}
                        </td>
                        <td style={{ padding: '0.75rem', verticalAlign: 'top' }}>Bs {fmtMonto(Number(cxc.monto_total))}</td>
                        <td style={{ padding: '0.75rem', verticalAlign: 'top', color: '#4ade80' }}>Bs {fmtMonto(cobrado)}</td>
                        <td style={{ 
                          padding: '0.75rem', 
                          verticalAlign: 'top', 
                          fontWeight: 700, 
                          color: isAnticipo 
                            ? (Number(cxc.saldo_pendiente) > 0 ? '#a855f7' : '#94a3b8')
                            : (Number(cxc.saldo_pendiente) > 0 ? '#facc15' : '#4ade80') 
                        }}>
                          Bs {fmtMonto(Number(cxc.saldo_pendiente))}
                          {isAnticipo && (Number(cxc.saldo_pendiente) > 0 ? ' (Disp.)' : ' (Aplicado)')}
                        </td>
                        <td style={{ padding: '0.75rem', textAlign: 'center', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                            {/* Ver documento completo */}
                            <button onClick={() => setVerNotaId(cxc.id)} className="cxc-btn-editar-visible" title="Ver documento completo"><Eye size={14} /></button>
                            {/* Editar nota */}
                            {!cxc.anulada && puedeAnular() && (
                              <button onClick={() => { setCxcParaEditar(cxc); setModoModal('editar'); setModalNotaVisible(true); }} style={{ color: '#3b82f6', borderColor: '#3b82f6' }} className="cxc-btn-editar-visible" title="Editar nota"><Pencil size={14} /></button>
                            )}
                            {/* Cobrar */}
                            {!cxc.anulada && cxc.estado !== 'pagada' && (
                              <button onClick={() => { setCobroCxcId(cxc.id); setCobroMonto(String(cxc.saldo_pendiente)); }} style={{ color: '#4ade80', borderColor: '#4ade80' }} className="cxc-btn-editar-visible" title="Registrar cobro"><DollarSign size={14} /></button>
                            )}
                            {/* Anular */}
                            {puedeAnular() && !cxc.anulada && (
                              <button onClick={() => anularNota(cxc.id)} style={{ color: '#f87171', borderColor: '#f87171' }} className="cxc-btn-editar-visible" title="Anular nota"><Ban size={14} /></button>
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
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <NotaServicios visible={mostrarNuevaNotaManual} onCerrar={() => setMostrarNuevaNotaManual(false)} onCreada={() => { setMostrarNuevaNotaManual(false); onActualizar(); }} alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }} />

      {/* Modal Editar Nota */}
      {modalNotaVisible && cxcParaEditar && (
        <NotaServicios
          visible={modalNotaVisible}
          onCerrar={() => { setModalNotaVisible(false); setCxcParaEditar(null); }}
          onCreada={() => { setModalNotaVisible(false); setCxcParaEditar(null); onActualizar(); }}
          alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }}
          cxcEditar={cxcParaEditar}
          modoInicial={modoModal}
        />
      )}

      {/* Modal Ver Documento Completo */}
      <ModalVerNotaCxC
        visible={!!verNotaId}
        cxcId={verNotaId}
        onCerrar={() => setVerNotaId(null)}
        onActualizar={onActualizar}
        onEditar={() => {
          const cxc = cxcs.find(c => c.id === verNotaId);
          if (cxc) {
            setVerNotaId(null);
            setCxcParaEditar(cxc);
            setModoModal('editar');
            setModalNotaVisible(true);
          }
        }}
      />
    </>
  );

  function puedeAnular() { return userRol === 'SuperAdministrador' || userRol === 'Dueño' || userRol === 'Administrador'; }
};

export default DetalleAlumnoCxc;
