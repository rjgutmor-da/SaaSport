/**
 * FiltroMonto.tsx
 * Dropdown elegante para filtrar por rango o montos exactos de mensualidad.
 */
import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, DollarSign, X } from 'lucide-react';
import { fmtMonto } from '../utils/estadisticasUtils';

interface FiltroMontoProps {
  montosUnicos: number[];
  montosExactos: number[];
  onChangeMontosExactos: (montos: number[]) => void;
  montoRangoDesde: string;
  montoRangoHasta: string;
  onChangeMontoRango: (desde: string, hasta: string) => void;
  onLimpiarMonto: () => void;
}

const FiltroMonto: React.FC<FiltroMontoProps> = ({
  montosUnicos,
  montosExactos,
  onChangeMontosExactos,
  montoRangoDesde,
  montoRangoHasta,
  onChangeMontoRango,
  onLimpiarMonto,
}) => {
  const [abierto, setAbierto] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar dropdown al hacer clic fuera
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const tieneFiltroActivo = montosExactos.length > 0 || Boolean(montoRangoDesde) || Boolean(montoRangoHasta);

  // Etiqueta a mostrar en el botón trigger
  const obtenerEtiquetaBoton = () => {
    if (montosExactos.length > 0) {
      if (montosExactos.length === 1) {
        return `Bs ${fmtMonto(montosExactos[0])}`;
      }
      return `${montosExactos.length} montos sel.`;
    }
    if (montoRangoDesde || montoRangoHasta) {
      const min = montoRangoDesde ? `Bs ${montoRangoDesde}` : 'Min';
      const max = montoRangoHasta ? `Bs ${montoRangoHasta}` : 'Max';
      return `${min} - ${max}`;
    }
    return 'Todos';
  };

  const toggleMontoExacto = (monto: number) => {
    // Si hay un rango escrito, al hacer clic en chips se limpia el rango
    if (montoRangoDesde || montoRangoHasta) {
      onChangeMontoRango('', '');
    }

    if (montosExactos.includes(monto)) {
      onChangeMontosExactos(montosExactos.filter(m => m !== monto));
    } else {
      onChangeMontosExactos([...montosExactos, monto]);
    }
  };

  const handleDesdeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Al escribir un rango, se limpian los chips exactos
    if (montosExactos.length > 0) {
      onChangeMontosExactos([]);
    }
    onChangeMontoRango(e.target.value, montoRangoHasta);
  };

  const handleHastaChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (montosExactos.length > 0) {
      onChangeMontosExactos([]);
    }
    onChangeMontoRango(montoRangoDesde, e.target.value);
  };

  return (
    <div className="est-filtro-monto-container" ref={containerRef}>
      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 500, paddingLeft: '2px' }}>
        Monto
      </span>

      <div className="est-filtro-monto-trigger-wrap">
        <button
          type="button"
          className={`est-select-premium est-monto-trigger ${tieneFiltroActivo ? 'est-monto-trigger--activo' : ''}`}
          onClick={() => setAbierto(!abierto)}
        >
          <DollarSign size={14} className="est-monto-icon" />
          <span className="est-monto-label">{obtenerEtiquetaBoton()}</span>
          <ChevronDown size={14} className={`est-monto-arrow ${abierto ? 'est-monto-arrow--open' : ''}`} />
        </button>

        {tieneFiltroActivo && (
          <button
            type="button"
            className="est-monto-limpiar-btn"
            onClick={(e) => {
              e.stopPropagation();
              onLimpiarMonto();
            }}
            title="Limpiar filtro de monto"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {abierto && (
        <div className="est-filtro-monto-panel">
          <div className="est-monto-panel-header">
            <span>Montos exactos</span>
            {tieneFiltroActivo && (
              <button
                type="button"
                className="est-monto-panel-limpiar"
                onClick={onLimpiarMonto}
              >
                Limpiar
              </button>
            )}
          </div>

          <div className="est-monto-chips-grid">
            <button
              type="button"
              className={`est-monto-chip ${!tieneFiltroActivo ? 'est-monto-chip--activo' : ''}`}
              onClick={onLimpiarMonto}
            >
              Todos
            </button>
            {montosUnicos.map((monto) => {
              const estaSeleccionado = montosExactos.includes(monto);
              return (
                <button
                  key={monto}
                  type="button"
                  className={`est-monto-chip ${estaSeleccionado ? 'est-monto-chip--activo' : ''}`}
                  onClick={() => toggleMontoExacto(monto)}
                >
                  Bs {fmtMonto(monto)}
                </button>
              );
            })}
          </div>

          {montosUnicos.length === 0 && (
            <p className="est-monto-vacio">No hay montos en la selección actual</p>
          )}

          <div className="est-monto-panel-divider" />

          <div className="est-monto-rango-seccion">
            <span className="est-monto-rango-titulo">Rango personalizado (Bs)</span>
            <div className="est-monto-rango-inputs">
              <input
                type="number"
                min="0"
                placeholder="Desde"
                value={montoRangoDesde}
                onChange={handleDesdeChange}
                className="est-input-monto-rango"
              />
              <span className="est-monto-rango-separador">-</span>
              <input
                type="number"
                min="0"
                placeholder="Hasta"
                value={montoRangoHasta}
                onChange={handleHastaChange}
                className="est-input-monto-rango"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FiltroMonto;
