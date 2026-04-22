/**
 * RegistroActividad.tsx
 * Pantalla de registro de actividad (Auditoría) con diseño de reporte premium.
 * Basado en el diseño solicitado por el usuario.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { 
  ChevronLeft, RefreshCw, Filter, 
  Calendar, Printer, Share2, 
  ChevronDown, Search, ArrowUpDown
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Interfaz del registro de auditoría */
interface AuditEntry {
  id: string;
  escuela_id: string;
  usuario_id: string;
  usuario_nombre: string;
  accion: string;
  modulo: string;
  entidad_id: string;
  detalle: any;
  ip_address: string;
  created_at: string;
}

const RegistroActividad: React.FC = () => {
  const navigate = useNavigate();
  const [registros, setRegistros] = useState<AuditEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombreEscuela, setNombreEscuela] = useState('PLANETA FUTBOL CLUB');
  
  // Filtros
  const [intervaloFechas, setIntervaloFechas] = useState('Este mes');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');

  /** Cargar datos de la base de datos */
  const cargarDatos = async () => {
    setCargando(true);
    
    // En una app real, filtraríamos por fecha aquí
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRegistros(data);
    } else {
      setRegistros([]);
    }
    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  /** Formatea la fecha para la tabla */
  const formatTableDate = (iso: string) => {
    const d = new Date(iso);
    const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
    const day = d.getDate();
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const hours = d.getHours();
    const minutes = d.getMinutes();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hours12 = hours % 12 || 12;
    const minStr = minutes < 10 ? `0${minutes}` : minutes;
    
    return `${day} ${month} ${year} ${hours12}:${minStr} ${ampm}`;
  };

  /** Obtener el rango de fechas para el subtítulo */
  const getSubtituloRango = () => {
    const hoy = new Date();
    const primerDia = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    const ultimoDia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
    
    const fmt = (d: Date) => d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' }).replace('.', '');
    
    return `Desde ${fmt(primerDia)} A ${fmt(ultimoDia)}`;
  };

  return (
    <main className="main-content" style={{ padding: '0', maxWidth: '100%', background: 'var(--bg-main)' }}>
      {/* Barra de Filtros Superior */}
      <div className="report-filter-bar" style={{ 
        display: 'flex', 
        alignItems: 'center', 
        padding: '0.75rem 2rem', 
        background: 'rgba(255,255,255,0.02)', 
        borderBottom: '1px solid var(--border)',
        gap: '1rem'
      }}>
        <button className="btn-volver" onClick={() => navigate('/contabilidad')} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)' }}>
          <ChevronLeft size={20} />
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <Filter size={16} />
          <strong>Filtros :</strong>
        </div>

        <div className="filter-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <div className="custom-select-wrapper" style={{ position: 'relative' }}>
            <select 
              value={intervaloFechas} 
              onChange={(e) => setIntervaloFechas(e.target.value)}
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                padding: '0.4rem 2rem 0.4rem 1rem',
                borderRadius: '6px',
                border: '1px solid var(--border)',
                appearance: 'none',
                fontSize: '0.9rem',
                minWidth: '180px'
              }}
            >
              <option>Este mes</option>
              <option>Mes pasado</option>
              <option>Este año</option>
              <option>Personalizado</option>
            </select>
            <ChevronDown size={14} style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#6b7280', pointerEvents: 'none' }} />
          </div>
        </div>

        <button style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem', 
          padding: '0.4rem 1rem', 
          borderRadius: '6px', 
          border: '1px solid var(--border)', 
          background: 'var(--bg-input)', 
          color: 'var(--text-primary)',
          fontSize: '0.9rem'
        }}>
          <div style={{ background: 'var(--primary)', color: '#fff', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}>+</div>
          Más filtros
        </button>

        <button 
          onClick={cargarDatos}
          style={{ 
            padding: '0.4rem 1.5rem', 
            borderRadius: '6px', 
            background: '#ff8a8a', 
            color: '#fff', 
            fontWeight: '600',
            border: 'none',
            fontSize: '0.9rem',
            boxShadow: '0 2px 4px rgba(255, 138, 138, 0.3)'
          }}
        >
          Ejecutar informe
        </button>
      </div>

      {/* Cuerpo del Reporte */}
      <div className="report-container" style={{ padding: '3rem 5rem' }}>
        <div className="report-paper" style={{ 
          background: 'var(--bg-card)', 
          minHeight: '100vh', 
          borderRadius: '8px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          padding: '3rem',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)'
        }}>
          
          {/* Encabezado del Papel */}
          <div className="report-header" style={{ textAlign: 'center', marginBottom: '3rem' }}>
            <h3 style={{ color: 'var(--text-tertiary)', fontSize: '1rem', fontWeight: '500', letterSpacing: '2px', marginBottom: '1rem' }}>{nombreEscuela}</h3>
            <h1 style={{ fontSize: '1.8rem', fontWeight: '800', marginBottom: '0.5rem', color: 'var(--text-primary)' }}>Registros de actividad</h1>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.95rem' }}>{getSubtituloRango()}</p>
          </div>

          {/* Tabla de Resultados */}
          <div className="report-table-wrapper">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '1rem 0', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.5px', width: '25%' }}>
                    FECHA <ArrowUpDown size={12} style={{ marginLeft: '4px', verticalAlign: 'middle' }} />
                  </th>
                  <th style={{ textAlign: 'left', padding: '1rem 0', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.5px' }}>
                    DETALLES DE LA ACTIVIDAD
                  </th>
                  <th style={{ textAlign: 'left', padding: '1rem 0', color: 'var(--text-tertiary)', textTransform: 'uppercase', fontSize: '0.75rem', fontWeight: '700', letterSpacing: '0.5px', width: '30%' }}>
                    DESCRIPCIÓN
                  </th>
                </tr>
              </thead>
              <tbody>
                {cargando ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '3rem', textAlign: 'center', color: '#90949c' }}>
                      <RefreshCw size={24} className="spin" style={{ marginBottom: '1rem' }} />
                      <p>Generando informe...</p>
                    </td>
                  </tr>
                ) : registros.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '3rem', textAlign: 'center', color: '#90949c' }}>
                      No se encontraron registros para este período.
                    </td>
                  </tr>
                ) : (
                  registros.map((reg) => (
                    <tr key={reg.id} className="report-row" style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '1.5rem 0', verticalAlign: 'top', color: 'var(--text-primary)' }}>
                        {formatTableDate(reg.created_at)}
                      </td>
                      <td style={{ padding: '1.5rem 0', verticalAlign: 'top' }}>
                        <div style={{ color: 'var(--primary)', fontWeight: '600', cursor: 'pointer', marginBottom: '0.2rem' }}>
                          {reg.detalle?.referencia || (reg.accion === 'cobro' ? `Pago ${reg.detalle?.nro_comprobante || ''}` : reg.entidad_id.substring(0, 8))}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                          Cliente: <span style={{ color: 'var(--primary)', fontWeight: '500' }}>{reg.detalle?.cliente || 'N/A'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '1.5rem 0', verticalAlign: 'top', color: 'var(--text-secondary)' }}>
                        <div style={{ fontWeight: '500', marginBottom: '0.3rem', color: 'var(--text-primary)' }}>
                          {reg.detalle?.descripcion || (reg.accion === 'cobro' ? `Cobro de Bs ${reg.detalle?.monto || 0} (${reg.detalle?.metodo_pago || 'efectivo'})` : reg.accion)}
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                          por {reg.usuario_nombre}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer del Reporte */}
          <div className="report-footer" style={{ marginTop: '5rem', paddingTop: '2rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
            <div>Generado el {new Date().toLocaleString()}</div>
            <div>Página 1 de 1</div>
          </div>
        </div>
      </div>

      <style>{`
        .report-row:hover { background: rgba(255,255,255,0.02); cursor: default; }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        /* Estilos para impresión */
        @media print {
          .report-filter-bar, .navbar, .btn-volver { display: none !important; }
          .report-container { padding: 0 !important; }
          .report-paper { box-shadow: none !important; border: none !important; padding: 0 !important; }
          body { background: white !important; }
          .main-content { background: white !important; }
        }
      `}</style>
    </main>
  );
};

export default RegistroActividad;
