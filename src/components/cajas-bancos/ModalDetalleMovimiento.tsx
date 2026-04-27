import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, FileText, Calendar, Hash, Info, Link2, User, CreditCard, ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { formatFecha } from '../../lib/dateUtils';
import type { MovimientoFinanciero } from '../../hooks/useFinanzas';

interface ModalDetalleMovimientoProps {
  visible: boolean;
  onCerrar: () => void;
  movimiento?: MovimientoFinanciero | null;
  asientoId?: string | null;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ORIGEN_INFO: Record<string, { label: string; modulo: string; color: string; bg: string }> = {
  cxp:           { label: 'Cuenta por Pagar',    modulo: 'CxP',          color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  cxc:           { label: 'Cuenta por Cobrar',    modulo: 'CxC',          color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  cobro:         { label: 'Cobro Aplicado',       modulo: 'Cobro CxC',    color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  pago:          { label: 'Pago Aplicado',        modulo: 'Pago CxP',     color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  banco_directo: { label: 'Movimiento Directo',   modulo: 'Cajas/Bancos', color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  manual:        { label: 'Asiento Manual',       modulo: 'Manual',       color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
};

const ModalDetalleMovimiento: React.FC<ModalDetalleMovimientoProps> = ({ visible, onCerrar, movimiento, asientoId }) => {
  const [asiento, setAsiento] = useState<any>(null);
  const [movimientosContables, setMovimientosContables] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    const targetId = asientoId || movimiento?.asiento_id;
    if (visible && targetId) {
      cargarDetalleContable(targetId);
    } else {
      setAsiento(null);
      setMovimientosContables([]);
    }
  }, [visible, movimiento, asientoId]);

  const cargarDetalleContable = async (id: string) => {
    setCargando(true);
    try {
      const { data: dataAsiento, error: errAsiento } = await supabase
        .from('asientos_contables')
        .select('*')
        .eq('id', id)
        .single();
      
      if (errAsiento) throw errAsiento;
      setAsiento(dataAsiento);

      const { data: dataMovs, error: errMovs } = await supabase
        .from('movimientos_contables')
        .select(`
          id, debe, haber, 
          cuenta:plan_cuentas(nombre, codigo)
        `)
        .eq('asiento_id', id)
        .order('debe', { ascending: false });

      if (errMovs) throw errMovs;
      setMovimientosContables(dataMovs || []);
    } catch (err: any) {
      console.error('Error al cargar detalle contable:', err);
    } finally {
      setCargando(false);
    }
  };

  if (!visible) return null;

  const infoOrigen = (movimiento?.tipo_origen && ORIGEN_INFO[movimiento.tipo_origen]) || ORIGEN_INFO.manual;
  const montoValor = movimiento ? (movimiento.debe > 0 ? movimiento.debe : movimiento.haber) : (asiento?.total || 0);
  const esIngreso = movimiento ? movimiento.debe > 0 : true;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '750px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: esIngreso ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', 
              color: esIngreso ? '#10b981' : '#ef4444' 
            }}>
              {esIngreso ? <ArrowDownRight size={24} /> : <ArrowUpRight size={24} />}
            </div>
            <div>
              <h2 style={{ margin: 0 }}>{esIngreso ? 'Detalle de Ingreso' : 'Detalle de Egreso'}</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                {infoOrigen.label} • {movimiento ? formatFecha(movimiento.fecha) : (asiento ? formatFecha(asiento.fecha) : '—')}
              </p>
            </div>
          </div>
          <button onClick={onCerrar} className="btn-cerrar-modal"><X size={20} /></button>
        </div>

        <div className="cxc-modal-form" style={{ padding: '1.5rem 2rem' }}>
          {/* Información General */}
          <div className="modal-form-grid" style={{ marginBottom: '2rem' }}>
            <div className="form-campo">
              <label><Calendar size={14} /> Fecha y Hora</label>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{movimiento ? formatFecha(movimiento.fecha) : (asiento ? formatFecha(asiento.fecha) : '—')}</div>
            </div>
            <div className="form-campo">
              <label><Hash size={14} /> Nro. Transacción</label>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{movimiento?.nro_transaccion || '—'}</div>
            </div>
            <div className="form-campo">
              <label><User size={14} /> {movimiento?.tipo_origen === 'cobro' ? 'Alumno / Cliente' : 'Beneficiario'}</label>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{movimiento?.cliente || '—'}</div>
            </div>
            <div className="form-campo">
              <label><CreditCard size={14} /> Cuenta / Caja</label>
              <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{movimiento?.cuenta_nombre || '—'}</div>
            </div>
            <div className="form-campo full-width">
              <label>Descripción / Glosa</label>
              <div style={{ background: 'var(--bg-glass)', padding: '1rem', borderRadius: '12px', border: '1px solid var(--border)', fontSize: '1.1rem', fontWeight: 500 }}>
                {movimiento?.descripcion || asiento?.glosa || 'Sin descripción'}
              </div>
            </div>
          </div>

          {/* Resumen del Monto */}
          <div style={{ 
            background: esIngreso ? 'rgba(16, 185, 129, 0.05)' : 'rgba(239, 68, 68, 0.05)', 
            padding: '1.5rem', 
            borderRadius: '16px', 
            border: `1px solid ${esIngreso ? '#10b981' : '#ef4444'}33`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '2rem'
          }}>
            <span style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Monto Total Transaccionado</span>
            <div style={{ fontSize: '2.5rem', fontWeight: 800, color: esIngreso ? '#10b981' : '#ef4444' }}>
              Bs {fmtMonto(montoValor)}
            </div>
          </div>

          {/* Sección Contable (Solo si existe asiento) */}
          {(movimiento?.asiento_id || asientoId) && (
            <div style={{ marginTop: '2rem' }}>
               <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <Info size={16} color="var(--text-tertiary)" />
                  <h3 style={{ margin: 0, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)' }}>
                    Información Contable (Histórica)
                  </h3>
               </div>

               {cargando ? (
                 <p style={{ textAlign: 'center', padding: '1rem', color: 'var(--text-tertiary)' }}>Cargando detalles contables...</p>
               ) : (
                 <div className="cxc-tabla-wrapper" style={{ overflow: 'hidden', border: '1px solid var(--border)', borderRadius: '12px' }}>
                    <table className="cxc-tabla">
                      <thead>
                        <tr>
                          <th className="cxc-th">Cuenta Contable</th>
                          <th className="cxc-th cxc-th-right">Debe</th>
                          <th className="cxc-th cxc-th-right">Haber</th>
                        </tr>
                      </thead>
                      <tbody>
                        {movimientosContables.map((m) => (
                          <tr key={m.id} className="cxc-tr" style={{ cursor: 'default' }}>
                            <td className="cxc-td">
                              <div style={{ fontWeight: 600 }}>{m.cuenta?.nombre}</div>
                              <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{m.cuenta?.codigo}</div>
                            </td>
                            <td className="cxc-td cxc-td-right">
                              {m.debe > 0 ? <span style={{ color: '#10b981', fontWeight: 600 }}>{fmtMonto(m.debe)}</span> : '—'}
                            </td>
                            <td className="cxc-td cxc-td-right">
                              {m.haber > 0 ? <span style={{ color: '#ef4444', fontWeight: 600 }}>{fmtMonto(m.haber)}</span> : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                 </div>
               )}
            </div>
          )}
        </div>
        
        <div style={{ padding: '1.5rem 2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={onCerrar}
            style={{ 
              padding: '0.7rem 3rem', 
              background: 'var(--bg-glass)', 
              color: 'var(--text-primary)',
              border: '1px solid var(--border)', 
              borderRadius: '12px',
              fontWeight: 800,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
            onMouseOut={e => e.currentTarget.style.background = 'var(--bg-glass)'}
          >
            Cerrar Detalle
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalDetalleMovimiento;
