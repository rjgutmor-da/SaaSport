/**
 * ModalEditarMovimiento.tsx
 * Modal para editar un movimiento existente de Cajas y Bancos.
 * Solo permite edición si el movimiento NO está conciliado.
 */
import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, Pencil, DollarSign, Calendar, Hash, AlignLeft, Building2, AlertCircle, Save, RefreshCw, Check } from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';
import type { CajaBanco } from '../../types/finanzas';

interface MovimientoExtendido {
  id: string;
  debe: number;
  haber: number;
  fecha: string;
  descripcion: string;
  nro_transaccion: string;
  asiento_id: string;
  cuenta_id: string;
  cuenta_nombre: string;
  conciliado: boolean;
}

interface Props {
  visible: boolean;
  movimiento: MovimientoExtendido | null;
  cajas: CajaBanco[];
  onCerrar: () => void;
  onGuardado: () => void;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ModalEditarMovimiento: React.FC<Props> = ({ visible, movimiento, cajas, onCerrar, onGuardado }) => {
  const [descripcion, setDescripcion] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState('');
  const [nroTransaccion, setNroTransaccion] = useState('');
  const [cajaId, setCajaId] = useState('');

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // Precargar datos del movimiento al abrir
  useEffect(() => {
    if (visible && movimiento) {
      setDescripcion(movimiento.descripcion);
      const montoOriginal = movimiento.debe > 0 ? movimiento.debe : movimiento.haber;
      setMonto(String(montoOriginal));
      setFecha(movimiento.fecha ? movimiento.fecha.split('T')[0] : getHoyISO());
      setNroTransaccion(movimiento.nro_transaccion || '');
      setCajaId(movimiento.cuenta_id);
      setError(null);
      setExito(null);
    }
  }, [visible, movimiento]);

  if (!visible || !movimiento) return null;

  const esIngreso = movimiento.debe > 0;

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) { setError('Ingrese un monto válido mayor a 0.'); return; }
    if (!fecha) { setError('Debe seleccionar una fecha.'); return; }
    if (!descripcion.trim()) { setError('Ingrese una descripción.'); return; }
    setGuardando(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      let userRol = '';
      if (user) {
        const { data: usrData } = await supabase.from('usuarios').select('rol').eq('id', user.id).single();
        userRol = usrData?.rol || '';
      }

      const { data, error: rpcErr } = await supabase.rpc('rpc_editar_movimiento_financiero', {
        p_payload: {
          movimiento_id: movimiento.id,
          cuenta_id: cajaId,
          monto: valorMonto,
          fecha: fecha,
          descripcion: descripcion.trim(),
          nro_transaccion: nroTransaccion.trim() || null,
          rol_usuario: userRol
        }
      });

      if (rpcErr) throw new Error(rpcErr.message);
      if (data && data.success === false) throw new Error(data.message);

      setExito('✅ Movimiento actualizado correctamente.');
      setTimeout(() => { onGuardado(); }, 1200);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{
              background: 'rgba(168, 133, 255, 0.15)',
              color: '#A885FF'
            }}>
              <Pencil size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Editar Movimiento</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {esIngreso ? 'Ingreso' : 'Egreso'} — {movimiento.cuenta_nombre}
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <form onSubmit={handleGuardar} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ padding: '0.5rem 0' }}>
            {/* Caja o Banco */}
            <div className="form-campo full-width">
              <label><Building2 size={14} /> Caja o Banco</label>
              <select value={cajaId} onChange={e => setCajaId(e.target.value)} disabled={guardando}>
                {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>

            {/* Monto */}
            <div className="form-campo">
              <label><DollarSign size={14} /> Monto (Bs) *</label>
              <input
                type="number" step="0.01" min="0.01"
                value={monto}
                onChange={e => setMonto(e.target.value)}
                required disabled={guardando}
                style={{ fontSize: '1.1rem', fontWeight: 700, color: esIngreso ? 'var(--success)' : 'var(--danger)' }}
              />
            </div>

            {/* Fecha */}
            <div className="form-campo">
              <label><Calendar size={14} /> Fecha *</label>
              <input type="date" value={fecha} onChange={e => setFecha(e.target.value)} required disabled={guardando} />
            </div>

            {/* Nro Transacción */}
            <div className="form-campo full-width">
              <label><Hash size={14} /> Nro. Transacción / Recibo</label>
              <input
                type="text"
                value={nroTransaccion}
                onChange={e => setNroTransaccion(e.target.value)}
                disabled={guardando}
                placeholder="Ej: 00123, REC-001..."
              />
            </div>

            {/* Descripción */}
            <div className="form-campo full-width">
              <label><AlignLeft size={14} /> Descripción *</label>
              <textarea
                value={descripcion}
                onChange={e => setDescripcion(e.target.value)}
                required disabled={guardando}
                maxLength={255}
                style={{ resize: 'vertical', minHeight: '60px' }}
              />
            </div>
          </div>

          {error && (
            <div className="form-msg form-msg--error" style={{ margin: '1rem 0' }}>
              <AlertCircle size={18} /> {error}
            </div>
          )}

          {exito && (
            <div className="form-msg form-msg--exito" style={{ margin: '1rem 0' }}>
              <Check size={18} /> {exito}
            </div>
          )}

          <div className="cxc-modal-footer" style={{
            marginTop: '1.5rem',
            paddingTop: '1.25rem',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '1rem'
          }}>
            <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-guardar-cuenta"
              disabled={guardando || !!exito}
              style={{ padding: '0.6rem 2rem', background: '#A885FF', borderColor: '#A885FF' }}
            >
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> Guardando... </>
              ) : (
                <> <Save size={16} /> Guardar Cambios </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalEditarMovimiento;
