/**
 * FiltrosCxc.tsx
 * Filtros bidireccionales para el módulo Cuentas por Cobrar.
 * Permite filtrar por Sucursal, Entrenador, Grupo.
 * Al seleccionar uno, los demás se ajustan automáticamente.
 */
import React, { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useSucursales, useEntrenadores, useGrupos, useAlumnosRelaciones } from '../../hooks/useMasterData';

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
  onChangeSucursal: (id: string) => void;
  onChangeEntrenador: (id: string) => void;
  onChangeGrupo: (id: string) => void;
  onLimpiar: () => void;
  sucursalBloqueada?: boolean;
  compact?: boolean;
  sidebar?: boolean;
}

const FiltrosCxc: React.FC<FiltrosProps> = ({
  sucursalId, entrenadorId, grupoId,
  onChangeSucursal, onChangeEntrenador, onChangeGrupo,
  onLimpiar, sucursalBloqueada = false, compact = false, sidebar = false,
}) => {
  // Hooks de datos maestros con TanStack Query
  const { data: sucursalesRaw } = useSucursales();
  const { data: entrenadoresRaw } = useEntrenadores();
  const { data: gruposRaw } = useGrupos();
  const { data: relaciones } = useAlumnosRelaciones();

  // Mapear a formato OpcionFiltro
  const sucursales = useMemo(() => (sucursalesRaw ?? []).map(s => ({ id: s.id, nombre: s.nombre })), [sucursalesRaw]);
  const entrenadores = useMemo(() => (entrenadoresRaw ?? []).map(e => ({ id: e.id, nombre: `${e.nombres} ${e.apellidos}` })), [entrenadoresRaw]);
  const grupos = useMemo(() => (gruposRaw ?? []).map(c => ({ id: c.id, nombre: c.nombre })), [gruposRaw]);

  // Filtrar opciones disponibles bidireccionalmente
  const filtrarOpciones = useMemo(() => {
    let rels = relaciones ?? [];

    // Aplicar filtros actuales para reducir el conjunto
    if (sucursalId) rels = rels.filter(r => r.sucursal_id === sucursalId);
    if (entrenadorId) rels = rels.filter(r => r.profesor_asignado_id === entrenadorId);
    if (grupoId) rels = rels.filter(r => r.grupo_id === grupoId);

    // IDs únicos disponibles según los filtros activos
    const sucIds = new Set(rels.map(r => r.sucursal_id).filter(Boolean));
    const entIds = new Set(rels.map(r => r.profesor_asignado_id).filter(Boolean));
    const canIds = new Set(rels.map(r => r.grupo_id).filter(Boolean));

    return {
      sucursalesFilt: sucursalId ? sucursales : sucursales.filter(s => sucIds.has(s.id)),
      entrenadoresFilt: entrenadorId ? entrenadores : entrenadores.filter(e => entIds.has(e.id)),
      gruposFilt: grupoId ? grupos : grupos.filter(c => canIds.has(c.id)),
    };
  }, [relaciones, sucursalId, entrenadorId, grupoId, sucursales, entrenadores, grupos]);


  const hayFiltros = sucursalId || entrenadorId || grupoId;

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
            <option value="">Todas</option>
            {filtrarOpciones.gruposFilt.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

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
