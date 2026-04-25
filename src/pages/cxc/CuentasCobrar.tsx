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
import React, { useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda } from '../../types/cxc';
import {
  RefreshCw, Plus, Search,
  Users, CreditCard, FileText, BookOpen, MessageCircle
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

import { useDebounce } from '../../hooks/useDebounce';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useCxcAlumnos, useCxcResumen } from '../../hooks/useFinanzas';
import { useQueryClient } from '@tanstack/react-query';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CuentasCobrar: React.FC = () => {
  const navigate = useNavigate();
  const { setExtra } = useContext(SidebarContext);
  const { escuelaId } = useAuthSaaSport();
  const queryClient = useQueryClient();

  // Búsqueda con Debounce
  const [busqueda, setBusqueda] = useState('');
  const debouncedBusqueda = useDebounce(busqueda, 500);

  // Filtros rápidos y de servidor
  const [soloConDeuda, setSoloConDeuda] = useState(false);
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroEntrenador, setFiltroEntrenador] = useState('');
  const [filtroCancha, setFiltroCancha] = useState('');
  const [filtroHorario, setFiltroHorario] = useState('');

  // Paginación
  const [pagina, setPagina] = useState(1);
  const itemsPorPagina = 20;

  // Hooks de datos (Fase 1: Cálculos en DB + Fase 2: Caché)
  const filtros = {
    sucursalId: filtroSucursal,
    entrenadorId: filtroEntrenador,
    canchaId: filtroCancha,
    horarioId: filtroHorario,
    soloConDeuda,
    busqueda: debouncedBusqueda,
    pagina,
    itemsPorPagina
  };

  const { data: alumnosData, isLoading: cargandoAlumnos, error: errorAlumnos, refetch: refetchAlumnos } = useCxcAlumnos(escuelaId, filtros);
  const { data: resumenData, isLoading: cargandoResumen, refetch: refetchResumen } = useCxcResumen(escuelaId);

  const cargando = cargandoAlumnos || cargandoResumen;
  const alumnosDeuda = (alumnosData?.data as unknown as AlumnoDeuda[]) || [];
  const totalResultados = alumnosData?.count || 0;
  const stats = {
    totalAlumnos: resumenData?.total_alumnos || 0,
    conDeuda: resumenData?.con_deuda || 0,
    totalPendiente: Number(resumenData?.total_pendiente || 0)
  };

  // Modales
  const [mostrarNota, setMostrarNota] = useState(false);
  const [alumnoSeleccionado, setAlumnoSeleccionado] = useState<AlumnoDeuda | null>(null);
  const [alumnoParaNota, setAlumnoParaNota] = useState<{ id: string; nombre: string } | null>(null);

  // Modal cobro rápido desde la lista
  const [alumnoParaCobro, setAlumnoParaCobro] = useState<AlumnoDeuda | null>(null);
  const [mostrarCobroRapido, setMostrarCobroRapido] = useState(false);
  const [mostrarSaldoInicial, setMostrarSaldoInicial] = useState(false);

  // Nombres de meses para cabecera de tabla
  const nombresMeses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  const fechaHoy = new Date();
  const mesActualStr = nombresMeses[fechaHoy.getMonth()];
  const fechaHoyAnt = new Date(); fechaHoyAnt.setMonth(fechaHoyAnt.getMonth() - 1);
  const mesAnteriorStr = nombresMeses[fechaHoyAnt.getMonth()];

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cxc-alumnos'] });
    queryClient.invalidateQueries({ queryKey: ['cxc-resumen'] });
  };


  // Abrir nota para un alumno específico
  const abrirNotaParaAlumno = (e: React.MouseEvent, alumno: AlumnoDeuda) => {
    e.stopPropagation();
    setAlumnoParaNota({ id: alumno.alumno_id, nombre: `${alumno.nombres} ${alumno.apellidos}` });
    setMostrarNota(true);
  };

  // Abrir cobro rápido para un alumno
  const abrirCobroRapido = (e: React.MouseEvent, alumno: AlumnoDeuda) => {
    e.stopPropagation();
    setAlumnoParaCobro(alumno);
    setMostrarCobroRapido(true);
  };

  // Enviar WhatsApp al padre/madre del alumno
  const enviarWhatsApp = (e: React.MouseEvent, alumno: AlumnoDeuda) => {
    e.stopPropagation();
    const esPadre = alumno.whatsapp_preferido === 'padre';
    const nombre = esPadre
      ? (alumno.nombre_padre || alumno.nombre_madre || 'Padre/Madre')
      : (alumno.nombre_madre || alumno.nombre_padre || 'Padre/Madre');
    const telefono = esPadre
      ? (alumno.telefono_padre || alumno.telefono_madre)
      : (alumno.telefono_madre || alumno.telefono_padre);

    if (!telefono) {
      alert('No se encontró un número de teléfono registrado para este alumno.');
      return;
    }
    const telLimpio = telefono.replace(/\D/g, '');
    const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
    const saldo = Number(alumno.saldo_pendiente);
    const mensaje = saldo > 0
      ? `Estimado/a ${nombre}, le recordamos que ${alumno.nombres} ${alumno.apellidos} tiene un saldo pendiente de Bs ${fmtMonto(saldo)}. Por favor regularice el pago a la brevedad. Gracias.`
      : `Estimado/a ${nombre}, le informamos que la cuenta de ${alumno.nombres} ${alumno.apellidos} está al día. ¡Gracias por su puntualidad!`;
    window.open(`https://wa.me/${telFinal}?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  return (
    <main className="main-content cxc-main-sticky" style={{ 
      paddingTop: 0, 
      paddingBottom: '1rem', 
      paddingLeft: '1.5rem', 
      paddingRight: '1.5rem', 
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      minHeight: 'auto'
    }}>
      {/* ─── Barra de Control Simplificada ─── */}
      <div className="cxc-barra-control" style={{ margin: 0, padding: '0.5rem 1.25rem' }}>
        <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <FiltrosCxc
              sucursalId={filtroSucursal}
              entrenadorId={filtroEntrenador}
              canchaId={filtroCancha}
              horarioId={filtroHorario}
              onChangeSucursal={setFiltroSucursal}
              onChangeEntrenador={setFiltroEntrenador}
              onChangeCancha={setFiltroCancha}
              onChangeHorario={setFiltroHorario}
              onLimpiar={() => {
                setFiltroSucursal(''); setFiltroEntrenador('');
                setFiltroCancha(''); setFiltroHorario('');
              }}
              compact
            />
          </div>

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
            onChange={e => setBusqueda(e.target.value)}
            className="cxc-search-input"
          />
          {busqueda && (
            <button className="cxc-search-clear" onClick={() => setBusqueda('')}>✕</button>
          )}
        </div>

        <div className="cxc-stats-horizontal">
          <div className="cxc-stat-pill" onClick={() => setSoloConDeuda(!soloConDeuda)} style={{ cursor: 'pointer' }}>
            <span className="cxc-pill-label">Deudores</span>
            <span className={`cxc-pill-value ${soloConDeuda ? 'text-warn' : ''}`}>
              {stats.conDeuda}
            </span>
          </div>
          <div className="cxc-stat-pill cxc-stat-pill--danger">
            <span className="cxc-pill-label">Pendiente</span>
            <span className="cxc-pill-value">Bs {fmtMonto(stats.totalPendiente)}</span>
          </div>
          <span className="cxc-divider-mini" />
          <span className="cxc-result-count">
            {totalResultados} alumnos
          </span>
        </div>
      </div>

      {/* ─── Error ─── */}
      {errorAlumnos && (
        <div className="pc-error">
          <p>⚠️ {errorAlumnos instanceof Error ? errorAlumnos.message : 'Error desconocido'}</p>
          <button onClick={manejarActualizacion}>Reintentar</button>
        </div>
      )}

      {/* ─── Lista de alumnos tipo hoja de cálculo ─── */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando alumnos...</p>
        </div>
      ) : alumnosDeuda.length === 0 ? (
        <div className="arbol-vacio">
          <Users size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>{soloConDeuda ? 'No hay alumnos con deuda en los filtros actuales.' : 'No se encontraron alumnos con los filtros actuales.'}</p>
          {soloConDeuda && (
            <button
              onClick={() => setSoloConDeuda(false)}
              style={{ marginTop: '0.5rem', color: 'var(--secondary)', background: 'none', border: '1px solid var(--secondary)', padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer' }}
            >
              Mostrar todos los alumnos
            </button>
          )}
        </div>
      ) : (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla cxc-tabla-fixed">
            <thead>
              <tr>
                <th className="cxc-th cxc-th-alumno">Alumno</th>
                <th className="cxc-th cxc-th-sucursal">Sucursal</th>
                <th className="cxc-th cxc-th-sm">Sub</th>
                <th className="cxc-th cxc-th-sm">{mesAnteriorStr}</th>
                <th className="cxc-th cxc-th-sm">{mesActualStr}</th>
                <th className="cxc-th cxc-th-monto">CxC Pend.</th>
                <th className="cxc-th cxc-th-monto">Deuda Total</th>
                <th className="cxc-th cxc-th-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alumnosDeuda.map(alumno => {
                const tieneDeuda = Number(alumno.saldo_pendiente) > 0;
                return (
                  <tr
                    key={alumno.alumno_id}
                    className={`cxc-tr cxc-tr-clickable ${tieneDeuda ? 'cxc-tr--deuda' : ''}`}
                    onClick={() => setAlumnoSeleccionado(alumno)}
                    title="Clic para ver detalle de movimientos"
                  >
                    <td className="cxc-td cxc-td-alumno">
                      <div className="cxc-alumno-info">
                        <span className="cxc-alumno-nombre">{alumno.nombres} {alumno.apellidos}</span>
                      </div>
                    </td>
                    <td className="cxc-td cxc-td-meta">{alumno.sucursal_nombre || '—'}</td>
                    <td className="cxc-td cxc-td-center cxc-td-meta">{alumno.sub ? `Sub ${alumno.sub}` : '—'}</td>
                    <td className="cxc-td cxc-td-center cxc-td-asist">{alumno.asistencias_anterior || 0}</td>
                    <td className="cxc-td cxc-td-center cxc-td-asist cxc-td-asist--actual">{alumno.asistencias_actual || 0}</td>
                    <td className="cxc-td cxc-td-right">
                      {Number(alumno.cxc_pendientes) > 0 ? (
                        <span className="cxc-badge-num">{alumno.cxc_pendientes}</span>
                      ) : <span className="cxc-td-dash">—</span>}
                    </td>
                    <td className="cxc-td cxc-td-right">
                      {tieneDeuda
                        ? <span className="cxc-monto-deuda">Bs {fmtMonto(Number(alumno.saldo_pendiente))}</span>
                        : <span className="cxc-al-dia">✓ Al día</span>
                      }
                    </td>
                    {/* Acciones por alumno */}
                    <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                      <div className="cxc-acciones-wrap">
                        <button
                          className="cxc-accion-btn cxc-accion-btn--nota"
                          onClick={e => abrirNotaParaAlumno(e, alumno)}
                          title="Crear Nota de Servicio"
                        >
                          <FileText size={13} />
                          <span>Nota</span>
                        </button>
                        {tieneDeuda && (
                          <button
                            className="cxc-accion-btn cxc-accion-btn--cobro"
                            onClick={e => abrirCobroRapido(e, alumno)}
                            title="Registrar Pago"
                          >
                            <CreditCard size={13} />
                            <span>Cobrar</span>
                          </button>
                        )}
                        <button
                          className="cxc-accion-btn cxc-accion-btn--wa"
                          onClick={e => enviarWhatsApp(e, alumno)}
                          title="Enviar mensaje WhatsApp"
                        >
                          <MessageCircle size={13} />
                          <span>WA</span>
                        </button>
                      </div>
                    </td>
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

    </main>
  );
};

export default CuentasCobrar;
