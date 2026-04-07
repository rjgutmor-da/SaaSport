/**
 * FiltrosCxc.tsx
 * Filtros bidireccionales para el módulo Cuentas por Cobrar.
 * Permite filtrar por Sucursal, Entrenador, Cancha y Horario.
 * Al seleccionar uno, los demás se ajustan automáticamente.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { Filter, X } from 'lucide-react';

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
  /** Modo compacto: sin tarjeta contenedora, para integrar en barras horizontales */
  compact?: boolean;
}

/** Datos crudos del alumno para construir relaciones */
interface AlumnoRel {
  sucursal_id: string | null;
  cancha_id: string | null;
  horario_id: string | null;
  profesor_asignado_id: string | null;
}

const FiltrosCxc: React.FC<FiltrosProps> = ({
  sucursalId, entrenadorId, canchaId, horarioId,
  onChangeSucursal, onChangeEntrenador, onChangeCancha, onChangeHorario,
  onLimpiar, compact = false,
}) => {
  // Catálogos base
  const [sucursales, setSucursales] = useState<OpcionFiltro[]>([]);
  const [entrenadores, setEntrenadores] = useState<OpcionFiltro[]>([]);
  const [canchas, setCanchas] = useState<OpcionFiltro[]>([]);
  const [horarios, setHorarios] = useState<OpcionFiltro[]>([]);
  // Relaciones de alumnos para filtrar bidireccionalmente
  const [relaciones, setRelaciones] = useState<AlumnoRel[]>([]);

  // Cargar catálogos y relaciones al montar
  useEffect(() => {
    const cargar = async () => {
      const [resSuc, resEnt, resCan, resHor, resAlum] = await Promise.all([
        supabase.from('sucursales').select('id, nombre').order('nombre'),
        supabase.from('usuarios').select('id, nombres, apellidos')
          .in('rol', ['Entrenador', 'Entrenarqueros'])
          .eq('activo', true)
          .order('nombres'),
        supabase.from('canchas').select('id, nombre').eq('activo', true).order('nombre'),
        supabase.from('horarios').select('id, hora').eq('activo', true).order('hora'),
        supabase.from('alumnos').select('sucursal_id, cancha_id, horario_id, profesor_asignado_id')
          .eq('archivado', false),
      ]);

      setSucursales((resSuc.data ?? []).map(s => ({ id: s.id, nombre: s.nombre })));
      setEntrenadores((resEnt.data ?? []).map(e => ({ id: e.id, nombre: `${e.nombres} ${e.apellidos}` })));
      setCanchas((resCan.data ?? []).map(c => ({ id: c.id, nombre: c.nombre })));
      setHorarios((resHor.data ?? []).map(h => ({ id: h.id, nombre: h.hora })));
      setRelaciones(resAlum.data ?? []);
    };
    cargar();
  }, []);

  // Filtrar opciones disponibles bidireccionalmentee
  const filtrarOpciones = useMemo(() => {
    let rels = relaciones;

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

  // Selectores compartidos entre modos
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
