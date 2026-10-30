/**
 * PanelMensualidades.tsx
 * Contenido de la pestaña "Mensualidades" de Estadísticas.
 * Muestra la mensualidad registrada en la ficha de cada alumno activo.
 *
 * - Promedio y moda: SIEMPRE sobre todos los alumnos activos de la escuela.
 * - Tabla: aplica filtros de Sucursal, Entrenador, Grupo, Horario y el rango del slider.
 */
import React, { useEffect, useMemo, useState } from 'react';
import FiltrosCxc from '../../../../components/cxc/FiltrosCxc';
import { useMensualidadesAlumnos } from '../hooks/useMensualidadesAlumnos';
import { calcularPromedio, calcularModas, calcularLimites } from '../utils/mensualidadesUtils';
import ResumenMensualidades from './ResumenMensualidades';
import TablaMensualidades from './TablaMensualidades';

interface Props {
  escuelaId: string | null;
  sucursalId: string;
  entrenadorId: string;
  grupoId: string;
  horarioId: string;
  onChangeSucursal: (v: string) => void;
  onChangeEntrenador: (v: string) => void;
  onChangeGrupo: (v: string) => void;
  onChangeHorario: (v: string) => void;
  onLimpiarFiltros: () => void;
}

const PanelMensualidades: React.FC<Props> = ({
  escuelaId,
  sucursalId,
  entrenadorId,
  grupoId,
  horarioId,
  onChangeSucursal,
  onChangeEntrenador,
  onChangeGrupo,
  onChangeHorario,
  onLimpiarFiltros,
}) => {
  const { alumnos, cargando, error } = useMensualidadesAlumnos(escuelaId);

  // Indicadores fijos sobre todos los alumnos activos
  const montos = useMemo(() => alumnos.map(a => a.mensualidad), [alumnos]);
  const promedio = useMemo(() => calcularPromedio(montos), [montos]);
  const modas = useMemo(() => calcularModas(montos), [montos]);
  const limites = useMemo(() => calcularLimites(montos), [montos]);

  // Rango del slider (se reinicia al rango completo cuando cambian los datos)
  const [rango, setRango] = useState({ desde: 0, hasta: 0 });
  useEffect(() => {
    setRango({ desde: limites.min, hasta: limites.max });
  }, [limites.min, limites.max]);

  // Alumnos visibles en la tabla
  const alumnosFiltrados = useMemo(() => alumnos.filter(a =>
    (!sucursalId || a.sucursal_id === sucursalId) &&
    (!entrenadorId || a.entrenador_id === entrenadorId) &&
    (!grupoId || a.grupo_id === grupoId) &&
    (!horarioId || a.horario_id === horarioId) &&
    a.mensualidad >= rango.desde &&
    a.mensualidad <= rango.hasta,
  ), [alumnos, sucursalId, entrenadorId, grupoId, horarioId, rango]);

  return (
    <div className="est-panel">
      <div className="est-filtros-alumnos-v3">
        <div className="est-filtros-cxc-wrap">
          <FiltrosCxc
            sucursalId={sucursalId}
            entrenadorId={entrenadorId}
            grupoId={grupoId}
            horarioId={horarioId}
            onChangeSucursal={onChangeSucursal}
            onChangeEntrenador={onChangeEntrenador}
            onChangeGrupo={onChangeGrupo}
            onChangeHorario={onChangeHorario}
            onLimpiar={onLimpiarFiltros}
            compact
          />
        </div>
        <ResumenMensualidades
          promedio={promedio}
          modas={modas}
          totalActivos={alumnos.length}
          limites={limites}
          desde={rango.desde}
          hasta={rango.hasta}
          onChangeRango={(desde, hasta) => setRango({ desde, hasta })}
        />
      </div>

      <TablaMensualidades alumnos={alumnosFiltrados} cargando={cargando} error={error} />
    </div>
  );
};

export default PanelMensualidades;
