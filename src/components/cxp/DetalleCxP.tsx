/**
 * DetalleCxP.tsx
 * Modal de detalle de una Nota de Pago (CxP).
 * Muestra el estado, ítems, historial de pagos realizados
 * y permite registrar nuevos pagos.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  X, DollarSign, Calendar, Package, RefreshCw,
  AlertCircle, Check, CreditCard, CheckCircle2, Edit
} from 'lucide-react';
import { formatFecha, formatFechaHora } from '../../lib/dateUtils';
import ModalDetalleMovimiento from '../cajas-bancos/ModalDetalleMovimiento';

interface CxPItem {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  proveedor_id: string | null;
  personal_id: string | null;
  cuenta_contable_id: string | null;
  tipo_gasto: string;
  estado: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  descripcion: string | null;
  observaciones: string | null;
  proveedor_nombre?: string;
  personal_nombre?: string;
}

interface PagoRealizado {
  id: string;
  monto_aplicado: number;
  fecha: string;
  asiento_id: string;
}

interface DetalleCxPItem {
  id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string | null;
}

interface Props {
  nota: CxPItem | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFechaLocal = (f: string) => formatFechaHora(f);

const BADGE_ESTADOS: Record<string, { label: string; color: string }> = {
  pendiente: { label: 'Pendiente', color: '#facc15' },
  parcial:   { label: 'Parcial',   color: '#38bdf8' },
  pagada:    { label: 'Pagada',    color: '#4ade80' },
  vencida:   { label: 'Vencida',   color: '#f87171' },
};

const DetalleCxP: React.FC<Props> = ({ nota, visible, onCerrar, onActualizar }) => {
  const [pagosRealizados, setPagosRealizados] = useState<PagoRealizado[]>([]);
  const [detalleItems, setDetalleItems] = useState<DetalleCxPItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; cuenta_contable_id: string }[]>([]);
  const [cuentasGasto, setCuentasGasto] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [anticiposDisponibles, setAnticiposDisponibles] = useState<any[]>([]);
  const [cargando, setCargando] = useState(true);

  // Formulario de pago
  const [montoPago, setMontoPago] = useState('');
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [cuentaGastoId, setCuentaGastoId] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [registrandoPago, setRegistrandoPago] = useState(false);
  const [usarAnticipo, setUsarAnticipo] = useState(false);
  const [anticipoId, setAnticipoId] = useState('');
  const [errorPago, setErrorPago] = useState<string | null>(null);
  const [exitoPago, setExitoPago] = useState<string | null>(null);

  // Detalle de movimiento (Asiento)
  const [movDetalleId, setMovDetalleId] = useState<string | null>(null);


  useEffect(() => {
    if (!visible || !nota) return;
    setCargando(true);
    setErrorPago(null); setExitoPago(null);
    setMontoPago(String(nota.deuda_restante));
    setCuentaPagoId(''); setCuentaGastoId(''); setNroComprobante('');

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id, sucursal_id').eq('id', user.id).single();

      const [resPagos, resItems, resCajas, resGastos] = await Promise.all([
        // Pagos realizados
        supabase.from('pagos_aplicados')
          .select('id, monto_aplicado, fecha, asiento_id')
          .eq('cuenta_pagar_id', nota.id)
          .order('fecha', { ascending: false }),
        // Ítems del detalle
        supabase.from('cxp_detalle')
          .select(`id, cantidad, precio_unitario, subtotal, descripcion, catalogo_item_id,
                   catalogo_items!inner(nombre, tipo)`)
          .eq('cuenta_pagar_id', nota.id),
        // Cajas y bancos disponibles
        supabase.from('cajas_bancos').select('id, nombre, cuenta_contable_id')
          .eq('escuela_id', usr?.escuela_id).eq('activo', true).order('nombre'),
        // Cuentas de gasto
        supabase.from('plan_cuentas').select('id, codigo, nombre')
          .like('codigo', '5.%').eq('es_transaccional', true)
          .or(`escuela_id.eq.${usr?.escuela_id},escuela_id.is.null`)
          .order('codigo'),
      ]);

      setPagosRealizados((resPagos.data as any[]) ?? []);
      setDetalleItems((resItems.data as any[])?.map((d: any) => ({
        id: d.id,
        nombre: d.catalogo_items?.nombre || '—',
        tipo: d.catalogo_items?.tipo || 'servicio',
        cantidad: d.cantidad,
        precio_unitario: Number(d.precio_unitario),
        subtotal: Number(d.subtotal),
        descripcion: d.descripcion,
      })) ?? []);
      setCajasBancos(resCajas.data ?? []);
      setCuentasGasto(resGastos.data ?? []);

      // Precargar cuenta de gasto si la CxP tiene una asignada
      if (nota.cuenta_contable_id) {
        setCuentaGastoId((nota as any).cuenta_contable_id || '');
      }

      // Buscar anticipos disponibles
      let qAnticipos = supabase.from('v_estado_cuentas_pagar')
        .select('*')
        .eq('es_anticipo', true)
        .gt('deuda_restante', 0);
      
      if (nota.proveedor_id) qAnticipos = qAnticipos.eq('proveedor_id', nota.proveedor_id);
      else if (nota.personal_id) qAnticipos = qAnticipos.eq('personal_id', nota.personal_id);
      else qAnticipos = qAnticipos.is('id', null); // Fallback

      const { data: resAnt } = await qAnticipos;
      setAnticiposDisponibles(resAnt || []);

      setCargando(false);
    };
    cargar();
    setUsarAnticipo(false);
    setAnticipoId('');
  }, [visible, nota]);

  /** Registrar un pago parcial o total */
  const registrarPago = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nota) return;
    setErrorPago(null); setExitoPago(null);

    const mp = parseFloat(montoPago);
    if (!mp || mp <= 0) { setErrorPago('Monto inválido.'); return; }
    if (!cuentaPagoId) { setErrorPago('Selecciona la caja/banco de pago.'); return; }
    if (!cuentaGastoId) { setErrorPago('Selecciona la cuenta de gasto.'); return; }
    if (mp > nota.deuda_restante) { setErrorPago(`El monto supera la deuda restante de Bs ${fmtMonto(nota.deuda_restante)}.`); return; }

    setRegistrandoPago(true);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setErrorPago('Error de autenticación.'); setRegistrandoPago(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id').eq('id', user.id).single();
    if (!ctx) { setErrorPago('Error de contexto.'); setRegistrandoPago(false); return; }

    if (usarAnticipo) {
      if (!anticipoId) { setErrorPago('Selecciona un anticipo.'); setRegistrandoPago(false); return; }
      const { error } = await supabase.rpc('rpc_aplicar_anticipo_cxp', {
        p_payload: {
          nota_id: nota.id,
          anticipo_id: anticipoId,
          monto: mp,
          usuario_id: ctx.id,
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
        }
      });
      if (error) { setErrorPago(`Error: ${error.message}`); setRegistrandoPago(false); return; }
    } else {
      const { error } = await supabase.rpc('rpc_registrar_pago_cxp', {
        p_payload: {
          cuenta_pagar_id: nota.id,
          monto: mp,
          metodo_pago: metodoPago,
          cuenta_pago_id: cuentaPagoId,
          cuenta_gasto_id: cuentaGastoId,
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          descripcion: `Pago: ${nota.descripcion || 'Nota de Pago'}`,
          nro_comprobante: nroComprobante.trim() || null,
        }
      });
      if (error) { setErrorPago(`Error: ${error.message}`); setRegistrandoPago(false); return; }
    }

    setExitoPago(`✅ Aplicación de Bs ${fmtMonto(mp)} registrada correctamente.`);
    setRegistrandoPago(false);

    // Recargar la nota actualizada
    setTimeout(() => {
      onActualizar();
      onCerrar();
    }, 1500);
  };

  if (!visible || !nota) return null;

  const badge = BADGE_ESTADOS[nota.estado] ?? BADGE_ESTADOS.pendiente;
  const nombreEntidad = nota.proveedor_nombre || nota.personal_nombre || nota.descripcion || '(Sin asignar)';
  const yaPagada = nota.estado === 'pagada';

  return (
    <div className="cxc-modal-overlay">
      <div
        className="cxc-modal"
        style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Cabecera */}
        <div className="cxc-modal-header">
          <h2>
            <DollarSign size={20} style={{ marginRight: '0.4rem' }} />
            Detalle — Nota de Pago
          </h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button onClick={onCerrar} disabled={registrandoPago}><X size={20} /></button>
          </div>
        </div>

        {cargando ? (
          <div className="pc-cargando"><RefreshCw size={28} className="spin" /><p>Cargando detalle...</p></div>
        ) : (
          <div style={{ padding: '1rem' }}>
            {/* Info principal */}
            <div className="cxc-cobro-resumen" style={{ marginBottom: '1.25rem' }}>
              <p style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '0.4rem' }}>{nombreEntidad}</p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.87rem', color: '#94a3b8' }}>
                <span><Calendar size={13} style={{ marginRight: '0.3rem' }} />{formatFecha(nota.fecha_emision)}</span>
                {nota.fecha_vencimiento && <span>Vence: {nota.fecha_vencimiento}</span>}
                <span style={{ color: badge.color, fontWeight: 600 }}>{badge.label}</span>
              </div>
              {nota.observaciones && (
                <p style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '0.5rem', fontStyle: 'italic' }}>
                  {nota.observaciones}
                </p>
              )}
            </div>

            {/* Barras de progreso de pago */}
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '0.9rem', marginBottom: '1.25rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>Progreso de pago</span>
                <span style={{ fontSize: '0.9rem', fontWeight: 700 }}>
                  Bs {fmtMonto(nota.monto_pagado)} / Bs {fmtMonto(nota.monto_total)}
                </span>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.08)', borderRadius: '4px', height: '6px' }}>
                <div style={{
                  width: `${Math.min(100, (nota.monto_pagado / nota.monto_total) * 100)}%`,
                  height: '100%', background: '#4ade80', borderRadius: '4px',
                  transition: 'width 0.5s ease'
                }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.8rem' }}>
                <span style={{ color: '#4ade80' }}>Pagado: Bs {fmtMonto(nota.monto_pagado)}</span>
                <span style={{ color: '#f87171' }}>Saldo: Bs {fmtMonto(nota.deuda_restante)}</span>
              </div>
            </div>

            {/* Ítems del detalle */}
            {detalleItems.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>
                  ÍTEMS DE LA NOTA
                </p>
                {detalleItems.map(item => (
                  <div key={item.id} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.5rem 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
                    fontSize: '0.87rem'
                  }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                      {item.tipo === 'producto' && <Package size={13} style={{ color: '#6366f1' }} />}
                      {item.nombre} × {item.cantidad}
                    </span>
                    <span style={{ color: '#e2e8f0', fontWeight: 600 }}>Bs {fmtMonto(item.subtotal)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Historial de pagos */}
            {pagosRealizados.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '0.5rem', fontWeight: 600 }}>
                  HISTORIAL DE PAGOS
                </p>
                {pagosRealizados.map(p => (
                  <div 
                    key={p.id} 
                    className="cxc-tr-clickable"
                    onClick={() => setMovDetalleId(p.asiento_id)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.4rem 0.6rem', borderRadius: '6px',
                      background: 'rgba(74,222,128,0.06)', marginBottom: '0.3rem',
                      fontSize: '0.85rem'
                    }}
                  >
                    <span style={{ color: '#94a3b8' }}>{fmtFechaLocal(p.fecha)}</span>
                    <span style={{ color: '#4ade80', fontWeight: 700 }}>
                      <CheckCircle2 size={12} style={{ marginRight: '0.3rem' }} />
                      Bs {fmtMonto(Number(p.monto_aplicado))}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Formulario de pago (solo si hay saldo pendiente) */}
            {!yaPagada && (
              <form onSubmit={registrarPago}>
                <div
                  style={{
                    border: '1px solid rgba(99,102,241,0.3)', borderRadius: '10px',
                    padding: '1rem', background: 'rgba(99,102,241,0.05)'
                  }}
                >
                  <p style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.75rem', color: '#a5b4fc' }}>
                    <CreditCard size={14} style={{ marginRight: '0.4rem' }} /> Registrar pago
                  </p>

                    <div style={{ marginBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.5rem' }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}>
                        <input
                          type="checkbox"
                          checked={usarAnticipo}
                          onChange={e => setUsarAnticipo(e.target.checked)}
                          disabled={registrandoPago || anticiposDisponibles.length === 0}
                        />
                        <span style={{ color: anticiposDisponibles.length > 0 ? '#a855f7' : '#64748b', fontWeight: 600 }}>
                          {anticiposDisponibles.length > 0 
                            ? `Usar Saldo a Favor disponible (Bs ${fmtMonto(anticiposDisponibles.reduce((s, a) => s + Number(a.deuda_restante), 0))})`
                            : 'No hay anticipos disponibles'
                          }
                        </span>
                      </label>
                    </div>

                    {usarAnticipo && (
                      <div style={{ marginBottom: '0.75rem' }}>
                        <select
                          value={anticipoId}
                          onChange={e => {
                            setAnticipoId(e.target.value);
                            const ant = anticiposDisponibles.find(a => a.id === e.target.value);
                            if (ant) {
                              const maxPosible = Math.min(nota.deuda_restante, Number(ant.deuda_restante));
                              setMontoPago(String(maxPosible));
                            }
                          }}
                          className="nota-pago-select"
                          style={{ width: '100%', borderColor: '#a855f7' }}
                          required
                        >
                          <option value="">— Seleccionar Anticipo —</option>
                          {anticiposDisponibles.map(a => (
                            <option key={a.id} value={a.id}>
                              {formatFecha(a.fecha_emision)} — {a.descripcion} (Bs {fmtMonto(a.deuda_restante)})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={montoPago}
                        onChange={e => setMontoPago(e.target.value)}
                        placeholder={`Monto (máx. ${fmtMonto(nota.deuda_restante)})`}
                        className="nota-pago-input"
                        disabled={registrandoPago}
                        style={{ flex: 1 }}
                      />
                      {!usarAnticipo && (
                        <select
                          value={metodoPago}
                          onChange={e => setMetodoPago(e.target.value)}
                          disabled={registrandoPago}
                          className="nota-pago-select"
                          style={{ minWidth: '130px' }}
                        >
                          <option value="efectivo">💵 Efectivo</option>
                          <option value="transferencia">🏦 Transferencia</option>
                          <option value="qr">📱 QR</option>
                        </select>
                      )}
                    </div>

                    {!usarAnticipo && (
                      <>
                        <select
                          value={cuentaPagoId}
                          onChange={e => setCuentaPagoId(e.target.value)}
                          required
                          disabled={registrandoPago}
                          className="nota-pago-select"
                          style={{ width: '100%' }}
                        >
                          <option value="">Caja / Banco que paga</option>
                          {cajasBancos.map(c => (
                            <option key={c.id} value={c.cuenta_contable_id}>{c.nombre}</option>
                          ))}
                        </select>

                        <select
                          value={cuentaGastoId}
                          onChange={e => setCuentaGastoId(e.target.value)}
                          required
                          disabled={registrandoPago}
                          className="nota-pago-select"
                          style={{ width: '100%' }}
                        >
                          <option value="">Cuenta de gasto (5.X.X)</option>
                          {cuentasGasto.map(c => (
                            <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                          ))}
                        </select>

                        <input
                          type="text"
                          value={nroComprobante}
                          onChange={e => setNroComprobante(e.target.value)}
                          placeholder="Nro. Comprobante (opcional)"
                          className="nota-pago-input"
                          disabled={registrandoPago}
                          style={{ width: '100%' }}
                        />
                      </>
                    )}

                  {errorPago && <div className="form-msg form-msg--error" style={{ marginTop: '0.5rem' }}><AlertCircle size={13} /> {errorPago}</div>}
                  {exitoPago && <div className="form-msg form-msg--exito" style={{ marginTop: '0.5rem' }}><Check size={13} /> {exitoPago}</div>}

                  <button
                    type="submit"
                    className="btn-guardar-cuenta"
                    style={{ width: '100%', justifyContent: 'center', marginTop: '0.75rem' }}
                    disabled={registrandoPago}
                  >
                    <Check size={16} />
                    {registrandoPago ? 'Registrando...' : 'Registrar Pago'}
                  </button>
                </div>
              </form>
            )}

            {yaPagada && (
              <div style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem',
                padding: '0.75rem', background: 'rgba(74,222,128,0.1)',
                borderRadius: '8px', color: '#4ade80', fontWeight: 600
              }}>
                <CheckCircle2 size={18} />
                Esta Nota de Pago está totalmente cancelada.
              </div>
            )}
          </div>
        )}
      </div>

      <ModalDetalleMovimiento
        visible={!!movDetalleId}
        asientoId={movDetalleId}
        onCerrar={() => setMovDetalleId(null)}
      />

    </div>
  );
};


export default DetalleCxP;
