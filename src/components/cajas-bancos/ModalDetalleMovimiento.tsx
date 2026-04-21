import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { X, FileText, Calendar, Hash, ArrowUpRight, ArrowDownRight, Info, Link2 } from 'lucide-react';
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

/** Etiquetas y colores para cada tipo de origen */
const ORIGEN_INFO: Record<string, { label: string; modulo: string; color: string; bg: string }> = {
  cxp:           { label: 'Cuenta por Pagar',    modulo: 'CxP',          color: '#f59e0b', bg: 'rgba(245,158,11,0.10)' },
  cxc:           { label: 'Cuenta por Cobrar',    modulo: 'CxC',          color: '#3b82f6', bg: 'rgba(59,130,246,0.10)' },
  cobro:         { label: 'Cobro Aplicado',       modulo: 'Cobro CxC',    color: '#10b981', bg: 'rgba(16,185,129,0.10)' },
  pago:          { label: 'Pago Aplicado',        modulo: 'Pago CxP',     color: '#ef4444', bg: 'rgba(239,68,68,0.10)' },
  banco_directo: { label: 'Movimiento Directo',   modulo: 'Cajas/Bancos', color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)' },
  manual:        { label: 'Asiento Manual',       modulo: 'Manual',       color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
};

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

              {/* Sección de Origen / Trazabilidad */}
              {asiento?.origen_tipo && (() => {
                const info = ORIGEN_INFO[asiento.origen_tipo] || ORIGEN_INFO.manual;
                const idCorto = asiento.origen_id ? asiento.origen_id.slice(0, 8) : null;
                return (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.75rem 1rem', borderRadius: '8px',
                    background: info.bg, border: `1px solid ${info.color}25`,
                    marginBottom: '1.5rem'
                  }}>
                    <Link2 size={16} style={{ color: info.color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginBottom: '0.15rem' }}>
                        ORIGEN DE LA TRANSACCIÓN
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{
                          padding: '0.15rem 0.5rem', borderRadius: '4px',
                          fontSize: '0.7rem', fontWeight: 700,
                          color: info.color, background: `${info.color}20`,
                          border: `1px solid ${info.color}30`,
                          textTransform: 'uppercase'
                        }}>
                          {info.modulo}
                        </span>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {info.label}
                        </span>
                        {idCorto && (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>
                            ID: {idCorto}…
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

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
