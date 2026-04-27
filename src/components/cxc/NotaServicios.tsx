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

const NotaServicios: React.FC<NotaServiciosProps> = ({
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar, esAnticipo = false, modoInicial
}) => {
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);

  const [alumnoId, setAlumnoId] = useState('');
  const [lineas, setLineas] = useState<LineaNota[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState('');
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
      setCajasBancos(resCajas.data ?? []);
    };
    cargar();

    if (cxcEditar) {
      setAlumnoId(cxcEditar.alumno_id);
      setLineas(cxcEditar.lineas || [lineaVacia()]);
      setObservaciones(cxcEditar.observaciones || '');
      setVencimiento(cxcEditar.vencimiento || '');
      setFechaEmision(cxcEditar.fecha_emision || getHoyISO());
    } else {
      setAlumnoId(alumnoPreseleccionado?.id || '');
      setLineas([lineaVacia()]);
      setObservaciones(esAnticipo ? 'Cobro Anticipado - Saldo a Favor' : '');
      setFechaEmision(getHoyISO());
    }
    setPagarAlCrear(esAnticipo);
    setMontoPago('');
    setError(null); setExito(null);
  }, [visible, cxcEditar, alumnoPreseleccionado, esAnticipo]);

  const total = useMemo(() => lineas.reduce((s, l) => s + l.subtotal, 0), [lineas]);

  useEffect(() => {
    if (pagarAlCrear && !montoPago) setMontoPago(String(total));
  }, [pagarAlCrear, total]);

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null);
    if (!alumnoId) { setError('Selecciona un alumno.'); return; }
    const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario > 0);
    if (lineasValidas.length === 0) { setError('Agrega ítems válidos.'); return; }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      // 1. Crear Nota
      const { data: nueva, error: errN } = await supabase.from('cuentas_cobrar').insert({
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        alumno_id: alumnoId,
        monto_total: total,
        observaciones,
        fecha_emision: fechaEmision,
        fecha_vencimiento: vencimiento || null,
        es_anticipo: esAnticipo,
        estado: 'pendiente'
      }).select('id').single();
      if (errN) throw errN;

      // 2. Detalle
      await supabase.from('cxc_detalle').insert(lineasValidas.map(l => ({
        escuela_id: ctx.escuela_id,
        cuenta_cobrar_id: nueva.id,
        catalogo_item_id: l.catalogo_item_id,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
        detalle_extra: l.detalle_personalizado
      })));

      // 3. Pago
      if (pagarAlCrear) {
        const mp = parseFloat(montoPago);
        if (mp > 0 && cuentaCobroId) {
          await supabase.from('cobros_aplicados').insert({
            escuela_id: ctx.escuela_id,
            cuenta_cobrar_id: nueva.id,
            monto_aplicado: mp,
            caja_id: cuentaCobroId,
            fecha: `${fechaPago}T${horaPago}:00`,
            documento_referencia: cobroNroDoc || null
          });

          // Actualizar Saldo Caja
          const caja = cajasBancos.find(c => c.id === cuentaCobroId);
          const nuevoSaldo = (Number(caja?.saldo_actual) || 0) + mp;
          await supabase.from('cajas_bancos').update({ saldo_actual: nuevoSaldo }).eq('id', cuentaCobroId);

          // Actualizar Estado Nota
          const nuevoEstado = mp >= total ? 'pagada' : 'parcial';
          await supabase.from('cuentas_cobrar').update({ estado: nuevoEstado }).eq('id', nueva.id);
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
          <h2><FileText size={20} style={{ marginRight: '0.5rem' }} /> {esAnticipo ? 'Cobro Anticipado' : 'Nueva Nota de Servicio'}</h2>
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
                <input type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} required />
              </div>
              <div className="form-campo">
                <label>Vencimiento</label>
                <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
              </div>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>CONCEPTOS</p>
              {lineas.map((linea, idx) => (
                <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px 30px', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                  <select value={linea.catalogo_item_id} onChange={e => {
                    const it = catalogo.find(c => c.id === e.target.value);
                    if (it) {
                      const nuevas = [...lineas];
                      nuevas[idx] = { ...nuevas[idx], catalogo_item_id: it.id, nombre: it.nombre, precio_unitario: Number(it.precio_venta) || 0, subtotal: Number(it.precio_venta) || 0 };
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
                  }} min="1" disabled={guardando} />
                  <div style={{ textAlign: 'right', fontWeight: 700 }}>Bs {fmtMonto(linea.subtotal)}</div>
                  <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                </div>
              ))}
              <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Agregar otro ítem</button>
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
                    <label>Caja/Banco</label>
                    <select value={cuentaCobroId} onChange={e => setCuentaCobroId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-campo full-width">
                    <label>Referencia / Nro. Transacción</label>
                    <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Opcional" />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Total: Bs {fmtMonto(total)}</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem' }}>{guardando ? '...' : 'Confirmar'}</button>
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
