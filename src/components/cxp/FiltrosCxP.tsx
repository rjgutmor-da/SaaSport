/** Filtros simplificados para Cuentas por Pagar. */
import React from 'react';
import { Users, Shirt, MoreHorizontal } from 'lucide-react';

export const CATEGORIAS_PROVEEDOR = [
  { value: 'personal', label: 'Personal' },
  { value: 'uniforme', label: 'Uniformes' },
  { value: 'otro', label: 'Otros' },
] as const;

interface Props {
  categoria: string;
  onChangeCategoria: (v: string) => void;
  compact?: boolean;
}

const iconos = { personal: Users, uniforme: Shirt, otro: MoreHorizontal };

const FiltrosCxP: React.FC<Props> = ({ categoria, onChangeCategoria, compact = false }) => (
  <div className="cxc-filtros-compact" style={{ gap: '0.45rem', flexWrap: 'wrap', ...(compact ? {} : { padding: '0.5rem' }) }} aria-label="Filtrar cuentas por pagar por categoría">
    {CATEGORIAS_PROVEEDOR.map((opcion) => {
      const Icono = iconos[opcion.value];
      const activo = categoria === opcion.value;
      return (
        <button key={opcion.value} type="button" className={`nota-mes-btn ${activo ? 'nota-mes-btn--activo' : ''}`} onClick={() => onChangeCategoria(activo ? '' : opcion.value)} aria-pressed={activo} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', padding: '0.4rem 0.7rem' }}>
          <Icono size={14} /> {opcion.label}
        </button>
      );
    })}
  </div>
);

export default FiltrosCxP;
