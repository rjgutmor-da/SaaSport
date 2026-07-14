import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { 
  ChevronLeft, RefreshCw, Search, Pencil, FileText, Calendar, Landmark, AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../lib/authHelper';
import NotaServicios from '../../components/cxc/NotaServicios';

interface Alumno {
  id: string;
  nombres: string;
  apellidos: string;
}

interface Sucursal {
  id: string;
  nombre: string;
}

interface CobroAplicado {
  monto_aplicado: number;
}

interface CuentaCobrar {
  id: string;
  monto_total: number;
  descripcion: string;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  estado: string;
  ciclo_inicio: string | null;
  ciclo_fin: string | null;
  periodo: string | null;
  alumnos: Alumno | null;
  sucursales: Sucursal | null;
  cobros_aplicados: CobroAplicado[];
}

const NotasAutomaticas: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId, perfil, sucursalId } = useAuthSaaSport();
  
  const [notas, setNotas] = useState<CuentaCobrar[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [busqueda, setBusqueda] = useState('');
  const [filtroSucursal, setFiltroSucursal] = useState('');

  // Modales
  const [cxcParaEditar, setCxcParaEditar] = useState<any | null>(null);
  const [modalNotaVisible, setModalNotaVisible] = useState(false);

  // Cargar sucursales para el filtro
  const cargarSucursales = async () => {
    if (!escuelaId) return;
    try {
      const { data, error: err } = await supabase
        .from('sucursales')
        .select('id, nombre')
        .eq('escuela_id', escuelaId)
        .order('nombre');
      if (err) throw err;
      setSucursales(data || []);
    } catch (err: any) {
      console.error('Error al cargar sucursales:', err.message);
    }
  };

  // Cargar las notas generadas automáticamente pendientes de pago
  const cargarNotas = async () => {
    if (!escuelaId) return;
    setCargando(true);
    setError(null);
    try {
      const { data, error: queryError } = await supabase
        .from('cuentas_cobrar')
        .select(`
          id,
          monto_total,
          descripcion,
          fecha_emision,
          fecha_vencimiento,
          estado,
          ciclo_inicio,
          ciclo_fin,
          periodo,
          alumnos (id, nombres, apellidos),
          sucursales (id, nombre),
          cobros_aplicados (monto_aplicado)
        `)
        .eq('origen_facturacion', 'automatico')
        .neq('estado', 'pagada')
        .eq('escuela_id', escuelaId)
        .order('fecha_emision', { ascending: false });

      if (queryError) throw queryError;
      setNotas((data as any) || []);
    } catch (err: any) {
      setError(err.message || 'Error al cargar las notas automáticas.');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (escuelaId) {
      cargarNotas();
      cargarSucursales();
    }
  }, [escuelaId]);

  // Si el usuario tiene rol limitado a una sucursal, forzar el filtro
  const sucursalBloqueada = perfil?.rol === 'Entrenador' || perfil?.rol === 'Asistente' ? sucursalId : null;
  const filtroSucursalEfectivo = sucursalBloqueada || filtroSucursal;

  // Filtrar notas localmente
  const notasFiltradas = useMemo(() => {
    return notas.filter(nota => {
      const matchSucursal = filtroSucursalEfectivo ? nota.sucursales?.id === filtroSucursalEfectivo : true;
      
      const nombreCompleto = nota.alumnos 
        ? `${nota.alumnos.nombres} ${nota.alumnos.apellidos}`.toLowerCase()
        : '';
      const matchBusqueda = busqueda.trim() === '' || nombreCompleto.includes(busqueda.toLowerCase());

      return matchSucursal && matchBusqueda;
    });
  }, [notas, busqueda, filtroSucursalEfectivo]);

  const formatFechaBonita = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const formatMonto = (n: number): string =>
    n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const abrirEdicion = (nota: CuentaCobrar) => {
    // Necesitamos formatear el objeto nota para que coincida con lo que NotaServicios espera
    // NotaServicios espera que la nota tenga alumnos y otros campos planos
    setCxcParaEditar({
      ...nota,
      alumno_id: nota.alumnos?.id,
      sucursal_id: nota.sucursales?.id
    });
    setModalNotaVisible(true);
  };

  return (
    <main className="main-content" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', background: 'var(--bg-main)', minHeight: '100vh' }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button className="btn-volver" onClick={() => navigate('/cxc')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 'bold', color: 'var(--text-primary)' }}>
            Notas Automáticas Pendientes
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginTop: '0.25rem' }}>
            Listado de mensualidades generadas automáticamente por el sistema que aún no han sido cobradas.
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div style={{ 
        display: 'flex', 
        gap: '1rem', 
        flexWrap: 'wrap',
        alignItems: 'center', 
        marginBottom: '1.5rem', 
        padding: '1rem', 
        background: 'var(--bg-card)', 
        border: '1px solid var(--border)', 
        borderRadius: '8px' 
      }}>
        {/* Buscador */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: 1, minWidth: '200px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Buscar Alumno</label>
          <div style={{ position: 'relative' }}>
            <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input 
              type="text" 
              placeholder="Escribe el nombre del alumno..."
              value={busqueda} 
              onChange={(e) => setBusqueda(e.target.value)} 
              style={{ 
                width: '100%', 
                background: 'var(--bg-input)', 
                border: '1px solid var(--border)', 
                padding: '0.4rem 0.4rem 0.4rem 2.2rem', 
                borderRadius: '6px', 
                color: 'var(--text-primary)',
                fontSize: '0.9rem'
              }} 
            />
          </div>
        </div>

        {/* Filtro Sucursal (solo si no está restringido a una) */}
        {!sucursalBloqueada && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '200px' }}>
            <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Sucursal</label>
            <select
              value={filtroSucursal}
              onChange={(e) => setFiltroSucursal(e.target.value)}
              style={{ 
                background: 'var(--bg-input)', 
                border: '1px solid var(--border)', 
                padding: '0.4rem', 
                borderRadius: '6px', 
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                height: '34px'
              }}
            >
              <option value="">Todas las Sucursales</option>
              {sucursales.map(s => (
                <option key={s.id} value={s.id}>{s.nombre}</option>
              ))}
            </select>
          </div>
        )}

        <button 
          onClick={cargarNotas}
          className="btn-nueva-cuenta"
          style={{ height: '34px', marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0 1rem' }}
        >
          <RefreshCw size={14} className={cargando ? 'spin' : ''} />
          <span>Actualizar</span>
        </button>
      </div>

      {/* Contenido Principal */}
      {error && (
        <div className="login-error" style={{ margin: '1rem 0', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {cargando ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh', flexDirection: 'column', gap: '1rem' }}>
          <RefreshCw size={32} className="spin" style={{ color: 'var(--primary)' }} />
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Cargando notas automáticas pendientes...</p>
        </div>
      ) : notasFiltradas.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', color: 'var(--text-secondary)' }}>
          <FileText size={48} style={{ opacity: 0.3, marginBottom: '1rem' }} />
          <p style={{ fontSize: '1.05rem', fontWeight: 500 }}>No hay notas automáticas pendientes</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.25rem', opacity: 0.8 }}>Todas las facturas automáticas han sido cobradas, editadas o no coinciden con los filtros.</p>
        </div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255, 255, 255, 0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Alumno</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Sucursal</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Concepto</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Ciclo Facturado</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>F. Emisión</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 600 }}>F. Venc.</th>
                  <th style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>Monto</th>
                  <th style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>Saldo Pendiente</th>
                  <th style={{ padding: '1rem', textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 600 }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {notasFiltradas.map((nota) => {
                  const totalCobrado = nota.cobros_aplicados?.reduce((s, c) => s + Number(c.monto_aplicado), 0) || 0;
                  const saldoPendiente = nota.monto_total - totalCobrado;

                  return (
                    <tr key={nota.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {nota.alumnos ? `${nota.alumnos.nombres} ${nota.alumnos.apellidos}` : 'Alumno desconocido'}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                        {nota.sucursales?.nombre || 'Sin sucursal'}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                        {nota.descripcion}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {nota.ciclo_inicio && nota.ciclo_fin ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Calendar size={12} />
                            {formatFechaBonita(nota.ciclo_inicio)} al {formatFechaBonita(nota.ciclo_fin)}
                          </span>
                        ) : 'No especificado'}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                        {formatFechaBonita(nota.fecha_emision)}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)' }}>
                        {formatFechaBonita(nota.fecha_vencimiento)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                        Bs {formatMonto(nota.monto_total)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', fontWeight: 700, color: saldoPendiente > 0 ? 'var(--warning)' : 'var(--text-primary)' }}>
                        Bs {formatMonto(saldoPendiente)}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        <button 
                          onClick={() => abrirEdicion(nota)}
                          className="btn-volver"
                          style={{ height: '30px', padding: '0 0.75rem', fontSize: '0.8rem', display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderColor: 'var(--border)' }}
                        >
                          <Pencil size={12} />
                          <span>Editar</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal de Edición Reutilizado */}
      {modalNotaVisible && cxcParaEditar && (
        <NotaServicios
          visible={modalNotaVisible}
          onCerrar={() => { setModalNotaVisible(false); setCxcParaEditar(null); }}
          onCreada={() => { 
            setModalNotaVisible(false); 
            setCxcParaEditar(null); 
            cargarNotas(); 
          }}
          alumnoPreseleccionado={cxcParaEditar.alumnos ? { 
            id: cxcParaEditar.alumnos.id, 
            nombre: `${cxcParaEditar.alumnos.nombres} ${cxcParaEditar.alumnos.apellidos}` 
          } : null}
          cxcEditar={cxcParaEditar}
          modoInicial="editar"
        />
      )}
    </main>
  );
};

export default NotasAutomaticas;
