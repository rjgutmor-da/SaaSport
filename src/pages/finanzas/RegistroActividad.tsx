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
import { useAuthSaaSport } from '../../lib/authHelper';

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
  const { escuelaId } = useAuthSaaSport();
  const [registros, setRegistros] = useState<AuditEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [nombreEscuela, setNombreEscuela] = useState('PLANETA FUTBOL CLUB');
  
  // Filtros — se usa fecha local para evitar desfase por timezone (UTC)
  const hoyLocal = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  })();
  const [intervaloFechas, setIntervaloFechas] = useState('Este mes');
  const [fechaDesde, setFechaDesde] = useState(hoyLocal);
  const [fechaHasta, setFechaHasta] = useState(hoyLocal);
  const [filtroUsuario, setFiltroUsuario] = useState('');

  /** Cargar datos de la base de datos */
  const cargarDatos = async () => {
    setCargando(true);
    if (!escuelaId) return;

    // Convertir la fecha local a UTC para que la query coincida con los timestamps guardados en BD
    const inicioUTC = new Date(`${fechaDesde}T00:00:00`).toISOString();
    const finUTC = new Date(`${fechaHasta}T23:59:59`).toISOString();

    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .eq('escuela_id', escuelaId)
      .gte('created_at', inicioUTC)
      .lte('created_at', finUTC)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setRegistros(data);
    } else {
      setRegistros([]);
    }
    setCargando(false);
  };

  useEffect(() => {
    if (escuelaId) cargarDatos();
  }, [escuelaId]);

  /** Lista de usuarios únicos para el filtro */
  const listaUsuarios = useMemo(() => {
    const usuarios = registros.map(r => r.usuario_nombre).filter(Boolean);
    return Array.from(new Set(usuarios)).sort();
  }, [registros]);

  /** Registros filtrados por usuario */
  const registrosFiltrados = useMemo(() => {
    if (!filtroUsuario) return registros;
    return registros.filter(r => r.usuario_nombre === filtroUsuario);
  }, [registros, filtroUsuario]);

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
    return `Desde ${fechaDesde} A ${fechaHasta}`;
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
        gap: '1rem',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        backdropFilter: 'blur(10px)'
      }}>
        <button className="btn-volver" onClick={() => navigate('/contabilidad')} style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)' }}>
          <ChevronLeft size={20} />
        </button>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          <Filter size={16} />
          <strong>Filtros :</strong>
        </div>

        <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)' }} />
        <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', padding: '0.3rem', borderRadius: '4px', color: 'var(--text-primary)' }} />

        {/* Filtro de Usuario */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <select 
            value={filtroUsuario} 
            onChange={(e) => setFiltroUsuario(e.target.value)}
            style={{ 
              background: 'var(--bg-input)', 
              border: '1px solid var(--border)', 
              padding: '0.3rem 0.6rem', 
              borderRadius: '4px', 
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              minWidth: '150px'
            }}
          >
            <option value="">Todos los usuarios</option>
            {listaUsuarios.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>

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
      <div className="report-container" style={{ padding: '1.5rem 2rem' }}>
        <div className="report-paper" style={{ 
          background: 'var(--bg-card)', 
          minHeight: '100vh', 
          borderRadius: '8px', 
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
          padding: '1.5rem 2.5rem',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)'
        }}>
          
          {/* Encabezado del Papel */}
          <div className="report-header" style={{ textAlign: 'center', marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: '800', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>Registros de actividad</h1>
            <p style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>{getSubtituloRango()}</p>
          </div>

          {/* Tabla de Resultados */}
          <div className="report-table-wrapper" style={{ overflowX: 'auto' }}>
            <table className="report-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)' }}>
                  <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-tertiary)', fontWeight: '600', width: '150px', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 10 }}>FECHA Y HORA</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-tertiary)', fontWeight: '600', width: '250px', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 10 }}>REFERENCIA / ENTIDAD</th>
                  <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-tertiary)', fontWeight: '600', position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 10 }}>ACTIVIDAD REALIZADA</th>
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
                ) : registrosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '3rem', textAlign: 'center', color: '#90949c' }}>
                      No se encontraron registros para este período o usuario.
                    </td>
                  </tr>
                ) : (
                  registrosFiltrados.map((reg) => (
                    <tr key={reg.id} className="report-row" style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                      <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle', color: 'var(--text-primary)', borderRight: '1px solid var(--border-subtle)', fontSize: '0.85rem' }}>
                        {formatTableDate(reg.created_at)}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle', borderRight: '1px solid var(--border-subtle)' }}>
                        <div style={{ color: 'var(--primary)', fontWeight: '700', cursor: 'pointer', fontSize: '0.85rem' }}>
                          {reg.detalle?.referencia || (reg.accion === 'cobro' ? `Pago ${reg.detalle?.nro_comprobante || ''}` : reg.entidad_id?.substring(0, 8) || 'N/A')}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', opacity: 0.8 }}>
                          Entidad: <span style={{ color: 'var(--text-primary)', fontWeight: '500' }}>{reg.detalle?.cliente || reg.detalle?.proveedor || reg.detalle?.alumno || 'N/A'}</span>
                        </div>
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', verticalAlign: 'middle', color: 'var(--text-secondary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                          <div style={{ fontWeight: '500', color: 'var(--text-primary)', fontSize: '0.85rem' }}>
                            {reg.detalle?.descripcion || (reg.accion === 'cobro' ? `Cobro de Bs ${reg.detalle?.monto || 0} (${reg.detalle?.metodo_pago || 'efectivo'})` : reg.accion)}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <span style={{ 
                              fontSize: '0.6rem', 
                              padding: '1px 5px', 
                              borderRadius: '4px', 
                              background: reg.ip_address === 'AsiSport' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                              color: reg.ip_address === 'AsiSport' ? '#60a5fa' : '#34d399',
                              border: '1px solid currentColor',
                              fontWeight: '800',
                              textTransform: 'uppercase'
                            }}>
                              {reg.ip_address || 'SaaSport'}
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
                              por {reg.usuario_nombre.split(' ')[0]}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Footer del Reporte */}
          <div className="report-footer" style={{ marginTop: '3rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
            <div>Generado el {new Date().toLocaleString()}</div>
            <div>Página 1 de 1</div>
          </div>
        </div>
      </div>

      <style>{`
        .report-row:hover { background: rgba(var(--primary-rgb), 0.05); cursor: default; }
        .report-row:nth-child(even) { background: rgba(255,255,255,0.01); }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        
        :root {
          --border-subtle: rgba(255,255,255,0.05);
        }
        [data-theme='light'] :root {
          --border-subtle: rgba(0,0,0,0.05);
        }

        .report-table-wrapper table {
          border: 1px solid var(--border);
        }
        .report-table-wrapper th {
          background: rgba(255,255,255,0.02);
          border-right: 1px solid var(--border-subtle);
          padding: 0.75rem !important;
        }

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
