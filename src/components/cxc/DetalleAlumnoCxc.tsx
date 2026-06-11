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
  MapPin, User, Trophy, Clock, Phone
} from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import NotaServicios from './NotaServicios';
import ModalVerNotaCxC from './ModalVerNotaCxC';
import ModalEditarMovimiento from '../cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../cajas-bancos/ModalDetalleMovimiento';
import FichaAnticiposCxC from './FichaAnticiposCxC';
import { getHoraLocal, getHoyISO, formatFecha, formatFechaCorta, ordenarMesesCalendario } from '../../lib/dateUtils';
import { useCobroMultiple } from './useCobroMultiple';

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
  const isMobile = useIsMobile();
  const [cxcs, setCxcs] = useState<CuentaCobrar[]>([]);
  const cobroMultiple = useCobroMultiple(cxcs);
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
  const [cobroInfoAnticipo, setCobroInfoAnticipo] = useState<{ monto: number } | null>(null);
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [cobroCuentaAnticipoId, setCobroCuentaAnticipoId] = useState('');
  
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
  const [montoMensualidad, setMontoMensualidad] = useState<number | null>(null);
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
        esAdmin = usr?.rol === 'SuperAdministrador';
        userSucursal = usr?.sucursal_id || '';
        escuelaId = usr?.escuela_id || '';
      }

      let qCuentas = supabase.from('cajas_bancos').select('*').eq('activo', true).eq('escuela_id', escuelaId);
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resCxc, resCuentas, resAlumno, resCat] = await Promise.all([
        supabase.from('v_cuentas_cobrar').select('*')
          .eq('alumno_id', alumno.alumno_id)
          .order('fecha_emision', { ascending: false }),
        qCuentas.order('nombre'),
        supabase.from('alumnos').select('mensualidad').eq('id', alumno.alumno_id).single(),
        supabase.from('catalogo_items')
          .select('*')
          .eq('activo', true)
          .eq('escuela_id', escuelaId)
          .or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos')
          .order('nombre')
      ]);

      setCxcs((resCxc.data as unknown as CuentaCobrar[]) ?? []);
      setCuentasCobro(resCuentas.data ?? []);
      setMontoMensualidad(resAlumno.data?.mensualidad || null);
      setCatalogo(resCat.data ?? []);

      
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
          .select('cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, periodo_meses, detalle_extra, catalogo_items!inner(nombre)')
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
    setCobroError(null); setCobroExito(null); setCobroInfoAnticipo(null);

    const esMultiple = cobroCxcId === 'TODO';
    const monto = esMultiple ? cobroMultiple.obtenerTotalCobrado() : parseFloat(cobroMonto);
    if (!monto || monto <= 0) { 
      setCobroError(esMultiple ? 'Debes seleccionar al menos una nota y definir un monto mayor a 0.' : 'Monto inválido.'); 
      return; 
    }
    if (!usarAnticipo && !cobroCuentaId) { setCobroError('Selecciona la caja/banco destino.'); return; }

    setGuardandoCobro(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Error de autenticación.');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');

      const concatDoc = cobroNroDoc.trim() || null;

      if (esMultiple) {
        if (usarAnticipo) throw new Error('No se pueden usar anticipos para el pago múltiple.');
        const cobrosPayload = cobroMultiple.generarPayloadCobros();

        if (cobrosPayload.length === 0) {
          throw new Error('Debes seleccionar al menos una nota y definir un monto mayor a 0.');
        }

        const { error: rpcErr } = await supabase.rpc('rpc_cobrar_multiple_cxc', {
          p_payload: {
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            usuario_id: ctx.id,
            cuenta_cobro_id: cobroCuentaId,
            nro_comprobante: concatDoc,
            fecha: `${cobroFecha}T${getHoraLocal()}:00`,
            cobros: cobrosPayload
          }
        });
        if (rpcErr) throw rpcErr;
      } else {
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
          // Detectar si el monto excede el saldo pendiente
          const saldoActual = Number(cxcActual.saldo_pendiente);
          let montoCobrar = monto;
          let exceso = 0;

          if (monto > saldoActual) {
            exceso = parseFloat((monto - saldoActual).toFixed(2));
            montoCobrar = saldoActual;
          }

          if (exceso > 0 && !cobroCuentaAnticipoId) {
            setCobroError('Debes seleccionar la cuenta/concepto para el anticipo.');
            setGuardandoCobro(false);
            return;
          }

          // Si hay exceso, crear anticipo automáticamente
          if (exceso > 0) {
            const { data: notaAnticipo, error: errAnt } = await supabase.from('cuentas_cobrar').insert({
              escuela_id: ctx.escuela_id,
              sucursal_id: ctx.sucursal_id,
              alumno_id: alumno.alumno_id,
              monto_total: exceso,
              descripcion: 'Anticipo — Exceso de pago',
              estado: 'pendiente',
              es_anticipo: true,
              observaciones: `Generado automáticamente por pago de Bs ${fmtMonto(monto)} con exceso de Bs ${fmtMonto(exceso)}.`
            }).select('id').single();

            if (errAnt || !notaAnticipo) throw new Error('Error al registrar el anticipo del exceso.');

            const { error: errDet } = await supabase.from('cxc_detalle').insert({
              escuela_id: ctx.escuela_id,
              cuenta_cobrar_id: notaAnticipo.id,
              catalogo_item_id: cobroCuentaAnticipoId,
              detalle_extra: 'Anticipo — Exceso de pago',
              cantidad: 1,
              precio_unitario: exceso
            });
            if (errDet) throw errDet;


            const { error: rpcMultipleErr } = await supabase.rpc('rpc_cobrar_multiple_cxc', {
              p_payload: {
                escuela_id: ctx.escuela_id,
                sucursal_id: ctx.sucursal_id,
                usuario_id: ctx.id,
                cuenta_cobro_id: cobroCuentaId,
                nro_comprobante: concatDoc,
                fecha: `${cobroFecha}T${getHoraLocal()}:00`,
                cobros: [
                  { cuenta_cobrar_id: cobroCxcId, monto: montoCobrar },
                  { cuenta_cobrar_id: notaAnticipo.id, monto: exceso }
                ]
              }
            });
            if (rpcMultipleErr) throw rpcMultipleErr;

            setCobroInfoAnticipo({ monto: exceso });
          } else {
            // Cobrar el saldo exacto de la nota cuando no hay exceso
            const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
              p_payload: {
                cuenta_cobrar_id: cobroCxcId,
                escuela_id: ctx.escuela_id,
                sucursal_id: ctx.sucursal_id,
                usuario_id: ctx.id,
                monto: montoCobrar,
                cuenta_cobro_id: cobroCuentaId,
                nro_comprobante: concatDoc,
                fecha: `${cobroFecha}T${getHoraLocal()}:00`
              }
            });
            if (rpcErr) throw rpcErr;
          }
        }
      }

      setCobroExito(`✅ Cobro de Bs ${fmtMonto(monto)} registrado correctamente.`);
      
      // WhatsApp Logic
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
        setCobroInfoAnticipo(null);
        setCobroCuentaAnticipoId('');
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
        <div 
          className="cxc-modal cxc-modal--detalle cxc-modal--wide" 
          onClick={e => e.stopPropagation()}
          style={isMobile ? {
            background: '#000000',
            color: '#ffffff',
            padding: '1.25rem',
            borderRadius: '20px 20px 0 0',
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            top: '10%',
            maxHeight: '90vh',
            width: '100%',
            overflowY: 'auto',
            border: '1px solid #222222',
            borderBottom: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxSizing: 'border-box'
          } : undefined}
        >
          {isMobile ? (
            /* Tarjeta de Identidad & Acciones para Móvil (Pantalla 2) */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, color: '#ffffff' }}>
                    {alumno.nombres} {alumno.apellidos}
                  </h2>
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', color: '#94a3b8', fontSize: '0.8rem', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <MapPin size={12} style={{ color: '#f87171' }} /> {alumno.sucursal_nombre || 'Sede'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <User size={12} style={{ color: '#4ade80' }} /> {alumno.entrenador_nombre || 'Entrenador'}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <Trophy size={12} style={{ color: '#fbbf24' }} /> {alumno.sub ? `Sub-${alumno.sub}` : 'Categoría'}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={onCerrar} 
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0.25rem' }}
                >
                  <X size={24} />
                </button>
              </div>

              {/* Botones de acción lado a lado */}
              <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                {(() => {
                  const totalDeudaNum = cxcs.reduce((s, c) => s + (!(c as any).es_anticipo && Number(c.saldo_pendiente) > 0 && !c.anulada ? Number(c.saldo_pendiente) : 0), 0);
                  return (
                    <button
                      onClick={() => {
                        setCobroCxcId('TODO');
                        cobroMultiple.inicializar();
                      }}
                      disabled={totalDeudaNum <= 0}
                      style={{
                        flex: 1,
                        background: totalDeudaNum > 0 ? '#10b981' : '#1b2a24',
                        color: totalDeudaNum > 0 ? '#ffffff' : '#64748b',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0.75rem',
                        fontWeight: 800,
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        cursor: totalDeudaNum > 0 ? 'pointer' : 'not-allowed',
                        opacity: totalDeudaNum > 0 ? 1 : 0.6
                      }}
                    >
                      <DollarSign size={16} /> $ PAGAR
                    </button>
                  );
                })()}

                <button
                  onClick={() => setMostrarNuevaNotaManual(true)}
                  style={{
                    flex: 1,
                    background: '#3b82f6',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '10px',
                    padding: '0.75rem',
                    fontWeight: 800,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    cursor: 'pointer'
                  }}
                >
                  <Plus size={16} /> + NUEVA NOTA
                </button>
              </div>

              {/* Botón WhatsApp — solo móvil */}
              {(() => {
                // Lógica de selección: preseleccionado → papá → mamá
                const preferido = alumno.whatsapp_preferido;
                let telefono: string | null = null;
                if (preferido === 'padre') {
                  telefono = alumno.telefono_padre || alumno.telefono_madre;
                } else if (preferido === 'madre') {
                  telefono = alumno.telefono_madre || alumno.telefono_padre;
                } else {
                  // Sin preseleccionado: papá primero, luego mamá
                  telefono = alumno.telefono_padre || alumno.telefono_madre;
                }
                if (!telefono) return null;
                const telLimpio = telefono.replace(/\D/g, '');
                const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
                const url = `https://wa.me/${telFinal}`;
                return (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      width: '100%',
                      padding: '0.75rem',
                      background: '#25D366',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '10px',
                      fontWeight: 800,
                      fontSize: '0.9rem',
                      textDecoration: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    <MessageCircle size={16} /> WHATSAPP
                  </a>
                );
              })()}
            </div>
          ) : (
            /* Header con Efecto Glass y Metadatos Premium para Desktop */
            <div className="modal-header-glass" style={{ padding: '1.5rem 2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <h2 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text-primary)' }}>
                  {alumno.nombres} {alumno.apellidos}
                </h2>
                <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', color: 'var(--text-secondary)', fontSize: '0.85rem', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <MapPin size={14} style={{ color: '#f87171' }} /> {alumno.sucursal_nombre || 'Sede'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <User size={14} style={{ color: '#4ade80' }} /> {alumno.entrenador_nombre || 'Entrenador'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <Trophy size={14} style={{ color: '#fbbf24' }} /> {alumno.sub ? `Sub-${alumno.sub}` : 'Categoría'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#38bdf8' }}>
                    <Clock size={14} /> {alumno.horario_hora || '--:--'}
                  </span>
                  {(() => {
                    const telefonoPrincipal = alumno.whatsapp_preferido === 'padre' 
                      ? (alumno.telefono_padre || alumno.telefono_madre) 
                      : (alumno.whatsapp_preferido === 'madre' 
                          ? (alumno.telefono_madre || alumno.telefono_padre) 
                          : (alumno.telefono_padre || alumno.telefono_madre));
                    return (
                      <>
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#a855f7' }}>
                          <Calendar size={14} /> Mensualidad: {montoMensualidad ? `Bs ${fmtMonto(montoMensualidad)}` : 'N/A'}
                        </span>
                        {telefonoPrincipal && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#10b981' }}>
                            <Phone size={14} /> {telefonoPrincipal}
                          </span>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.85rem', alignItems: 'center' }}>
                {(() => {
                  const totalDeudaNum = cxcs.reduce((s, c) => s + (!(c as any).es_anticipo && Number(c.saldo_pendiente) > 0 && !c.anulada ? Number(c.saldo_pendiente) : 0), 0);
                  if (totalDeudaNum > 0) {
                    return (
                      <button 
                        onClick={() => {
                          setCobroCxcId('TODO');
                          cobroMultiple.inicializar();
                        }}
                        className="btn-premium"
                        style={{ 
                          padding: '0.75rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.6rem', 
                          fontWeight: 800, background: '#10b981', color: '#fff', borderRadius: '10px'
                        }}
                      >
                        <DollarSign size={18} /> PAGAR
                      </button>
                    );
                  }
                  return null;
                })()}
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
          )}

          {/* Ficha Premium de 4 Columnas */}
          {!isMobile && (
            <div className="detalle-resumen-premium" style={{ gap: '1.25rem', padding: '1.5rem 2rem' }}>
              {(() => {
                const totalDeuda = cxcs.reduce((s, c) => s + ((c as any).es_anticipo ? -Number(c.saldo_pendiente) : Number(c.saldo_pendiente)), 0);
                const esSaldoAFavor = totalDeuda < 0;
                return (
                  <div className="resumen-card" style={{ border: esSaldoAFavor ? '1px solid rgba(74,222,128,0.2)' : '1px solid rgba(248,113,113,0.2)' }}>
                    <span className="resumen-label">{esSaldoAFavor ? 'SALDO A FAVOR' : 'TOTAL DEUDA'}</span>
                    <span className={`resumen-valor ${esSaldoAFavor ? 'color-ingreso' : 'color-deuda'}`} style={{ fontSize: '1.8rem' }}>
                      Bs {fmtMonto(Math.abs(totalDeuda))}
                    </span>
                    <div className="resumen-icon-bg" style={{ opacity: 0.15 }}>
                      {esSaldoAFavor ? <Check size={28} className="color-ingreso" /> : <AlertCircle size={28} className="color-deuda" />}
                    </div>
                  </div>
                );
              })()}

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
          )}

          <div className="detalle-cxc-lista" style={{ padding: isMobile ? '0 0 1rem 0' : '0 1rem 1rem 1rem', overflowY: 'auto', maxHeight: '60vh', width: '100%', boxSizing: 'border-box' }}>
            {isMobile ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
                {/* Formulario de Pago Múltiple Inline en Móvil */}
                {cobroCxcId === 'TODO' && (
                  <div style={{ padding: '1rem', background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '10px', width: '100%', boxSizing: 'border-box' }}>
                    <form onSubmit={registrarCobro}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.9rem' }}>PAGO MÚLTIPLE DE DEUDA</span>
                          <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1.05rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.35rem 0.5rem', borderRadius: '6px', alignSelf: 'flex-start' }}>
                            Total a Pagar: Bs {fmtMonto(cobroMultiple.obtenerTotalCobrado())}
                          </span>
                        </div>

                        {/* Listado de notas seleccionables */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: '6px', padding: '0.5rem', background: 'var(--bg-main)' }}>
                          {[...cxcs].filter(c => !c.anulada && Number(c.saldo_pendiente) > 0 && !(c as any).es_anticipo).sort((a, b) => new Date(a.fecha_emision || a.created_at).getTime() - new Date(b.fecha_emision || b.created_at).getTime()).map(cxc => {
                            const seleccionado = !!cobroMultiple.seleccionados[cxc.id];
                            const montoCxc = cobroMultiple.montos[cxc.id] || '';
                            return (
                              <div key={cxc.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', padding: '0.5rem', background: 'var(--bg-card)', border: seleccionado ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border)', borderRadius: '6px', opacity: seleccionado ? 1 : 0.75 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <input 
                                    type="checkbox" 
                                    checked={seleccionado} 
                                    onChange={() => cobroMultiple.toggleSeleccion(cxc.id, cxc.saldo_pendiente)}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#10b981' }}
                                  />
                                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                                      {cxc.descripcion || 'Nota'}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                      Saldo: <strong style={{ color: '#38bdf8' }}>Bs {fmtMonto(cxc.saldo_pendiente)}</strong>
                                    </span>
                                  </div>
                                </div>
                                {seleccionado && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', alignSelf: 'flex-end' }}>
                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Monto:</span>
                                    <input 
                                      type="number" 
                                      step="0.01"
                                      min="0"
                                      max={cxc.saldo_pendiente}
                                      value={montoCxc}
                                      onChange={(e) => cobroMultiple.cambiarMonto(cxc.id, e.target.value, cxc.saldo_pendiente)}
                                      placeholder="0.00"
                                      style={{ 
                                        width: '80px', 
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

                        <select value={cobroCuentaId} onChange={e => setCobroCuentaId(e.target.value)} required className="detalle-cobro-select" style={{ width: '100%' }}>
                          <option value="">Destino Caja/Banco *</option>
                          {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Nro Transacción" style={{ width: '100%' }} className="detalle-cobro-input" />
                        <input type="date" value={cobroFecha} onChange={e => setCobroFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '100%' }} />
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          <button type="submit" disabled={guardandoCobro || cobroMultiple.obtenerTotalCobrado() <= 0} className="btn-guardar-cuenta" style={{ flex: 1, padding: '0.6rem 1rem', background: '#10b981', fontWeight: 700 }}>
                            {guardandoCobro ? '...' : `Cobrar Bs ${fmtMonto(cobroMultiple.obtenerTotalCobrado())}`}
                          </button>
                          <button type="button" onClick={() => setCobroCxcId(null)} className="btn-refrescar" style={{ padding: '0.6rem' }}>Cancelar</button>
                        </div>
                        {cobroError && <p style={{ color: '#f87171', fontSize: '0.75rem', margin: 0 }}>{cobroError}</p>}
                      </div>
                    </form>
                  </div>
                )}

                {/* Tabla de Movimientos Simple: EXACTAMENTE 3 columnas (FECHA, CONCEPTO/DETALLE, SALDO) */}
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden', width: '100%', boxSizing: 'border-box' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-table-header)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '0.6rem 0.5rem', textAlign: 'left', width: '20%', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-table-header)', whiteSpace: 'nowrap' }}>FECHA</th>
                        <th style={{ padding: '0.6rem 0.5rem', textAlign: 'left', width: '60%', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-table-header)' }}>CONCEPTO / DETALLE</th>
                        <th style={{ padding: '0.6rem 0.5rem', textAlign: 'right', width: '20%', fontSize: '0.7rem', fontWeight: 800, color: 'var(--text-table-header)', whiteSpace: 'nowrap' }}>SALDO</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cxcs.map((cxc) => {
                        const saldoVal = Number(cxc.saldo_pendiente);
                        const isDeudor = saldoVal > 0;
                        const isAnticipo = (cxc as any).es_anticipo;
                        const itemsDeLaNota = detallesItems[cxc.id] || [];
                        
                        return (
                          <tr 
                            key={cxc.id} 
                            onClick={() => setVerNotaId(cxc.id)}
                            style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                          >
                            <td style={{ padding: '0.6rem 0.5rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                              {formatFechaCorta(cxc.fecha_emision || cxc.created_at)}
                            </td>
                            <td style={{ padding: '0.6rem 0.5rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                                <span style={{ fontWeight: 700 }}>{cxc.descripcion || 'Sin descripción'}</span>
                                {cxc.anulada && <span style={{ color: '#f87171', fontSize: '0.6rem', background: 'rgba(248,113,113,0.1)', padding: '2px 4px', borderRadius: '4px' }}>ANULADA</span>}
                                {isAnticipo && <span style={{ color: '#a855f7', fontSize: '0.6rem', background: 'rgba(168,85,247,0.1)', padding: '2px 4px', borderRadius: '4px' }}>ANTICIPO</span>}
                                {!isAnticipo && itemsDeLaNota.length > 0 && (
                                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    {itemsDeLaNota.map((item: any, i: number) => (
                                      <React.Fragment key={i}>
                                        {!(cxc.descripcion?.toLowerCase().includes(item.item_nombre?.toLowerCase()) || item.item_nombre?.toLowerCase().includes(cxc.descripcion?.toLowerCase())) && (
                                          <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '4px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', fontWeight: 600 }}>
                                            {item.item_nombre}
                                          </span>
                                        )}
                                        {item.periodo_meses && ordenarMesesCalendario(item.periodo_meses).map((mes: string, mi: number) => (
                                          <span key={`${i}-${mi}`} style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '4px', background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600 }}>
                                            {mes}
                                          </span>
                                        ))}
                                        {(item.item_nombre === 'Inscripción a Torneos' || item.item_nombre === 'Inscripcion a Torneos') && item.detalle_extra && (
                                          <span style={{ fontSize: '0.6rem', padding: '1px 4px', borderRadius: '4px', background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600 }}>
                                            {item.detalle_extra}
                                          </span>
                                        )}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                )}
                                {cxc.observaciones && (
                                  <span style={{ 
                                    fontSize: '0.65rem', 
                                    color: 'var(--text-tertiary)', 
                                    fontStyle: 'italic'
                                  }}>
                                    ({cxc.observaciones})
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: '0.6rem 0.5rem', textAlign: 'right', fontWeight: 700, color: isDeudor ? '#ef4444' : '#10b981', whiteSpace: 'nowrap' }}>
                              Bs {fmtMonto(saldoVal)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', minWidth: 'auto', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-table-header)', color: 'var(--text-table-header)' }}>
                    <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '120px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>FECHA</th>
                    <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>CONCEPTO / DETALLE</th>
                    <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>TOTAL</th>
                    <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>COBRADO</th>
                    <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '140px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>SALDO</th>
                    {!isMobile && <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'left', width: '100px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>ULT. PAGO</th>}
                    {!isMobile && <th style={{ padding: '0.6rem 0.75rem', border: '1px solid var(--border)', textAlign: 'center', width: '160px', fontSize: '0.7rem', fontWeight: 800, whiteSpace: 'nowrap' }}>ACCIONES</th>}
                  </tr>
                </thead>
                <tbody>
                  {cobroCxcId === 'TODO' && (
                    <tr>
                      <td colSpan={isMobile ? 5 : 7} style={{ padding: '1.25rem', background: 'rgba(16, 185, 129, 0.02)', borderBottom: '1px solid rgba(16, 185, 129, 0.2)' }}>
                        <form onSubmit={registrarCobro}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            {/* Header row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <span style={{ fontWeight: 800, color: '#10b981', fontSize: '0.95rem' }}>PAGO MÚLTIPLE DE DEUDA</span>
                                <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1.1rem', background: 'rgba(16, 185, 129, 0.1)', padding: '0.35rem 0.75rem', borderRadius: '6px' }}>
                                  Total a Cobrar: Bs {fmtMonto(cobroMultiple.obtenerTotalCobrado())}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                                <select value={cobroCuentaId} onChange={e => setCobroCuentaId(e.target.value)} required className="detalle-cobro-select" style={{ width: '220px' }}>
                                  <option value="">Destino Caja/Banco *</option>
                                  {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                </select>
                                <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Nro Transacción" style={{ width: '130px' }} className="detalle-cobro-input" />
                                <input type="date" value={cobroFecha} onChange={e => setCobroFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '160px' }} />
                                <button type="submit" disabled={guardandoCobro || cobroMultiple.obtenerTotalCobrado() <= 0} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0.55rem 1.25rem', background: '#10b981', fontWeight: 700 }}>
                                  {guardandoCobro ? '...' : 'Registrar Cobro'}
                                </button>
                                <button type="button" onClick={() => setCobroCxcId(null)} className="btn-refrescar" style={{ width: 'auto', padding: '0.55rem 1rem' }}>Cancelar</button>
                              </div>
                            </div>

                            {/* Grid/List of selectable notes with customized amounts */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '0.75rem', background: 'var(--bg-main)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', maxHeight: '180px', overflowY: 'auto' }}>
                              {[...cxcs].filter(c => !c.anulada && Number(c.saldo_pendiente) > 0 && !(c as any).es_anticipo).sort((a, b) => new Date(a.fecha_emision || a.created_at).getTime() - new Date(b.fecha_emision || b.created_at).getTime()).map(cxc => {
                                const seleccionado = !!cobroMultiple.seleccionados[cxc.id];
                                const montoCxc = cobroMultiple.montos[cxc.id] || '';
                                return (
                                  <div key={cxc.id} style={{ display: 'flex', alignItems: 'center', justifySelf: 'stretch', justifyContent: 'space-between', padding: '0.5rem 0.75rem', background: 'var(--bg-card)', border: seleccionado ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border)', borderRadius: '6px', opacity: seleccionado ? 1 : 0.65, transition: 'all 0.2s' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                      <input 
                                        type="checkbox" 
                                        checked={seleccionado} 
                                        onChange={() => cobroMultiple.toggleSeleccion(cxc.id, cxc.saldo_pendiente)}
                                        style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: '#10b981' }}
                                      />
                                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                                        <span style={{ fontWeight: 700, fontSize: '0.75rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '150px' }}>
                                          {cxc.descripcion || 'Nota'}
                                        </span>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                          Saldo: <strong style={{ color: '#38bdf8' }}>Bs {fmtMonto(cxc.saldo_pendiente)}</strong>
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
                                          max={cxc.saldo_pendiente}
                                          value={montoCxc}
                                          onChange={(e) => cobroMultiple.cambiarMonto(cxc.id, e.target.value, cxc.saldo_pendiente)}
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
                            {cobroError && <p style={{ color: '#f87171', fontSize: '0.8rem', margin: 0 }}>{cobroError}</p>}
                          </div>
                        </form>
                      </td>
                    </tr>
                  )}
                  {cxcs.map(cxc => {
                    const isCobro = cobroCxcId === cxc.id;
                    const isAnticipo = (cxc as any).es_anticipo;
                    const itemsDeLaNota = detallesItems[cxc.id] || [];
                    const cobrado = Number(cxc.monto_total) - Number(cxc.saldo_pendiente);
                    const ultimoPago = historialCobros[cxc.id]?.[0];
                    
                    return (
                      <React.Fragment key={cxc.id}>
                        <tr style={{ borderBottom: '1px solid var(--border)', opacity: cxc.anulada ? 0.5 : 1 }}>
                          <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', whiteSpace: 'nowrap', border: '1px solid var(--border)' }}>{formatFecha(cxc.fecha_emision || cxc.created_at)}</td>
                          <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                                <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>
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
                                        {item.periodo_meses && ordenarMesesCalendario(item.periodo_meses).map((mes: string, mi: number) => (
                                          <span key={`${i}-${mi}`} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600 }}>
                                            {mes}
                                          </span>
                                        ))}
                                        {(item.item_nombre === 'Inscripción a Torneos' || item.item_nombre === 'Inscripcion a Torneos') && item.detalle_extra && (
                                          <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(74,222,128,0.15)', color: '#4ade80', fontWeight: 600 }}>
                                            {item.detalle_extra}
                                          </span>
                                        )}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                )}
                                {cxc.observaciones && (
                                  <span style={{ 
                                    fontSize: '0.75rem', 
                                    color: 'var(--text-tertiary)', 
                                    fontStyle: 'italic', 
                                    borderLeft: '1px solid var(--border)', 
                                    paddingLeft: '0.6rem',
                                    marginLeft: '0.2rem'
                                  }}>
                                    {cxc.observaciones}
                                  </span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Bs {fmtMonto(Number(cxc.monto_total))}
                          </td>
                          <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid var(--border)', color: '#4ade80', fontWeight: 600, whiteSpace: 'nowrap' }}>
                            Bs {fmtMonto(isAnticipo ? (Number(cxc.monto_total) - Number(cxc.saldo_pendiente)) : cobrado)}
                          </td>
                          <td style={{ 
                            padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid var(--border)',
                            fontWeight: 700, 
                            whiteSpace: 'nowrap',
                            color: isAnticipo 
                              ? (Number(cxc.saldo_pendiente) > 0 ? '#a855f7' : '#4ade80')
                              : (Number(cxc.saldo_pendiente) > 0 ? '#38bdf8' : '#4ade80') 
                          }}>
                            {isAnticipo && Number(cxc.saldo_pendiente) > 0 ? '- ' : ''}
                            Bs {fmtMonto(Number(cxc.saldo_pendiente))}
                          </td>
                          {!isMobile && (
                            <td style={{ padding: '0.5rem 0.75rem', verticalAlign: 'middle', border: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {ultimoPago ? formatFecha(ultimoPago.fecha) : '—'}
                            </td>
                          )}
                          {!isMobile && (
                            <td style={{ padding: '0.5rem 0.75rem', textAlign: 'center', verticalAlign: 'middle', border: '1px solid var(--border)' }}>
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
                                {!cxc.anulada && Number(cxc.saldo_pendiente) > 0 && !isAnticipo && (
                                  <button onClick={() => { setCobroCxcId(cxc.id); setCobroMonto(String(cxc.saldo_pendiente)); }} className="btn-compact-action action-green" title="Cobrar"><DollarSign size={14} /></button>
                                )}
                                {puedeAnular() && !cxc.anulada && (
                                  <button onClick={() => anularNota(cxc.id)} className="btn-compact-action action-red" title="Anular"><Ban size={14} /></button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>

                        {isCobro && (
                          <tr>
                            <td colSpan={isMobile ? 5 : 6} style={{ padding: '1rem', background: 'rgba(59, 130, 246, 0.05)', borderBottom: '1px solid rgba(59, 130, 246, 0.2)' }}>
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
                                  <input
                                    type="number" step="0.01"
                                    value={cobroMonto}
                                    onChange={e => setCobroMonto(e.target.value)}
                                    placeholder="Monto" required
                                    style={{ width: '100px' }}
                                    className="detalle-cobro-input"
                                  />
                                  <input type="date" value={cobroFecha} onChange={e => setCobroFecha(e.target.value)} className="detalle-cobro-input" style={{ width: '160px' }} />
                                  <button type="submit" disabled={guardandoCobro} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0.5rem 1rem' }}>{guardandoCobro ? '...' : 'Cobrar'}</button>
                                  <button type="button" onClick={() => setCobroCxcId(null)} className="btn-refrescar" style={{ width: 'auto', padding: '0.5rem' }}>Cancelar</button>
                                </div>
                                {(() => {
                                  const saldoNota = Number(cxc.saldo_pendiente);
                                  const montoIn = parseFloat(cobroMonto) || 0;
                                  const exc = !usarAnticipo && montoIn > saldoNota && saldoNota > 0
                                    ? parseFloat((montoIn - saldoNota).toFixed(2)) : 0;
                                  return exc > 0 ? (
                                    <>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', width: '100%', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                                        <label style={{ fontSize: '0.8rem', color: '#a855f7', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                          📂 Cuenta Anticipo:
                                        </label>
                                        <select
                                          value={cobroCuentaAnticipoId}
                                          onChange={e => setCobroCuentaAnticipoId(e.target.value)}
                                          disabled={guardandoCobro}
                                          className="detalle-cobro-select"
                                          style={{ flex: 1, borderColor: '#a855f7' }}
                                          required
                                        >
                                          <option value="">— Seleccionar concepto para el anticipo —</option>
                                          {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                        </select>
                                      </div>
                                      <p style={{
                                        marginTop: '0.4rem',
                                        fontSize: '0.72rem',
                                        color: '#f59e0b',
                                        background: 'rgba(245,158,11,0.08)',
                                        border: '1px solid rgba(245,158,11,0.3)',
                                        borderRadius: '6px',
                                        padding: '0.4rem 0.7rem',
                                        display: 'flex', alignItems: 'center', gap: '0.4rem'
                                      }}>
                                        ⚠ Exceso de <strong>Bs {fmtMonto(exc)}</strong> — se guardará automáticamente como anticipo a favor del cliente.
                                      </p>
                                    </>
                                  ) : null;
                                })()}
                                {cobroInfoAnticipo && (
                                  <p style={{
                                    marginTop: '0.4rem',
                                    fontSize: '0.72rem',
                                    color: '#a855f7',
                                    background: 'rgba(168,85,247,0.08)',
                                    border: '1px solid rgba(168,85,247,0.3)',
                                    borderRadius: '6px',
                                    padding: '0.4rem 0.7rem',
                                    display: 'flex', alignItems: 'center', gap: '0.4rem'
                                  }}>
                                    ✓ Bs {fmtMonto(cobroInfoAnticipo.monto)} guardados como anticipo exitosamente.
                                  </p>
                                )}
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
            )}
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
          }
        }}
      />
    </>
  );

  function puedeAnular() { return userRol === 'SuperAdministrador' || userRol === 'Administrador'; }
};

export default DetalleAlumnoCxc;
