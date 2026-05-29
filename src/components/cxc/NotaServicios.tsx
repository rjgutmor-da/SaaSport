/**
 * NotaServicios.tsx
 * Modal flotante para crear/editar una "Nota de Servicios" (cuenta por cobrar).
 * Versión simplificada sin campos contables.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import type { LineaNota } from '../../types/cxc';
import { MESES_ANIO } from '../../types/cxc';
import {
  X, Plus, Check, Trash2, Calendar, AlertCircle,
  CreditCard, FileText, Users, RefreshCw, Hash
} from 'lucide-react';
import { getHoyISO, getHoraLocal } from '../../lib/dateUtils';

interface NotaServiciosProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  alumnoPreseleccionado?: { id: string; nombre: string } | null;
  esAnticipo?: boolean;
  cxcEditar?: any | null;
  modoInicial?: 'ver' | 'editar' | 'crear';
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const lineaVacia = (): LineaNota => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  periodo_meses: [],
  detalle_personalizado: '',
  subtotal: 0,
  cuenta_ingreso_id: null,
});

interface LineaNotaUI extends LineaNota {
  torneo_select_value?: string;
}

const NotaServicios: React.FC<NotaServiciosProps> = ({
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar, esAnticipo = false, modoInicial
}) => {
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);
  const [torneos, setTorneos] = useState<string[]>([]);

  const [alumnoId, setAlumnoId] = useState('');
  const [lineas, setLineas] = useState<LineaNotaUI[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState(getHoyISO());
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [cuentaCobroId, setCuentaCobroId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [cobroNroDoc, setCobroNroDoc] = useState('');
  const [fechaPago, setFechaPago] = useState(getHoyISO());
  const [horaPago, setHoraPago] = useState(getHoraLocal());
  const [montoAnticipo, setMontoAnticipo] = useState('');
  const [cuentaAnticipoId, setCuentaAnticipoId] = useState('');

  const STORAGE_KEY = 'saasport_nota_draft';

  useEffect(() => {
    if (!visible) return;
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const [resAlum, resCat, resCajas] = await Promise.all([
        supabase.from('alumnos').select('id, nombres, apellidos').eq('archivado', false).order('nombres'),
        supabase.from('catalogo_items').select('*').eq('activo', true).or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos').order('nombre'),
        supabase.from('cajas_bancos').select('id, nombre, saldo_actual').eq('activo', true).eq('escuela_id', usr.escuela_id).order('nombre'),
      ]);
      setAlumnos(resAlum.data ?? []);
      setCatalogo(resCat.data ?? []);
      const listaCajas = resCajas.data ?? [];
      setCajasBancos(listaCajas);
      // Preseleccionar caja predeterminada si no hay una ya seleccionada
      if (!cuentaCobroId) {
        const pred = (listaCajas as any[]).find((c: any) => c.es_predeterminada);
        if (pred) setCuentaCobroId(pred.id);
        else if (listaCajas.length > 0) setCuentaCobroId(listaCajas[0].id);
      }

      // Cargar torneos con fallback y autoseed
      try {
        const { data: dbTorneos, error: tErr } = await supabase
          .from('torneos')
          .select('nombre')
          .eq('escuela_id', usr.escuela_id)
          .eq('activo', true)
          .order('nombre');

        if (tErr) {
          console.warn("No se pudo cargar torneos de la BD:", tErr.message);
          setTorneos([]);
        } else {
          setTorneos(dbTorneos.map((t: any) => t.nombre));
        }
      } catch (e) {
        console.error("Error al obtener torneos:", e);
        setTorneos([]);
      }
    };
    cargar();

    if (cxcEditar) {
      setAlumnoId(cxcEditar.alumno_id);
      setLineas(cxcEditar.lineas || [lineaVacia()]);
      setObservaciones(cxcEditar.observaciones || '');
      setVencimiento(cxcEditar.fecha_vencimiento || cxcEditar.vencimiento || getHoyISO());
      setFechaEmision(cxcEditar.fecha_emision || getHoyISO());
      // Si estamos editando y ya tiene cobros, no mostramos el panel de pago rápido
      if (cxcEditar.total_cobrado > 0) {
        setPagarAlCrear(false);
      }
    } else {
      // Intentar cargar borrador si no estamos editando
      const borrador = localStorage.getItem(STORAGE_KEY);
      if (borrador) {
        try {
          const data = JSON.parse(borrador);
          // PRIORIDAD: Si se pasa un alumno explícitamente desde la tarjeta de cliente, tiene prioridad sobre el borrador.
          setAlumnoId(alumnoPreseleccionado?.id || data.alumnoId || '');
          setLineas(data.lineas || [lineaVacia()]);
          setObservaciones(data.observaciones || '');
          // Cargar fechas desde el borrador si existen, de lo contrario usar la fecha de hoy
          setVencimiento(data.vencimiento || getHoyISO());
          setFechaEmision(data.fechaEmision || getHoyISO());
          setFechaPago(data.fechaPago || getHoyISO());
          setPagarAlCrear(data.pagarAlCrear || esAnticipo);
          setCuentaCobroId(data.cuentaCobroId || '');
          setCuentaAnticipoId(data.cuentaAnticipoId || '');
          setMontoPago(data.montoPago || '');
          setCobroNroDoc(data.cobroNroDoc || '');
        } catch (e) {
          console.error("Error cargando borrador", e);
        }
      } else {
        setAlumnoId(alumnoPreseleccionado?.id || '');
        setLineas([lineaVacia()]);
        setObservaciones(esAnticipo ? 'Cobro Anticipado - Saldo a Favor' : '');
        setFechaEmision(getHoyISO());
        setVencimiento(getHoyISO());
        setFechaPago(getHoyISO());
      }
    }
    setError(null); setExito(null);
  }, [visible, cxcEditar, alumnoPreseleccionado, esAnticipo]);

  // Guardar borrador automáticamente
  useEffect(() => {
    if (visible && !cxcEditar && !exito) {
      const draft = {
        alumnoId, lineas, observaciones, vencimiento, fechaEmision,
        pagarAlCrear, cuentaCobroId, cuentaAnticipoId, montoPago, cobroNroDoc, fechaPago
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    }
  }, [alumnoId, lineas, observaciones, vencimiento, fechaEmision, pagarAlCrear, cuentaCobroId, cuentaAnticipoId, montoPago, cobroNroDoc, fechaPago, visible, cxcEditar, exito]);

  const total = useMemo(() => {
    if (esAnticipo) return parseFloat(montoAnticipo) || 0;
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas, esAnticipo, montoAnticipo]);

  useEffect(() => {
    if (esAnticipo) {
      setMontoPago(String(total));
      setPagarAlCrear(true);
    } else if (pagarAlCrear && !montoPago) {
      setMontoPago(String(total));
    }
  }, [pagarAlCrear, total, esAnticipo]);

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null);
    if (esAnticipo) {
      if (!montoAnticipo || parseFloat(montoAnticipo) <= 0) { setError('Ingresa un monto válido.'); return; }
      if (!cuentaCobroId) { setError('Selecciona la caja de ingreso.'); return; }
      if (!cuentaAnticipoId) { setError('Selecciona la cuenta/concepto a la que se aplicará el anticipo.'); return; }
    } else {
      const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario > 0);
      if (lineasValidas.length === 0) { setError('Agrega ítems válidos.'); return; }

      // Validación para Mensualidad: obligatorio seleccionar al menos un mes
      for (const l of lineasValidas) {
        if (l.nombre === 'Mensualidad' && l.periodo_meses.length === 0) {
          setError('Debe seleccionar al menos un mes para el ítem Mensualidad.');
          return;
        }
      }
    }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      // 1. Guardar/Actualizar Nota
      let notaId = '';
      const descripcionFinal = esAnticipo ? 'Anticipo' : lineas.filter(l => l.catalogo_item_id && l.precio_unitario > 0).map(l => l.nombre).join(', ');

      if (cxcEditar?.id) {
        notaId = cxcEditar.id;

        // Recalcular el estado correcto en base a los cobros existentes y el nuevo monto_total
        const { data: cobrosExistentes } = await supabase
          .from('cobros_aplicados')
          .select('monto_aplicado')
          .eq('cuenta_cobrar_id', notaId);
        const totalCobrado = (cobrosExistentes || []).reduce((s: number, c: any) => s + Number(c.monto_aplicado), 0);
        let nuevoEstado = 'pendiente';
        if (totalCobrado >= total) nuevoEstado = 'pagada';
        else if (totalCobrado > 0) nuevoEstado = 'parcial';

        const { error: errU } = await supabase.from('cuentas_cobrar').update({
          monto_total: total,
          descripcion: descripcionFinal,
          observaciones,
          fecha_emision: fechaEmision,
          fecha_vencimiento: vencimiento || null,
          estado: nuevoEstado,
          editado: true,
          editado_por: ctx.id,
          updated_at: new Date().toISOString()
        }).eq('id', notaId);
        if (errU) throw errU;

        // Borrar detalle previo para re-insertar
        await supabase.from('cxc_detalle').delete().eq('cuenta_cobrar_id', notaId);
      } else {
        const { data: nueva, error: errN } = await supabase.from('cuentas_cobrar').insert({
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          alumno_id: alumnoId,
          monto_total: total,
          descripcion: descripcionFinal,
          observaciones,
          fecha_emision: fechaEmision,
          fecha_vencimiento: vencimiento || null,
          es_anticipo: esAnticipo,
          estado: 'pendiente',
          nro_recibo: cobroNroDoc || null
        }).select('id').single();
        if (errN) throw errN;
        notaId = nueva.id;
      }

      // 2. Detalle
      if (esAnticipo) {
        await supabase.from('cxc_detalle').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaId,
          catalogo_item_id: cuentaAnticipoId,
          cantidad: 1,
          precio_unitario: total,
          detalle_extra: 'Anticipo'
        });
      } else {
        const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario > 0);
        await supabase.from('cxc_detalle').insert(lineasValidas.map(l => ({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaId,
          catalogo_item_id: l.catalogo_item_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
          detalle_extra: l.detalle_personalizado
        })));
      }

      // 3. Pago (Solo si es nueva nota o si explícitamente se pidió pagar algo adicional)
      if (pagarAlCrear || esAnticipo) {
        const mp = esAnticipo ? parseFloat(montoAnticipo) : parseFloat(montoPago);
        if (mp > 0 && cuentaCobroId) {
          const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
            p_payload: {
              cuenta_cobrar_id: notaId,
              escuela_id: ctx.escuela_id,
              sucursal_id: ctx.sucursal_id,
              usuario_id: ctx.id,
              monto: mp,
              cuenta_cobro_id: cuentaCobroId,
              nro_comprobante: cobroNroDoc || null,
              fecha: `${fechaPago}T${horaPago}:00`
            }
          });

          if (rpcErr) throw rpcErr;
        }
      }

      localStorage.removeItem(STORAGE_KEY);
      setExito(`✅ ${cxcEditar ? 'Cambios guardados' : 'Registrado'} correctamente.`);
      
      // LOG DE ACTIVIDAD
      try {
        const { logActivity } = await import('../../lib/auditLogger');
        const alumnoNombre = alumnos.find(a => a.id === alumnoId);
        logActivity({
          escuela_id: ctx.escuela_id,
          usuario_id: ctx.id,
          usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
          accion: cxcEditar ? 'Nota Actualizada' : (esAnticipo ? 'Anticipo Registrado' : 'Nueva Nota'),
          modulo: 'Finanzas',
          entidad_id: notaId,
          detalle: {
            alumno: alumnoNombre ? `${alumnoNombre.nombres} ${alumnoNombre.apellidos}` : 'N/A',
            monto: total,
            descripcion: `${cxcEditar ? 'Factura Actualizada' : (esAnticipo ? 'Anticipo' : 'Factura')} por Bs ${total} para ${alumnoNombre ? alumnoNombre.nombres : 'alumno'}.`
          }
        });
      } catch (e) { console.error(e); }

      onCreada();
      setTimeout(() => { onCerrar(); }, 600);
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2><FileText size={20} style={{ marginRight: '0.5rem' }} /> {esAnticipo ? 'Cobro Anticipado' : (cxcEditar ? 'Editar Nota de Servicio' : 'Nueva Nota de Servicio')}</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <form onSubmit={guardarNota}>
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="form-campo full-width">
                <label>Alumno / Deportista *</label>
                <select value={alumnoId} onChange={e => setAlumnoId(e.target.value)} disabled={guardando || !!cxcEditar} required>
                  <option value="">— Seleccionar —</option>
                  {alumnos.map(a => <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>)}
                </select>
              </div>
              <div className="form-campo">
                <label>Fecha Emisión</label>
                <input 
                  type="date" 
                  value={fechaEmision} 
                  onChange={e => {
                    const f = e.target.value;
                    setFechaEmision(f);
                    setVencimiento(f);
                    
                    // Sincronizar meses de mensualidad si existen
                    if (f) {
                      const monthIdx = parseInt(f.split('-')[1]) - 1;
                      const nuevasLineas = lineas.map(l => {
                        if (l.nombre === 'Mensualidad') {
                          return { 
                            ...l, 
                            periodo_meses: [MESES_ANIO[monthIdx]],
                            cantidad: 1,
                            subtotal: l.precio_unitario
                          };
                        }
                        return l;
                      });
                      setLineas(nuevasLineas);
                    }
                  }} 
                  required 
                />
              </div>
              {!esAnticipo && (
                <div className="form-campo">
                  <label>Vencimiento</label>
                  <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
                </div>
              )}
            </div>

            {!esAnticipo ? (
              <div style={{ marginBottom: '1.5rem' }}>
                {lineas.map((linea, idx) => {
                  const esMensualidad = linea.nombre === 'Mensualidad';
                  const esTorneo = linea.nombre === 'Inscripción a Torneos';

                  return (
                    <div key={idx} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                        <select value={linea.catalogo_item_id} onChange={e => {
                          const it = catalogo.find(c => c.id === e.target.value);
                          if (it) {
                            const nuevas = [...lineas];
                            const esMensualidad = it.nombre === 'Mensualidad';
                            const monthIdx = parseInt(fechaEmision.split('-')[1]) - 1;
                            const mesesIniciales = esMensualidad ? [MESES_ANIO[monthIdx]] : [];
                            const cantidadInicial = esMensualidad ? 1 : nuevas[idx].cantidad;

                            nuevas[idx] = { 
                              ...nuevas[idx], 
                              catalogo_item_id: it.id, 
                              nombre: it.nombre, 
                              precio_unitario: Number(it.precio_venta) || 0, 
                              cantidad: cantidadInicial,
                              subtotal: (Number(it.precio_venta) || 0) * cantidadInicial,
                              periodo_meses: mesesIniciales,
                              detalle_personalizado: ''
                            };
                            setLineas(nuevas);
                          }
                        }} required disabled={guardando}>
                          <option value="">— Seleccionar Ítem —</option>
                          {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        <input type="number" value={linea.cantidad} onChange={e => {
                          const cant = parseInt(e.target.value) || 1;
                          const nuevas = [...lineas];
                          nuevas[idx] = { ...nuevas[idx], cantidad: cant, subtotal: cant * nuevas[idx].precio_unitario };
                          setLineas(nuevas);
                        }} min="1" disabled={guardando || esMensualidad} title="Cantidad" />
                        <input type="number" step="0.01" value={linea.precio_unitario} onChange={e => {
                          const prec = parseFloat(e.target.value) || 0;
                          const nuevas = [...lineas];
                          nuevas[idx] = { ...nuevas[idx], precio_unitario: prec, subtotal: prec * nuevas[idx].cantidad };
                          setLineas(nuevas);
                        }} disabled={guardando} title="Precio Unitario" />
                        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>Bs {fmtMonto(linea.subtotal)}</div>
                        <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                      </div>

                      {esMensualidad && (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Seleccionar Mes(es)</p>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
                            {MESES_ANIO.map(mes => (
                              <label key={mes} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', cursor: 'pointer', background: linea.periodo_meses.includes(mes) ? 'rgba(59,130,246,0.1)' : 'transparent', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid', borderColor: linea.periodo_meses.includes(mes) ? '#3b82f6' : 'rgba(255,255,255,0.1)' }}>
                                <input 
                                  type="checkbox" 
                                  checked={linea.periodo_meses.includes(mes)} 
                                  onChange={e => {
                                    const meses = e.target.checked 
                                      ? [...linea.periodo_meses, mes]
                                      : linea.periodo_meses.filter(m => m !== mes);
                                    const nuevas = [...lineas];
                                    nuevas[idx].periodo_meses = meses;
                                    
                                    // Actualizar cantidad automáticamente según meses seleccionados
                                    if (meses.length > 0) {
                                      nuevas[idx].cantidad = meses.length;
                                      nuevas[idx].subtotal = meses.length * nuevas[idx].precio_unitario;
                                    }
                                    
                                    setLineas(nuevas);
                                  }}
                                  style={{ width: '12px', height: '12px' }}
                                />
                                {mes}
                              </label>
                            ))}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>PERIODO ESPECÍFICO / DETALLE</label>
                              <input 
                                type="text" 
                                value={linea.detalle_personalizado} 
                                onChange={e => {
                                  const nuevas = [...lineas];
                                  nuevas[idx].detalle_personalizado = e.target.value;
                                  setLineas(nuevas);
                                }}
                                placeholder="Ej: Curso de Verano, Enero-Febrero, etc."
                                style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {esTorneo && (() => {
                        const selectVal = linea.torneo_select_value !== undefined
                          ? linea.torneo_select_value
                          : (linea.detalle_personalizado
                              ? (torneos.includes(linea.detalle_personalizado) ? linea.detalle_personalizado : 'Otro')
                              : '');

                        return (
                          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: selectVal === 'Otro' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                              <div>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>SELECCIONAR TORNEO</label>
                                <select 
                                  value={selectVal}
                                  onChange={e => {
                                    const val = e.target.value;
                                    const nuevas = [...lineas];
                                    nuevas[idx] = {
                                      ...nuevas[idx],
                                      torneo_select_value: val,
                                      detalle_personalizado: val === 'Otro'
                                        ? (nuevas[idx].detalle_personalizado && !torneos.includes(nuevas[idx].detalle_personalizado)
                                            ? nuevas[idx].detalle_personalizado
                                            : '')
                                        : val
                                    };
                                    setLineas(nuevas);
                                  }}
                                  style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                                >
                                  <option value="">— Seleccionar —</option>
                                  {torneos.map(t => <option key={t} value={t}>{t}</option>)}
                                  <option value="Otro">Otro</option>
                                </select>
                              </div>
                              {selectVal === 'Otro' && (
                                <div>
                                  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>NOMBRE DEL TORNEO</label>
                                  <input 
                                    type="text" 
                                    value={linea.detalle_personalizado || ''} 
                                    onChange={e => {
                                      const nuevas = [...lineas];
                                      nuevas[idx] = { ...nuevas[idx], detalle_personalizado: e.target.value };
                                      setLineas(nuevas);
                                    }}
                                    placeholder="Escriba el torneo..."
                                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Agregar otro ítem</button>
              </div>
            ) : null}

            {esAnticipo && (
              <div className="form-campo full-width" style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  📂 Cuenta / Concepto <span style={{ color: '#a855f7', fontSize: '0.75rem' }}>(a qué cuenta se aplica el anticipo)</span>
                </label>
                <select
                  value={cuentaAnticipoId}
                  onChange={e => setCuentaAnticipoId(e.target.value)}
                  disabled={guardando}
                  style={{ borderColor: cuentaAnticipoId ? '#a855f7' : undefined }}
                  required
                >
                  <option value="">— Seleccionar cuenta —</option>
                  {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </div>
            )}

            {/* Observaciones generales */}
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                📝 Observaciones Generales
              </label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Notas internas, aclaraciones, condiciones especiales..."
                rows={2}
                style={{
                  width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px', color: 'inherit', resize: 'vertical', minHeight: '50px'
                }}
                disabled={guardando}
              />
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }}>
                <input 
                  type="checkbox" 
                  checked={pagarAlCrear} 
                  onChange={e => {
                    const val = e.target.checked;
                    setPagarAlCrear(val);
                    if (val) setFechaPago(getHoyISO());
                  }} 
                  disabled={esAnticipo} 
                />
                <span style={{ fontWeight: 700 }}>{esAnticipo ? 'Registro de Ingreso de Dinero' : '¿Registrar pago ahora?'}</span>
              </label>

              {pagarAlCrear && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-campo">
                    <label>Monto</label>
                    <input 
                      type="number" step="0.01" 
                      value={esAnticipo ? montoAnticipo : montoPago} 
                      onChange={e => esAnticipo ? setMontoAnticipo(e.target.value) : setMontoPago(e.target.value)} 
                      required 
                    />
                  </div>
                  <div className="form-campo">
                    <label>Caja/Banco</label>
                    <select value={cuentaCobroId} onChange={e => setCuentaCobroId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-campo">
                    <label>Referencia / Nro. Transacción</label>
                    <input 
                      type="text" 
                      value={cobroNroDoc} 
                      onChange={e => setCobroNroDoc(e.target.value)} 
                      placeholder="Ej: Transf-123, Recibo-456..." 
                    />
                  </div>
                  <div className="form-campo">
                    <label>Fecha de Pago</label>
                    <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} required />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Total: Bs {fmtMonto(total)}</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem' }}>{guardando ? '...' : (cxcEditar ? 'Guardar Cambios' : 'Confirmar')}</button>
              </div>
            </div>
            {error && <p style={{ color: '#f87171', marginTop: '1rem' }}>{error}</p>}
            {exito && <p style={{ color: '#4ade80', marginTop: '1rem' }}>{exito}</p>}
          </form>
        </div>
      </div>
    </div>
  );
};

export default NotaServicios;
