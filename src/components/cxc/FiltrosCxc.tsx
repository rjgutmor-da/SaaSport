/**
 * FiltrosCxc.tsx
 * Filtros bidireccionales para el módulo Cuentas por Cobrar.
 * Permite filtrar por Sucursal, Entrenador, Cancha y Horario.
 * Al seleccionar uno, los demás se ajustan automáticamente.
 */
import React, { useMemo } from 'react';
import { Filter, X } from 'lucide-react';
import { useSucursales, useEntrenadores, useCanchas, useHorarios, useAlumnosRelaciones } from '../../hooks/useMasterData';

/** Estructura de opciones de filtro */
interface OpcionFiltro {
  id: string;
  nombre: string;
}

/** Props del componente */
interface FiltrosProps {
  sucursalId: string;
  entrenadorId: string;
  canchaId: string;
  horarioId: string;
  onChangeSucursal: (id: string) => void;
  onChangeEntrenador: (id: string) => void;
  onChangeCancha: (id: string) => void;
  onChangeHorario: (id: string) => void;
  onLimpiar: () => void;
  compact?: boolean;
  sidebar?: boolean;
}

const FiltrosCxc: React.FC<FiltrosProps> = ({
  sucursalId, entrenadorId, canchaId, horarioId,
  onChangeSucursal, onChangeEntrenador, onChangeCancha, onChangeHorario,
  onLimpiar, compact = false, sidebar = false,
}) => {
  // Hooks de datos maestros con TanStack Query
  const { data: sucursalesRaw } = useSucursales();
  const { data: entrenadoresRaw } = useEntrenadores();
  const { data: canchasRaw } = useCanchas();
  const { data: horariosRaw } = useHorarios();
  const { data: relaciones } = useAlumnosRelaciones();

  // Mapear a formato OpcionFiltro
  const sucursales = useMemo(() => (sucursalesRaw ?? []).map(s => ({ id: s.id, nombre: s.nombre })), [sucursalesRaw]);
  const entrenadores = useMemo(() => (entrenadoresRaw ?? []).map(e => ({ id: e.id, nombre: `${e.nombres} ${e.apellidos}` })), [entrenadoresRaw]);
  const canchas = useMemo(() => (canchasRaw ?? []).map(c => ({ id: c.id, nombre: c.nombre })), [canchasRaw]);
  const horarios = useMemo(() => (horariosRaw ?? []).map(h => ({ id: h.id, nombre: h.hora })), [horariosRaw]);

  // Filtrar opciones disponibles bidireccionalmente
  const filtrarOpciones = useMemo(() => {
    let rels = relaciones ?? [];

    // Aplicar filtros actuales para reducir el conjunto
    if (sucursalId) rels = rels.filter(r => r.sucursal_id === sucursalId);
    if (entrenadorId) rels = rels.filter(r => r.profesor_asignado_id === entrenadorId);
    if (canchaId) rels = rels.filter(r => r.cancha_id === canchaId);
    if (horarioId) rels = rels.filter(r => r.horario_id === horarioId);

    // IDs únicos disponibles según los filtros activos
    const sucIds = new Set(rels.map(r => r.sucursal_id).filter(Boolean));
    const entIds = new Set(rels.map(r => r.profesor_asignado_id).filter(Boolean));
    const canIds = new Set(rels.map(r => r.cancha_id).filter(Boolean));
    const horIds = new Set(rels.map(r => r.horario_id).filter(Boolean));

    return {
      sucursalesFilt: sucursalId ? sucursales : sucursales.filter(s => sucIds.has(s.id)),
      entrenadoresFilt: entrenadorId ? entrenadores : entrenadores.filter(e => entIds.has(e.id)),
      canchasFilt: canchaId ? canchas : canchas.filter(c => canIds.has(c.id)),
      horariosFilt: horarioId ? horarios : horarios.filter(h => horIds.has(h.id)),
    };
  }, [relaciones, sucursalId, entrenadorId, canchaId, horarioId, sucursales, entrenadores, canchas, horarios]);


  const hayFiltros = sucursalId || entrenadorId || canchaId || horarioId;

  // Render para Sidebar
  if (sidebar) {
    return (
      <div className="sidebar-filters-grid">
        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Sucursal</label>
          <select value={sucursalId} onChange={e => onChangeSucursal(e.target.value)} className="sidebar-select">
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
          <label className="sidebar-filter-label">Cancha</label>
          <select value={canchaId} onChange={e => onChangeCancha(e.target.value)} className="sidebar-select">
            <option value="">Todas</option>
            {filtrarOpciones.canchasFilt.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Horario</label>
          <select value={horarioId} onChange={e => onChangeHorario(e.target.value)} className="sidebar-select">
            <option value="">Todos</option>
            {filtrarOpciones.horariosFilt.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
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
        value={canchaId}
        onChange={e => onChangeCancha(e.target.value)}
        className="cxc-filtro-select"
      >
        <option value="">Cancha</option>
        {filtrarOpciones.canchasFilt.map(c => (
          <option key={c.id} value={c.id}>{c.nombre}</option>
        ))}
      </select>

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
