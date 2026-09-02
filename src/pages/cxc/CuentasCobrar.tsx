/**
 * CuentasCobrar.tsx
 * Centro de Mando del módulo Cuentas por Cobrar — REDISEÑADO v3.
 *
 * Layout:
 * 1. Header (título + botones)
 * 2. Barra única: Filtros de primer nivel + tarjetas de stats compactas
 * 3. Barra de búsqueda
 * 4. Tabla tipo hoja de cálculo con acciones por alumno
 */
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda } from '../../types/cxc';
import {
  RefreshCw, Plus, Search,
  Users, CreditCard, FileText, BookOpen, Eye
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { SidebarContext } from '../../App';
import { useContext } from 'react';

// Componentes del módulo
import FiltrosCxc from '../../components/cxc/FiltrosCxc';
import NotaServicios from '../../components/cxc/NotaServicios';
import DetalleAlumnoCxc from '../../components/cxc/DetalleAlumnoCxc';
import ModalCobroRapido from '../../components/cxc/ModalCobroRapido';
import ModalSaldoInicialCxC from '../../components/cxc/ModalSaldoInicialCxC';
import ModalNotaMasiva from '../../components/cxc/ModalNotaMasiva';

import { useDebounce } from '../../hooks/useDebounce';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useCxcBusqueda } from '../../hooks/useFinanzas';
import { formatearMesCorto } from '../../lib/dateUtils';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '../../hooks/useIsMobile';
import { getDataScope } from '../../config/roles';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type FiltroEstadoAlumno = 'activos' | 'archivados' | 'todos';

const CuentasCobrar: React.FC = () => {
  const navigate = useNavigate();
  const { setExtra } = useContext(SidebarContext);
  const { session, escuelaId, sucursalId, perfil } = useAuthSaaSport();
  const queryClient = useQueryClient();
  const isMobile = useIsMobile();

  // Búsqueda con Debounce
  const [busqueda, setBusqueda] = useState('');
  const debouncedBusqueda = useDebounce(busqueda, 300);
  const busquedaDebouncedValida = debouncedBusqueda.trim().length !== 1;

  // Filtros rápidos y de servidor
  // CxC abre enfocada en los alumnos deudores; el indicador permite quitar el filtro.
  const [soloConDeuda, setSoloConDeuda] = useState(true);
  const [filtroEstadoAlumno, setFiltroEstadoAlumno] = useState<FiltroEstadoAlumno>('activos');
  const filtrosAntesBusqueda = useRef<{ soloConDeuda: boolean; estado: FiltroEstadoAlumno } | null>(null);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroEntrenador, setFiltroEntrenador] = useState('');
  const [filtroGrupo, setFiltroGrupo] = useState('');

  // Los roles con alcance de sucursal nunca deben poder ampliar CxC a toda la escuela.
  // El filtro visible sigue disponible para usuarios con alcance escolar.
  const sucursalBloqueada = getDataScope(perfil?.rol) === 'branch' && !!sucursalId;
  const sucursalEfectiva = sucursalBloqueada ? sucursalId : filtroSucursal;

  // Paginación
  const [pagina, setPagina] = useState(1);
  const itemsPorPagina = 30;

  const manejarBusqueda = (valor: string) => {
    const teniaBusqueda = busqueda.trim().length > 0;
    const tieneBusqueda = valor.trim().length > 0;

    if (!teniaBusqueda && tieneBusqueda) {
      filtrosAntesBusqueda.current = { soloConDeuda, estado: filtroEstadoAlumno };
    }

    if (teniaBusqueda && !tieneBusqueda && filtrosAntesBusqueda.current) {
      setSoloConDeuda(filtrosAntesBusqueda.current.soloConDeuda);
      setFiltroEstadoAlumno(filtrosAntesBusqueda.current.estado);
      filtrosAntesBusqueda.current = null;
    }

    setBusqueda(valor);
  };

  useEffect(() => {
    setPagina(1);
  }, [debouncedBusqueda, soloConDeuda, filtroEstadoAlumno, sucursalEfectiva, filtroEntrenador, filtroGrupo]);

  const filtros = {
    sucursalId: sucursalEfectiva,
    entrenadorId: filtroEntrenador,
    grupoId: filtroGrupo,
    soloConDeuda: debouncedBusqueda.trim().length >= 2 ? false : soloConDeuda,
    filtroEstadoAlumno: debouncedBusqueda.trim().length >= 2 ? 'todos' as const : filtroEstadoAlumno,
    busqueda: debouncedBusqueda.trim().length >= 2 ? debouncedBusqueda : '',
    pagina,
    itemsPorPagina
  };

  const alcanceBusqueda = {
    userId: session?.user?.id || null,
    escuelaId,
    sucursalId: sucursalEfectiva || null,
  };
  const { data: busquedaData, isLoading: cargando } = useCxcBusqueda(alcanceBusqueda, filtros, busquedaDebouncedValida);
  const alumnosDeuda = (busquedaData?.items as AlumnoDeuda[]) || [];
  const totalResultados = busquedaData?.total_resultados || 0;
  const stats = {
    totalAlumnos: busquedaData?.resumen.total_alumnos || 0,
    conDeuda: busquedaData?.resumen.con_deuda || 0,
    totalPendiente: Number(busquedaData?.resumen.total_pendiente || 0)
  };

  // Modales
  const [mostrarNota, setMostrarNota] = useState(false);
  const [alumnoSeleccionado, setAlumnoSeleccionado] = useState<AlumnoDeuda | null>(null);
  const [alumnoParaNota, setAlumnoParaNota] = useState<{ id: string; nombre: string } | null>(null);

  // Modal cobro rápido desde la lista
  const [alumnoParaCobro, setAlumnoParaCobro] = useState<AlumnoDeuda | null>(null);
  const [mostrarCobroRapido, setMostrarCobroRapido] = useState(false);
  const [mostrarSaldoInicial, setMostrarSaldoInicial] = useState(false);

  // Selección múltiple para notas masivas
  const [alumnosMarcados, setAlumnosMarcados] = useState<AlumnoDeuda[]>([]);
  const [mostrarNotaMasiva, setMostrarNotaMasiva] = useState(false);

  const toggleMarcarAlumno = (alumno: AlumnoDeuda) => {
    if (alumno.archivado) return;
    setAlumnosMarcados(prev => {
      const yaMarcado = prev.some(a => a.alumno_id === alumno.alumno_id);
      if (yaMarcado) {
        return prev.filter(a => a.alumno_id !== alumno.alumno_id);
      }
      if (prev.length >= 30) {
        alert('Por seguridad, solo puedes seleccionar un máximo de 30 alumnos a la vez.');
        return prev;
      }
      return [...prev, alumno];
    });
  };

  const toggleMarcarTodos = (actuales: AlumnoDeuda[]) => {
    const seleccionables = actuales.filter(alumno => !alumno.archivado);
    if (alumnosMarcados.length === seleccionables.length && seleccionables.length > 0) {
      setAlumnosMarcados([]);
    } else {
      const nuevos = seleccionables.slice(0, 30);
      setAlumnosMarcados(nuevos);
      if (seleccionables.length > 30) {
        alert('Se han marcado los primeros 30 alumnos de la lista (límite por seguridad).');
      }
    }
  };

  // Nombres de meses para cabecera de tabla
  const nombresMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const fechaHoy = new Date();
  const mesActualStr = nombresMeses[fechaHoy.getMonth()];
  const fechaHoyAnt = new Date(fechaHoy.getFullYear(), fechaHoy.getMonth() - 1, 1);
  const mesAnteriorStr = nombresMeses[fechaHoyAnt.getMonth()];

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cxc-busqueda'] });
  };


  // Abrir nota para un alumno específico
  const abrirNotaParaAlumno = (e: React.MouseEvent, alumno: AlumnoDeuda) => {
    e.stopPropagation();
    if (alumno.archivado) return;
    setAlumnoParaNota({ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` });
    setMostrarNota(true);
  };

  // Abrir cobro rápido para un alumno
  const abrirCobroRapido = (e: React.MouseEvent, alumno: AlumnoDeuda) => {
    e.stopPropagation();
    if (alumno.archivado) return;
    setAlumnoParaCobro(alumno);
    setMostrarCobroRapido(true);
  };



  return (
    <main className="main-content cxc-main-sticky" style={{ 
      paddingTop: 0, 
      paddingBottom: '1rem', 
      paddingLeft: isMobile ? '0.75rem' : '1.5rem', 
      paddingRight: isMobile ? '0.75rem' : '1.5rem', 
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      minHeight: 'auto',
      maxWidth: '100vw',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }}>
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', width: '100%', boxSizing: 'border-box' }}>
          {/* Buscador y Chip de Resumen */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', width: '100%', marginTop: '1rem' }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <Search size={16} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
              <input
                type="text"
                placeholder="Buscador de Alumno"
                value={busqueda}
                onChange={e => manejarBusqueda(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.6rem 0.75rem 0.6rem 2.2rem',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  boxSizing: 'border-box'
                }}
              />
              {busqueda.trim().length === 1 && (
                <span style={{ display: 'block', marginTop: '0.35rem', color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
                  Escribe al menos 2 caracteres
                </span>
              )}
            </div>
            {(() => {
              const totalDeudaVal = stats.totalPendiente;
              const hasDeuda = totalDeudaVal > 0;
              const hasFavor = totalDeudaVal < 0;
              const badgeColor = hasDeuda ? '#ef4444' : (hasFavor ? '#a855f7' : '#10b981');
              const badgeBg = hasDeuda ? 'rgba(239, 68, 68, 0.08)' : (hasFavor ? 'rgba(168, 85, 247, 0.08)' : 'rgba(16, 185, 129, 0.08)');
              const badgeBorder = hasDeuda ? 'rgba(239, 68, 68, 0.2)' : (hasFavor ? 'rgba(168, 85, 247, 0.2)' : 'rgba(16, 185, 129, 0.2)');
              const badgeText = hasDeuda ? 'PENDIENTE' : (hasFavor ? 'A FAVOR' : 'AL DÍA');
              
              return (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  background: badgeBg,
                  border: `1px solid ${badgeBorder}`,
                  borderRadius: '10px',
                  padding: '0.4rem 0.75rem',
                  gap: '2px'
                }}>
                  <span style={{ fontSize: '0.65rem', fontWeight: 800, color: badgeColor, letterSpacing: '0.05em' }}>{badgeText}</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 800, color: badgeColor }}>
                    Bs {fmtMonto(Math.abs(totalDeudaVal))}
                  </span>
                </div>
              );
            })()}
          </div>

          {/* Tabla Simple: 2 Columnas (ALUMNO y DEUDA TOTAL) */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ background: 'var(--bg-table-header)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'left', width: '70%', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-table-header)' }}>ALUMNO</th>
                  <th style={{ padding: '0.75rem 1rem', textAlign: 'right', width: '30%', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-table-header)' }}>DEUDA TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {alumnosDeuda.map((alumno) => {
                  const saldoVal = Number(alumno.saldo_pendiente);
                  const isDeudor = saldoVal > 0;
                  const isAnticipo = saldoVal < 0;
                  return (
                    <tr
                      key={alumno.alumno_id}
                      onClick={() => setAlumnoSeleccionado(alumno)}
                      style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                    >
                      <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {alumno.nombres} {alumno.apellidos}
                      </td>
                      <td style={{ padding: '0.75rem 1rem', textAlign: 'right', fontWeight: 700, color: isDeudor ? '#38bdf8' : (isAnticipo ? '#a855f7' : '#10b981') }}>
                        Bs {fmtMonto(saldoVal)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Paginación en móvil */}
          {totalResultados > itemsPorPagina && (
            <div className="cxc-paginacion" style={{ marginTop: '0.5rem', justifyContent: 'center' }}>
              <button 
                className="btn-pagi" 
                disabled={pagina === 1} 
                onClick={() => setPagina(p => p - 1)}
              >
                Anterior
              </button>
              <span className="pagi-info">Pág. {pagina} / {Math.ceil(totalResultados / itemsPorPagina)}</span>
              <button 
                className="btn-pagi" 
                disabled={pagina >= Math.ceil(totalResultados / itemsPorPagina)} 
                onClick={() => setPagina(p => p + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* ─── Barra de Control Simplificada ─── */}
          <div className="cxc-barra-control" style={{ margin: 0, padding: '0.5rem 1.25rem' }}>
            <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              {!isMobile && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <FiltrosCxc
                    sucursalId={sucursalEfectiva}
                    sucursalBloqueada={sucursalBloqueada}
                    entrenadorId={filtroEntrenador}
                    grupoId={filtroGrupo}
                    onChangeSucursal={sucursalBloqueada ? () => undefined : setFiltroSucursal}
                    onChangeEntrenador={setFiltroEntrenador}
                    onChangeGrupo={setFiltroGrupo}
                    onLimpiar={() => {
                      setFiltroSucursal(''); setFiltroEntrenador('');
                      setFiltroGrupo('');
                    }}
                    compact
                  />
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button
                  className="btn-excel btn-cobro"
                  onClick={() => { setAlumnoParaCobro(null); setMostrarCobroRapido(true); }}
                  title="Nuevo Cobro"
                >
                  <CreditCard size={14} /> <span>Cobro</span>
                </button>
                <button
                  className="btn-excel btn-nota"
                  onClick={() => { setAlumnoParaNota(null); setMostrarNota(true); }}
                  title="Nueva Nota"
                >
                  <Plus size={14} /> <span>Nota</span>
                </button>
                <button
                  className="btn-excel btn-nota"
                  onClick={() => setMostrarNotaMasiva(true)}
                  disabled={alumnosMarcados.length === 0}
                  title="Notas de Servicio Masivas"
                  style={{ opacity: alumnosMarcados.length === 0 ? 0.5 : 1, cursor: alumnosMarcados.length === 0 ? 'not-allowed' : 'pointer' }}
                >
                  <Users size={14} /> <span>Notas Masivas ({alumnosMarcados.length})</span>
                </button>
                <button
                  className="btn-excel-icon"
                  onClick={() => setMostrarSaldoInicial(true)}
                  title="Migración"
                >
                  <BookOpen size={14} />
                </button>
                <button className="btn-refrescar" onClick={manejarActualizacion} disabled={cargando} title="Actualizar">
                  <RefreshCw size={14} className={cargando ? 'spin' : ''} />
                </button>
              </div>
            </div>
          </div>

          <div className="cxc-search-row" style={{ margin: '0 0 0.5rem 0', padding: '0 1.25rem', border: 'none', background: 'transparent' }}>
            <div className="cxc-search-container" style={{ background: 'var(--bg-card)' }}>
              <Search size={14} className="cxc-search-icon" />
              <input
                type="text"
                placeholder="Filtrar por nombre del alumno..."
                value={busqueda}
                onChange={e => manejarBusqueda(e.target.value)}
                className="cxc-search-input"
              />
              {busqueda && (
                <button className="cxc-search-clear" onClick={() => manejarBusqueda('')}>✕</button>
              )}
            </div>
            {busqueda.trim().length === 1 && (
              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.78rem', whiteSpace: 'nowrap' }}>
                Escribe al menos 2 caracteres
              </span>
            )}

            {!isMobile && (
              <div className="cxc-stats-horizontal">
                <button
                  type="button"
                  className="cxc-stat-pill"
                  onClick={() => setFiltroEstadoAlumno('activos')}
                  aria-pressed={filtroEstadoAlumno === 'activos'}
                  style={{
                    borderColor: filtroEstadoAlumno === 'activos' ? '#10b981' : undefined,
                    background: filtroEstadoAlumno === 'activos' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                    color: 'inherit',
                    cursor: 'pointer'
                  }}
                  title="Ver alumnos activos"
                >
                  <span className="cxc-pill-label" style={{ color: filtroEstadoAlumno === 'activos' ? '#10b981' : undefined }}>Activos</span>
                </button>
                <button
                  type="button"
                  className="cxc-stat-pill"
                  onClick={() => setFiltroEstadoAlumno('archivados')}
                  aria-pressed={filtroEstadoAlumno === 'archivados'}
                  style={{
                    borderColor: filtroEstadoAlumno === 'archivados' ? '#f97316' : undefined,
                    background: filtroEstadoAlumno === 'archivados' ? 'rgba(249, 115, 22, 0.08)' : undefined,
                    color: 'inherit',
                    cursor: 'pointer'
                  }}
                  title="Ver alumnos archivados"
                >
                  <span className="cxc-pill-label" style={{ color: filtroEstadoAlumno === 'archivados' ? '#f97316' : undefined }}>Archivados</span>
                </button>

                {busqueda.trim() && (
                  <button
                    type="button"
                    className="cxc-stat-pill"
                    onClick={() => setFiltroEstadoAlumno('todos')}
                    aria-pressed={filtroEstadoAlumno === 'todos'}
                    style={{
                      borderColor: filtroEstadoAlumno === 'todos' ? '#3b82f6' : undefined,
                      background: filtroEstadoAlumno === 'todos' ? 'rgba(59, 130, 246, 0.08)' : undefined,
                      color: 'inherit',
                      cursor: 'pointer'
                    }}
                    title="Buscar alumnos activos y archivados"
                  >
                    <span className="cxc-pill-label" style={{ color: filtroEstadoAlumno === 'todos' ? '#3b82f6' : undefined }}>Todos</span>
                  </button>
                )}

                <div className="cxc-stat-pill" onClick={() => setSoloConDeuda(!soloConDeuda)} style={{ cursor: 'pointer' }} aria-pressed={soloConDeuda}>
                  <span className="cxc-pill-label">Deudores</span>
                  <span className={`cxc-pill-value ${soloConDeuda ? 'text-warn' : ''}`}>
                    {stats.conDeuda}
                  </span>
                </div>
                <div className="cxc-stat-pill" style={{ borderColor: stats.totalPendiente < 0 ? '#a855f7' : undefined }}>
                  <span className="cxc-pill-label">{stats.totalPendiente < 0 ? 'Saldo a Favor' : 'Pendiente'}</span>
                  <span className="cxc-pill-value" style={{ color: stats.totalPendiente < 0 ? '#a855f7' : undefined }}>
                    {stats.totalPendiente < 0 ? '- ' : ''}Bs {fmtMonto(Math.abs(stats.totalPendiente))}
                  </span>
                </div>
                <span className="cxc-divider-mini" />
                <span className="cxc-result-count">
                  {totalResultados} alumnos
                </span>
              </div>
            )}
          </div>
          <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla cxc-tabla-fixed">
            <thead>
              <tr>
                {!isMobile && (
                  <th className="cxc-th cxc-th-sm" style={{ width: '40px', textAlign: 'center' }}>
                    <input 
                      type="checkbox" 
                      onChange={() => toggleMarcarTodos(alumnosDeuda)}
                      checked={alumnosMarcados.length > 0 && alumnosMarcados.length === Math.min(alumnosDeuda.filter(alumno => !alumno.archivado).length, 30)}
                      style={{ cursor: 'pointer' }}
                      title="Marcar todos (Max 30)"
                    />
                  </th>
                )}
                <th className="cxc-th cxc-th-alumno">Alumno</th>
                {!isMobile && <th className="cxc-th cxc-th-sucursal" title="Última Mensualidad">Ult. Mes.</th>}
                {!isMobile && <th className="cxc-th cxc-th-sm">Sub</th>}
                {!isMobile && <th className="cxc-th cxc-th-sm">{mesAnteriorStr}</th>}
                {!isMobile && <th className="cxc-th cxc-th-sm">{mesActualStr}</th>}
                {!isMobile && <th className="cxc-th cxc-th-sm">PEND</th>}
                <th className="cxc-th cxc-th-monto">Deuda Total</th>
                {!isMobile && <th className="cxc-th cxc-th-acciones">Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {alumnosDeuda.map(alumno => {
                const tieneDeuda = Number(alumno.saldo_pendiente) > 0;
                const esArchivado = !!alumno.archivado;
                return (
                  <tr
                    key={alumno.alumno_id}
                    className={`cxc-tr cxc-tr-clickable ${tieneDeuda ? 'cxc-tr--deuda' : ''} ${esArchivado ? 'cxc-tr--archivado' : ''} ${alumnosMarcados.some(a => a.alumno_id === alumno.alumno_id) ? 'cxc-tr--seleccionado' : ''}`}
                    onClick={() => setAlumnoSeleccionado(alumno)}
                    title="Clic para ver detalle de movimientos"
                    style={{ background: alumnosMarcados.some(a => a.alumno_id === alumno.alumno_id) ? 'rgba(59,130,246,0.1)' : undefined }}
                  >
                    {!isMobile && (
                      <td className="cxc-td cxc-td-center" onClick={e => e.stopPropagation()}>
                        {esArchivado ? <span className="cxc-td-dash" title="Los alumnos archivados son solo de consulta">—</span> : (
                          <input
                            type="checkbox"
                            checked={alumnosMarcados.some(a => a.alumno_id === alumno.alumno_id)}
                            onChange={() => toggleMarcarAlumno(alumno)}
                            style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                          />
                        )}
                      </td>
                    )}
                    <td className="cxc-td cxc-td-alumno">
                      <div className="cxc-alumno-info">
                        <span className="cxc-alumno-nombre">{alumno.nombres} {alumno.apellidos}</span>
                        {esArchivado && <span className="cxc-badge-archivado">Archivado</span>}
                      </div>
                    </td>
                    {!isMobile && <td className="cxc-td cxc-td-meta">{formatearMesCorto(alumno.ultima_mensualidad) || '—'}</td>}
                    {!isMobile && <td className="cxc-td cxc-td-center cxc-td-meta">{alumno.sub ? `Sub ${alumno.sub}` : '—'}</td>}
                    {!isMobile && <td className="cxc-td cxc-td-center cxc-td-asist">{alumno.asistencias_anterior || 0}</td>}
                    {!isMobile && <td className="cxc-td cxc-td-center cxc-td-asist cxc-td-asist--actual">{alumno.asistencias_actual || 0}</td>}
                    {!isMobile && (
                      <td className="cxc-td cxc-td-right">
                        {Number(alumno.cxc_pendientes) > 0 ? (
                          <span className="cxc-badge-num">{alumno.cxc_pendientes}</span>
                        ) : <span className="cxc-td-dash">—</span>}
                      </td>
                    )}
                    <td className="cxc-td cxc-td-right">
                      {Number(alumno.saldo_pendiente) !== 0
                        ? <span className="cxc-monto-deuda" style={{ color: Number(alumno.saldo_pendiente) < 0 ? '#a855f7' : undefined }}>
                            {Number(alumno.saldo_pendiente) < 0 ? '- ' : ''}Bs {fmtMonto(Math.abs(Number(alumno.saldo_pendiente)))}
                          </span>
                        : <span className="cxc-al-dia">✓ Al día</span>
                      }
                    </td>
                    {/* Acciones por alumno */}
                    {!isMobile && (
                      <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                        <div className="cxc-acciones-wrap">
                          {esArchivado ? (
                            <button
                              className="cxc-accion-btn cxc-accion-btn--historial"
                              onClick={() => setAlumnoSeleccionado(alumno)}
                              title="Ver movimientos históricos"
                            >
                              <Eye size={13} />
                              <span>Movimientos</span>
                            </button>
                          ) : <>
                            <button
                              className="cxc-accion-btn cxc-accion-btn--nota"
                              onClick={e => abrirNotaParaAlumno(e, alumno)}
                              title="Crear Nota de Servicio"
                            >
                              <FileText size={13} />
                              <span>Nota</span>
                            </button>
                            <button
                              className="cxc-accion-btn cxc-accion-btn--cobro"
                              onClick={e => abrirCobroRapido(e, alumno)}
                              title="Registrar Pago"
                            >
                              <CreditCard size={13} />
                              <span>Cobrar</span>
                            </button>
                          </>}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Paginación */}
          {totalResultados > itemsPorPagina && (
            <div className="cxc-paginacion">
              <button 
                className="btn-pagi" 
                disabled={pagina === 1} 
                onClick={() => setPagina(p => p - 1)}
              >
                Anterior
              </button>
              <span className="pagi-info">Página {pagina} de {Math.ceil(totalResultados / itemsPorPagina)}</span>
              <button 
                className="btn-pagi" 
                disabled={pagina >= Math.ceil(totalResultados / itemsPorPagina)} 
                onClick={() => setPagina(p => p + 1)}
              >
                Siguiente
              </button>
            </div>
          )}
        </div>
      </>
    )}

      {/* Modal: Nota de Servicios */}
      <NotaServicios
        visible={mostrarNota}
        onCerrar={() => { setMostrarNota(false); setAlumnoParaNota(null); }}
        onCreada={manejarActualizacion}
        alumnoPreseleccionado={alumnoParaNota}
      />

      {/* Modal: Cobro rápido */}
      {mostrarCobroRapido && (
        <ModalCobroRapido
          alumnoInicial={alumnoParaCobro}
          visible={mostrarCobroRapido}
          onCerrar={() => { setMostrarCobroRapido(false); setAlumnoParaCobro(null); }}
          onCobrado={manejarActualizacion}
        />
      )}

      {/* Modal: Detalle de movimientos del alumno */}
      <DetalleAlumnoCxc
        alumno={alumnoSeleccionado}
        visible={!!alumnoSeleccionado}
        onCerrar={() => setAlumnoSeleccionado(null)}
        onActualizar={manejarActualizacion}
      />

      <ModalSaldoInicialCxC
        visible={mostrarSaldoInicial}
        onCerrar={() => setMostrarSaldoInicial(false)}
        onCreado={() => {
          setMostrarSaldoInicial(false);
          manejarActualizacion();
        }}
      />

      <ModalNotaMasiva
        visible={mostrarNotaMasiva}
        onCerrar={() => setMostrarNotaMasiva(false)}
        onCreada={() => {
          setMostrarNotaMasiva(false);
          setAlumnosMarcados([]); // Limpiar selección tras crear
          manejarActualizacion();
        }}
        alumnosSeleccionados={alumnosMarcados}
      />

    </main>
  );
};

export default CuentasCobrar;
