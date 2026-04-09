import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, ArrowDownRight, ArrowUpRight, DollarSign, Calendar, CreditCard, AlignLeft, Building2, Tag } from 'lucide-react';
import type { CuentaContable } from '../../types/finanzas';

interface Props {
  visible: boolean;
  tipo: 'ingreso' | 'salida';
  cajas: CuentaContable[];
  onCerrar: () => void;
  onCreado: () => void;
  setFormDirty: (dirty: boolean) => void;
  isDirty: boolean;
}

const ModalMovimientoDirecto: React.FC<Props> = ({ visible, tipo, cajas, onCerrar, onCreado, setFormDirty, isDirty }) => {
  const isIngreso = tipo === 'ingreso';

  const [cajaId, setCajaId] = useState('');
  const [contraCuentaId, setContraCuentaId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [descripcion, setDescripcion] = useState('');
  const [metodo, setMetodo] = useState('efectivo');

  const [todasLasCuentas, setTodasLasCuentas] = useState<CuentaContable[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Cargar cuentas contra-partida al abrir modal
  useEffect(() => {
    if (visible) {
      cargarContraCuentas();
      // Reset form states if needed
      setMonto('');
      setDescripcion('');
      setContraCuentaId('');
      setCajaId('');
      setFormDirty(false);
    }
  }, [visible, setFormDirty]);

  const handleInputChange = (setter: any, value: any) => {
    setter(value);
    setFormDirty(true);
  };

  const cargarContraCuentas = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    if (!perfil?.escuela_id) return;

    // Filtrar cuentas: Ingreso -> tipo 'ingreso', Salida -> tipo 'gasto'
    let query = supabase
      .from('plan_cuentas')
      .select('id, codigo, nombre, tipo')
      .or(`escuela_id.eq.${perfil.escuela_id},escuela_id.is.null`)
      .eq('es_transaccional', true);
    
    if (isIngreso) {
      query = query.eq('tipo', 'ingreso');
    } else {
      query = query.eq('tipo', 'gasto');
    }

    const { data } = await query.order('codigo');

    if (data) setTodasLasCuentas(data as CuentaContable[]);
  };

  if (!visible) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    
    if (!cajaId) return setError('Seleccione una Caja o Banco.');
    if (!contraCuentaId) return setError('Seleccione la cuenta concepto/destino.');
    if (cajaId === contraCuentaId) return setError('La caja y la cuenta destino no pueden ser la misma.');
    
    const valorMonto = parseFloat(monto);
    if (isNaN(valorMonto) || valorMonto <= 0) return setError('Ingrese un monto válido mayor a 0.');
    if (!fecha) return setError('Debe seleccionar una fecha.');

    setGuardando(true);

    try {
      // 1. Sesión
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      const escuelaId = perfil?.escuela_id;
      if (!escuelaId) throw new Error('No se pudo determinar la escuela.');

      // 2. Cabecera (Asiento contable)
      const { data: asiento, error: errAsiento } = await supabase.from('asientos_contables').insert({
        escuela_id: escuelaId,
        usuario_id: user.id,
        fecha,
        descripcion,
        metodo_pago: metodo
      }).select().single();

      if (errAsiento || !asiento) throw new Error('Error al registrar el comprobante.');

      // 3. Movimientos (Partida doble)
      // Ingreso: Caja (Debe) , Contra-cuenta (Haber)
      // Salida:  Caja (Haber), Contra-cuenta (Debe)
      
      const cajaMov = {
        escuela_id: escuelaId,
        asiento_id: asiento.id,
        cuenta_contable_id: cajaId,
        debe: isIngreso ? valorMonto : 0,
        haber: isIngreso ? 0 : valorMonto,
        conciliado: false
      };

      const contraMov = {
        escuela_id: escuelaId,
        asiento_id: asiento.id,
        cuenta_contable_id: contraCuentaId,
        debe: isIngreso ? 0 : valorMonto,
        haber: isIngreso ? valorMonto : 0,
        conciliado: false
      };

      const { error: errMovs } = await supabase.from('movimientos_contables').insert([cajaMov, contraMov]);
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
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: isIngreso ? '#00D26A' : '#0A84FF', fontSize: '1.4rem', fontWeight: 700 }}>
            {isIngreso ? <ArrowDownRight size={26} /> : <ArrowUpRight size={26} />}
            {isIngreso ? 'Nuevo Ingreso de Dinero' : 'Nueva Salida / Gasto'}
          </h2>
          <button className="btn-close" onClick={onCerrar} disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body form-grid" style={{ gap: '1.2rem' }}>
          {error && <div className="form-msg form-msg--error">{error}</div>}

          {/* Selector de Caja / Banco */}
          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Caja o Banco</label>
            <select value={cajaId} onChange={e => handleInputChange(setCajaId, e.target.value)} required disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="">Seleccione cuenta...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          {/* Selector de Contra Cuenta */}
          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Concepto de {isIngreso ? 'Ingreso' : 'Salida'}</label>
            <select value={contraCuentaId} onChange={e => handleInputChange(setContraCuentaId, e.target.value)} required disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="">Seleccione concepto...</option>
              {todasLasCuentas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="form-campo" style={{ marginBottom: '0.5rem' }}>
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Monto (Bs)</label>
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
            <label style={{ color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.8rem', marginBottom: '0px' }}>Método de {isIngreso ? 'Cobro' : 'Pago'}</label>
            <select value={metodo} onChange={e => handleInputChange(setMetodo, e.target.value)} disabled={guardando} style={{ padding: '0.7rem' }}>
              <option value="efectivo">Efectivo</option>
              <option value="qr">QR</option>
              <option value="transferencia">Transferencia</option>
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
              maxLength={255}
            />
          </div>

          <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1.5rem', borderTop: '1px solid var(--border-light)', paddingTop: '1.5rem', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button type="button" className="btn-cancelar" onClick={onCerrar} disabled={guardando} style={{ padding: '0.75rem 1.5rem' }}>Cancelar</button>
            <button 
                type="submit" 
                className="btn-guardar-cuenta" 
                disabled={guardando}
                style={{ 
                  background: isIngreso ? '#00D26A' : '#0A84FF', 
                  borderColor: isIngreso ? '#00D26A' : '#0A84FF',
                  padding: '0.75rem 2rem',
                  fontWeight: 600,
                  boxShadow: `0 4px 12px ${isIngreso ? 'rgba(0,210,106,0.3)' : 'rgba(10,132,255,0.3)'}`
                }}
              >
              {guardando ? 'Registrando...' : (isIngreso ? 'Confirmar Ingreso' : 'Confirmar Salida')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalMovimientoDirecto;
