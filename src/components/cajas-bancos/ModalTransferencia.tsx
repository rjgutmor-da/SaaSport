import React, { useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, ArrowRightLeft, DollarSign, Calendar, Hash, AlignLeft, Building2, AlertCircle, Save, RefreshCw, Clock } from 'lucide-react';
import { getHoyISO, getHoraLocal, buildTimestampLocal, FECHA_MINIMA_MOVIMIENTO_FINANCIERO, validarFechaMovimientoFinanciero } from '../../lib/dateUtils';
import type { CajaBanco } from '../../types/finanzas';
import { confirmarMovimientoEnPeriodoConciliado } from '../../lib/conciliacion';

interface Props {
  visible: boolean;
  cajas: CajaBanco[];
  onCerrar: () => void;
  onCreado: () => void;
  setFormDirty: (dirty: boolean) => void;
}

const ModalTransferencia: React.FC<Props> = ({ visible, cajas, onCerrar, onCreado, setFormDirty }) => {
  const [origenId, setOrigenId] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(getHoyISO());
  const [hora, setHora] = useState(getHoraLocal());
  const [descripcion, setDescripcion] = useState('Transferencia interna');
  const [nroTransaccion, setNroTransaccion] = useState('');
  
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
      setFecha(getHoyISO());
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
    const errorFecha = validarFechaMovimientoFinanciero(fecha);
    if (errorFecha) return setError(errorFecha);

    setGuardando(true);

    try {
      // 1. Obtener datos sesión y escuela
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No hay sesión activa.');
      
      const { data: perfil } = await supabase.from('usuarios').select('id, escuela_id, nombres, apellidos, email').eq('id', user.id).single();
      const escuelaId = perfil?.escuela_id;
      if (!escuelaId) throw new Error('No se pudo determinar la escuela.');
      const usuarioNombre = `${perfil.nombres || ''} ${perfil.apellidos || ''}`.trim() || perfil.email;
      const origenNombre = cajas.find(c => c.id === origenId)?.nombre || 'cuenta origen';
      const destinoNombre = cajas.find(c => c.id === destinoId)?.nombre || 'cuenta destino';
      const continuarOrigen = await confirmarMovimientoEnPeriodoConciliado({
        cajaId: origenId,
        cajaNombre: origenNombre,
        fechaISO: fecha,
        tipoMovimiento: 'una transferencia de salida',
        escuelaId,
        usuarioId: perfil.id,
        usuarioNombre
      });
      if (!continuarOrigen) return;

      const continuarDestino = await confirmarMovimientoEnPeriodoConciliado({
        cajaId: destinoId,
        cajaNombre: destinoNombre,
        fechaISO: fecha,
        tipoMovimiento: 'una transferencia de entrada',
        escuelaId,
        usuarioId: perfil.id,
        usuarioNombre
      });
      if (!continuarDestino) return;

      const timestamp = buildTimestampLocal(fecha, getHoraLocal());

      // 2. Registrar EGRESO (Cuenta Origen)
      const { data: cxp, error: errCxP } = await supabase.from('cuentas_pagar').insert({
        escuela_id: escuelaId,
        monto_total: valorMonto,
        estado: 'pagada',
        descripcion: `[EGRESO TRF] ${descripcion}`,
        fecha_emision: fecha,
        tipo_gasto: 'gasto_corriente'
      }).select().single();

      if (errCxP || !cxp) throw new Error('Error al registrar egreso de transferencia: ' + errCxP?.message);

      await supabase.from('cxp_detalle').insert({
        escuela_id: escuelaId,
        cuenta_pagar_id: cxp.id,
        catalogo_item_id: null,
        cantidad: 1,
        precio_unitario: valorMonto
      });

      await supabase.from('pagos_aplicados').insert({
        escuela_id: escuelaId,
        cuenta_pagar_id: cxp.id,
        caja_id: origenId,
        monto_aplicado: valorMonto,
        fecha: timestamp,
        referencia: nroTransaccion
      });

      // 3. Registrar INGRESO (Cuenta Destino)
      const { data: cxc, error: errCxC } = await supabase.from('cuentas_cobrar').insert({
        escuela_id: escuelaId,
        monto_total: valorMonto,
        estado: 'pagada',
        descripcion: `[INGRESO TRF] ${descripcion}`,
        fecha_emision: fecha,
        nro_recibo: nroTransaccion
      }).select().single();

      if (errCxC || !cxc) throw new Error('Error al registrar ingreso de transferencia: ' + errCxC?.message);

      await supabase.from('cxc_detalle').insert({
        escuela_id: escuelaId,
        cuenta_cobrar_id: cxc.id,
        catalogo_item_id: null,
        cantidad: 1,
        precio_unitario: valorMonto
      });

      await supabase.from('cobros_aplicados').insert({
        escuela_id: escuelaId,
        cuenta_cobrar_id: cxc.id,
        caja_id: destinoId,
        monto_aplicado: valorMonto,
        fecha: timestamp,
        documento_referencia: nroTransaccion
      });


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
              background: 'rgba(10, 132, 255, 0.15)',
              color: '#0A84FF'
            }}>
              <ArrowRightLeft size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Transferencia entre Cuentas</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                Mueve fondos entre tus cajas o cuentas bancarias
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <form onSubmit={handleSubmit} className="cxc-modal-form">
          <div className="modal-form-grid" style={{ 
            display: 'grid', 
            gridTemplateColumns: '1fr 1fr', 
            gap: '1.25rem',
            padding: '0.5rem 0'
          }}>
            <div className="form-campo">
              <label><Building2 size={14} /> Cuenta Origen *</label>
              <select value={origenId} onChange={e => handleInputChange(setOrigenId, e.target.value)} required disabled={guardando}>
                <option value="">Seleccione</option>
                {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>

            <div className="form-campo">
              <label><Building2 size={14} /> Cuenta Destino *</label>
              <select value={destinoId} onChange={e => handleInputChange(setDestinoId, e.target.value)} required disabled={guardando}>
                <option value="">Seleccione</option>
                {cajas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>

            <div className="form-campo">
              <label><DollarSign size={14} /> Monto a Transferir (Bs) *</label>
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
                min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO}
                onChange={e => handleInputChange(setFecha, e.target.value)} 
                required 
                disabled={guardando} 
              />
            </div>



            <div className="form-campo full-width" style={{ gridColumn: '1 / -1' }}>
              <label><Hash size={14} /> Nro. Transacción / Referencia</label>
              <input
                type="text"
                value={nroTransaccion}
                onChange={e => handleInputChange(setNroTransaccion, e.target.value)}
                disabled={guardando}
                placeholder=""
              />
            </div>

            <div className="form-campo full-width" style={{ gridColumn: '1 / -1' }}>
              <label><AlignLeft size={14} /> Observaciones *</label>
              <textarea 
                value={descripcion} 
                onChange={e => handleInputChange(setDescripcion, e.target.value)} 
                required 
                disabled={guardando} 
                placeholder="Descripción de la transferencia"
                maxLength={255}
                style={{ resize: 'vertical', minHeight: '120px', width: '100%' }}
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
              style={{ padding: '0.6rem 2rem', background: '#0A84FF', borderColor: '#0A84FF' }}
            >
              {guardando ? (
                <> <RefreshCw size={16} className="spin" /> Transfiriendo... </>
              ) : (
                <> <Save size={16} /> Confirmar Transferencia </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalTransferencia;
