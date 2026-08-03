/**
 * ModalEditarCobroCxC.tsx
 * Modal para editar un cobro de CxC con el mismo estilo que el formulario de registro de cobro.
 * Campos: fecha, monto, caja/banco de entrada, referencia/comprobante.
 * Usa ReactDOM.createPortal para evitar conflictos con overlays anidados.
 */
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { X, Check, AlertCircle, DollarSign, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { getHoraLocal, buildTimestampLocal, FECHA_MINIMA_MOVIMIENTO_FINANCIERO, validarFechaMovimientoFinanciero } from '../../lib/dateUtils';
import type { CajaBanco } from '../../types/finanzas';

interface Props {
  visible: boolean;
  cobro: {
    id: string;
    monto_aplicado: number;
    fecha: string;
    documento_referencia?: string;
    caja_id?: string;
    caja_nombre?: string;
    es_aplicacion_anticipo?: boolean;
  } | null;
  cajas: CajaBanco[];
  fechaEmisionNota?: string;
  descripcionNota?: string;
  onCerrar: () => void;
  onActualizar: () => void;
}

const ModalEditarCobroCxC: React.FC<Props> = ({ visible, cobro, cajas, fechaEmisionNota, descripcionNota, onCerrar, onActualizar }) => {
  const [fecha, setFecha] = useState('');
  const [monto, setMonto] = useState('');
  const [cajaId, setCajaId] = useState('');
  const [referencia, setReferencia] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState('');

  // Precargar datos del cobro al abrir
  useEffect(() => {
    if (visible && cobro) {
      // Extraer fecha en formato YYYY-MM-DD local (evitar desfase UTC)
      const d = new Date(cobro.fecha);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      setFecha(`${yyyy}-${mm}-${dd}`);
      setMonto(String(cobro.monto_aplicado));
      setCajaId(cobro.caja_id || '');
      setReferencia(cobro.documento_referencia || '');
      setError('');
      setExito('');
    }
  }, [visible, cobro]);

  if (!visible || !cobro) return null;

  const esAnticipo = cobro.es_aplicacion_anticipo;

  const guardar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) {
      setError('Ingrese un monto válido mayor a 0.');
      return;
    }
    const errorFecha = validarFechaMovimientoFinanciero(fecha);
    if (errorFecha) {
      setError(errorFecha);
      return;
    }
    if (fechaEmisionNota) {
      const fNotaSoloFecha = fechaEmisionNota.split('T')[0];
      if (fecha < fNotaSoloFecha) {
        setError(`La fecha del cobro no puede ser anterior a la fecha de emisión de la Nota de Servicio (${fNotaSoloFecha}).`);
        return;
      }
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
          movimiento_id: cobro.id,
          tipo_origen: 'cobro',
          cuenta_id: cajaId || null,
          monto: valorMonto,
          fecha: buildTimestampLocal(fecha, getHoraLocal()),
          descripcion: descripcionNota || 'Cobro CxC',
          nro_transaccion: referencia.trim() || null,
        }
      });

      if (rpcErr) throw new Error(rpcErr.message);
      if (data && data.success === false) throw new Error(data.message);

      setExito('✅ Cobro actualizado correctamente.');
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
            <DollarSign size={18} style={{ color: '#4ade80' }} />
            <h2 style={{ fontSize: '1.1rem', margin: 0, color: 'var(--text-primary, #fff)' }}>
              Editar Cobro
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

        {/* Formulario */}
        <div style={{ padding: '1.25rem 1.5rem' }}>

          {/* Aviso de anticipo */}
          {esAnticipo && (
            <div style={{
              padding: '0.6rem 0.9rem', marginBottom: '1rem',
              background: 'rgba(168,85,247,0.1)', borderRadius: '8px',
              border: '1px solid rgba(168,85,247,0.2)',
              fontSize: '0.82rem', color: '#a855f7', fontWeight: 600,
              display: 'flex', alignItems: 'center', gap: '0.4rem'
            }}>
              🔄 Cobro por aplicación de anticipo — solo puede editarse la fecha y el monto.
            </div>
          )}

          {/* Fecha + Monto */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: '0.75rem', color: 'var(--text-tertiary, #94a3b8)', display: 'block', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Fecha Cobro
              </label>
              <input
                type="date"
                value={fecha}
                min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO}
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
                Caja / Banco de Entrada
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

          {/* Referencia / Nro. Comprobante */}
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
              style={{ flex: 2, justifyContent: 'center', gap: '0.4rem' }}
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

export default ModalEditarCobroCxC;
