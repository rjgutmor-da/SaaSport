/**
 * FiltroRangoMensualidad.tsx
 * Slider de rango doble (mínimo–máximo) para filtrar alumnos por mensualidad.
 * Los límites se toman de las mensualidades existentes.
 */
import React from 'react';
import { simboloMoneda } from '../../../../lib/moneda';
import { fmtMonto } from '../utils/estadisticasUtils';

interface Props {
  /** Límite inferior absoluto (menor mensualidad existente) */
  min: number;
  /** Límite superior absoluto (mayor mensualidad existente) */
  max: number;
  /** Valor seleccionado "desde" */
  desde: number;
  /** Valor seleccionado "hasta" */
  hasta: number;
  onChange: (desde: number, hasta: number) => void;
}

const FiltroRangoMensualidad: React.FC<Props> = ({ min, max, desde, hasta, onChange }) => {
  const sinRango = max <= min;
  // Paso de 1 para que siempre se pueda alcanzar el máximo exacto
  const paso = 1;

  // Porcentajes para pintar la franja seleccionada
  const pct = (v: number) => (sinRango ? 0 : ((v - min) / (max - min)) * 100);
  const izquierda = pct(desde);
  const derecha = 100 - pct(hasta);

  const cambiarDesde = (valor: number) => onChange(Math.min(valor, hasta), hasta);
  const cambiarHasta = (valor: number) => onChange(desde, Math.max(valor, desde));

  const esRangoCompleto = desde <= min && hasta >= max;

  return (
    <div className="est-mens-rango">
      <div className="est-mens-rango-cabecera">
        <span className="est-mens-label">Rango de mensualidad</span>
        <span className="est-mens-rango-valores">
          {simboloMoneda()} {fmtMonto(desde)} — {simboloMoneda()} {fmtMonto(hasta)}
        </span>
        {!esRangoCompleto && (
          <button
            type="button"
            className="est-limpiar-subfiltro-chip"
            onClick={() => onChange(min, max)}
            title="Restablecer rango completo"
          >
            ✕ Limpiar
          </button>
        )}
      </div>
      <div className={`est-mens-slider ${sinRango ? 'est-mens-slider--deshabilitado' : ''}`}>
        <div className="est-mens-slider-pista" />
        <div
          className="est-mens-slider-franja"
          style={{ left: `${izquierda}%`, right: `${derecha}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={paso}
          value={desde}
          disabled={sinRango}
          onChange={e => cambiarDesde(Number(e.target.value))}
          aria-label="Mensualidad mínima"
          // Si ambos pulgares coinciden en el máximo, el "desde" debe quedar encima
          style={{ zIndex: desde >= max - paso ? 5 : 3 }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={paso}
          value={hasta}
          disabled={sinRango}
          onChange={e => cambiarHasta(Number(e.target.value))}
          aria-label="Mensualidad máxima"
          style={{ zIndex: 4 }}
        />
      </div>
      <div className="est-mens-rango-limites">
        <span>{simboloMoneda()} {fmtMonto(min)}</span>
        <span>{simboloMoneda()} {fmtMonto(max)}</span>
      </div>
    </div>
  );
};

export default FiltroRangoMensualidad;
