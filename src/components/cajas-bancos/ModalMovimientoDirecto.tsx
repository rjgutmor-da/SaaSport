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
}

const ModalMovimientoDirecto: React.FC<Props> = ({ visible, tipo, cajas, onCerrar, onCreado }) => {
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
    }
  }, [visible]);

  const cargarContraCuentas = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: perfil } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    if (!perfil?.escuela_id) return;

    // Cargar TODAS las cuentas transaccionales que NO sean necesariamente las cajas
    const { data } = await supabase
      .from('plan_cuentas')
      .select('id, codigo, nombre, tipo')
      .or(`escuela_id.eq.${perfil.escuela_id},escuela_id.is.null`)
      .eq('es_transaccional', true)
      .order('codigo');

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
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: isIngreso ? 'var(--success-color)' : 'var(--danger-color)' }}>
            {isIngreso ? <ArrowDownRight size={20} /> : <ArrowUpRight size={20} />}
            {isIngreso ? 'Nuevo Ingreso de Dinero' : 'Nueva Salida / Gasto'}
          </h2>
          <button className="btn-close" onClick={onCerrar} disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="modal-body form-grid">
          {error && <div className="form-msg form-msg--error">{error}</div>}

          {/* Selector de Caja / Banco */}
          <div className="form-campo">
            <label><Building2 size={16}/> {isIngreso ? 'Ingresa a (Caja/Banco)' : 'Sale de (Caja/Banco)'}</label>
            <select value={cajaId} onChange={e => setCajaId(e.target.value)} required disabled={guardando}>
              <option value="">Seleccione cuenta...</option>
              {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>

          {/* Selector de Contra Cuenta */}
          <div className="form-campo">
            <label><Tag size={16}/> {isIngreso ? 'Concepto de Ingreso' : 'Concepto de Gasto/Salida'}</label>
            <select value={contraCuentaId} onChange={e => setContraCuentaId(e.target.value)} required disabled={guardando}>
              <option value="">Seleccione concepto...</option>
              {todasLasCuentas.map(c => (
                <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="form-campo">
            <label><DollarSign size={16}/> Monto (Bs)</label>
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
            <label><CreditCard size={16}/> Método de {isIngreso ? 'Cobro' : 'Pago'}</label>
            <select value={metodo} onChange={e => setMetodo(e.target.value)} disabled={guardando}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia / Cheque</option>
              <option value="qr">Código QR / Billetera</option>
            </select>
          </div>

          <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
            <label><AlignLeft size={16}/> Descripción o Referencia</label>
            <input 
              type="text" 
              value={descripcion} 
              onChange={e => setDescripcion(e.target.value)} 
              required 
              disabled={guardando} 
              placeholder="Ej: Pago servicio de internet"
              maxLength={255}
            />
          </div>

          <div className="modal-footer" style={{ gridColumn: '1 / -1', marginTop: '1rem' }}>
            <button type="button" className="btn-cancelar" onClick={onCerrar} disabled={guardando}>Cancelar</button>
            <button 
                type="submit" 
                className="btn-guardar-cuenta" 
                disabled={guardando}
                style={{ background: isIngreso ? 'var(--success-color)' : 'var(--danger-color)', borderColor: isIngreso ? 'var(--success-color)' : 'var(--danger-color)' }}
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
