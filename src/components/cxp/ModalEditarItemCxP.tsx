import React, { useState } from 'react';
import ReactDOM from 'react-dom';
import { X, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  visible: boolean;
  item: any;
  notaId: string;
  onCerrar: () => void;
  onActualizar: () => void;
}

const ModalEditarItemCxP: React.FC<Props> = ({ visible, item, notaId, onCerrar, onActualizar }) => {
  const [cantidad, setCantidad] = useState<number>(item?.cantidad || 1);
  const [precioUnitario, setPrecioUnitario] = useState<string>(String(item?.precio_unitario || 0));
  const [descripcion, setDescripcion] = useState<string>(item?.descripcion || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  if (!visible || !item) return null;

  const guardar = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const cant = Number(cantidad);
    const prec = parseFloat(precioUnitario);
    if (cant <= 0 || isNaN(prec) || prec < 0) {
      setError('Cantidad o precio inválidos.');
      return;
    }

    setGuardando(true);
    setError('');

    try {
      // 1. Actualizar el ítem en cxp_detalle
      const { error: errUpdate } = await supabase
        .from('cxp_detalle')
        .update({ cantidad: cant, precio_unitario: prec, descripcion: descripcion || null })
        .eq('id', item.id);

      if (errUpdate) throw errUpdate;

      // 2. Recalcular monto_total de la nota (subtotal es columna generada)
      const { data: allItems, error: errItems } = await supabase
        .from('cxp_detalle')
        .select('subtotal')
        .eq('cuenta_pagar_id', notaId);

      if (errItems) throw errItems;

      const nuevoTotal = (allItems || []).reduce((acc, curr) => acc + Number(curr.subtotal || 0), 0);

      // 3. Obtener total pagado para recalcular estado
      const { data: pagos, error: errPagos } = await supabase
        .from('pagos_aplicados')
        .select('monto_aplicado')
        .eq('cuenta_pagar_id', notaId);

      if (errPagos) throw errPagos;

      const totalPagado = (pagos || []).reduce((acc, curr) => acc + Number(curr.monto_aplicado || 0), 0);

      let nuevoEstado = 'pendiente';
      if (nuevoTotal > 0 && totalPagado >= nuevoTotal) nuevoEstado = 'pagada';
      else if (totalPagado > 0) nuevoEstado = 'parcial';

      const { error: errNota } = await supabase
        .from('cuentas_pagar')
        .update({ monto_total: nuevoTotal, estado: nuevoEstado })
        .eq('id', notaId);

      if (errNota) throw errNota;

      onActualizar();
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
      onClick={e => { e.stopPropagation(); onCerrar(); }}
    >
      <div
        style={{
          background: 'var(--bg-surface, #1e2535)',
          borderRadius: '14px',
          maxWidth: '420px',
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
          <h2 style={{ fontSize: '1.15rem', margin: 0, color: 'var(--text-primary, #fff)' }}>
            Editar Ítem
          </h2>
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onCerrar(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary, #94a3b8)', padding: '0.25rem', borderRadius: '6px' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Cuerpo */}
        <div style={{ padding: '1.5rem' }}>
          <p style={{ fontWeight: 700, marginBottom: '1.25rem', color: 'var(--text-primary, #fff)', fontSize: '1.05rem' }}>
            {item.nombre}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-campo">
              <label>Cantidad</label>
              <input
                type="number"
                min="1"
                value={cantidad}
                onChange={e => setCantidad(Number(e.target.value))}
                onClick={e => e.stopPropagation()}
              />
            </div>
            <div className="form-campo">
              <label>Precio Unit. (Bs)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={precioUnitario}
                onChange={e => setPrecioUnitario(e.target.value)}
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>

          <div className="form-campo" style={{ marginBottom: '1.25rem' }}>
            <label>Descripción / Detalle</label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              onClick={e => e.stopPropagation()}
              placeholder="Opcional..."
            />
          </div>

          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            marginBottom: '1.25rem', padding: '0.75rem',
            background: 'rgba(255,255,255,0.03)', borderRadius: '8px',
          }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary, #94a3b8)' }}>Subtotal:</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary, #f59e0b)' }}>
              Bs {(cantidad * (parseFloat(precioUnitario) || 0)).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {error && (
            <div className="form-msg form-msg--error" style={{ marginBottom: '1rem' }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <button
            type="button"
            onClick={guardar}
            disabled={guardando}
            className="btn-guardar-cuenta"
            style={{ width: '100%', justifyContent: 'center', gap: '0.5rem' }}
          >
            <Check size={16} />
            {guardando ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ModalEditarItemCxP;
