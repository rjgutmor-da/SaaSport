import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, FileText, Calendar, Hash, ArrowUpRight, ArrowDownRight, Info } from 'lucide-react';
import { formatFecha } from '../../lib/dateUtils';

interface MovimientoDetalle {
  id: string;
  debe: number;
  haber: number;
  cuenta: string;
  descripcion: string;
  nro_transaccion: string;
  fecha: string;
  asiento_id: string;
}

interface ModalDetalleMovimientoProps {
  visible: boolean;
  onCerrar: () => void;
  asientoId: string | null;
}

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ModalDetalleMovimiento: React.FC<ModalDetalleMovimientoProps> = ({ visible, onCerrar, asientoId }) => {
  const [asiento, setAsiento] = useState<any>(null);
  const [movimientos, setMovimientos] = useState<any[]>([]);
  const [cargando, setCargando] = useState(false);

  useEffect(() => {
    if (visible && asientoId) {
      cargarDetalle();
    } else {
      setAsiento(null);
      setMovimientos([]);
    }
  }, [visible, asientoId]);

  const cargarDetalle = async () => {
    setCargando(true);
    try {
      // 1. Cargar el asiento
      const { data: dataAsiento, error: errAsiento } = await supabase
        .from('asientos_contables')
        .select('*')
        .eq('id', asientoId)
        .single();
      
      if (errAsiento) throw errAsiento;
      setAsiento(dataAsiento);

      // 2. Cargar todos los movimientos de ese asiento
      const { data: dataMovs, error: errMovs } = await supabase
        .from('movimientos_contables')
        .select(`
          id, debe, haber, 
          cuenta:plan_cuentas(nombre, codigo)
        `)
        .eq('asiento_id', asientoId)
        .order('debe', { ascending: false });

      if (errMovs) throw errMovs;
      setMovimientos(dataMovs || []);
    } catch (error) {
      console.error('Error al cargar detalle:', error);
    } finally {
      setCargando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '750px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div className="cxc-header-icon-circle" style={{ background: 'var(--secondary-glow)', color: 'var(--secondary)' }}>
              <FileText size={24} />
            </div>
            <div>
              <h2 style={{ margin: 0 }}>Detalle de Transacción</h2>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>Asiento Contable #{asiento?.nro_asiento || ''}</p>
            </div>
          </div>
          <button onClick={onCerrar}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form" style={{ padding: '1.5rem 2rem' }}>
          {cargando ? (
            <div style={{ textAlign: 'center', padding: '3rem' }}>
              <div className="spin" style={{ display: 'inline-block', marginBottom: '1rem' }}>
                <FileText size={32} style={{ opacity: 0.5 }} />
              </div>
              <p>Cargando información del asiento...</p>
            </div>
          ) : (
            <>
              {/* Información General */}
              <div className="modal-form-grid" style={{ marginBottom: '2rem' }}>
                <div className="form-campo">
                  <label><Calendar size={14} /> Fecha</label>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{asiento?.fecha ? formatFecha(asiento.fecha) : '—'}</div>
                </div>
                <div className="form-campo">
                  <label><Hash size={14} /> Nro. Transacción</label>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>{asiento?.nro_transaccion || '—'}</div>
                </div>
                <div className="form-campo full-width">
                  <label>Descripción / Glosa</label>
                  <div style={{ background: 'var(--bg-glass)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '1rem' }}>
                    {asiento?.descripcion || 'Sin descripción'}
                  </div>
                </div>
              </div>

              {/* Libro Diario del Asiento */}
              <div style={{ marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
                  Movimientos Contables (Partida Doble)
                </h3>
                <div className="cxc-tabla-wrapper" style={{ overflow: 'hidden' }}>
                  <table className="cxc-tabla" style={{ tableLayout: 'auto' }}>
                    <thead>
                      <tr>
                        <th className="cxc-th">Código / Cuenta</th>
                        <th className="cxc-th cxc-th-right">Debe</th>
                        <th className="cxc-th cxc-th-right">Haber</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movimientos.map((m) => (
                        <tr key={m.id} className="cxc-tr" style={{ cursor: 'default' }}>
                          <td className="cxc-td">
                            <div style={{ fontWeight: 600 }}>{m.cuenta?.nombre}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{m.cuenta?.codigo}</div>
                          </td>
                          <td className="cxc-td cxc-td-right">
                            {m.debe > 0 ? (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>{fmtMonto(m.debe)}</span>
                            ) : <span className="cxc-td-dash">—</span>}
                          </td>
                          <td className="cxc-td cxc-td-right">
                            {m.haber > 0 ? (
                              <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{fmtMonto(m.haber)}</span>
                            ) : <span className="cxc-td-dash">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                        <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                            <td className="cxc-td" style={{ fontWeight: 800 }}>TOTAL</td>
                            <td className="cxc-td cxc-td-right" style={{ fontWeight: 800 }}>
                                {fmtMonto(movimientos.reduce((acc, m) => acc + (m.debe || 0), 0))}
                            </td>
                            <td className="cxc-td cxc-td-right" style={{ fontWeight: 800 }}>
                                {fmtMonto(movimientos.reduce((acc, m) => acc + (m.haber || 0), 0))}
                            </td>
                        </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        
        <div style={{ padding: '1.5rem 2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button 
            onClick={onCerrar}
            style={{ 
              padding: '0.6rem 2.5rem', 
              background: 'var(--bg-card-hover)', 
              color: 'var(--text-primary)',
              border: '1px solid var(--border)', 
              borderRadius: '8px',
              fontWeight: 700,
              boxShadow: 'var(--shadow-sm)'
            }}
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModalDetalleMovimiento;
