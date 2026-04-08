/**
 * FiltrosCxP.tsx
 * Filtros para el módulo Cuentas por Pagar.
 * Permite filtrar proveedores por Categoría y por Antigüedad de deuda.
 */
import React from 'react';
import { Filter, X } from 'lucide-react';

/** Opciones de categoría de proveedor */
export const CATEGORIAS_PROVEEDOR: { value: string; label: string }[] = [
  { value: 'uniforme',          label: 'Proveedor de Uniformes' },
  { value: 'trabajador',        label: 'Trabajadores' },
  { value: 'servicios_basicos', label: 'Servicios Básicos' },
  { value: 'alquiler',          label: 'Alquileres' },
  { value: 'otro',              label: 'Otros' },
];

/** Opciones de antigüedad en días */
export const OPCIONES_ANTIGUEDAD: { value: string; label: string; dias: number }[] = [
  { value: '15',  label: 'Hasta 15 días',  dias: 15  },
  { value: '30',  label: 'Hasta 30 días',  dias: 30  },
  { value: '45',  label: 'Hasta 45 días',  dias: 45  },
  { value: 'mas', label: 'Más de 45 días', dias: 999 },
];

interface Props {
  categoria: string;
  antiguedad: string;
  onChangeCategoria: (v: string) => void;
  onChangeAntiguedad: (v: string) => void;
  onLimpiar: () => void;
  /** Modo compacto: sin tarjeta contenedora, para integrar en barras */
  compact?: boolean;
}

const FiltrosCxP: React.FC<Props> = ({
  categoria, antiguedad,
  onChangeCategoria, onChangeAntiguedad,
  onLimpiar, compact = false,
}) => {
  const hayFiltros = categoria || antiguedad;

  const selectores = (
    <>
      {/* Filtro por categoría */}
      <select
        value={categoria}
        onChange={e => onChangeCategoria(e.target.value)}
        className="cxc-filtro-select"
      >
        <option value="">Categoría</option>
        {CATEGORIAS_PROVEEDOR.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      {/* Filtro por antigüedad de deuda */}
      <select
        value={antiguedad}
        onChange={e => onChangeAntiguedad(e.target.value)}
        className="cxc-filtro-select"
      >
        <option value="">Antigüedad</option>
        {OPCIONES_ANTIGUEDAD.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>

      {hayFiltros && (
        <button
          className="cxc-filtro-limpiar"
          onClick={onLimpiar}
          title="Limpiar filtros"
        >
          <X size={14} /> Limpiar
        </button>
      )}
    </>
  );

  if (compact) {
    return (
      <div className="cxc-filtros-compact">
        <Filter size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
        {selectores}
      </div>
    );
  }

  return (
    <div className="cxc-filtros">
      <div className="cxc-filtros-icono">
        <Filter size={16} />
        <span>Filtros</span>
      </div>
      <div className="cxc-filtros-selectores">
        {selectores}
      </div>
    </div>
  );
};

export default FiltrosCxP;
