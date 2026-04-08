import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, ArrowRightLeft, DollarSign, Calendar, CreditCard, AlignLeft, Building2 } from 'lucide-react';
import type { CuentaContable } from '../../types/finanzas';

interface Props {
  visible: boolean;
  cajas: CuentaContable[];
  onCerrar: () => void;
  onCreado: () => void;
}

const ModalTransferencia: React.FC<Props> = ({ visible, cajas, onCerrar, onCreado }) => {
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('Transferencia interna');
  const [metodo, setMetodo] = useState('transferencia');
  
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ArrowRightLeft size={20} className="text-brand" />
            Transferencia entre Cuentas
          </h2>
          <button className="btn-close" onClick={onCerrar} disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body form-grid">
          {error && <div className="form-msg form-msg--error">{error}</div>}

          <div className="form-campo">
            <label><Building2 size={16}/> Cuenta Origen (Sale)</label>
            <select value={origenId} onChange={e => setOrigenId(e.target.value)} required disabled={guardando}>
              <option value="">Seleccione origen...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="form-campo">
            <label><Building2 size={16}/> Cuenta Destino (Entra)</label>
            <select value={destinoId} onChange={e => setDestinoId(e.target.value)} required disabled={guardando}>
              <option value="">Seleccione destino...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          <div className="form-campo">
            <label><DollarSign size={16}/> Monto a Transferir (Bs)</label>
            <input 
              type="number" 
              step="0.01" 
              min="0.01"
              value={monto} 
              onChange={e => setMonto(e.target.value)} 
              required 
              disabled={guardando} 
              placeholder="0.00"
            />
          </div>

          <div className="form-campo">
            <label><Calendar size={16}/> Fecha</label>
            <input 
              type="date" 
              value={fecha} 
              onChange={e => setFecha(e.target.value)} 
              required 
              disabled={guardando} 
            />
          </div>

          <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
            <label><CreditCard size={16}/> Método de Transferencia</label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)} disabled={guardando}>
              <option value="transferencia">Transferencia Bancaria</option>
              <option value="efectivo">Efectivo</option>
              <option value="qr">Código QR</option>
            </select>
          </div>

          <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
            <label><AlignLeft size={16}/> Descripción / Glosa</label>
            <input 
              type="text" 
              value={descripcion} 
              onChange={e => setDescripcion(e.target.value)} 
              required 
              disabled={guardando} 
              placeholder="Ej: Traspaso para caja chica"
            />
          </div>

          <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
            <button type="button" className="btn-cancelar" onClick={onCerrar} disabled={guardando}>Cancelar</button>
            <button type="submit" className="btn-guardar-cuenta" disabled={guardando}>
              {guardando ? 'Transfiriendo...' : 'Confirmar Transferencia'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalTransferencia;
