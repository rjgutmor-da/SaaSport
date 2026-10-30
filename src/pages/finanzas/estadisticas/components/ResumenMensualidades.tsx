/**
 * ResumenMensualidades.tsx
 * Fila de indicadores de la pestaña "Mensualidades" (reemplaza la fila de Meses):
 *   - Mensualidad promedio (solo alumnos activos)
 *   - Moda (todas las modas empatadas con su cantidad de alumnos)
 *   - Slider de rango de mensualidad
 */
import React from 'react';
import { simboloMoneda } from '../../../../lib/moneda';
import { fmtMonto } from '../utils/estadisticasUtils';
import type { ModaMensualidad } from '../utils/mensualidadesUtils';
import FiltroRangoMensualidad from './FiltroRangoMensualidad';

interface Props {
  promedio: number;
  modas: ModaMensualidad[];
  totalActivos: number;
  limites: { min: number; max: number };
  desde: number;
  hasta: number;
  onChangeRango: (desde: number, hasta: number) => void;
}

const ResumenMensualidades: React.FC<Props> = ({
  promedio,
  modas,
  totalActivos,
  limites,
  desde,
  hasta,
  onChangeRango,
}) => (
  <div className="est-mens-resumen">
    <div className="est-mens-indicador">
      <span className="est-mens-label">Mensualidad promedio</span>
      <strong className="est-mens-valor">{simboloMoneda()} {fmtMonto(promedio)}</strong>
      <span className="est-mens-nota">{totalActivos} alumnos activos</span>
    </div>

    <div className="est-mens-indicador">
      <span className="est-mens-label">Moda</span>
      {modas.length === 0 ? (
        <strong className="est-mens-valor">—</strong>
      ) : (
        <strong className="est-mens-valor">
          {modas.map(m => `${simboloMoneda()} ${fmtMonto(m.monto)}`).join(' / ')}
        </strong>
      )}
      {modas.length > 0 && (
        <span className="est-mens-nota">
          {modas[0].cantidad} alumno{modas[0].cantidad !== 1 ? 's' : ''}
          {modas.length > 1 ? ' cada una' : ''}
        </span>
      )}
    </div>

    <FiltroRangoMensualidad
      min={limites.min}
      max={limites.max}
      desde={desde}
      hasta={hasta}
      onChange={onChangeRango}
    />
  </div>
);

export default ResumenMensualidades;
