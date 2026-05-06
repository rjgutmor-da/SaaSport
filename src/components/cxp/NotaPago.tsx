/**
 * NotaPago.tsx
 * Modal para crear una Nota de Pago (CxP).
 * Versión simplificada sin campos contables.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import {
  X, Plus, Check, Trash2, AlertCircle, CreditCard, Package,
  Users, FileText, Calendar, RefreshCw, Hash
} from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';

interface LineaNotaPago {
  catalogo_item_id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string;
}

interface Props {
  visible: boolean;
  tipoInicial: 'proveedor' | 'personal';
  esAnticipo?: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  cxpEditar?: any;
}

const lineaVacia = (): LineaNotaPago => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  subtotal: 0,
  descripcion: '',
});

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NotaPago: React.FC<Props> = ({ visible, tipoInicial, esAnticipo = false, onCerrar, onCreada, cxpEditar }) => {
  const [tipoGasto, setTipoGasto] = useState(tipoInicial);
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
  const [vencimiento, setVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<LineaNotaPago[]>([lineaVacia()]);

  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [fechaPago, setFechaPago] = useState(getHoyISO());
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [montoAnticipo, setMontoAnticipo] = useState('');

  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [personal, setPersonal] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => { 
    if (!cxpEditar) setTipoGasto(tipoInicial); 
  }, [tipoInicial, cxpEditar]);

  useEffect(() => {
    if (!visible) return;
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const [resProv, persProv, resCat, resCajas] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('personal').select('id, nombres, apellidos').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombres'),
        supabase.from('catalogo_items').select('*').eq('activo', true).or('tipo_movimiento.eq.egreso,tipo_movimiento.eq.ambos').order('nombre'),
        supabase.from('cajas_bancos').select('id, nombre, saldo_actual, es_predeterminada').eq('activo', true).eq('escuela_id', usr.escuela_id).order('orden'),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(persProv.data ?? []);
      const catData = resCat.data ?? [];
      setCatalogo(catData);
      const listaCajas = resCajas.data ?? [];
      setCajasBancos(listaCajas);
      // Preseleccionar caja predeterminada
      if (!cuentaPagoId) {
        const pred = (listaCajas as any[]).find((c: any) => c.es_predeterminada);
        if (pred) setCuentaPagoId(pred.id);
        else if (listaCajas.length > 0) setCuentaPagoId(listaCajas[0].id);
      }

      if (cxpEditar) {
        setTipoGasto(cxpEditar.tipo_gasto || 'proveedor');
        setProveedorId(cxpEditar.proveedor_id || '');
        setPersonalId(cxpEditar.personal_id || '');
        setFechaEmision(cxpEditar.fecha_emision ? cxpEditar.fecha_emision.split('T')[0] : getHoyISO());
        setVencimiento(cxpEditar.fecha_vencimiento ? cxpEditar.fecha_vencimiento.split('T')[0] : '');
        setObservaciones(cxpEditar.observaciones || '');
        
        const { data: detItems } = await supabase.from('cxp_detalle').select('*').eq('cuenta_pagar_id', cxpEditar.id);
        if (detItems && detItems.length > 0) {
          setLineas(detItems.map(d => {
            const it = (catData || []).find(c => c.id === d.catalogo_item_id);
            return {
              catalogo_item_id: d.catalogo_item_id || '',
              nombre: it?.nombre || d.descripcion || '',
              tipo: it?.tipo || 'servicio',
              cantidad: d.cantidad || 1,
              precio_unitario: Number(d.precio_unitario),
              subtotal: (d.cantidad || 1) * Number(d.precio_unitario),
              descripcion: d.descripcion || ''
            };
          }));
        } else {
          setLineas([lineaVacia()]);
        }
      } else {
        setProveedorId(''); setPersonalId('');
        setFechaEmision(getHoyISO()); setVencimiento(getHoyISO()); setObservaciones('');
        setLineas([lineaVacia()]); setPagarAlCrear(esAnticipo);
        setFechaPago(getHoyISO()); setMontoPago(''); setNroComprobante('');
      }
      setError(null); setExito(null);
    };
    cargar();
  }, [visible, esAnticipo, cxpEditar]);

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
      if (!cuentaPagoId) { setError('Selecciona la caja de salida.'); return; }
    } else {
      const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
      if (lineasValidas.length === 0) { setError('Agrega al menos un ítem válido.'); return; }
      if (pagarAlCrear && (!montoPago || !cuentaPagoId)) { setError('Completa los datos del pago.'); return; }
    }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      // 1. Crear o Actualizar Nota
      let notaId = cxpEditar?.id;
      
      const cxpPayload = {
        proveedor_id: tipoGasto === 'proveedor' ? proveedorId : null,
        personal_id: tipoGasto === 'personal' ? personalId : null,
        monto_total: total,
        tipo_gasto: tipoGasto,
        descripcion: esAnticipo ? 'Anticipo' : lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0).map(l => l.nombre).join(', '),
        observaciones,
        fecha_emision: fechaEmision,
        fecha_vencimiento: vencimiento || null,
      };

      if (cxpEditar) {
        const pagado = Number(cxpEditar.monto_pagado) || 0;
        let nuevoEstado = 'pendiente';
        if (pagado >= total && total > 0) nuevoEstado = 'pagada';
        else if (pagado > 0) nuevoEstado = 'parcial';

        const { error: errU } = await supabase.from('cuentas_pagar')
          .update({ ...cxpPayload, estado: nuevoEstado })
          .eq('id', cxpEditar.id);
        if (errU) throw errU;
        
        // 2. Detalle (borrar y recrear en edicion)
        await supabase.from('cxp_detalle').delete().eq('cuenta_pagar_id', cxpEditar.id);
      } else {
        const { data: nueva, error: errN } = await supabase.from('cuentas_pagar').insert({
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          es_anticipo: esAnticipo,
          estado: 'pendiente',
          ...cxpPayload
        }).select('id').single();
        if (errN) throw errN;
        notaId = nueva.id;
      }

      // 2. Insertar Detalle (nuevo o despues de borrar)
      if (esAnticipo) {
        // Para anticipos, usamos un ítem genérico o el primero de la lista
        const itemGenerico = catalogo[0]?.id; 
        await supabase.from('cxp_detalle').insert({
          escuela_id: ctx.escuela_id,
          cuenta_pagar_id: notaId,
          catalogo_item_id: itemGenerico,
          cantidad: 1,
          precio_unitario: total,
          descripcion: 'Anticipo'
        });
      } else {
        const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
        await supabase.from('cxp_detalle').insert(lineasValidas.map(l => ({
          escuela_id: ctx.escuela_id,
          cuenta_pagar_id: notaId,
          catalogo_item_id: l.catalogo_item_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          descripcion: l.descripcion || null
        })));
      }

      // 3. Pago (solo si es nuevo, la edicion de pagos va por otro lado)
      if (!cxpEditar && (pagarAlCrear || esAnticipo)) {
        const mp = esAnticipo ? parseFloat(montoAnticipo) : parseFloat(montoPago);
        if (mp > 0 && cuentaPagoId) {
          const { error: errRpc } = await supabase.rpc('rpc_registrar_pago_cxp', {
            p_payload: {
              escuela_id: ctx.escuela_id,
              sucursal_id: ctx.sucursal_id,
              usuario_id: ctx.id,
              cuenta_pagar_id: notaId,
              monto: mp,
              cuenta_pago_id: cuentaPagoId,
              fecha: fechaPago,
              nro_comprobante: nroComprobante || null,
              metodo_pago: 'efectivo',
              descripcion: esAnticipo ? `Anticipo: ${observaciones || 'Sin observaciones'}` : undefined
            }
          });
          
          if (errRpc) throw errRpc;

          // Inventario (solo si no es anticipo)
          if (!esAnticipo) {
            const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
            for (const l of lineasValidas) {
              if (l.tipo === 'producto') {
                await supabase.from('movimientos_stock').insert({ escuela_id: ctx.escuela_id, catalogo_item_id: l.catalogo_item_id, tipo: 'entrada', cantidad: l.cantidad, motivo: `Compra: ${notaId}` });
              }
            }
          }
        }
      }

      setExito('✅ Registrado correctamente.');
      setTimeout(() => { onCreada(); onCerrar(); }, 1200);
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
          <h2><Package size={20} style={{ marginRight: '0.5rem' }} /> {esAnticipo ? 'Registrar Anticipo' : 'Nueva Nota de Deuda'}</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <form onSubmit={guardarNota}>
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="form-campo full-width">
                <label>Tipo de Beneficiario</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => setTipoGasto('proveedor')} className={`nota-mes-btn ${tipoGasto === 'proveedor' ? 'nota-mes-btn--activo' : ''}`} style={{ flex: 1 }}>🏭 Proveedor</button>
                  <button type="button" onClick={() => setTipoGasto('personal')} className={`nota-mes-btn ${tipoGasto === 'personal' ? 'nota-mes-btn--activo' : ''}`} style={{ flex: 1 }}>👤 Personal</button>
                </div>
              </div>
              <div className="form-campo full-width">
                <label>{tipoGasto === 'proveedor' ? 'Proveedor' : 'Personal'} *</label>
                {tipoGasto === 'proveedor' ? (
                  <select value={proveedorId} onChange={e => setProveedorId(e.target.value)} required>
                    <option value="">— Seleccionar —</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                ) : (
                  <select value={personalId} onChange={e => setPersonalId(e.target.value)} required>
                    <option value="">— Seleccionar —</option>
                    {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                  </select>
                )}
              </div>
              <div className="form-campo">
                <label>Fecha Emisión</label>
                <input type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} required />
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
                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>ÍTÉMS / GASTOS</p>
                {lineas.map((linea, idx) => (
                  <div key={idx} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                      <select value={linea.catalogo_item_id} onChange={e => {
                        const it = catalogo.find(c => c.id === e.target.value);
                        if (it) {
                          const nuevas = [...lineas];
                          nuevas[idx] = { ...nuevas[idx], catalogo_item_id: it.id, nombre: it.nombre, tipo: it.tipo, precio_unitario: Number(it.precio_venta) || 0, subtotal: (Number(it.precio_venta) || 0) * nuevas[idx].cantidad };
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
                      }} min="1" disabled={guardando} title="Cantidad" />
                      <input type="number" step="0.01" value={linea.precio_unitario} onChange={e => {
                        const prec = parseFloat(e.target.value) || 0;
                        const nuevas = [...lineas];
                        nuevas[idx] = { ...nuevas[idx], precio_unitario: prec, subtotal: prec * nuevas[idx].cantidad };
                        setLineas(nuevas);
                      }} disabled={guardando} title="Precio Unitario" />
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>Bs {fmtMonto(linea.subtotal)}</div>
                      <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                    </div>
                  </div>
                ))}
                <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Agregar ítem</button>
              </div>
            ) : null}

            {/* Observaciones generales */}
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                📝 Observaciones Generales
              </label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Notas internas, aclaraciones, condiciones de pago..."
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
                <input type="checkbox" checked={pagarAlCrear} onChange={e => setPagarAlCrear(e.target.checked)} disabled={esAnticipo} />
                <span style={{ fontWeight: 700 }}>{esAnticipo ? 'Registro de Salida de Dinero' : '¿Registrar pago ahora?'}</span>
              </label>

              {pagarAlCrear && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-campo">
                    <label>Fecha Pago</label>
                    <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)} required />
                  </div>
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
                    <label>Caja/Banco de Salida</label>
                    <select value={cuentaPagoId} onChange={e => setCuentaPagoId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-campo full-width">
                    <label>Nro. Documento / Comprobante</label>
                    <input 
                      type="text" 
                      value={nroComprobante} 
                      onChange={e => setNroComprobante(e.target.value)} 
                      placeholder="Ej: Transf-123, Recibo-456..." 
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Total: Bs {fmtMonto(total)}</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem', background: '#f59e0b', borderColor: '#f59e0b' }}>{guardando ? '...' : 'Confirmar'}</button>
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

export default NotaPago;
