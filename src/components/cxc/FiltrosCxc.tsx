/**
 * FiltrosCxc.tsx
 * Filtros bidireccionales para el módulo Cuentas por Cobrar.
 * Permite filtrar por Sucursal, Entrenador, Grupo y Horario.
 * Al seleccionar uno, los demás se ajustan automáticamente.
 */
import React, { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useSucursales, useEntrenadores, useGrupos, useHorarios } from '../../hooks/useMasterData';

/** Estructura de opciones de filtro */
interface OpcionFiltro {
  id: string;
  nombre: string;
}

/** Props del componente */
interface FiltrosProps {
  sucursalId: string;
  entrenadorId: string;
  grupoId: string;
  horarioId?: string;
  onChangeSucursal: (id: string) => void;
  onChangeEntrenador: (id: string) => void;
  onChangeGrupo: (id: string) => void;
  onChangeHorario?: (id: string) => void;
  onLimpiar: () => void;
  sucursalBloqueada?: boolean;
  compact?: boolean;
  sidebar?: boolean;
}

const FiltrosCxc: React.FC<FiltrosProps> = ({
  sucursalId, entrenadorId, grupoId, horarioId = '',
  onChangeSucursal, onChangeEntrenador, onChangeGrupo, onChangeHorario,
  onLimpiar, sucursalBloqueada = false, compact = false, sidebar = false,
}) => {
  // Hooks de datos maestros con TanStack Query
  const { data: sucursalesRaw } = useSucursales();
  const { data: entrenadoresRaw } = useEntrenadores();
  const { data: gruposRaw } = useGrupos();
  const { data: horariosRaw } = useHorarios();


  // Mapear a formato OpcionFiltro
  const sucursales = useMemo(() => (sucursalesRaw ?? []).map(s => ({ id: s.id, nombre: s.nombre })), [sucursalesRaw]);
  const entrenadores = useMemo(() => (entrenadoresRaw ?? []).map(e => ({
    id: e.id,
    nombre: `${e.nombres} ${e.apellidos}`.trim(),
    sucursal_id: (e as any).sucursal_id || null,
  })), [entrenadoresRaw]);
  const grupos = useMemo(() => (gruposRaw ?? [])
    .filter(c => c.activo !== false)
    .map(c => ({
      id: c.id,
      nombre: c.nombre,
      sucursal_id: c.sucursal_id || null,
      horario_ids: ((c.grupos_horarios ?? []) as any[]).map((gh: any) => gh.horario_id).filter(Boolean) as string[],
    })), [gruposRaw]);
  const horarios = useMemo(() => (horariosRaw ?? []).map(h => ({ id: h.id, nombre: h.hora })), [horariosRaw]);

  // Filtrar opciones disponibles de manera jerárquica y directa
  const filtrarOpciones = useMemo(() => {
    // 1. Grupos: acotar por sucursal seleccionada si existe; mostrar todos los grupos activos creados
    let gruposFilt = grupos;
    if (sucursalId) {
      gruposFilt = gruposFilt.filter(g => !g.sucursal_id || g.sucursal_id === sucursalId);
    }

    // 2. Entrenadores: acotar por sucursal si existe y el entrenador tiene sucursal asignada
    let entrenadoresFilt = entrenadores;
    if (sucursalId) {
      entrenadoresFilt = entrenadoresFilt.filter(e => !e.sucursal_id || e.sucursal_id === sucursalId);
    }

    // 3. Horarios: si se selecciona un grupo con horarios configurados, acotar a dichos horarios
    let horariosFilt = horarios;
    if (grupoId) {
      const grupoSel = grupos.find(g => g.id === grupoId);
      if (grupoSel && grupoSel.horario_ids && grupoSel.horario_ids.length > 0) {
        const horIdsSet = new Set(grupoSel.horario_ids);
        horariosFilt = horariosFilt.filter(h => horIdsSet.has(h.id));
      }
    }

    return {
      sucursalesFilt: sucursales,
      entrenadoresFilt,
      gruposFilt,
      horariosFilt,
    };
  }, [sucursales, entrenadores, grupos, horarios, sucursalId, grupoId]);


  const hayFiltros = sucursalId || entrenadorId || grupoId || horarioId;

  // Render para Sidebar
  if (sidebar) {
    return (
      <div className="sidebar-filters-grid">
        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Sucursal</label>
          <select value={sucursalId} onChange={e => onChangeSucursal(e.target.value)} className="sidebar-select" disabled={sucursalBloqueada}>
            <option value="">Todas</option>
            {filtrarOpciones.sucursalesFilt.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>

        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Entrenador</label>
          <select value={entrenadorId} onChange={e => onChangeEntrenador(e.target.value)} className="sidebar-select">
            <option value="">Todos</option>
            {filtrarOpciones.entrenadoresFilt.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>

        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Grupo</label>
          <select value={grupoId} onChange={e => onChangeGrupo(e.target.value)} className="sidebar-select">
            <option value="">Todos</option>
            {filtrarOpciones.gruposFilt.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        {onChangeHorario && (
          <div className="sidebar-filter-item">
            <label className="sidebar-filter-label">Horario</label>
            <select value={horarioId} onChange={e => onChangeHorario(e.target.value)} className="sidebar-select">
              <option value="">Todos</option>
              {filtrarOpciones.horariosFilt.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
            </select>
          </div>
        )}

        {hayFiltros && (
          <button className="cxc-filtro-limpiar" onClick={onLimpiar} style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}>
            <X size={14} /> Limpiar Filtros
          </button>
        )}
      </div>
    );
  }

  // Selectores compartidos para otros modos
  const selectores = (
    <>
      <select
        value={sucursalId}
        onChange={e => onChangeSucursal(e.target.value)}
        className="cxc-filtro-select"
        disabled={sucursalBloqueada}
        title={sucursalBloqueada ? 'Tu usuario está restringido a esta sucursal' : undefined}
      >
        <option value="">Sucursal</option>
        {filtrarOpciones.sucursalesFilt.map(s => (
          <option key={s.id} value={s.id}>{s.nombre}</option>
        ))}
      </select>

      <select
        value={entrenadorId}
        onChange={e => onChangeEntrenador(e.target.value)}
        className="cxc-filtro-select"
      >
        <option value="">Entrenador</option>
        {filtrarOpciones.entrenadoresFilt.map(e => (
          <option key={e.id} value={e.id}>{e.nombre}</option>
        ))}
      </select>

      <select
        value={grupoId}
        onChange={e => onChangeGrupo(e.target.value)}
        className="cxc-filtro-select"
      >
        <option value="">Grupo</option>
        {filtrarOpciones.gruposFilt.map(c => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </select>

      {onChangeHorario && (
        <select
          value={horarioId}
          onChange={e => onChangeHorario(e.target.value)}
          className="cxc-filtro-select"
        >
          <option value="">Horario</option>
          {filtrarOpciones.horariosFilt.map(h => (
            <option key={h.id} value={h.id}>{h.nombre}</option>
          ))}
        </select>
      )}

      {hayFiltros && (
        <button className="cxc-filtro-limpiar" onClick={onLimpiar} title="Limpiar filtros">
          <X size={14} /> Limpiar
        </button>
      )}
    </>
  );

  // Modo compacto: sin tarjeta contenedora
  if (compact) {
    return (
      <div className="cxc-filtros-compact">
        <Filter size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        {selectores}
      </div>
    );
  }

  return (
    <div className="cxc-filtros">
      <div className="cxc-filtros-icono">
        <Filter size={16} />
        <span>Filtros</span>
      </div>
      <div className="cxc-filtros-selectores">
        {selectores}
      </div>
    </div>
  );
};

export default FiltrosCxc;
