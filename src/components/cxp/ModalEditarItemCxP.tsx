import React, { useState } from 'react';
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
  const [cantidad, setCantidad] = useState<number>(item.cantidad || 1);
  const [precioUnitario, setPrecioUnitario] = useState<string>(String(item.precio_unitario || 0));
  const [descripcion, setDescripcion] = useState(item.descripcion || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  if (!visible || !item) return null;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    const cant = Number(cantidad);
    const prec = parseFloat(precioUnitario);
    if (cant <= 0 || prec < 0) {
      setError('Cantidad o precio inválidos.');
      return;
    }

    setGuardando(true);
    setError('');

    try {
      // 1. Actualizar el ítem
      const { error: errUpdate } = await supabase.from('cxp_detalle')
        .update({
          cantidad: cant,
          precio_unitario: prec,
          descripcion: descripcion || null
        })
        .eq('id', item.id);
      
      if (errUpdate) throw errUpdate;

      // 2. Recalcular el monto_total de la nota
      const { data: allItems, error: errItems } = await supabase.from('cxp_detalle')
        .select('subtotal')
        .eq('cuenta_pagar_id', notaId);
      
      if (errItems) throw errItems;

      const nuevoTotal = allItems.reduce((acc, curr) => acc + Number(curr.subtotal || 0), 0);

      // 3. Obtener el monto pagado para recalcular el estado
      const { data: pagos, error: errPagos } = await supabase.from('pagos_aplicados')
        .select('monto_aplicado')
        .eq('cuenta_pagar_id', notaId);
      
      if (errPagos) throw errPagos;
      
      const totalPagado = pagos.reduce((acc, curr) => acc + Number(curr.monto_aplicado || 0), 0);
      
      let nuevoEstado = 'pendiente';
      if (totalPagado >= nuevoTotal && nuevoTotal > 0) nuevoEstado = 'pagada';
      else if (totalPagado > 0) nuevoEstado = 'parcial';

      const { error: errNota } = await supabase.from('cuentas_pagar')
        .update({ monto_total: nuevoTotal, estado: nuevoEstado })
        .eq('id', notaId);

      if (errNota) throw errNota;

      onActualizar();
      onCerrar();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div className="cxc-modal" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header" style={{ padding: '1rem 1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Editar Ítem</h2>
          <button onClick={onCerrar}><X size={18} /></button>
        </div>
        <form onSubmit={guardar} style={{ padding: '1.5rem' }}>
          <p style={{ fontWeight: 600, marginBottom: '1rem', color: 'var(--text-primary)' }}>{item.nombre}</p>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-campo">
              <label>Cantidad</label>
              <input type="number" min="1" value={cantidad} onChange={e => setCantidad(Number(e.target.value))} required />
            </div>
            <div className="form-campo">
              <label>Precio Unit. (Bs)</label>
              <input type="number" step="0.01" value={precioUnitario} onChange={e => setPrecioUnitario(e.target.value)} required />
            </div>
          </div>
          
          <div className="form-campo" style={{ marginBottom: '1.5rem' }}>
            <label>Descripción / Detalle</label>
            <input type="text" value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Opcional..." />
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', padding: '0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Subtotal:</span>
            <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary)' }}>
              Bs {(cantidad * (parseFloat(precioUnitario) || 0)).toLocaleString('es-BO', { minimumFractionDigits: 2 })}
            </span>
          </div>

          {error && <div className="form-msg form-msg--error" style={{ marginBottom: '1rem' }}><AlertCircle size={14} /> {error}</div>}
          
          <button type="submit" className="btn-guardar-cuenta" style={{ width: '100%', justifyContent: 'center' }} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar Cambios'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ModalEditarItemCxP;
