/**
 * FiltroPeriodoMeses.tsx
 * Filtro de periodo reutilizable para las pestañas de Estadísticas:
 * chips de meses (selección múltiple) + selector de año.
 * Replica el estilo de los filtros de "Alumnos por Ítem".
 */
import React from 'react';
import { X } from 'lucide-react';
import { NOMBRES_MESES } from '../utils/estadisticasUtils';

interface Props {
  mesesSeleccionados: string[];
  onChangeMeses: (meses: string[]) => void;
  anio: number;
  onChangeAnio: (anio: number) => void;
  anios: number[];
}

const estiloEtiqueta: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'var(--text-secondary)',
  fontWeight: 500,
  paddingLeft: '2px',
};

const FiltroPeriodoMeses: React.FC<Props> = ({
  mesesSeleccionados,
  onChangeMeses,
  anio,
  onChangeAnio,
  anios,
}) => {
  /** Alterna la selección de un mes */
  const toggleMes = (mes: string) => {
    onChangeMeses(
      mesesSeleccionados.includes(mes)
        ? mesesSeleccionados.filter(m => m !== mes)
        : [...mesesSeleccionados, mes]
    );
  };

  return (
    <div className="est-filtro-meses-row" style={{ alignItems: 'flex-end' }}>
      <div className="est-filtro-meses-col-meses">
        <span style={{ ...estiloEtiqueta, display: 'block', marginBottom: '0.2rem' }}>
          Meses <span className="est-filtro-hint">(opcional — deja vacío para ver todo el año)</span>
        </span>
        <div className="est-meses-grid">
          {NOMBRES_MESES.map(mes => (
            <button
              key={mes}
              className={`est-mes-chip ${mesesSeleccionados.includes(mes) ? 'est-mes-chip--activo' : ''}`}
              onClick={() => toggleMes(mes)}
            >
              {mes}
            </button>
          ))}
          {mesesSeleccionados.length > 0 && (
            <button
              className="est-limpiar-subfiltro-chip"
              onClick={() => onChangeMeses([])}
            >
              <X size={12} /> Limpiar
            </button>
          )}
        </div>
      </div>

      <div className="est-filtros-meses-inline" style={{ marginLeft: 'auto' }}>
        <div className="est-filtro-item-label est-filtro-anio-inline">
          <span style={estiloEtiqueta}>Año</span>
          <select
            className="est-select-premium"
            value={anio}
            onChange={e => onChangeAnio(Number(e.target.value))}
          >
            {anios.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default FiltroPeriodoMeses;
