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
  const [cobroNroDoc, setCobroNroDoc] = useState('');
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

  const [refreshKey, setRefreshKey] = useState(0);
  const triggerRefresh = () => setRefreshKey(prev => prev + 1);

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
          .order('fecha_emision', { ascending: false }),
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
  }, [visible, alumno, refreshKey]);

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
            fecha: `${cobroFecha}T${getHoraLocal()}:00`
          }
        });

        if (rpcErr) throw rpcErr;
      } else {
        const concatDoc = cobroNroDoc.trim() || null;

        const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
          p_payload: {
            cuenta_cobrar_id: cobroCxcId,
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            usuario_id: ctx.id,
            monto: monto,
            cuenta_cobro_id: cobroCuentaId,
            nro_comprobante: concatDoc,
            fecha: `${cobroFecha}T${getHoraLocal()}:00`
          }
        });

        if (rpcErr) throw rpcErr;
      }

      setCobroExito(`✅ Cobro de Bs ${fmtMonto(monto)} registrado correctamente.`);
      
      // WhatsApp Logic (Simplified)
      const esPadre = alumno.whatsapp_preferido === 'padre';
      const telefono = esPadre ? (alumno.telefono_padre || alumno.telefono_madre) : (alumno.telefono_madre || alumno.telefono_padre);
      if (telefono) {
          const telLimpio = telefono.replace(/\D/g, '');
          const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
          setMensajePagoWA({ texto: `Gracias por el pago de Bs ${fmtMonto(monto)}.`, telefono: telFinal });
      }

      onActualizar(); 
      triggerRefresh();
      setTimeout(() => { 
        setCobroCxcId(null); 
        setCobroMonto('');
        setCobroNroDoc('');
        setCobroFecha(getHoyISO());
        setUsarAnticipo(false);
        setAnticipoId('');
      }, 800);

    } catch (err: any) {
      setCobroError(`Error: ${err.message}`);
    } finally {
      setGuardandoCobro(false);
    }
  };

  const anularNota = async (cxcId: string) => {
    if (!confirm('¿Estás seguro de anular esta nota de servicios? Se anularán y revertirán todos los cobros asociados.')) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Usuario no autenticado.');

      const { error: err } = await supabase.rpc('rpc_anular_cuenta_cobrar', {
        p_id: cxcId,
        p_usuario_id: user.id
      });

      if (err) throw err;

      onActualizar();
      triggerRefresh();
    } catch (err: any) { alert(`Error al anular: ${err.message}`); }
  };

  if (!visible || !alumno) return null;

  return (
    <>
      <div className="cxc-modal-overlay" onClick={onCerrar}>
        <div className="cxc-modal cxc-modal--detalle cxc-modal--wide" onClick={e => e.stopPropagation()}>
          {/* Header con Efecto Glass y Metadatos Premium */}
          <div className="modal-header-glass" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.025em', color: '#fff' }}>
                {alumno.nombres} {alumno.apellidos}
              </h2>
              <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', color: '#94a3b8', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <MapPin size={14} style={{ color: '#f87171' }} /> {alumno.sucursal_nombre || 'Sede'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <User size={14} style={{ color: '#4ade80' }} /> {alumno.entrenador_nombre || 'Entrenador'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Trophy size={14} style={{ color: '#fbbf24' }} /> {alumno.cancha_nombre || 'Cancha'}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                  <Clock size={14} /> {alumno.horario_hora || '--:--'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
              <button 
                onClick={() => setMostrarNuevaNotaManual(true)}
                className="btn-premium"
                style={{ 
                  padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                  fontWeight: 700, background: '#3b82f6', borderRadius: '10px'
                }}
              >
                <Plus size={18} /> NUEVA NOTA
              </button>
              <button 
                className="btn-premium"
                onClick={() => setMostrarFichaAnticipos(true)}
                style={{ 
                  padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                  fontWeight: 700, background: '#8b5cf6', borderRadius: '10px'
                }}
              >
                <CreditCard size={18} /> ANTICIPOS
              </button>
              <button onClick={onCerrar} className="btn-close-circle" style={{ borderRadius: '10px' }}><X size={20}/></button>
            </div>
          </div>

          {/* Ficha Premium de 4 Columnas */}
          <div className="detalle-resumen-premium" style={{ gap: '1.25rem', padding: '1.5rem 2rem' }}>
            <div className="resumen-card" style={{ border: '1px solid rgba(248,113,113,0.2)' }}>
              <span className="resumen-label">TOTAL DEUDA</span>
              <span className="resumen-valor color-deuda" style={{ fontSize: '1.8rem' }}>
                Bs {fmtMonto(cxcs.reduce((s, c) => s + ((c as any).es_anticipo ? -Number(c.saldo_pendiente) : Number(c.saldo_pendiente)), 0))}
              </span>
              <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><AlertCircle size={28} className="color-deuda" /></div>
            </div>

            <div className="resumen-card" style={{ border: '1px solid rgba(74,222,128,0.2)' }}>
              <span className="resumen-label">TOTAL INGRESOS</span>
              <span className="resumen-valor color-ingreso" style={{ fontSize: '1.8rem' }}>Bs {fmtMonto(alumno.total_ingresos_historico || 0)}</span>
              <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><Wallet size={28} className="color-ingreso" /></div>
            </div>

            <div className="resumen-card" style={{ border: '1px solid rgba(56,189,248,0.2)' }}>
              <span className="resumen-label">FECHA DE INICIO</span>
              <span className="resumen-valor color-meses" style={{ fontSize: '1.8rem' }}>{formatFechaCorta(alumno.fecha_inicio_consolidada)}</span>
              <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><Calendar size={28} className="color-meses" /></div>
            </div>

            <div className="resumen-card" style={{ border: '1px solid rgba(56,189,248,0.2)' }}>
              <span className="resumen-label">MESES DE ACTIVIDAD</span>
              <span className="resumen-valor" style={{ color: '#38bdf8', fontSize: '1.8rem' }}>{alumno.cantidad_meses_actividad || 0} <small style={{ fontSize: '0.9rem' }}>Meses</small></span>
              <div className="resumen-icon-bg" style={{ opacity: 0.15 }}><Clock size={28} style={{ color: '#38bdf8' }} /></div>
            </div>
          </div>

          <div className="detalle-cxc-lista" style={{ padding: '0 1rem 1rem 1rem', overflowY: 'auto', maxHeight: '60vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-table-header)', color: 'var(--text-table-header)' }}>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '120px', fontSize: '0.7rem', fontWeight: 800 }}>FECHA</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', fontSize: '0.7rem', fontWeight: 800 }}>CONCEPTO / DETALLE</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800 }}>TOTAL</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800 }}>COBRADO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800 }}>SALDO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '100px', fontSize: '0.7rem', fontWeight: 800 }}>ULT. PAGO</th>
                  <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '160px', fontSize: '0.7rem', fontWeight: 800 }}>ACCIONES</th>
                </tr>
              </thead>
              <tbody>
                {cxcs.map(cxc => {
                  const isCobro = cobroCxcId === cxc.id;
                  const isAnticipo = (cxc as any).es_anticipo;
                  const itemsDeLaNota = detallesItems[cxc.id] || [];
                  const cobrado = Number(cxc.monto_total) - Number(cxc.saldo_pendiente);
                  const ultimoPago = historialCobros[cxc.id]?.[0];
                  
                  return (
                    <React.Fragment key={cxc.id}>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', opacity: cxc.anulada ? 0.5 : 1 }}>
                        <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', whiteSpace: 'nowrap', border: '1px solid rgba(255,255,255,0.08)' }}>{formatFecha(cxc.fecha_emision || cxc.created_at)}</td>
                        <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                              <div style={{ fontWeight: 700, color: '#fff' }}>
                                {cxc.descripcion || 'Sin descripción'}
                                {cxc.anulada && <span style={{ color: '#f87171', marginLeft: '0.4rem', fontSize: '0.7rem', background: 'rgba(248,113,113,0.1)', padding: '2px 6px', borderRadius: '4px' }}>ANULADA</span>}
                                {isAnticipo && <span style={{ color: '#a855f7', marginLeft: '0.4rem', fontSize: '0.7rem', background: 'rgba(168,85,247,0.1)', padding: '2px 6px', borderRadius: '4px' }}>ANTICIPO</span>}
                              </div>
                              {!isAnticipo && itemsDeLaNota.length > 0 && (
                                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                                  {itemsDeLaNota.map((item: any, i: number) => (
                                    <React.Fragment key={i}>
                                      {!(cxc.descripcion?.toLowerCase().includes(item.item_nombre?.toLowerCase()) || item.item_nombre?.toLowerCase().includes(cxc.descripcion?.toLowerCase())) && (
                                        <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 600 }}>
                                          {item.item_nombre}
                                        </span>
                                      )}
                                      {item.periodo_meses && item.periodo_meses.map((mes: string, mi: number) => (
                                        <span key={`${i}-${mi}`} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600 }}>
                                          {mes}
                                        </span>
                                      ))}
                                    </React.Fragment>
                                  ))}
                                </div>
                              )}
                              {cxc.observaciones && (
                                <span style={{ 
                                  fontSize: '0.75rem', 
                                  color: '#94a3b8', 
                                  fontStyle: 'italic', 
                                  borderLeft: '1px solid rgba(255,255,255,0.1)', 
                                  paddingLeft: '0.6rem',
                                  marginLeft: '0.2rem'
                                }}>
                                  {cxc.observaciones}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)', fontWeight: 600 }}>
                          Bs {fmtMonto(isAnticipo ? 0 : Number(cxc.monto_total))}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)', color: '#4ade80', fontWeight: 600 }}>
                          Bs {fmtMonto(isAnticipo ? Number(cxc.total_cobrado) : cobrado)}
                        </td>
                        <td style={{ 
                          padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)',
                          fontWeight: 700, 
                          color: isAnticipo 
                            ? (Number(cxc.saldo_pendiente) >= 0 ? '#a855f7' : '#4ade80')
                            : (Number(cxc.saldo_pendiente) > 0 ? '#38bdf8' : '#4ade80') 
                        }}>
                          {isAnticipo ? '-' : ''} Bs {fmtMonto(isAnticipo ? Number(cxc.total_cobrado) : Number(cxc.saldo_pendiente))}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)', fontSize: '0.75rem', color: '#94a3b8' }}>
                          {ultimoPago ? formatFecha(ultimoPago.fecha) : '—'}
                        </td>
                        <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', verticalAlign: 'middle', border: '1px solid rgba(255,255,255,0.08)' }}>
                          <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center' }}>
                            <button onClick={() => setVerNotaId(cxc.id)} className="btn-compact-action" title="Ver"><Eye size={14} /></button>
                            {!cxc.anulada && puedeAnular() && (
                              <button onClick={() => { 
                                const lines = detallesItems[cxc.id] || [];
                                setCxcParaEditar({ 
                                  ...cxc, 
                                  lineas: lines.map(l => ({
                                    catalogo_item_id: l.catalogo_item_id,
                                    nombre: l.item_nombre,
                                    tipo: 'servicio',
                                    cantidad: l.cantidad,
                                    precio_unitario: l.precio_unitario,
                                    periodo_meses: l.periodo_meses || [],
                                    detalle_personalizado: l.detalle_extra || '',
                                    subtotal: l.cantidad * l.precio_unitario
                                  }))
                                }); 
                                setModoModal('editar'); 
                                setModalNotaVisible(true); 
                              }} className="btn-compact-action action-blue" title="Editar"><Pencil size={14} /></button>
                            )}
                            {!cxc.anulada && cxc.estado !== 'pagada' && (
                              <button onClick={() => { setCobroCxcId(cxc.id); setCobroMonto(String(cxc.saldo_pendiente)); }} className="btn-compact-action action-green" title="Cobrar"><DollarSign size={14} /></button>
                            )}
                            {puedeAnular() && !cxc.anulada && (
                              <button onClick={() => anularNota(cxc.id)} className="btn-compact-action action-red" title="Anular"><Ban size={14} /></button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isCobro && (
                        <tr>
                          <td colSpan={6} style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.05)', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
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
                                <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Nro Transacción" style={{ width: '130px' }} className="detalle-cobro-input" />
                                <input type="number" step="0.01" value={cobroMonto} onChange={e => setCobroMonto(e.target.value)} placeholder="Monto" required style={{ width: '100px' }} className="detalle-cobro-input" />
                                <input type="date" value={cobroFecha} onChange={e => setCobroFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '160px' }} />
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

      <NotaServicios 
        visible={mostrarNuevaNotaManual} 
        onCerrar={() => setMostrarNuevaNotaManual(false)} 
        onCreada={() => { 
          setMostrarNuevaNotaManual(false); 
          onActualizar(); 
          triggerRefresh();
        }} 
        alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }} 
      />

      {/* Modal Editar Nota */}
      {modalNotaVisible && cxcParaEditar && (
        <NotaServicios
          visible={modalNotaVisible}
          onCerrar={() => { setModalNotaVisible(false); setCxcParaEditar(null); }}
          onCreada={() => { 
            setModalNotaVisible(false); 
            setCxcParaEditar(null); 
            onActualizar(); 
            triggerRefresh();
          }}
          alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }}
          cxcEditar={cxcParaEditar}
          modoInicial={modoModal}
        />
      )}

      <FichaAnticiposCxC
        visible={mostrarFichaAnticipos}
        alumnoId={alumno.alumno_id}
        alumnoNombre={`${alumno.nombres} ${alumno.apellidos}`}
        onCerrar={() => setMostrarFichaAnticipos(false)}
        onActualizar={() => {
          onActualizar();
          triggerRefresh();
        }}
        onRegistrar={() => {
          setMostrarFichaAnticipos(false);
          setMostrarNotaAnticipo(true);
        }}
      />

      <NotaServicios
        visible={mostrarNotaAnticipo}
        onCerrar={() => setMostrarNotaAnticipo(false)}
        onCreada={() => {
          setMostrarNotaAnticipo(false);
          onActualizar();
          triggerRefresh();
        }}
        alumnoPreseleccionado={{ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` }}
        esAnticipo={true}
      />

      <ModalVerNotaCxC
        visible={!!verNotaId}
        cxcId={verNotaId}
        onCerrar={() => setVerNotaId(null)}
        onActualizar={() => {
          onActualizar();
          triggerRefresh();
        }}
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
