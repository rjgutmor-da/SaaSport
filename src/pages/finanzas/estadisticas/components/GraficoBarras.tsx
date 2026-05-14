import React from 'react';
import { fmtMonto } from '../utils/estadisticasUtils';
import type { ItemResumen } from '../hooks/useResumenFinanciero';

interface Props {
  items: ItemResumen[];
  total: number;
  titulo: string;
  isIngreso?: boolean;
}

// Paletas vibrantes para los cilindros
const PALETA = [
  { main: '#facc15', top: '#fef08a' }, // Amarillo
  { main: '#0ea5e9', top: '#7dd3fc' }, // Celeste
  { main: '#f97316', top: '#fdba74' }, // Naranja
  { main: '#ec4899', top: '#f472b6' }, // Rosa
  { main: '#8b5cf6', top: '#c4b5fd' }, // Morado
  { main: '#10b981', top: '#6ee7b7' }, // Verde
];

const GraficoBarras: React.FC<Props> = ({ items, total, titulo, isIngreso }) => {
  if (items.length === 0 || total === 0) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '150px', 
        background: 'var(--bg-card)', 
        borderRadius: '12px', 
        border: '1px solid var(--border)' 
      }}>
        <p style={{ opacity: 0.5 }}>Sin datos para {titulo.toLowerCase()}</p>
      </div>
    );
  }

  // Ordenar de mayor a menor monto
  const ordenados = [...items].sort((a, b) => b.monto - a.monto);
  
  // Tomar los top 5
  const top5 = ordenados.slice(0, 5);
  
  // El resto sumarlos a "Otros"
  const otrosMonto = ordenados.slice(5).reduce((sum, item) => sum + item.monto, 0);
  const otrosPct = ordenados.slice(5).reduce((sum, item) => sum + item.porcentaje, 0);
  
  const datosFinales = [...top5];
  if (otrosMonto > 0) {
    datosFinales.push({
      nombre: 'Otros',
      monto: otrosMonto,
      porcentaje: otrosPct
    });
  }

  // Máximo para escalar (sumamos un 10% para que la más alta no toque el techo)
  const maxMonto = Math.max(...datosFinales.map(d => d.monto));

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'row', 
      gap: '1.5rem', 
      background: 'var(--bg-card)', 
      padding: '1.2rem', 
      borderRadius: '12px', 
      border: '1px solid var(--border)',
      boxShadow: '0 8px 24px -10px rgba(0,0,0,0.4)',
      flexWrap: 'wrap'
    }}>
      
      {/* LADO IZQUIERDO: EL GRÁFICO 3D */}
      <div style={{ flex: '1 1 350px', position: 'relative', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ marginBottom: '0.5rem', color: 'var(--text-primary)', fontSize: '1rem', fontWeight: 700 }}>
          {titulo}
        </h3>
        
        {/* Contenedor del escenario / plataforma */}
        <div style={{ 
          position: 'relative', 
          flex: 1, 
          minHeight: '180px', 
          display: 'flex', 
          alignItems: 'flex-end', 
          justifyContent: 'space-around',
          paddingBottom: '20px',
          paddingTop: '25px',
          borderBottom: '2px solid rgba(255,255,255,0.05)',
          perspective: '800px'
        }}>
          {/* Fondo decorativo (grid) */}
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: '20px',
            backgroundImage: 'radial-gradient(circle at center, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '15px 15px',
            zIndex: 0
          }} />

          {/* Plataforma 3D base */}
          <div style={{
            position: 'absolute',
            bottom: '-10px',
            left: '-2%',
            right: '-2%',
            height: '60px',
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.1), rgba(0,0,0,0.6))',
            transform: 'rotateX(75deg)',
            transformOrigin: 'bottom',
            borderRadius: '8px',
            boxShadow: '0 15px 30px rgba(0,0,0,0.7)',
            zIndex: 0
          }} />

          {/* Los Cilindros */}
          {datosFinales.map((item, idx) => {
            const heightPct = maxMonto > 0 ? (item.monto / maxMonto) * 85 : 0; 
            const color = PALETA[idx % PALETA.length];

            return (
              <div key={idx} style={{ 
                position: 'relative', 
                zIndex: 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center',
                height: '100%',
                justifyContent: 'flex-end',
                width: '16%'
              }}>
                {/* Porcentaje flotante */}
                <div style={{
                  marginBottom: '15px',
                  color: 'var(--text-primary)',
                  fontWeight: 800,
                  fontSize: '0.8rem',
                  textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                  opacity: 0.95
                }}>
                  {item.porcentaje.toFixed(0)}%
                </div>

                {/* El Cilindro Principal */}
                <div style={{
                  width: '100%',
                  maxWidth: '45px',
                  height: `${heightPct}%`,
                  position: 'relative',
                  background: `linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(255,255,255,0.3) 25%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0.6) 100%), ${color.main}`,
                  borderRadius: '2px',
                  boxShadow: 'inset 0px 0px 8px rgba(0,0,0,0.3), 5px 0 15px rgba(0,0,0,0.4)',
                  transition: 'height 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                }}>
                  {/* Tapa Superior (Elipse) */}
                  <div style={{
                    position: 'absolute',
                    top: '-8px',
                    left: 0,
                    width: '100%',
                    height: '16px',
                    background: color.top,
                    borderRadius: '50%',
                    boxShadow: 'inset 0 -2px 5px rgba(0,0,0,0.3)'
                  }} />

                  {/* Tapa Inferior (Base curva del cilindro) */}
                  <div style={{
                    position: 'absolute',
                    bottom: '-8px',
                    left: 0,
                    width: '100%',
                    height: '16px',
                    background: `linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(255,255,255,0.3) 25%, rgba(0,0,0,0.1) 70%, rgba(0,0,0,0.6) 100%), ${color.main}`,
                    borderRadius: '50%',
                    zIndex: -1
                  }} />

                  {/* Reflejo (Sombra hacia abajo sobre la plataforma) */}
                  <div style={{
                    position: 'absolute',
                    bottom: '-35px',
                    left: 0,
                    width: '100%',
                    height: '30px',
                    background: `linear-gradient(to bottom, ${color.main}, transparent)`,
                    opacity: 0.25,
                    borderRadius: '50%',
                    transform: 'scaleY(-1)',
                    filter: 'blur(3px)',
                    zIndex: -2
                  }} />
                </div>
              </div>
            );
          })}
        </div>
        
        {/* Nombres debajo de la plataforma */}
        <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: '0.8rem', padding: '0 5px' }}>
          {datosFinales.map((item, idx) => (
            <div key={idx} style={{ 
              width: '16%', 
              textAlign: 'center', 
              color: 'var(--text-secondary)', 
              fontSize: '0.7rem', 
              fontWeight: 600,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              lineHeight: '1.2'
            }}>
              {item.nombre}
            </div>
          ))}
        </div>
      </div>

      {/* LADO DERECHO: INFORMACIÓN DETALLADA */}
      <div style={{ 
        flex: '1 1 250px', 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '1rem',
        borderLeft: '1px solid var(--border)',
        paddingLeft: '1.5rem'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '1px', fontWeight: 600 }}>
            Total {isIngreso ? 'Ingresado' : 'Egresado'}
          </span>
          <span style={{ fontSize: '1.8rem', fontWeight: 800, color: isIngreso ? '#10b981' : '#ef4444', lineHeight: 1 }}>
            Bs {fmtMonto(total)}
          </span>
        </div>

        <div style={{ height: '1px', background: 'var(--border)', width: '100%' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
          <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>Desglose Detallado</h4>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', overflowY: 'auto', paddingRight: '0.2rem' }}>
            {datosFinales.map((item, idx) => {
              const color = PALETA[idx % PALETA.length];
              return (
                <div key={idx} style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  background: 'rgba(255,255,255,0.03)',
                  padding: '0.6rem 0.8rem',
                  borderRadius: '8px',
                  border: '1px solid rgba(255,255,255,0.05)',
                  transition: 'transform 0.2s, background 0.2s',
                  cursor: 'default'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                  e.currentTarget.style.transform = 'translateX(3px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                  e.currentTarget.style.transform = 'translateX(0)';
                }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <div style={{ 
                      width: '12px', 
                      height: '12px', 
                      borderRadius: '50%', 
                      background: color.main, 
                      boxShadow: `0 0 10px ${color.main}` 
                    }} />
                    <span style={{ color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 600 }}>{item.nombre}</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.9rem' }}>
                      Bs {fmtMonto(item.monto)}
                    </span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem', fontWeight: 500 }}>
                      {item.porcentaje.toFixed(1)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

    </div>
  );
};

export default GraficoBarras;
