/**
 * FiltrosCxP.tsx
 * Filtros para el módulo Cuentas por Pagar.
 * Permite filtrar proveedores por Categoría y por Antigüedad de deuda.
 */
import React from 'react';
import { Filter, X } from 'lucide-react';

/** Opciones de categoría de proveedor */
export const CATEGORIAS_PROVEEDOR: { value: string; label: string }[] = [
  { value: 'todas', label: 'Todas las categorías' },
  { value: 'personal_interno', label: 'Personal Interno' },
  { value: 'trabajador', label: 'Personal Externo' },
  { value: 'uniforme', label: 'Uniformes' },
  { value: 'servicios_basicos', label: 'Servicios Básicos' },
  { value: 'alquiler', label: 'Alquileres' },
  { value: 'otro', label: 'Otros' },
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
  /** Modo sidebar: vertical para integrar en menú izquierdo */
  sidebar?: boolean;
}

const FiltrosCxP: React.FC<Props> = ({
  categoria, antiguedad,
  onChangeCategoria, onChangeAntiguedad,
  onLimpiar, compact = false, sidebar = false,
}) => {
  const hayFiltros = categoria || antiguedad;

  // Render para Sidebar
  if (sidebar) {
    return (
      <div className="sidebar-filters-grid">
        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Categoría</label>
          <select value={categoria} onChange={e => onChangeCategoria(e.target.value)} className="sidebar-select">
            <option value="">Todas</option>
            {CATEGORIAS_PROVEEDOR.filter(c => c.value !== 'todas').map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div className="sidebar-filter-item">
          <label className="sidebar-filter-label">Antigüedad</label>
          <select value={antiguedad} onChange={e => onChangeAntiguedad(e.target.value)} className="sidebar-select">
            <option value="">Cualquiera</option>
            {OPCIONES_ANTIGUEDAD.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {hayFiltros && (
          <button className="cxc-filtro-limpiar" onClick={onLimpiar} style={{ width: '100%', marginTop: '0.5rem', justifyContent: 'center' }}>
            <X size={14} /> Limpiar Filtros
          </button>
        )}
      </div>
    );
  }

  const selectores = (
    <>
      {/* Filtro por categoría */}
      <select
        value={categoria}
        onChange={e => onChangeCategoria(e.target.value)}
        className="cxc-filtro-select"
      >

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
