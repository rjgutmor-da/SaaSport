/** Módulo de Registro, Edición y Archivo de Alumnos en SaaSport. */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Edit2,
  GraduationCap,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import { can, getDataScope } from '../../config/roles';
import { simboloMoneda } from '../../lib/moneda';
import { useDebounce } from '../../hooks/useDebounce';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useGrupos, useSucursales } from '../../hooks/useMasterData';
import { usePlanEscuela } from '../../hooks/usePlanEscuela';
import { useActualizarNotasAutomaticasPendientes } from '../../hooks/useNotasAutomaticasPendientes';
import { useAlumnosSaaSport, useInvalidarAlumnosSaaSport } from '../../hooks/useAlumnosSaaSport';
import { restaurarAlumnoSaaSport } from '../../services/alumnos';
import ModalFormularioAlumno, {
  type GrupoOpcion,
  type SucursalOpcion,
} from '../../components/alumnos/ModalFormularioAlumno';
import ModalConfirmarArchivoAlumno from '../../components/alumnos/ModalConfirmarArchivoAlumno';
import NotaServicios from '../../components/cxc/NotaServicios';
import type {
  AlumnoListadoSaaSport,
  EstadoFiltroAlumnos,
  NotaIngresoBorrador,
} from '../../types/alumnos';
import './RegistroAlumnos.css';

const ITEMS_POR_PAGINA = 30;

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const telefonoContactoPrincipal = (alumno: AlumnoListadoSaaSport): string => {
  if (alumno.whatsapp_preferido === 'madre') {
    return alumno.telefono_madre || alumno.telefono_padre || '—';
  }
  return alumno.telefono_padre || alumno.telefono_madre || '—';
};

const nombreContactoPrincipal = (alumno: AlumnoListadoSaaSport): string => {
  if (alumno.whatsapp_preferido === 'madre') {
    return alumno.nombre_madre || alumno.nombre_padre || '—';
  }
  return alumno.nombre_padre || alumno.nombre_madre || '—';
};

const inicialesAlumno = (alumno: AlumnoListadoSaaSport): string => {
  const n = (alumno.nombres || '').trim().charAt(0);
  const a = (alumno.apellidos || '').trim().charAt(0);
  return `${n}${a}`.toUpperCase() || 'A';
};

const AvatarAlumnoLista: React.FC<{ alumno: AlumnoListadoSaaSport }> = ({ alumno }) => {
  const [falloImagen, setFalloImagen] = useState(false);

  if (alumno.foto_url && !falloImagen) {
    return (
      <img
        src={alumno.foto_url}
        alt={`${alumno.nombres} ${alumno.apellidos}`}
        className="alumno-lista-avatar-img"
        loading="lazy"
        onError={() => setFalloImagen(true)}
      />
    );
  }

  return (
    <div className="alumno-lista-avatar-iniciales" aria-hidden="true">
      {inicialesAlumno(alumno)}
    </div>
  );
};

const RegistroAlumnos: React.FC = () => {
  const { session, perfil, escuelaId, sucursalId } = useAuthSaaSport();
  const isMobile = useIsMobile();
  const { data: estadoPlan } = usePlanEscuela(escuelaId, Boolean(escuelaId));
  const { data: sucursalesRaw = [] } = useSucursales();
  const { data: gruposRaw = [] } = useGrupos();
  const invalidarAlumnos = useInvalidarAlumnosSaaSport();
  const actualizarAvisoNotas = useActualizarNotasAutomaticasPendientes();

  const esSaaSportLite = Boolean(
    estadoPlan?.plan.incluye_saasport_lite && !estadoPlan?.plan.incluye_saasport_full,
  );
  const incluyeAsisport = Boolean(estadoPlan?.plan.incluye_asisport);

  const sucursalBloqueada = getDataScope(perfil?.rol) === 'branch' && Boolean(sucursalId);
  const puedeArchivarYRestaurar =
    perfil?.rol === 'SuperAdministrador' || perfil?.rol === 'Administrador';
  const puedeEditarNotaIngreso = can(perfil?.rol, 'finance.cxc.edit');

  const sucursalesEscuela = useMemo(
    () => (sucursalesRaw as SucursalOpcion[]).filter(s => s.escuela_id === escuelaId),
    [sucursalesRaw, escuelaId],
  );

  const gruposEscuela = useMemo(
    () => (gruposRaw as GrupoOpcion[]).filter(g => g.escuela_id === escuelaId && g.activo !== false),
    [gruposRaw, escuelaId],
  );

  // Filtros y paginación
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltroAlumnos>('activos');
  const [busqueda, setBusqueda] = useState('');
  const debouncedBusqueda = useDebounce(busqueda, 300);
  const busquedaValida = debouncedBusqueda.trim().length !== 1;
  const [filtroSucursal, setFiltroSucursal] = useState('');
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [filtroSub, setFiltroSub] = useState('');
  const [pagina, setPagina] = useState(1);

  const sucursalEfectiva = sucursalBloqueada ? (sucursalId || '') : filtroSucursal;
  const grupoEfectivo = esSaaSportLite ? '' : filtroGrupo;

  useEffect(() => {
    setPagina(1);
  }, [estadoFiltro, debouncedBusqueda, sucursalEfectiva, grupoEfectivo, filtroSub]);

  const gruposFiltradosPorSucursal = useMemo(() => {
    if (!sucursalEfectiva) return gruposEscuela;
    return gruposEscuela.filter(g => !g.sucursal_id || g.sucursal_id === sucursalEfectiva);
  }, [gruposEscuela, sucursalEfectiva]);

  const alcance = useMemo(
    () => ({
      userId: session?.user?.id || null,
      escuelaId,
      sucursalId: sucursalEfectiva || null,
    }),
    [session?.user?.id, escuelaId, sucursalEfectiva],
  );

  const filtros = useMemo(
    () => ({
      estado: estadoFiltro,
      busqueda: debouncedBusqueda.trim().length >= 2 ? debouncedBusqueda.trim() : '',
      sucursalId: sucursalEfectiva,
      grupoId: grupoEfectivo,
      sub: filtroSub,
      pagina,
      limite: ITEMS_POR_PAGINA,
    }),
    [estadoFiltro, debouncedBusqueda, sucursalEfectiva, grupoEfectivo, filtroSub, pagina],
  );

  const {
    data: listadoData,
    isLoading,
    isFetching,
    error: errorListado,
    refetch,
  } = useAlumnosSaaSport(alcance, filtros, busquedaValida);

  const alumnos = listadoData?.items ?? [];
  const totalResultados = listadoData?.total_resultados ?? 0;
  const resumen = listadoData?.resumen ?? { total_activos: 0, total_archivados: 0 };
  const subsDisponibles = listadoData?.facetas.subs ?? [];
  const totalPaginas = Math.max(1, Math.ceil(totalResultados / ITEMS_POR_PAGINA));

  // Modales y avisos
  const [modalFormularioAbierto, setModalFormularioAbierto] = useState(false);
  const [alumnoEditar, setAlumnoEditar] = useState<AlumnoListadoSaaSport | null>(null);
  const [alumnoArchivar, setAlumnoArchivar] = useState<AlumnoListadoSaaSport | null>(null);
  const [notaIngresoPendiente, setNotaIngresoPendiente] = useState<NotaIngresoBorrador | null>(null);
  const [notaIngresoGuardada, setNotaIngresoGuardada] = useState(false);
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'exito' | 'info' | 'error'; mensaje: string } | null>(null);

  const limpiarFiltros = () => {
    setBusqueda('');
    setFiltroSucursal('');
    setFiltroGrupo('');
    setFiltroSub('');
  };

  const hayFiltrosActivos = Boolean(
    busqueda.trim() || (!sucursalBloqueada && filtroSucursal) || (!esSaaSportLite && filtroGrupo) || filtroSub,
  );

  const abrirNuevoAlumno = () => {
    setAviso(null);
    setAlumnoEditar(null);
    setModalFormularioAbierto(true);
  };

  const abrirEditarAlumno = (alumno: AlumnoListadoSaaSport) => {
    setAviso(null);
    setAlumnoEditar(alumno);
    setModalFormularioAbierto(true);
  };

  const manejarAlumnoGuardado = async ({
    modo,
    alumno,
    notaIngreso,
  }: {
    modo: 'crear' | 'editar';
    alumno: AlumnoListadoSaaSport;
    notaIngreso: NotaIngresoBorrador | null;
  }) => {
    setModalFormularioAbierto(false);
    setAlumnoEditar(null);
    await invalidarAlumnos();

    if (modo === 'editar') {
      setAviso({
        tipo: 'exito',
        mensaje: `Ficha de ${alumno.nombres} ${alumno.apellidos} actualizada correctamente.`,
      });
      return;
    }

    if (notaIngreso) {
      if (puedeEditarNotaIngreso) {
        setNotaIngresoGuardada(false);
        setNotaIngresoPendiente(notaIngreso);
      } else {
        void actualizarAvisoNotas();
        setAviso({
          tipo: 'info',
          mensaje: `${alumno.nombres} ${alumno.apellidos} fue registrado. Su primera mensualidad quedó en Mensualidades Por Aprobar.`,
        });
      }
    } else {
      setAviso({
        tipo: 'exito',
        mensaje: `Alumno ${alumno.nombres} ${alumno.apellidos} registrado correctamente.`,
      });
    }
  };

  const manejarRestaurar = async (alumno: AlumnoListadoSaaSport) => {
    if (
      !window.confirm(
        `¿Deseas restaurar a ${alumno.nombres} ${alumno.apellidos}? Volverá al padrón de alumnos activos.`,
      )
    ) {
      return;
    }

    setRestaurandoId(alumno.id);
    setAviso(null);
    try {
      const { notaIngreso } = await restaurarAlumnoSaaSport(alumno.id);
      await invalidarAlumnos();

      if (notaIngreso && puedeEditarNotaIngreso) {
        setNotaIngresoGuardada(false);
        setNotaIngresoPendiente(notaIngreso);
      } else {
        if (notaIngreso) void actualizarAvisoNotas();
        setAviso({
          tipo: 'exito',
          mensaje: `Alumno ${alumno.nombres} ${alumno.apellidos} restaurado correctamente.`,
        });
      }
    } catch (err: unknown) {
      setAviso({
        tipo: 'error',
        mensaje: err instanceof Error ? err.message : 'No se pudo restaurar al alumno.',
      });
    } finally {
      setRestaurandoId(null);
    }
  };

  const rangoDesde = totalResultados === 0 ? 0 : (pagina - 1) * ITEMS_POR_PAGINA + 1;
  const rangoHasta = Math.min(pagina * ITEMS_POR_PAGINA, totalResultados);

  return (
    <main className="cxc-main">
      {/* 1. Cabecera */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <GraduationCap size={26} style={{ color: 'var(--primary)', flexShrink: 0 }} />
          <div>
            <h1 className="cxc-titulo-principal">Alumnos</h1>
          </div>
        </div>

        <div className="cxc-header-acciones">
          <button
            type="button"
            className="btn-refrescar"
            onClick={() => void refetch()}
            disabled={isFetching}
            title="Actualizar listado"
          >
            <RefreshCw size={18} className={isFetching ? 'spin' : ''} />
          </button>

          <button
            type="button"
            className="btn-nueva-cuenta"
            onClick={abrirNuevoAlumno}
          >
            <Plus size={18} />
            <span>{isMobile ? 'Nuevo' : 'Nuevo Alumno'}</span>
          </button>
        </div>
      </div>

      {/* Aviso de operación */}
      {aviso && (
        <div className={`alumnos-aviso-banner alumnos-aviso-banner--${aviso.tipo}`} role="status">
          <span>{aviso.mensaje}</span>
          <button
            type="button"
            className="alumnos-aviso-cerrar"
            onClick={() => setAviso(null)}
            aria-label="Cerrar aviso"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {errorListado && (
        <div className="alumnos-aviso-banner alumnos-aviso-banner--error" role="alert">
          <span>{(errorListado as Error).message || 'No se pudo cargar el listado de alumnos.'}</span>
        </div>
      )}

      {/* 2. Barra de filtros y estado */}
      <div className="cxc-barra-control alumnos-barra-control">
        <div className="alumnos-tabs-estado" role="tablist" aria-label="Estado del alumno">
          <button
            type="button"
            role="tab"
            aria-selected={estadoFiltro === 'activos'}
            className={`alumnos-tab-btn${estadoFiltro === 'activos' ? ' alumnos-tab-btn--activo' : ''}`}
            onClick={() => setEstadoFiltro('activos')}
          >
            <span>Activos</span>
            <span className="alumnos-tab-contador">{resumen.total_activos}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={estadoFiltro === 'archivados'}
            className={`alumnos-tab-btn${estadoFiltro === 'archivados' ? ' alumnos-tab-btn--activo' : ''}`}
            onClick={() => setEstadoFiltro('archivados')}
          >
            <span>Archivados</span>
            <span className="alumnos-tab-contador">{resumen.total_archivados}</span>
          </button>
        </div>

        <div className="cxc-filtros-inline alumnos-filtros-inline">
          <div className="cxc-filtros-compact alumnos-filtros-compact">
            {!sucursalBloqueada && sucursalesEscuela.length > 1 && (
              <select
                className="cxc-filtro-select"
                value={filtroSucursal}
                onChange={e => {
                  setFiltroSucursal(e.target.value);
                  setFiltroGrupo('');
                }}
                aria-label="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {sucursalesEscuela.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            )}

            {!esSaaSportLite && (
              <select
                className="cxc-filtro-select"
                value={filtroGrupo}
                onChange={e => setFiltroGrupo(e.target.value)}
                aria-label="Filtrar por grupo"
              >
                <option value="">Todos los grupos</option>
                {gruposFiltradosPorSucursal.map(g => (
                  <option key={g.id} value={g.id}>{g.nombre}</option>
                ))}
              </select>
            )}

            <select
              className="cxc-filtro-select"
              value={filtroSub}
              onChange={e => setFiltroSub(e.target.value)}
              aria-label="Filtrar por categoría Sub"
            >
              <option value="">Todas las Sub</option>
              {subsDisponibles.map(sub => (
                <option key={sub} value={String(sub)}>Sub {sub}</option>
              ))}
            </select>

            {hayFiltrosActivos && (
              <button type="button" className="cxc-filtro-limpiar" onClick={limpiarFiltros}>
                <X size={14} />
                <span>Limpiar</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 3. Buscador */}
      <div className="cxc-busqueda-bar">
        <div className="alumnos-busqueda-input-wrap">
          <Search size={16} className="alumnos-busqueda-icono" />
          <input
            type="text"
            className="alumnos-busqueda-input"
            placeholder="Buscar por nombre, carnet, padre, madre o teléfono..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
          />
        </div>
        {busqueda && (
          <button
            type="button"
            className="cxc-limpiar-busqueda"
            onClick={() => setBusqueda('')}
          >
            Limpiar
          </button>
        )}
        {!isMobile && (
          <span className="cxc-conteo-resultado">
            {totalResultados} {totalResultados === 1 ? 'alumno' : 'alumnos'}
          </span>
        )}
      </div>

      {/* 4. Listado principal */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <RefreshCw size={26} className="spin" style={{ color: 'var(--primary)', marginBottom: '0.75rem' }} />
          <p>Cargando padrón de alumnos...</p>
        </div>
      ) : alumnos.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '3rem 1.5rem',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            color: 'var(--text-secondary)',
          }}
        >
          <GraduationCap size={42} style={{ color: 'var(--text-tertiary)', marginBottom: '0.75rem' }} />
          <p style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>
            {estadoFiltro === 'archivados'
              ? 'No hay alumnos archivados con estos filtros'
              : 'No se encontraron alumnos activos'}
          </p>
          <p style={{ fontSize: '0.88rem' }}>
            {hayFiltrosActivos
              ? 'Prueba ajustando o limpiando los filtros de búsqueda.'
              : 'Registra tu primer alumno con el botón "Nuevo Alumno".'}
          </p>
        </div>
      ) : isMobile ? (
        <>
          <div className="alumnos-tarjetas-movil">
            {alumnos.map(alumno => {
              const saldo = Number(alumno.saldo_pendiente || 0);
              return (
                <article key={alumno.id} className="alumnos-tarjeta-movil">
                  <div className="alumnos-tarjeta-top">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                      {incluyeAsisport && <AvatarAlumnoLista alumno={alumno} />}
                      <div style={{ minWidth: 0 }}>
                        <div className="alumnos-tarjeta-nombre">
                          {alumno.nombres} {alumno.apellidos}
                        </div>
                        <div className="alumnos-tarjeta-meta" style={{ marginTop: '0.2rem' }}>
                          {alumno.sub !== null && <span>Sub {alumno.sub}</span>}
                          {alumno.sucursal_nombre && <span>{alumno.sucursal_nombre}</span>}
                          {!esSaaSportLite && alumno.grupo_nombre && <span>{alumno.grupo_nombre}</span>}
                          {incluyeAsisport && alumno.es_arquero && (
                            <span className="alumno-badge-arquero">Arquero</span>
                          )}
                        </div>
                      </div>
                    </div>
                    {alumno.archivado && <span className="cxc-badge-archivado">Archivado</span>}
                  </div>

                  <div className="alumnos-tarjeta-meta">
                    <span>Contacto: <strong>{nombreContactoPrincipal(alumno)}</strong> ({telefonoContactoPrincipal(alumno)})</span>
                    <span>
                      Mensualidad:{' '}
                      <strong>
                        {alumno.mensualidad !== null && alumno.mensualidad !== undefined
                          ? `${simboloMoneda()} ${fmtMonto(Number(alumno.mensualidad))}`
                          : 'Becado / Sin tarifa'}
                      </strong>
                    </span>
                    {saldo > 0 && (
                      <span style={{ color: 'var(--danger)', fontWeight: 700 }}>
                        Deuda CxC: {simboloMoneda()} {fmtMonto(saldo)}
                      </span>
                    )}
                  </div>

                  <div className="alumnos-tarjeta-pie">
                    <button
                      type="button"
                      className="alumnos-btn-fila"
                      onClick={() => abrirEditarAlumno(alumno)}
                    >
                      <Edit2 size={14} />
                      <span>Editar</span>
                    </button>

                    {puedeArchivarYRestaurar && (
                      alumno.archivado ? (
                        <button
                          type="button"
                          className="alumnos-btn-fila alumnos-btn-fila--restaurar"
                          onClick={() => void manejarRestaurar(alumno)}
                          disabled={restaurandoId === alumno.id}
                        >
                          <RotateCcw size={14} />
                          <span>{restaurandoId === alumno.id ? 'Restaurando...' : 'Restaurar'}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="alumnos-btn-fila alumnos-btn-fila--archivar"
                          onClick={() => setAlumnoArchivar(alumno)}
                        >
                          <Archive size={14} />
                          <span>Archivar</span>
                        </button>
                      )
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {totalResultados > ITEMS_POR_PAGINA && (
            <div className="alumnos-paginacion-pie">
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Mostrando {rangoDesde}–{rangoHasta} de {totalResultados}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button
                  type="button"
                  className="btn-pagi"
                  disabled={pagina === 1}
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <span className="pagi-info">
                  Página {pagina} de {totalPaginas}
                </span>
                <button
                  type="button"
                  className="btn-pagi"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th cxc-th-alumno">Alumno</th>
                <th className="cxc-th cxc-th-sm">Sub</th>
                <th className="cxc-th cxc-th-sucursal">Sucursal</th>
                {!esSaaSportLite && <th className="cxc-th cxc-th-sucursal">Grupo</th>}
                <th className="cxc-th">Contacto Principal</th>
                <th className="cxc-th cxc-th-monto">Mensualidad</th>
                <th className="cxc-th cxc-th-monto">Saldo CxC</th>
                <th className="cxc-th cxc-th-acciones">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {alumnos.map(alumno => {
                const saldo = Number(alumno.saldo_pendiente || 0);
                return (
                  <tr
                    key={alumno.id}
                    className={`cxc-tr${alumno.archivado ? ' cxc-tr--archivado' : ''}`}
                  >
                    <td className="cxc-td cxc-td-alumno">
                      <div className="cxc-alumno-info">
                        {incluyeAsisport && <AvatarAlumnoLista alumno={alumno} />}
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                            <span className="cxc-alumno-nombre">
                              {alumno.nombres} {alumno.apellidos}
                            </span>
                            {incluyeAsisport && alumno.es_arquero && (
                              <span className="alumno-badge-arquero">Arquero</span>
                            )}
                          </div>
                          {(alumno.carnet_identidad || alumno.observaciones) && (
                            <span style={{ fontSize: '0.74rem', color: 'var(--text-tertiary)', display: 'block' }}>
                              {[
                                alumno.carnet_identidad ? `CI: ${alumno.carnet_identidad}` : null,
                                alumno.observaciones || null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
                        </div>
                        {alumno.archivado && <span className="cxc-badge-archivado">Archivado</span>}
                      </div>
                    </td>

                    <td className="cxc-td" style={{ textAlign: 'center' }}>
                      {alumno.sub !== null ? `Sub ${alumno.sub}` : '—'}
                    </td>

                    <td className="cxc-td" style={{ textAlign: 'center' }}>
                      {alumno.sucursal_nombre || '—'}
                    </td>

                    {!esSaaSportLite && (
                      <td className="cxc-td" style={{ textAlign: 'center' }}>
                        {alumno.grupo_nombre || '—'}
                      </td>
                    )}

                    <td className="cxc-td">
                      <div style={{ fontSize: '0.82rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                        {nombreContactoPrincipal(alumno)}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {telefonoContactoPrincipal(alumno)}
                      </div>
                    </td>

                    <td className="cxc-td" style={{ textAlign: 'right', fontWeight: 600 }}>
                      {alumno.mensualidad !== null && alumno.mensualidad !== undefined
                        ? `${simboloMoneda()} ${fmtMonto(Number(alumno.mensualidad))}`
                        : 'Becado'}
                    </td>

                    <td className="cxc-td" style={{ textAlign: 'right' }}>
                      {saldo > 0 ? (
                        <span className="cxc-monto-deuda">
                          {simboloMoneda()} {fmtMonto(saldo)}
                        </span>
                      ) : (
                        <span className="cxc-al-dia">✓ Al día</span>
                      )}
                    </td>

                    <td className="cxc-td" style={{ textAlign: 'center' }}>
                      <div className="alumnos-acciones-fila">
                        <button
                          type="button"
                          className="alumnos-btn-fila"
                          onClick={() => abrirEditarAlumno(alumno)}
                          title="Editar ficha del alumno"
                        >
                          <Edit2 size={13} />
                          <span>Editar</span>
                        </button>

                        {puedeArchivarYRestaurar && (
                          alumno.archivado ? (
                            <button
                              type="button"
                              className="alumnos-btn-fila alumnos-btn-fila--restaurar"
                              onClick={() => void manejarRestaurar(alumno)}
                              disabled={restaurandoId === alumno.id}
                              title="Restaurar alumno"
                            >
                              <RotateCcw size={13} />
                              <span>{restaurandoId === alumno.id ? '...' : 'Restaurar'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="alumnos-btn-fila alumnos-btn-fila--archivar"
                              onClick={() => setAlumnoArchivar(alumno)}
                              title="Archivar alumno"
                            >
                              <Archive size={13} />
                              <span>Archivar</span>
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {totalResultados > ITEMS_POR_PAGINA && (
            <div className="alumnos-paginacion-pie">
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Mostrando {rangoDesde}–{rangoHasta} de {totalResultados} alumnos
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <button
                  type="button"
                  className="btn-pagi"
                  disabled={pagina === 1}
                  onClick={() => setPagina(p => Math.max(1, p - 1))}
                >
                  Anterior
                </button>
                <span className="pagi-info">
                  Página {pagina} de {totalPaginas}
                </span>
                <button
                  type="button"
                  className="btn-pagi"
                  disabled={pagina >= totalPaginas}
                  onClick={() => setPagina(p => Math.min(totalPaginas, p + 1))}
                >
                  Siguiente
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal Crear / Editar Alumno */}
      {escuelaId && perfil?.id && (
        <ModalFormularioAlumno
          visible={modalFormularioAbierto}
          escuelaId={escuelaId}
          usuarioId={perfil.id}
          esSaaSportLite={esSaaSportLite}
          incluyeAsisport={incluyeAsisport}
          sucursales={sucursalesEscuela}
          grupos={gruposEscuela}
          sucursalBloqueadaId={sucursalBloqueada ? sucursalId : null}
          alumnoEditar={alumnoEditar}
          onCerrar={() => {
            setModalFormularioAbierto(false);
            setAlumnoEditar(null);
          }}
          onGuardado={resultado => void manejarAlumnoGuardado(resultado)}
        />
      )}

      {/* Modal Confirmar Archivo */}
      <ModalConfirmarArchivoAlumno
        alumno={alumnoArchivar}
        onCerrar={() => setAlumnoArchivar(null)}
        onArchivado={({ alumno, borradores_eliminados }) => {
          setAlumnoArchivar(null);
          void invalidarAlumnos();
          void actualizarAvisoNotas();
          setAviso({
            tipo: 'exito',
            mensaje:
              borradores_eliminados > 0
                ? `${alumno.nombres} ${alumno.apellidos} fue archivado y se limpiaron ${borradores_eliminados} borrador(es) pendientes.`
                : `${alumno.nombres} ${alumno.apellidos} fue archivado correctamente.`,
          });
        }}
      />

      {/* Modal Nota de Cargo post-inscripción / restauración */}
      {notaIngresoPendiente && (
        <NotaServicios
          visible={true}
          cxcEditar={notaIngresoPendiente}
          onCreada={() => {
            setNotaIngresoGuardada(true);
            void invalidarAlumnos();
            void actualizarAvisoNotas();
          }}
          onCerrar={() => {
            const fueGuardada = notaIngresoGuardada;
            setNotaIngresoPendiente(null);
            setNotaIngresoGuardada(false);
            void actualizarAvisoNotas();
            setAviso(
              fueGuardada
                ? {
                    tipo: 'exito',
                    mensaje: 'Alumno registrado y Nota de Cargo confirmada correctamente.',
                  }
                : {
                    tipo: 'info',
                    mensaje: 'El borrador de mensualidad quedó guardado en Mensualidades Por Aprobar como respaldo.',
                  },
            );
          }}
        />
      )}
    </main>
  );
};

export default RegistroAlumnos;
