import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

// Interfaz para definir cada opción del dropdown
interface OpcionDropdown {
  label: string;
  descripcion?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

// Propiedades del componente DropdownAcciones
interface DropdownAccionesProps {
  label: string;
  icon: React.ReactNode;
  opciones: OpcionDropdown[];
  tooltip?: string;
}

export const DropdownAcciones: React.FC<DropdownAccionesProps> = ({
  label,
  icon,
  opciones,
  tooltip
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Cerrar el menú desplegable al hacer clic fuera del componente
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div ref={menuRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        title={tooltip}
        className="cxc-accion-btn"
        style={{
          fontWeight: 700,
          padding: '0.5rem 1rem',
          background: isOpen ? 'var(--primary-glow, rgba(59, 130, 246, 0.1))' : '#E5E7EB',
          color: isOpen ? 'var(--primary, #3b82f6)' : '#000',
          border: isOpen ? '1px solid var(--primary, #3b82f6)' : 'none',
          borderRadius: '8px',
          boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          cursor: 'pointer',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown
          size={16}
          style={{
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            background: 'var(--bg-card, #ffffff)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: '1px solid var(--border, rgba(0, 0, 0, 0.1))',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            minWidth: '280px',
            padding: '0.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
          }}
        >
          {opciones.map((opcion, idx) => {
            const isItemHovered = hoveredIdx === idx;
            return (
              <button
                key={idx}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                onClick={() => {
                  opcion.onClick();
                  setIsOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.65rem 0.75rem',
                  background: isItemHovered ? 'var(--primary-glow, rgba(59, 130, 246, 0.08))' : 'transparent',
                  border: 'none',
                  borderRadius: '8px',
                  textAlign: 'left',
                  width: '100%',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  color: isItemHovered ? 'var(--primary, #3b82f6)' : 'var(--text-primary, #1f2937)',
                }}
              >
                <div 
                  style={{ 
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: isItemHovered ? 'var(--primary, #3b82f6)' : 'var(--text-secondary, #4b5563)',
                    transition: 'color 0.15s ease',
                  }}
                >
                  {opcion.icon}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600, fontSize: '0.85rem', lineHeight: 1.2 }}>
                    {opcion.label}
                  </span>
                  {opcion.descripcion && (
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary, #6b7280)', opacity: 0.85 }}>
                      {opcion.descripcion}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DropdownAcciones;
