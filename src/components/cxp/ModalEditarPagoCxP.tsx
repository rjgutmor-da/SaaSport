/**
 * ModalEditarPagoCxP.tsx
 * Modal para editar un pago de CxP con el mismo estilo que el formulario de creación.
 * Muestra: fecha, monto, caja/banco de salida y nro. comprobante.
 */
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Check, AlertCircle, CreditCard, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getHoraLocal } from '../../lib/dateUtils';
import type { CajaBanco } from '../../types/finanzas';

interface Props {
  visible: boolean;
  pago: {
    id: string;
    monto_aplicado: number;
    fecha: string;
    referencia?: string;
    caja_id?: string;
    caja_nombre?: string;
    es_aplicacion_anticipo?: boolean;
  } | null;
  cajas: CajaBanco[];
  onCerrar: () => void;
  onActualizar: () => void;
}

const ModalEditarPagoCxP: React.FC<Props> = ({ visible, pago, cajas, onCerrar, onActualizar }) => {
  const [fecha, setFecha] = useState('');
  const [monto, setMonto] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [referencia, setReferencia] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  // Precargar datos del pago al abrir
  useEffect(() => {
    if (visible && pago) {
      // Extraer fecha en formato YYYY-MM-DD local (evitar desfase UTC)
      const d = new Date(pago.fecha);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setFecha(`${yyyy}-${mm}-${dd}`);
      setMonto(String(pago.monto_aplicado));
      setCajaId(pago.caja_id || '');
      setReferencia(pago.referencia || '');
      setError('');
      setExito('');
    }
  }, [visible, pago]);

  if (!visible || !pago) return null;

  const esAnticipo = pago.es_aplicacion_anticipo;

  const guardar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) {
      setError('Ingrese un monto válido mayor a 0.');
      return;
    }
    if (!fecha) {
      setError('Seleccione una fecha.');
      return;
    }
    if (!esAnticipo && !cajaId) {
      setError('Seleccione la caja o banco.');
      return;
    }

    setGuardando(true);
    setError('');

    try {
      const { data, error: rpcErr } = await supabase.rpc('rpc_editar_movimiento_simple', {
        p_payload: {
          movimiento_id: pago.id,
          tipo_origen: 'pago',
          cuenta_id: cajaId || null,
          monto: valorMonto,
          fecha: new Date(`${fecha}T${getHoraLocal()}:00`).toISOString(),
          descripcion: referencia.trim() || 'Pago CxP',
          nro_transaccion: referencia.trim() || null,
        }
      });

      if (rpcErr) throw new Error(rpcErr.message);
      if (data && data.success === false) throw new Error(data.message);

      setExito('✅ Pago actualizado correctamente.');
      setTimeout(() => {
        onActualizar();
      }, 1000);
    } catch (err: any) {
      setError(err.message || 'Error al guardar');
      setGuardando(false);
    }
  };

  return ReactDOM.createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={e => { e.stopPropagation(); if (!guardando) onCerrar(); }}
    >
      <div
        style={{
          background: 'var(--bg-surface, #1e2535)',
          borderRadius: '14px',
          maxWidth: '460px',
          width: '95vw',
          border: '1px solid var(--border, rgba(255,255,255,0.08))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '1rem 1.5rem',
          borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <CreditCard size={18} style={{ color: 'var(--secondary, #38bdf8)' }} />
            <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text-primary, #fff)' }}>
              Editar Pago
            </h2>
          </div>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onCerrar(); }}
            disabled={guardando}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary, #94a3b8)', padding: '0.25rem', borderRadius: '6px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Formulario — mismo estilo que "Registrar Pago" */}
        <div style={{ padding: '1.25rem 1.5rem' }}>

          {/* Anticipo — solo informativo, no editable */}
          {esAnticipo && (
            <div style={{
              padding: '0.6rem 0.9rem', marginBottom: '1rem',
              background: 'rgba(168,85,247,0.1)', borderRadius: '8px',
              border: '1px solid rgba(168,85,247,0.2)',
              fontSize: '0.82rem', color: '#a855f7', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}>
              🔄 Este pago es una aplicación de anticipo — solo puede editarse la fecha y el monto.
            </div>
          )}

          {/* Fila: Fecha + Monto */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #94a3b8)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Fecha Pago
              </label>
              <input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                onClick={e => e.stopPropagation()}
                disabled={guardando}
                className="nota-pago-input"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #94a3b8)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Monto (Bs)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                onClick={e => e.stopPropagation()}
                disabled={guardando}
                placeholder="0.00"
                className="nota-pago-input"
                style={{ width: '100%', fontWeight: 700 }}
              />
            </div>
          </div>

          {/* Caja / Banco — solo si no es anticipo */}
          {!esAnticipo && (
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #94a3b8)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Caja / Banco de Salida
              </label>
              <select
                value={cajaId}
                onChange={e => setCajaId(e.target.value)}
                onClick={e => e.stopPropagation()}
                disabled={guardando}
                className="nota-pago-select"
                style={{ width: '100%' }}
              >
                <option value="">— Seleccionar —</option>
                {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}

          {/* Nro. Comprobante / Referencia */}
          {!esAnticipo && (
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #94a3b8)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Referencia / Nro. Comprobante
              </label>
              <input
                type="text"
                value={referencia}
                onChange={e => setReferencia(e.target.value)}
                onClick={e => e.stopPropagation()}
                disabled={guardando}
                placeholder="Ej: Transf-123, Recibo-456..."
                className="nota-pago-input"
                style={{ width: '100%' }}
              />
            </div>
          )}

          {/* Mensajes */}
          {error && (
            <div className="form-msg form-msg--error" style={{ marginBottom: '0.75rem' }}>
              <AlertCircle size={13} /> {error}
            </div>
          )}
          {exito && (
            <div className="form-msg form-msg--exito" style={{ marginBottom: '0.75rem' }}>
              <Check size={13} /> {exito}
            </div>
          )}

          {/* Botones */}
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onCerrar(); }}
              disabled={guardando}
              className="btn-refrescar"
              style={{ flex: 1, justifyContent: 'center' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={guardar}
              disabled={guardando || !!exito}
              className="btn-guardar-cuenta"
              style={{ flex: 2, justifyContent: 'center' }}
            >
              {guardando
                ? <><RefreshCw size={15} className="spin" /> Guardando...</>
                : <><Check size={15} /> Guardar Cambios</>
              }
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalEditarPagoCxP;
