import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../../lib/supabaseClient';
import { 
  ChevronLeft, RefreshCw, Calendar, Eye, X, FileText, CheckCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../../lib/authHelper';

interface Ejecucion {
  id: string;
  escuela_id: string;
  fecha_ejecucion: string;
  facturas_generadas: number;
  created_at: string;
}

interface FacturaDetalle {
  id: string;
  monto_total: number;
  ciclo_inicio: string;
  ciclo_fin: string;
  fecha_emision: string;
  alumnos: {
    nombres: string;
    apellidos: string;
  } | null;
  sucursales: {
    nombre: string;
  } | null;
}

const HistorialFacturacionAutomatica: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId } = useAuthSaaSport();
  
  const [ejecuciones, setEjecuciones] = useState<Ejecucion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fechas de filtro
  const haceUnMes = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  })();
  const hoyLocal = new Date().toISOString().split('T')[0];

  const [fechaDesde, setFechaDesde] = useState(haceUnMes);
  const [fechaHasta, setFechaHasta] = useState(hoyLocal);

  // Estado para el modal de detalle
  const [ejecucionSeleccionada, setEjecucionSeleccionada] = useState<Ejecucion | null>(null);
  const [detalles, setDetalles] = useState<FacturaDetalle[]>([]);
  const [cargandoDetalle, setCargandoDetalle] = useState(false);

  const cargarEjecuciones = async () => {
    if (!escuelaId) return;
    setCargando(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('ejecuciones_facturacion')
        .select('*')
        .eq('escuela_id', escuelaId)
        .gte('fecha_ejecucion', fechaDesde)
        .lte('fecha_ejecucion', fechaHasta)
        .order('fecha_ejecucion', { ascending: false });

      if (queryError) throw queryError;
      setEjecuciones(data || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar el historial de facturación.');
    } finally {
      setCargando(false);
    }
  };

  const cargarDetalleEjecucion = async (ejecucion: Ejecucion) => {
    setEjecucionSeleccionada(ejecucion);
    setCargandoDetalle(true);
    try {
      const { data, error: queryError } = await supabase
        .from('cuentas_cobrar')
        .select(`
          id,
          monto_total,
          ciclo_inicio,
          ciclo_fin,
          fecha_emision,
          alumnos (nombres, apellidos),
          sucursales (nombre)
        `)
        .eq('ejecucion_facturacion_id', ejecucion.id);

      if (queryError) throw queryError;
      setDetalles((data as any) || []);
    } catch (err: any) {
      alert('Error al cargar el detalle: ' + err.message);
    } finally {
      setCargandoDetalle(false);
    }
  };

  useEffect(() => {
    if (escuelaId) {
      cargarEjecuciones();
    }
  }, [escuelaId]);

  const formatFechaBonita = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatHora = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <main className="main-content" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-main)' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button className="btn-volver" onClick={() => navigate('/panel-escuela')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            Historial de Facturación Automática
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Registro de ejecuciones automáticas de cobros de mensualidades por ciclo de alumno.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        alignItems: 'center', 
        marginBottom: '1.5rem', 
        padding: '1rem', 
        background: 'var(--bg-card)', 
        border: '1px solid var(--border)', 
        borderRadius: '8px' 
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Desde</label>
          <input 
            type="date" 
            value={fechaDesde} 
            onChange={(e) => setFechaDesde(e.target.value)} 
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px', color: 'var(--text-primary)' }} 
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Hasta</label>
          <input 
            type="date" 
            value={fechaHasta} 
            onChange={(e) => setFechaHasta(e.target.value)} 
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '0.4rem', borderRadius: '4px', color: 'var(--text-primary)' }} 
          />
        </div>
        <button 
          onClick={cargarEjecuciones}
          className="btn-nueva-cuenta"
          style={{ height: '38px', marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        >
          <RefreshCw size={16} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Contenido Principal */}
      {error && (
        <div className="login-error" style={{ margin: '1rem 0' }}>
          <span>{error}</span>
        </div>
      )}

      {cargando ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '30vh', flexDirection: 'column', gap: '1rem' }}>
          <RefreshCw size={28} className="spin" style={{ color: 'var(--primary)' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Cargando ejecuciones...</p>
        </div>
      ) : ejecuciones.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
          <Calendar size={48} style={{ opacity: 0.5, marginBottom: '1rem' }} />
          <p>No se encontraron ejecuciones de facturación automática en este periodo.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '1rem' }}>Fecha de Ejecución</th>
                <th style={{ padding: '1rem' }}>Hora de Ejecución</th>
                <th style={{ padding: '1rem' }}>Facturas Generadas</th>
                <th style={{ padding: '1rem', textAlign: 'right' }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {ejecuciones.map((ej) => (
                <tr key={ej.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '1rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                    {formatFechaBonita(ej.fecha_ejecucion)}
                  </td>
                  <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                    {formatHora(ej.created_at)}
                  </td>
                  <td style={{ padding: '1rem' }}>
                    <span style={{ 
                      display: 'inline-flex', 
                      alignItems: 'center', 
                      gap: '0.35rem', 
                      background: 'rgba(16, 185, 129, 0.1)', 
                      color: '#10b981', 
                      padding: '0.25rem 0.6rem', 
                      borderRadius: '50px', 
                      fontSize: '0.8rem',
                      fontWeight: 600
                    }}>
                      <CheckCircle size={12} />
                      {ej.facturas_generadas} {ej.facturas_generadas === 1 ? 'Factura' : 'Facturas'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <button 
                      onClick={() => cargarDetalleEjecucion(ej)}
                      className="btn-volver"
                      style={{ height: '32px', padding: '0 0.85rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                    >
                      <Eye size={14} />
                      Ver Detalles
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal de Detalle */}
      {ejecucionSeleccionada && (
        <div className="cxc-modal-overlay">
          <div className="cxc-modal" style={{ maxWidth: '800px', width: '90%' }}>
            <div className="cxc-modal-header">
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>Detalle de Ejecución</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                  {formatFechaBonita(ejecucionSeleccionada.fecha_ejecucion)} a las {formatHora(ejecucionSeleccionada.created_at)}
                </p>
              </div>
              <button onClick={() => setEjecucionSeleccionada(null)}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', maxHeight: '60vh', overflowY: 'auto' }}>
              {cargandoDetalle ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                  <RefreshCw size={24} className="spin" style={{ color: 'var(--primary)' }} />
                </div>
              ) : detalles.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>
                  No se encontraron facturas vinculadas a esta ejecución.
                </div>
              ) : (
                <div style={{ border: '1px solid var(--border)', borderRadius: '6px', overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
                        <th style={{ padding: '0.75rem' }}>Alumno</th>
                        <th style={{ padding: '0.75rem' }}>Sucursal</th>
                        <th style={{ padding: '0.75rem' }}>Ciclo Facturado</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right' }}>Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detalles.map((d) => (
                        <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.75rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                            {d.alumnos ? `${d.alumnos.nombres} ${d.alumnos.apellidos}` : 'Alumno desconocido'}
                          </td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                            {d.sucursales?.nombre || 'Sin sucursal'}
                          </td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                            {d.ciclo_inicio ? `${new Date(d.ciclo_inicio).toLocaleDateString('es-ES')} al ${new Date(d.ciclo_fin).toLocaleDateString('es-ES')}` : 'Ciclo no especificado'}
                          </td>
                          <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Bs. {d.monto_total.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem', borderTop: '1px solid var(--border)' }}>
              <button className="btn-volver" onClick={() => setEjecucionSeleccionada(null)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default HistorialFacturacionAutomatica;
