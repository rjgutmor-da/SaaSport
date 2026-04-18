import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, ArrowDownRight, ArrowUpRight, DollarSign, Calendar, Hash, AlignLeft, Building2, Tag, AlertCircle, Save, RefreshCw } from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';
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
  const [fecha, setFecha] = useState(getHoyISO());
  const [descripcion, setDescripcion] = useState('');
  const [nroTransaccion, setNroTransaccion] = useState('');

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
      setNroTransaccion('');
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
        metodo_pago: 'efectivo',
        nro_transaccion: nroTransaccion.trim() || null
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
    <div className="cxc-modal-overlay" onClick={onCerrar}>
      <div className="cxc-modal cxc-modal--entidad" onClick={e => e.stopPropagation()} style={{ maxWidth: '650px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: isIngreso ? 'rgba(0, 210, 106, 0.15)' : 'rgba(255, 107, 53, 0.15)',
              color: isIngreso ? '#00D26A' : '#FF6B35'
            }}>
              {isIngreso ? <ArrowDownRight size={20} /> : <ArrowUpRight size={20} />}
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {isIngreso ? 'Nuevo Ingreso de Dinero' : 'Nueva Salida / Gasto'}
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {isIngreso ? 'Registra un ingreso directo a tu caja o banco' : 'Registra un egreso directo de tu caja o banco'}
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ padding: '0.5rem 0' }}>
            {/* Selector de Caja / Banco */}
            <div className="form-campo full-width">
              <label><Building2 size={14} /> Caja o Banco *</label>
              <select value={cajaId} onChange={e => handleInputChange(setCajaId, e.target.value)} required disabled={guardando}>
                <option value="">Seleccione cuenta transaccional...</option>
                {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>

            {/* Selector de Contra Cuenta */}
            <div className="form-campo">
              <label><Tag size={14} /> Concepto de {isIngreso ? 'Ingreso' : 'Salida'} *</label>
              <select value={contraCuentaId} onChange={e => handleInputChange(setContraCuentaId, e.target.value)} required disabled={guardando}>
                <option value="">Seleccione concepto...</option>
                {todasLasCuentas.map(c => (
                  <option key={c.id} value={c.id}>{c.nombre}</option>
                ))}
              </select>
            </div>

            <div className="form-campo">
              <label><DollarSign size={14} /> Monto (Bs) *</label>
              <input 
                type="number" 
                step="0.01" 
                min="0.01"
                value={monto} 
                onChange={e => handleInputChange(setMonto, e.target.value)} 
                required 
                disabled={guardando} 
                placeholder="0.00"
              />
            </div>

            <div className="form-campo">
              <label><Calendar size={14} /> Fecha *</label>
              <input 
                type="date" 
                value={fecha} 
                onChange={e => handleInputChange(setFecha, e.target.value)} 
                required 
                disabled={guardando} 
              />
            </div>

            <div className="form-campo">
              <label><Hash size={14} /> Nro. Transacción / Recibo</label>
              <input 
                type="text"
                value={nroTransaccion}
                onChange={e => handleInputChange(setNroTransaccion, e.target.value)}
                disabled={guardando}
                placeholder="Ej: 00123, REC-001..."
              />
            </div>

            <div className="form-campo full-width">
              <label><AlignLeft size={14} /> Observaciones *</label>
              <textarea 
                value={descripcion} 
                onChange={e => handleInputChange(setDescripcion, e.target.value)} 
                required 
                disabled={guardando} 
                placeholder="Descripción del movimiento"
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
                disabled={guardando}
                style={{ 
                  background: isIngreso ? '#00D26A' : '#FF6B35', 
                  borderColor: isIngreso ? '#00D26A' : '#FF6B35',
                  padding: '0.6rem 2rem',
                }}
              >
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> Registrando... </>
              ) : (
                <> <Save size={16} /> Confirmar {isIngreso ? 'Ingreso' : 'Salida'} </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalMovimientoDirecto;
