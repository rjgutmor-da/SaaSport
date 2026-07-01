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
}

const INTERVALOS: IntervaloPredefinido[] = [
  'total', 'este-mes', 'mes-pasado', 'este-año', 'año-pasado',
];

const SelectorFechas: React.FC<Props> = ({
  intervalo,
  onCambiarIntervalo,
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
    </div>
  );
};

export default SelectorFechas;
