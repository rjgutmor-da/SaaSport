/**
 * TortaIngresos.tsx
 * Gráfico de torta SVG puro (sin librería externa) que muestra la distribución
 * porcentual de ingresos o egresos por ítem de catálogo.
 *
 * Requisito: no depende de recharts ni chart.js — es SVG vanilla para máxima
 * compatibilidad y rendimiento en la app.
 */
import React, { useState } from 'react';
import { COLORES_TORTA, fmtMonto } from '../utils/estadisticasUtils';
import type { ItemResumen } from '../hooks/useResumenFinanciero';

interface Props {
  items: ItemResumen[];
  total: number;
  titulo: string;
  colorBase: string; // Color de acento principal (para títulos, etc.)
}

/** Calcula un arco SVG para un segmento de torta */
function calcularArco(
  cx: number,
  cy: number,
  r: number,
  startAngle: number, // grados
  endAngle: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startAngle));
  const y1 = cy + r * Math.sin(toRad(startAngle));
  const x2 = cx + r * Math.cos(toRad(endAngle));
  const y2 = cy + r * Math.sin(toRad(endAngle));
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`;
}

const TortaIngresos: React.FC<Props> = ({ items, total, titulo, colorBase }) => {
  const [hover, setHover] = useState<number | null>(null);

  // Dimensiones de la torta
  const CX = 130, CY = 130, R = 110, R_INNER = 55;

  // Si no hay datos
  if (items.length === 0 || total === 0) {
    return (
      <div className="est-torta-vacia">
        <div className="est-torta-circulo-vacio" />
        <p className="est-vacio-msg">Sin datos para el período seleccionado</p>
      </div>
    );
  }

  // Construir segmentos
  let anguloAcum = -90; // Empieza desde arriba
  const segmentos = items.map((item, i) => {
    const grados = (item.porcentaje / 100) * 360;
    const inicio = anguloAcum;
    const fin = anguloAcum + grados;
    anguloAcum = fin;
    return {
      ...item,
      color: COLORES_TORTA[i % COLORES_TORTA.length],
      inicio,
      fin,
      grados,
      index: i,
    };
  });

  return (
    <div className="est-torta-contenedor">
      {/* SVG Torta */}
      <div className="est-torta-svg-wrap">
        <svg
          width={260}
          height={260}
          viewBox="0 0 260 260"
          className="est-torta-svg"
        >
          {segmentos.map((seg) => {
            const esHover = hover === seg.index;
            const escala = esHover ? 1.04 : 1;
            return (
              <path
                key={seg.index}
                d={calcularArco(CX, CY, esHover ? R + 6 : R, seg.inicio, seg.fin)}
                fill={seg.color}
                stroke="var(--bg-main)"
                strokeWidth={2}
                style={{ cursor: 'pointer', transition: 'all 0.2s ease', transform: `scale(${escala})`, transformOrigin: `${CX}px ${CY}px` }}
                onMouseEnter={() => setHover(seg.index)}
                onMouseLeave={() => setHover(null)}
                opacity={hover !== null && hover !== seg.index ? 0.6 : 1}
              />
            );
          })}

          {/* Círculo interior (efecto donut) */}
          <circle
            cx={CX}
            cy={CY}
            r={R_INNER}
            fill="var(--bg-main)"
            stroke="var(--border)"
            strokeWidth={1}
          />

          {/* Texto central */}
          <text x={CX} y={CY - 8} textAnchor="middle" fill="var(--text-secondary)" fontSize="11" fontFamily="inherit">
            {titulo.toUpperCase()}
          </text>
          <text x={CX} y={CY + 10} textAnchor="middle" fill="var(--text-primary)" fontSize="13" fontWeight="700" fontFamily="inherit">
            Bs {fmtMonto(total)}
          </text>

          {/* Tooltip (segmento en hover) */}
          {hover !== null && segmentos[hover] && (
            <g>
              <rect
                x={CX - 55}
                y={10}
                width={110}
                height={34}
                rx={6}
                fill="var(--bg-card)"
                stroke="var(--border)"
                strokeWidth={1}
              />
              <text x={CX} y={24} textAnchor="middle" fill={segmentos[hover].color} fontSize="10" fontWeight="700" fontFamily="inherit">
                {segmentos[hover].nombre}
              </text>
              <text x={CX} y={38} textAnchor="middle" fill="var(--text-primary)" fontSize="10.5" fontWeight="600" fontFamily="inherit">
                {segmentos[hover].porcentaje.toFixed(1)}% — Bs {fmtMonto(segmentos[hover].monto)}
              </text>
            </g>
          )}
        </svg>
      </div>

      {/* Leyenda (lista de ítems) */}
      <div className="est-torta-leyenda">
        {segmentos.map((seg) => (
          <div
            key={seg.index}
            className={`est-leyenda-item ${hover === seg.index ? 'est-leyenda-item--hover' : ''}`}
            onMouseEnter={() => setHover(seg.index)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="est-leyenda-dot" style={{ background: seg.color }} />
            <span className="est-leyenda-nombre">{seg.nombre}</span>
            <span className="est-leyenda-barra-wrap">
              <span
                className="est-leyenda-barra-fill"
                style={{ width: `${seg.porcentaje}%`, background: seg.color }}
              />
            </span>
            <span className="est-leyenda-pct">{seg.porcentaje.toFixed(1)}%</span>
            <span className="est-leyenda-monto">Bs {fmtMonto(seg.monto)}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TortaIngresos;
