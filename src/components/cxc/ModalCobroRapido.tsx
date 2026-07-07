/**
 * ModalCobroRapido.tsx
 * Modal de cobro rápido accesible desde la lista principal de alumnos.
 * Versión simplificada sin contabilidad de doble partida.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda, CuentaCobrar } from '../../types/cxc';
import type { CajaBanco } from '../../types/finanzas';
import { X, CreditCard, AlertCircle, Check, MessageCircle, Users, FileText, RefreshCw, DollarSign, Building2, Info, Calendar, Hash, Clock } from 'lucide-react';
import { getHoyISO, getHoraLocal } from '../../lib/dateUtils';
import { useCobroMultiple } from './useCobroMultiple';
import type { CatalogoItem } from '../../types/cuentas';
import { confirmarMovimientoEnPeriodoConciliado } from '../../lib/conciliacion';

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
  const cobroMultiple = useCobroMultiple(cxcsPendientes);
  const [cuentasCobro, setCuentasCobro] = useState<CajaBanco[]>([]);

  const [monto, setMonto] = useState('');
  const [cuentaId, setCuentaId] = useState('');
  const [fecha, setFecha] = useState(getHoyISO());
  const [hora, setHora] = useState(getHoraLocal());
  const [nroDoc, setNroDoc] = useState('');

  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cuentaAnticipoId, setCuentaAnticipoId] = useState('');

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

      const esAdmin = usr.rol === 'SuperAdministrador';

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

      // Cargar catálogo para anticipos
      const { data: resCat } = await supabase.from('catalogo_items')
        .select('*').eq('activo', true)
        .or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos')
        .order('nombre');
      setCatalogo(resCat ?? []);
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
      const notasDeuda = lista.filter((c) => !(c as any).es_anticipo);
      if (notasDeuda.length > 1) {
        setCxcSelId('multiple');
        setMonto('');
      } else if (notasDeuda.length === 1) {
        setCxcSelId(notasDeuda[0].id);
        setMonto(String(Number(notasDeuda[0].saldo_pendiente)));
      } else {
        setCxcSelId('anticipo');
        setMonto('');
      }
    };
    cargarCxc();
  }, [alumnoSel]);

  useEffect(() => {
    if (cxcSelId === 'multiple') {
      cobroMultiple.inicializar();
    }
  }, [cxcSelId, cxcsPendientes]);

  const handleChangeCxc = (id: string) => {
    setCxcSelId(id);
    if (id === 'multiple') {
      setMonto('');
      cobroMultiple.inicializar();
      return;
    }
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
    const esMultiple = cxcSelId === 'multiple';
    const montoNum = esMultiple ? cobroMultiple.obtenerTotalCobrado() : parseFloat(monto);
    if (!montoNum || montoNum <= 0) {
      setError(esMultiple ? 'Selecciona al menos una nota y define un monto mayor a 0.' : 'Monto inválido.');
      return;
    }
    if (!cuentaId) { setError('Selecciona la caja/banco destino.'); return; }

    setGuardando(true); setError(null); setInfoAnticipo(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Error de autenticación.');
      const { data: ctx } = await supabase.from('usuarios')
        .select('id, escuela_id, sucursal_id, nombres, apellidos, email')
        .eq('id', user.id).single();
      if (!ctx) throw new Error('Error de contexto.');
      const cuentaNombre = cuentasCobro.find(c => c.id === cuentaId)?.nombre || 'la cuenta seleccionada';
      const puedeContinuar = await confirmarMovimientoEnPeriodoConciliado({
        cajaId: cuentaId,
        cajaNombre: cuentaNombre,
        fechaISO: fecha,
        tipoMovimiento: 'un cobro',
        escuelaId: ctx.escuela_id,
        usuarioId: ctx.id,
        usuarioNombre: `${ctx.nombres || ''} ${ctx.apellidos || ''}`.trim() || ctx.email
      });
      if (!puedeContinuar) return;

      const concatDoc = nroDoc.trim();

      let objetivoCxcId = cxcSelId;
      let exceso = 0;

      if (esMultiple) {
        const cobrosPayload = cobroMultiple.generarPayloadCobros();
        if (cobrosPayload.length === 0) {
          throw new Error('Selecciona al menos una nota y define un monto mayor a 0.');
        }

        // Validar que la fecha del pago no sea anterior a la de emisión de ninguna de las notas seleccionadas
        for (const item of cobrosPayload) {
          const nota = cxcsPendientes.find(c => c.id === item.cuenta_cobrar_id);
          if (nota) {
            const fNota = nota.fecha_emision;
            const fNotaSoloFecha = fNota ? fNota.split('T')[0] : '';
            if (fNotaSoloFecha && fecha < fNotaSoloFecha) {
              throw new Error(`La fecha del pago no puede ser anterior a la de emisión de la Nota de Servicio: ${nota.descripcion || 'Mensualidad/Concepto'} (${fNotaSoloFecha}).`);
            }
          }
        }

        objetivoCxcId = cobrosPayload[0].cuenta_cobrar_id;

        const { error: rpcMultipleErr } = await supabase.rpc('rpc_cobrar_multiple_cxc', {
          p_payload: {
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            usuario_id: ctx.id,
            cuenta_cobro_id: cuentaId,
            nro_comprobante: concatDoc || null,
            fecha: `${fecha}T${getHoraLocal()}:00`,
            cobros: cobrosPayload
          }
        });
        if (rpcMultipleErr) throw rpcMultipleErr;
      } else {
        let montoCobrado = montoNum;

        // Si es una nota pendiente y el monto excede el saldo, separar exceso como anticipo
        if (cxcSelId !== 'anticipo') {
          const cxcSel = cxcsPendientes.find(c => c.id === cxcSelId);
          if (cxcSel) {
            // Validar que la fecha del pago no sea anterior a la fecha de emisión de la nota de servicio
            const fNota = cxcSel.fecha_emision;
            const fNotaSoloFecha = fNota ? fNota.split('T')[0] : '';
            if (fNotaSoloFecha && fecha < fNotaSoloFecha) {
              throw new Error(`La fecha del pago no puede ser anterior a la fecha de emisión de la Nota de Servicio (${fNotaSoloFecha}).`);
            }

            if (montoNum > Number(cxcSel.saldo_pendiente)) {
              exceso = parseFloat((montoNum - Number(cxcSel.saldo_pendiente)).toFixed(2));
              montoCobrado = Number(cxcSel.saldo_pendiente);
            }
          }
        }

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
                fecha_emision: fecha, // Especificar la fecha elegida para el pago
            }).select('id').single();

            if (errCxc || !nuevaNota) throw new Error('Error al crear nota de anticipo.');
            objetivoCxcId = nuevaNota.id;

            let itemAnticipoId = '';
            const itemAnticipo = catalogo.find(c => c.nombre === 'Anticipo');
            if (!itemAnticipo) {
                const { data: nuevoItem, error: errC } = await supabase.from('catalogo_items').insert({
                    escuela_id: ctx.escuela_id,
                    nombre: 'Anticipo',
                    tipo: 'servicio',
                    categoria: 'servicio',
                    tipo_movimiento: 'ingreso',
                    precio_venta: 0,
                    activo: true,
                    es_ingreso: true,
                    es_gasto: false
                }).select('id').single();
                if (errC || !nuevoItem) throw new Error('Error al inicializar el concepto "Anticipo" en el catálogo.');
                itemAnticipoId = nuevoItem.id;
            } else {
                itemAnticipoId = itemAnticipo.id;
            }

            await supabase.from('cxc_detalle').insert({
                escuela_id: ctx.escuela_id,
                cuenta_cobrar_id: nuevaNota.id,
                catalogo_item_id: itemAnticipoId,
                descripcion: 'Anticipo del cliente',
                cantidad: 1,
                precio_unitario: montoNum
            });
        }

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
            fecha_emision: fecha, // Especificar la fecha elegida para el pago
            observaciones: `Generado automáticamente por pago de Bs ${fmtMonto(montoNum)} con exceso de Bs ${fmtMonto(exceso)}.`
          }).select('id').single();

          if (errAnt || !notaAnticipo) throw new Error('Error al registrar el anticipo del exceso.');

        let itemAnticipoId = '';
        const itemAnticipo = catalogo.find(c => c.nombre === 'Anticipo');
        if (!itemAnticipo) {
            const { data: nuevoItem, error: errC } = await supabase.from('catalogo_items').insert({
                escuela_id: ctx.escuela_id,
                nombre: 'Anticipo',
                tipo: 'servicio',
                categoria: 'servicio',
                tipo_movimiento: 'ingreso',
                precio_venta: 0,
                activo: true,
                es_ingreso: true,
                es_gasto: false
            }).select('id').single();
            if (errC || !nuevoItem) throw new Error('Error al inicializar el concepto "Anticipo" en el catálogo.');
            itemAnticipoId = nuevoItem.id;
        } else {
            itemAnticipoId = itemAnticipo.id;
        }

        const { error: errDet } = await supabase.from('cxc_detalle').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaAnticipo.id,
          catalogo_item_id: itemAnticipoId,
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
            cuenta_cobro_id: cuentaId,
            nro_comprobante: concatDoc || null,
            fecha: `${fecha}T${getHoraLocal()}:00`,
            cobros: [
              { cuenta_cobrar_id: objetivoCxcId, monto: montoCobrado },
              { cuenta_cobrar_id: notaAnticipo.id, monto: exceso }
            ]
          }
        });
        if (rpcMultipleErr) throw rpcMultipleErr;

        setInfoAnticipo({ monto: exceso });
      } else {
        // Cobrar el monto exacto cuando no hay exceso
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
      }

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
      const conceptoWA = esMultiple ? 'varias notas de servicio' : (cxcActual?.descripcion || 'servicios');

      if (telefono) {
        const telF = telefono.replace(/\D/g, '');
        const telFinal = telF.startsWith('591') ? telF : `591${telF}`;
        let texto = `Gracias por el pago de Bs ${fmtMonto(montoNum)} correspondiente a: ${conceptoWA}.`;
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

  const notasDeuda = cxcsPendientes.filter((c) => !(c as any).es_anticipo);
  const esCobroMultiple = cxcSelId === 'multiple';
  const totalCobroMultiple = cobroMultiple.obtenerTotalCobrado();
  const cxcSel = cxcsPendientes.find(c => c.id === cxcSelId);
  const saldoCxc = cxcSel ? Number(cxcSel.saldo_pendiente) : 0;
  const montoIngresado = parseFloat(monto) || 0;
  const excesoCalculado = !esCobroMultiple && cxcSelId !== 'anticipo' && montoIngresado > saldoCxc && saldoCxc > 0
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
                    {notasDeuda.length > 1 && (
                      <option value="multiple">Pago múltiple de deuda — Bs {fmtMonto(notasDeuda.reduce((s, c) => s + Number(c.saldo_pendiente), 0))}</option>
                    )}
                    {notasDeuda.length > 0 && <optgroup label="Notas Pendientes">
                      {notasDeuda.map(c => (
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

              {(cxcSel || cxcSelId === 'anticipo' || esCobroMultiple) && (
                <form onSubmit={registrar} style={{ display: 'contents' }}>
                  <div className="modal-form-grid">
                    {esCobroMultiple && (
                      <div className="form-campo full-width">
                        <label><DollarSign size={14} /> Notas a cobrar *</label>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.75rem' }}>
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Selecciona las notas y ajusta los montos a asignar.</span>
                          <span style={{ color: '#10b981', fontWeight: 800, background: 'rgba(16,185,129,0.10)', border: '1px solid rgba(16,185,129,0.22)', borderRadius: '6px', padding: '0.35rem 0.6rem', whiteSpace: 'nowrap' }}>
                            Total: Bs {fmtMonto(totalCobroMultiple)}
                          </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '0.65rem', maxHeight: '210px', overflowY: 'auto', padding: '0.75rem', background: 'var(--bg-main)', border: '1px solid var(--border)', borderRadius: '8px' }}>
                          {notasDeuda.map((cxc) => {
                            const seleccionado = !!cobroMultiple.seleccionados[cxc.id];
                            const montoCxc = cobroMultiple.montos[cxc.id] || '';
                            return (
                              <div key={cxc.id} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', alignItems: 'center', gap: '0.65rem', padding: '0.65rem', background: 'var(--bg-card)', border: seleccionado ? '1px solid rgba(16,185,129,0.32)' : '1px solid var(--border)', borderRadius: '6px', opacity: seleccionado ? 1 : 0.65 }}>
                                <input type="checkbox" checked={seleccionado} onChange={() => cobroMultiple.toggleSeleccion(cxc.id, Number(cxc.saldo_pendiente))} disabled={guardando} style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#10b981' }} />
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cxc.descripcion || 'Nota'}</div>
                                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    Saldo: <strong style={{ color: '#38bdf8' }}>Bs {fmtMonto(Number(cxc.saldo_pendiente))}</strong>
                                  </div>
                                </div>
                                <input type="number" step="0.01" min="0" max={Number(cxc.saldo_pendiente)} value={montoCxc} onChange={(e) => cobroMultiple.cambiarMonto(cxc.id, e.target.value, Number(cxc.saldo_pendiente))} disabled={guardando || !seleccionado} placeholder="0.00" style={{ width: '92px', padding: '0.4rem 0.45rem', borderRadius: '5px', border: '1px solid var(--border)', background: 'var(--bg-glass)', color: 'var(--text-primary)', fontWeight: 800, textAlign: 'right' }} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="form-campo" style={{ display: esCobroMultiple ? 'none' : undefined }}>
                      <label><DollarSign size={14} /> Monto a cobrar *</label>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={monto}
                        onChange={e => setMonto(e.target.value)}
                        required={!esCobroMultiple} disabled={guardando || esCobroMultiple}
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

                    {/* El selector de cuenta/concepto de anticipo fue removido por políticas contables simplificadas */}
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
