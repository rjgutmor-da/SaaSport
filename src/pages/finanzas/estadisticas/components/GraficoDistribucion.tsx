import React, { useState } from 'react';
import { fmtMonto } from '../utils/estadisticasUtils';
import type { ItemResumen } from '../hooks/useResumenFinanciero';

const PALETA_AESTHETIC = [
  '#6366f1', // Azul medio
  '#f59e0b', // Naranja/Amarillo
  '#10b981', // Verde
  '#ef4444', // Rojo
  '#3b82f6', // Azul claro
  '#8b5cf6', // Púrpura
  '#1e293b', // Gris oscuro
];

interface Props {
  items: ItemResumen[];
  total: number;
  titulo: string;
  isIngreso?: boolean;
}

/** Calcula un arco SVG para un segmento de torta */
function calcularArco(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
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

const GraficoDistribucion: React.FC<Props> = ({ items, total, titulo, isIngreso }) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (items.length === 0 || total === 0) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '180px', 
        background: 'var(--bg-card)', 
        borderRadius: '16px', 
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
        fontSize: '0.9rem'
      }}>
        <p>Sin datos para {titulo.toLowerCase()}</p>
      </div>
    );
  }

  // Ordenar de mayor a menor monto
  const ordenados = [...items].sort((a, b) => b.monto - a.monto);
  
  // Tomar los top 6 (para que se vea más lleno y profesional)
  const topN = ordenados.slice(0, 6);
  
  // El resto sumarlos a "Otros"
  const otrosMonto = ordenados.slice(6).reduce((sum, item) => sum + item.monto, 0);
  const otrosPct = ordenados.slice(6).reduce((sum, item) => sum + item.porcentaje, 0);
  
  const datosFinales = [...topN];
  if (otrosMonto > 0) {
    datosFinales.push({
      nombre: 'Otros',
      monto: otrosMonto,
      porcentaje: otrosPct
    });
  }

  // Dimensiones de la torta (Agrandada)
  const CX = 140, CY = 140, R = 130;
  const labelRadius = R * 0.7;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  // Construir segmentos
  let anguloAcum = -90; // Empieza desde arriba
  const segmentos = datosFinales.map((item, i) => {
    const grados = (item.porcentaje / 100) * 360;
    const inicio = anguloAcum;
    const fin = anguloAcum + grados;
    const midAngle = inicio + grados / 2;
    anguloAcum = fin;
    
    return {
      ...item,
      color: PALETA_AESTHETIC[i % PALETA_AESTHETIC.length],
      inicio,
      fin,
      grados,
      index: i,
      labelX: CX + labelRadius * Math.cos(toRad(midAngle)),
      labelY: CY + labelRadius * Math.sin(toRad(midAngle))
    };
  });

  return (
    <div className="grafico-distribucion-premium" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      gap: '2rem', 
      background: 'var(--bg-card)', 
      padding: '2.5rem', 
      borderRadius: '24px', 
      border: '1px solid var(--border)',
      boxShadow: '0 15px 50px -20px rgba(0,0,0,0.6)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Efecto de brillo de fondo */}
      <div style={{
        position: 'absolute',
        top: '-20%',
        left: '-10%',
        width: '40%',
        height: '60%',
        background: `radial-gradient(circle, ${isIngreso ? 'rgba(0, 210, 106, 0.05)' : 'rgba(255, 59, 48, 0.05)'} 0%, transparent 70%)`,
        zIndex: 0,
        pointerEvents: 'none'
      }} />

      {/* ENCABEZADO: Título Izquierda, Total Derecha */}
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'flex-start', 
        zIndex: 1,
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <h2 style={{ 
          color: 'var(--text-primary)', 
          fontSize: '2.4rem', 
          fontWeight: 300, /* Aesthetic look */
          letterSpacing: '1px',
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}>
          {isIngreso ? 'Ingresos' : 'Egresos'}
        </h2>
        <div style={{ textAlign: 'right' }}>
          <span style={{ fontSize: '2.8rem', fontWeight: 900, color: isIngreso ? 'var(--success)' : 'var(--danger)', lineHeight: 1, letterSpacing: '-0.04em' }}>
            Bs {fmtMonto(total)}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'row', gap: '2.5rem', flexWrap: 'wrap', zIndex: 1 }}>
        {/* LADO IZQUIERDO: TORTA COMPLETA */}
        <div style={{ 
          flex: '1 1 300px', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}>
          <div style={{ position: 'relative', width: '280px', height: '280px' }}>
            <svg width={280} height={280} viewBox="0 0 280 280" style={{ transform: 'rotate(0deg)', transition: 'transform 0.5s ease' }}>
              <defs>
                {segmentos.map((seg, i) => (
                  <linearGradient key={`grad-${i}`} id={`grad-${seg.index}`} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor={seg.color} stopOpacity="1" />
                    <stop offset="100%" stopColor={seg.color} stopOpacity="0.8" />
                  </linearGradient>
                ))}
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feGaussianBlur in="SourceAlpha" stdDeviation="3" />
                  <feOffset dx="0" dy="2" result="offsetblur" />
                  <feComponentTransfer>
                    <feFuncA type="linear" slope="0.3" />
                  </feComponentTransfer>
                  <feMerge>
                    <feMergeNode />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>

              {segmentos.map((seg) => {
                const esHover = hoverIndex === seg.index;
                const escala = esHover ? 1.04 : 1;
                
                return (
                  <g key={seg.index}>
                    <path
                      d={calcularArco(CX, CY, esHover ? R + 4 : R, seg.inicio, seg.fin)}
                      fill={`url(#grad-${seg.index})`}
                      stroke="var(--bg-card)"
                      strokeWidth={2.5}
                      style={{ 
                        cursor: 'pointer', 
                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)', 
                        transform: `scale(${escala})`, 
                        transformOrigin: `${CX}px ${CY}px`,
                        filter: esHover ? 'url(#shadow)' : 'none'
                      }}
                      onMouseEnter={() => setHoverIndex(seg.index)}
                      onMouseLeave={() => setHoverIndex(null)}
                    />
                    
                    {/* Porcentaje Permanente sobre el segmento */}
                    {seg.porcentaje > 4 && (
                      <text
                        x={seg.labelX}
                        y={seg.labelY}
                        textAnchor="middle"
                        dominantBaseline="middle"
                        fill="#FFF"
                        fontSize={seg.porcentaje > 15 ? "14" : "11"}
                        fontWeight="900"
                        style={{ 
                          pointerEvents: 'none', 
                          textShadow: '0 2px 4px rgba(0,0,0,0.5)',
                          opacity: hoverIndex === null || hoverIndex === seg.index ? 1 : 0.7,
                          transition: 'all 0.3s ease'
                        }}
                      >
                        {seg.porcentaje.toFixed(0)}%
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* LADO DERECHO: BARRAS HORIZONTALES */}
        <div style={{ 
          flex: '1 1 350px', 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '1.2rem',
          paddingTop: '1rem'
        }}>
          {segmentos.map((item, idx) => {
            const isHovered = hoverIndex === idx;
            return (
              <div 
                key={idx} 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '0.5rem',
                  transition: 'all 0.3s ease',
                  transform: isHovered ? 'translateX(5px)' : 'none',
                  opacity: hoverIndex === null || isHovered ? 1 : 0.6
                }}
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
                    <div style={{ 
                      width: '10px', 
                      height: '10px', 
                      borderRadius: '50%', 
                      background: item.color, 
                      boxShadow: `0 0 12px ${item.color}88` 
                    }} />
                    <span style={{ 
                      color: isHovered ? 'var(--text-primary)' : 'var(--text-secondary)', 
                      fontSize: '0.9rem', 
                      fontWeight: isHovered ? 800 : 600,
                      transition: 'color 0.2s ease'
                    }}>
                      {item.nombre}
                    </span>
                  </div>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.95rem' }}>
                    Bs {fmtMonto(item.monto)}
                  </span>
                </div>

                {/* Barra horizontal */}
                <div style={{ 
                  width: '100%', 
                  height: '8px', 
                  background: 'rgba(255,255,255,0.04)', 
                  borderRadius: '10px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.02)'
                }}>
                  <div style={{ 
                    width: `${item.porcentaje}%`, 
                    height: '100%', 
                    background: `linear-gradient(90deg, ${item.color}cc, ${item.color})`,
                    borderRadius: '10px',
                    boxShadow: isHovered ? `0 0 10px ${item.color}66` : 'none',
                    transition: 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Estilos inline para animaciones */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translate(-50%, -40%); }
          to { opacity: 1; transform: translate(-50%, -50%); }
        }
      `}</style>
    </div>
  );
};

export default GraficoDistribucion;
