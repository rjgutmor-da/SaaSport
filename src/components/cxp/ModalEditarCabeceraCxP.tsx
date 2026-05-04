import React, { useState } from 'react';
import { X, Check, AlertCircle } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

interface Props {
  visible: boolean;
  nota: any;
  onCerrar: () => void;
  onActualizar: () => void;
}

const ModalEditarCabeceraCxP: React.FC<Props> = ({ visible, nota, onCerrar, onActualizar }) => {
  const [fechaEmision, setFechaEmision] = useState(nota.fecha_emision ? nota.fecha_emision.split('T')[0] : '');
  const [fechaVencimiento, setFechaVencimiento] = useState(nota.fecha_vencimiento ? nota.fecha_vencimiento.split('T')[0] : '');
  const [observaciones, setObservaciones] = useState(nota.observaciones || '');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');

  if (!visible || !nota) return null;

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError('');

    try {
      const { error: errUpdate } = await supabase.from('cuentas_pagar')
        .update({
          fecha_emision: fechaEmision,
          fecha_vencimiento: fechaVencimiento || null,
          observaciones: observaciones || null
        })
        .eq('id', nota.id);
      
      if (errUpdate) throw errUpdate;

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
          <h2 style={{ fontSize: '1.2rem', margin: 0 }}>Editar Cabecera</h2>
          <button onClick={onCerrar}><X size={18} /></button>
        </div>
        <form onSubmit={guardar} style={{ padding: '1.5rem' }}>
          
          <div className="form-campo" style={{ marginBottom: '1rem' }}>
            <label>Fecha Emisión</label>
            <input type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} required />
          </div>

          <div className="form-campo" style={{ marginBottom: '1rem' }}>
            <label>Fecha Vencimiento (Opcional)</label>
            <input type="date" value={fechaVencimiento} onChange={e => setFechaVencimiento(e.target.value)} />
          </div>
          
          <div className="form-campo" style={{ marginBottom: '1.5rem' }}>
            <label>Observaciones / Glosa</label>
            <textarea value={observaciones} onChange={e => setObservaciones(e.target.value)} placeholder="Opcional..." rows={3} style={{ width: '100%', resize: 'none' }}></textarea>
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

export default ModalEditarCabeceraCxP;
