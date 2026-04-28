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

const NotaPago: React.FC<Props> = ({ visible, tipoInicial, esAnticipo = false, onCerrar, onCreada }) => {
  const [tipoGasto, setTipoGasto] = useState(tipoInicial);
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
  const [vencimiento, setVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<LineaNotaPago[]>([lineaVacia()]);

  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');

  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [personal, setPersonal] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  useEffect(() => { setTipoGasto(tipoInicial); }, [tipoInicial]);

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
        supabase.from('cajas_bancos').select('id, nombre, saldo_actual').eq('activo', true).eq('escuela_id', usr.escuela_id).order('nombre'),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(persProv.data ?? []);
      setCatalogo(resCat.data ?? []);
      setCajasBancos(resCajas.data ?? []);
    };
    cargar();

    setProveedorId(''); setPersonalId(''); setDescripcion('');
    setFechaEmision(getHoyISO()); setVencimiento(''); setObservaciones('');
    setLineas([lineaVacia()]); setPagarAlCrear(esAnticipo);
    setMontoPago(''); setNroComprobante('');
    setError(null); setExito(null);
  }, [visible, esAnticipo, tipoInicial]);

  const total = useMemo(() => lineas.reduce((s, l) => s + l.subtotal, 0), [lineas]);

  useEffect(() => {
    if (pagarAlCrear && !montoPago) setMontoPago(String(total));
  }, [pagarAlCrear, total]);

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null);

    const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
    if (lineasValidas.length === 0) { setError('Agrega al menos un ítem válido.'); return; }
    if (pagarAlCrear && (!montoPago || !cuentaPagoId)) { setError('Completa los datos del pago.'); return; }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      // 1. Crear Nota
      const { data: nueva, error: errN } = await supabase.from('cuentas_pagar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        proveedor_id: tipoGasto === 'proveedor' ? proveedorId : null,
        personal_id: tipoGasto === 'personal' ? personalId : null,
        monto_total: total,
        tipo_gasto: tipoGasto,
        descripcion: descripcion || lineasValidas.map(l => l.nombre).join(', '),
        observaciones,
        fecha_emision: fechaEmision,
        fecha_vencimiento: vencimiento || null,
        es_anticipo: esAnticipo,
        estado: 'pendiente'
      }).select('id').single();
      if (errN) throw errN;

      // 2. Detalle
      await supabase.from('cxp_detalle').insert(lineasValidas.map(l => ({
        escuela_id: ctx.escuela_id,
        cuenta_pagar_id: nueva.id,
        catalogo_item_id: l.catalogo_item_id,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        descripcion: l.descripcion || null
      })));

      // 3. Pago
      if (pagarAlCrear) {
        const mp = parseFloat(montoPago);
        if (mp > 0 && cuentaPagoId) {
          await supabase.from('pagos_aplicados').insert({
            escuela_id: ctx.escuela_id,
            cuenta_pagar_id: nueva.id,
            monto_aplicado: mp,
            caja_id: cuentaPagoId,
            fecha: fechaEmision,
            referencia: nroComprobante || null
          });

          // Actualizar Saldo Caja
          const caja = cajasBancos.find(c => c.id === cuentaPagoId);
          const nuevoSaldo = (Number(caja?.saldo_actual) || 0) - mp;
          await supabase.from('cajas_bancos').update({ saldo_actual: nuevoSaldo }).eq('id', cuentaPagoId);

          // Actualizar Estado Nota
          const nuevoEstado = mp >= total ? 'pagada' : 'parcial';
          await supabase.from('cuentas_pagar').update({ monto_pagado: mp, estado: nuevoEstado }).eq('id', nueva.id);

          // Inventario
          for (const l of lineasValidas) {
            if (l.tipo === 'producto') {
              await supabase.from('movimientos_stock').insert({ escuela_id: ctx.escuela_id, catalogo_item_id: l.catalogo_item_id, tipo: 'entrada', cantidad: l.cantidad, motivo: `Compra: ${nueva.id}` });
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
              <div className="form-campo">
                <label>Vencimiento</label>
                <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
              </div>
              <div className="form-campo full-width">
                <label>Concepto / Glosa *</label>
                <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: Pago de uniformes..." required />
              </div>
            </div>

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
                <span style={{ fontWeight: 700 }}>¿Registrar pago ahora?</span>
              </label>

              {pagarAlCrear && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-campo">
                    <label>Monto</label>
                    <input type="number" step="0.01" value={montoPago} onChange={e => setMontoPago(e.target.value)} required />
                  </div>
                  <div className="form-campo">
                    <label>Caja/Banco de Salida</label>
                    <select value={cuentaPagoId} onChange={e => setCuentaPagoId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
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
