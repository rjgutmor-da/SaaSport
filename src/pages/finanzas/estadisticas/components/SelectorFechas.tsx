/**
 * SelectorFechas.tsx
 * Barra de filtro de fechas omnipresente usada en las 3 pestañas de Estadísticas.
 * Incluye botones de acceso rápido para rangos predefinidos.
 */
import React from 'react';
import { Calendar } from 'lucide-react';
import type { IntervaloPredefinido } from '../utils/estadisticasUtils';
import { etiquetaIntervalo } from '../utils/estadisticasUtils';

interface Props {
  intervalo: IntervaloPredefinido;
  onCambiarIntervalo: (i: IntervaloPredefinido) => void;
  fechaDesde?: string;
  fechaHasta?: string;
  onChangeFechaDesde?: (f: string) => void;
  onChangeFechaHasta?: (f: string) => void;
}

const INTERVALOS: IntervaloPredefinido[] = [
  'este-mes', 'mes-pasado', 'este-año', 'año-pasado', 'personalizado'
];

const SelectorFechas: React.FC<Props> = ({
  intervalo,
  onCambiarIntervalo,
  fechaDesde = '',
  fechaHasta = '',
  onChangeFechaDesde,
  onChangeFechaHasta,
}) => {
  return (
    <div className="est-selector-fechas">
      {/* Icono */}
      <Calendar size={16} className="est-cal-icono" />

      {/* Botones predefinidos */}
      <div className="est-fechas-chips">
        {INTERVALOS.map((i) => (
          <button
            key={i}
            className={`est-chip ${intervalo === i ? 'est-chip--activo' : ''}`}
            onClick={() => onCambiarIntervalo(i)}
          >
            {etiquetaIntervalo(i)}
          </button>
        ))}
      </div>

      {/* Rango de fechas personalizado */}
      {intervalo === 'personalizado' && onChangeFechaDesde && onChangeFechaHasta && (
        <div className="est-fechas-custom">
          <span className="est-custom-label">Desde</span>
          <input
            type="date"
            className="est-input-fecha"
            value={fechaDesde}
            onChange={e => onChangeFechaDesde(e.target.value)}
          />
          <span className="est-custom-label">Hasta</span>
          <input
            type="date"
            className="est-input-fecha"
            value={fechaHasta}
            onChange={e => onChangeFechaHasta(e.target.value)}
          />
        </div>
      )}
    </div>
  );
};

export default SelectorFechas;
