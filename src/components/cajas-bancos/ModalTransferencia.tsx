import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, ArrowRightLeft, DollarSign, Calendar, CreditCard, AlignLeft, Building2 } from 'lucide-react';
import type { CuentaContable } from '../../types/finanzas';

interface Props {
  visible: boolean;
  cajas: CuentaContable[];
  onCerrar: () => void;
  onCreado: () => void;
  setFormDirty: (dirty: boolean) => void;
}

const ModalTransferencia: React.FC<Props> = ({ visible, cajas, onCerrar, onCreado, setFormDirty }) => {
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('Transferencia interna');
  const [metodo, setMetodo] = useState('transferencia');
  
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (setter: any, value: any) => {
    setter(value);
    setFormDirty(true);
  };

  React.useEffect(() => {
    if (visible) {
      setOrigenId('');
      setDestinoId('');
      setMonto('');
      setDescripcion('Transferencia interna');
      setFormDirty(false);
    }
  }, [visible, setFormDirty]);

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!origenId || !destinoId) return setError('Debe seleccionar origen y destino.');
    if (origenId === destinoId) return setError('La cuenta origen y destino no pueden ser la misma.');
    
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) return setError('Ingrese un monto válido mayor a 0.');
    if (!fecha) return setError('Debe seleccionar una fecha.');

    setGuardando(true);

    try {
      // 1. Obtener datos sesión y escuela
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      
      const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      const escuelaId = perfil?.escuela_id;
      if (!escuelaId) throw new Error('No se pudo determinar la escuela.');

      // 2. Crear asiento contable (la cabecera)
      const { data: asiento, error: errAsiento } = await supabase.from('asientos_contables').insert({
        escuela_id: escuelaId,
        usuario_id: user.id,
        fecha,
        descripcion,
        metodo_pago: metodo
      }).select().single();

      if (errAsiento || !asiento) throw new Error('Error al registrar el comprobante: ' + (errAsiento?.message || 'Error desconocido'));

      // 3. Crear movimientos (Origen -> sale dinero -> Haber, Destino -> entra dinero -> Debe)
      const { error: errMovs } = await supabase.from('movimientos_contables').insert([
        { // Salida origen
          escuela_id: escuelaId,
          asiento_id: asiento.id,
          cuenta_contable_id: origenId,
          debe: 0,
          haber: valorMonto,
          conciliado: false
        },
        { // Entrada destino
          escuela_id: escuelaId,
          asiento_id: asiento.id,
          cuenta_contable_id: destinoId,
          debe: valorMonto,
          haber: 0,
          conciliado: false
        }
      ]);

      if (errMovs) throw new Error('Error al registrar los movimientos: ' + errMovs.message);

      setFormDirty(false);
      onCreado();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth: '500px' }}>
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: '#0A84FF', fontSize: '1.4rem', fontWeight: 700 }}>
            <ArrowRightLeft size={26} />
            Transferencia entre Cuentas
          </h2>
          <button className="btn-close" onClick={onCerrar} disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body form-grid" style={{ gap: '1.2rem' }}>
          {error && <div className="form-msg form-msg--error">{error}</div>}

          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Cuenta Origen</label>
            <select value={origenId} onChange={e => handleInputChange(setOrigenId, e.target.value)} required disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="">Seleccione origen...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Cuenta Destino</label>
            <select value={destinoId} onChange={e => handleInputChange(setDestinoId, e.target.value)} required disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="">Seleccione destino...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Monto a Transferir (Bs)</label>
            <input 
              type="number" 
              step="0.01" 
              min="0.01"
              value={monto} 
              onChange={e => handleInputChange(setMonto, e.target.value)} 
              required 
              disabled={guardando} 
              placeholder="0.00"
              style={{ padding: '0.7rem' }}
            />
          </div>

          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Fecha</label>
            <input 
              type="date" 
              value={fecha} 
              onChange={e => handleInputChange(setFecha, e.target.value)} 
              required 
              disabled={guardando} 
              style={{ padding: '0.7rem' }}
            />
          </div>

          <div className="form-campo" style={{ gridColumn: '1 / -1', marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Método de Transferencia</label>
            <select value={metodo} onChange={e => handleInputChange(setMetodo, e.target.value)} disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="transferencia">Transferencia Bancaria</option>
              <option value="efectivo">Efectivo</option>
              <option value="qr">Código QR</option>
            </select>
          </div>

          <div className="form-campo" style={{ gridColumn: '1 / -1', marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Observaciones</label>
            <textarea 
              value={descripcion} 
              onChange={e => handleInputChange(setDescripcion, e.target.value)} 
              required 
              disabled={guardando} 
              placeholder=""
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border)', minHeight: '80px', resize: 'vertical', fontSize: '0.9rem' }}
            />
          </div>

          <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1.5rem', borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button type="button" className="btn-cancelar" onClick={onCerrar} disabled={guardando} style={{ padding: '0.75rem 1.5rem' }}>Cancelar</button>
            <button 
              type="submit" 
              className="btn-guardar-cuenta" 
              disabled={guardando}
              style={{ 
                background: '#0A84FF', 
                borderColor: '#0A84FF',
                padding: '0.75rem 2rem',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(10,132,255,0.3)'
              }}
            >
              {guardando ? 'Transfiriendo...' : 'Confirmar Transferencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalTransferencia;
