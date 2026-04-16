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
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda } from '../../types/cxc';
import {
  ChevronLeft, RefreshCw, Plus, Search,
  Users, AlertTriangle, DollarSign,
  MessageCircle, CreditCard, FileText, BookOpen
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Componentes del módulo
import FiltrosCxc from '../../components/cxc/FiltrosCxc';
import NotaServicios from '../../components/cxc/NotaServicios';
import DetalleAlumnoCxc from '../../components/cxc/DetalleAlumnoCxc';
import ModalCobroRapido from '../../components/cxc/ModalCobroRapido';
import ModalSaldoInicialCxC from '../../components/cxc/ModalSaldoInicialCxC';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CuentasCobrar: React.FC = () => {
  const navigate = useNavigate();

  // Datos principales
  const [alumnosDeuda, setAlumnosDeuda] = useState<AlumnoDeuda[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda
  const [busqueda, setBusqueda] = useState('');

  // Filtro rápido: solo con deuda
  const [soloConDeuda, setSoloConDeuda] = useState(false);

  // Filtros bidireccionales
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroEntrenador, setFiltroEntrenador] = useState('');
  const [filtroCancha, setFiltroCancha] = useState('');
  const [filtroHorario, setFiltroHorario] = useState('');

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

  // Obtener escuela_id del usuario autenticado
  const obtenerEscuelaId = async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', user.id)
      .single();
    return data?.escuela_id ?? null;
  };

  // Cargar datos
  const cargarDatos = async () => {
    setCargando(true);
    setError(null);

    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) {
      setError('No se pudo determinar tu escuela. Reinicia sesión.');
      setCargando(false);
      return;
    }

    const { data, error: err } = await supabase
      .from('v_alumnos_deuda')
      .select('*, fecha_nacimiento')
      .eq('escuela_id', escuelaId);

    if (err) {
      setError(`Error al cargar: ${err.message}`);
      setCargando(false);
      return;
    }
    setAlumnosDeuda((data as unknown as AlumnoDeuda[]) ?? []);
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

  // Estadísticas sobre los alumnos con filtros de primer nivel aplicados
  const statsGlobales = useMemo(() => {
    let lista = alumnosDeuda;
    if (filtroSucursal) lista = lista.filter(a => a.sucursal_id === filtroSucursal);
    if (filtroEntrenador) lista = lista.filter(a => a.entrenador_id === filtroEntrenador);
    if (filtroCancha) lista = lista.filter(a => a.cancha_id === filtroCancha);
    if (filtroHorario) lista = lista.filter(a => a.horario_id === filtroHorario);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(a =>
        a.nombres.toLowerCase().includes(q) ||
        a.apellidos.toLowerCase().includes(q)
      );
    }
    return {
      totalAlumnos: lista.length,
      conDeuda: lista.filter(a => Number(a.saldo_pendiente) > 0).length,
      totalPendiente: lista.reduce((s, a) => s + Number(a.saldo_pendiente), 0),
    };
  }, [alumnosDeuda, filtroSucursal, filtroEntrenador, filtroCancha, filtroHorario, busqueda]);

  // Filtrar y ordenar alumnos
  const alumnosFiltrados = useMemo(() => {
    let lista = alumnosDeuda;
    if (filtroSucursal) lista = lista.filter(a => a.sucursal_id === filtroSucursal);
    if (filtroEntrenador) lista = lista.filter(a => a.entrenador_id === filtroEntrenador);
    if (filtroCancha) lista = lista.filter(a => a.cancha_id === filtroCancha);
    if (filtroHorario) lista = lista.filter(a => a.horario_id === filtroHorario);
    if (soloConDeuda) lista = lista.filter(a => Number(a.saldo_pendiente) > 0);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(a =>
        a.nombres.toLowerCase().includes(q) ||
        a.apellidos.toLowerCase().includes(q)
      );
    }
    return lista.sort((a, b) =>
      `${a.nombres} ${a.apellidos}`.localeCompare(`${b.nombres} ${b.apellidos}`)
    );
  }, [alumnosDeuda, filtroSucursal, filtroEntrenador, filtroCancha, filtroHorario, busqueda, soloConDeuda]);

  // Limpiar todos los filtros
  const limpiarFiltros = () => {
    setFiltroSucursal(''); setFiltroEntrenador('');
    setFiltroCancha(''); setFiltroHorario('');
    setSoloConDeuda(false);
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
    <main className="main-content cxc-main">
      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Cuentas por Cobrar</h1>
          </div>
        </div>
        <div className="cxc-header-acciones">
          <button
            className="btn-nueva-cuenta btn-nuevo-cobro"
            onClick={() => { setAlumnoParaCobro(null); setMostrarCobroRapido(true); }}
          >
            <CreditCard size={16} /> Nuevo Cobro
          </button>
          <button
            className="btn-nueva-cuenta"
            onClick={() => { setAlumnoParaNota(null); setMostrarNota(true); }}
          >
            <Plus size={16} /> Nueva Nota
          </button>
          <button
            className="btn-nueva-cuenta"
            onClick={() => setMostrarSaldoInicial(true)}
            style={{ background: '#f59e0b', borderColor: '#f59e0b' }}
          >
            <BookOpen size={16} /> Saldo Inicial
          </button>
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Barra de Control: Filtros + Stats en una sola línea ─── */}
      <div className="cxc-barra-control">
        {/* Filtros de primer nivel (izquierda, toma el espacio sobrante) */}
        <div className="cxc-filtros-inline">
          <FiltrosCxc
            sucursalId={filtroSucursal}
            entrenadorId={filtroEntrenador}
            canchaId={filtroCancha}
            horarioId={filtroHorario}
            onChangeSucursal={setFiltroSucursal}
            onChangeEntrenador={setFiltroEntrenador}
            onChangeCancha={setFiltroCancha}
            onChangeHorario={setFiltroHorario}
            onLimpiar={limpiarFiltros}
            compact
          />
        </div>

        {/* Tarjetas de stats compactas (derecha) */}
        <div className="cxc-stats-inline">
          {/* Tarjeta Alumnos — limpia filtro "Con Deuda" */}
          <button
            className={`cxc-mini-stat ${!soloConDeuda ? 'cxc-mini-stat--activo' : ''}`}
            onClick={() => setSoloConDeuda(false)}
            title="Mostrar todos los alumnos"
          >
            <Users size={15} />
            <span className="cxc-mini-num">{statsGlobales.totalAlumnos}</span>
            <span className="cxc-mini-label">Alumnos</span>
          </button>

          {/* Tarjeta Con Deuda — filtro rápido */}
          <button
            className={`cxc-mini-stat cxc-mini-stat--deuda ${soloConDeuda ? 'cxc-mini-stat--activo' : ''}`}
            onClick={() => setSoloConDeuda(!soloConDeuda)}
            title={soloConDeuda ? 'Clic para mostrar todos' : 'Clic para filtrar deudores'}
          >
            <AlertTriangle size={15} />
            <span className="cxc-mini-num cxc-mini-num--warn">{statsGlobales.conDeuda}</span>
            <span className="cxc-mini-label">{soloConDeuda ? '⊘ Con Deuda' : 'Con Deuda'}</span>
          </button>

          {/* Tarjeta Total Pendiente */}
          <div className="cxc-mini-stat cxc-mini-stat--total">
            <DollarSign size={15} />
            <span className="cxc-mini-num cxc-mini-num--danger">Bs {fmtMonto(statsGlobales.totalPendiente)}</span>
            <span className="cxc-mini-label">Total Pend.</span>
          </div>
        </div>
      </div>

      {/* ─── Barra de búsqueda ─── */}
      <div className="cxc-busqueda-bar">
        <div className="pc-busqueda">
          <Search size={16} className="pc-busqueda-icono" />
          <input
            type="text"
            placeholder="Buscar alumno por nombre..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pc-busqueda-input"
          />
        </div>
        {busqueda && (
          <button
            className="cxc-limpiar-busqueda"
            onClick={() => setBusqueda('')}
          >
            ✕
          </button>
        )}
        <span className="cxc-conteo-resultado">
          {alumnosFiltrados.length} resultado{alumnosFiltrados.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="pc-error">
          <p>⚠️ {error}</p>
          <button onClick={cargarDatos}>Reintentar</button>
        </div>
      )}

      {/* ─── Lista de alumnos tipo hoja de cálculo ─── */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando alumnos...</p>
        </div>
      ) : alumnosFiltrados.length === 0 ? (
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
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th cxc-th-alumno">Alumno</th>
                <th className="cxc-th">Sucursal</th>
                <th className="cxc-th cxc-th-center">Entrenador</th>
                <th className="cxc-th cxc-th-center">Asist. {mesAnteriorStr}</th>
                <th className="cxc-th cxc-th-center">Asist. {mesActualStr}</th>
                <th className="cxc-th cxc-th-right">CxC Pend.</th>
                <th className="cxc-th cxc-th-right">Total Deuda</th>
                <th className="cxc-th cxc-th-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alumnosFiltrados.map(alumno => {
                const tieneDeuda = Number(alumno.saldo_pendiente) > 0;
                return (
                  <tr
                    key={alumno.alumno_id}
                    className={`cxc-tr ${tieneDeuda ? 'cxc-tr--deuda' : ''}`}
                    onClick={() => setAlumnoSeleccionado(alumno)}
                    title="Clic para ver detalle de movimientos"
                  >
                    <td className="cxc-td cxc-td-alumno">
                      <span className="cxc-alumno-avatar">
                        {alumno.nombres[0]}{alumno.apellidos[0]}
                      </span>
                      <div className="cxc-alumno-info">
                        <span className="cxc-alumno-nombre">{alumno.nombres} {alumno.apellidos}</span>
                      </div>
                    </td>
                    <td className="cxc-td cxc-td-meta">{alumno.sucursal_nombre || '—'}</td>
                    <td className="cxc-td cxc-td-center cxc-td-meta">{alumno.entrenador_nombre || '—'}</td>
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal: Nota de Servicios */}
      <NotaServicios
        visible={mostrarNota}
        onCerrar={() => { setMostrarNota(false); setAlumnoParaNota(null); }}
        onCreada={cargarDatos}
        alumnoPreseleccionado={alumnoParaNota}
      />

      {/* Modal: Cobro rápido */}
      {mostrarCobroRapido && (
        <ModalCobroRapido
          alumnoInicial={alumnoParaCobro}
          visible={mostrarCobroRapido}
          onCerrar={() => { setMostrarCobroRapido(false); setAlumnoParaCobro(null); }}
          onCobrado={cargarDatos}
        />
      )}

      {/* Modal: Detalle de movimientos del alumno */}
      <DetalleAlumnoCxc
        alumno={alumnoSeleccionado}
        visible={!!alumnoSeleccionado}
        onCerrar={() => setAlumnoSeleccionado(null)}
        onActualizar={cargarDatos}
      />

      {/* Modal: Saldo Inicial CxC */}
      <ModalSaldoInicialCxC
        visible={mostrarSaldoInicial}
        onCerrar={() => setMostrarSaldoInicial(false)}
        onCreado={() => { setMostrarSaldoInicial(false); cargarDatos(); }}
      />
    </main>
  );
};

export default CuentasCobrar;
