/**
 * FinanzasHub.tsx
 * Pantalla principal del módulo de Finanzas.
 * Actúa como hub de navegación hacia los sub-módulos: Plan de Cuentas y Libro Diario.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TreePine, BookOpen, ChevronLeft } from 'lucide-react';

const FinanzasHub: React.FC = () => {
  const navigate = useNavigate();

  const modulos: Array<{
    id: string;
    titulo: string;
    descripcion: string;
    icono: React.ReactNode;
    ruta: string;
    hoverClass: string;
    proximamente?: boolean;
  }> = [
    {
      id: 'plan-cuentas',
      titulo: 'Plan de Cuentas',
      descripcion: 'Árbol contable jerárquico con todas las cuentas organizadas por tipo.',
      icono: <TreePine size={60} strokeWidth={1.5} />,
      ruta: '/finanzas/plan-cuentas',
      hoverClass: 'hover-color-green',
    },
    {
      id: 'libro-diario',
      titulo: 'Libro Diario',
      descripcion: 'Registro inmutable de asientos contables con partida doble.',
      icono: <BookOpen size={60} strokeWidth={1.5} />,
      ruta: '/finanzas/libro-diario',
      hoverClass: 'hover-color-blue',
    },
  ];

  return (
    <main className="main-content">
      {/* Encabezado */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver al Dashboard">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">Finanzas</h1>
            <p className="pc-subtitulo">Core contable de tu escuela deportiva</p>
          </div>
        </div>
      </div>

      {/* Grid de sub-módulos */}
      <div className="finanzas-grid">
        {modulos.map((mod) => (
          <button
            key={mod.id}
            className={`finanzas-modulo-card ${mod.hoverClass} ${mod.proximamente ? 'finanzas-modulo-card--disabled' : ''}`}
            onClick={() => !mod.proximamente && navigate(mod.ruta)}
            disabled={mod.proximamente}
          >
            <div className="card-icon">
              {mod.icono}
            </div>
            <h2 className="card-title">{mod.titulo}</h2>
            <p className="finanzas-modulo-desc" style={{ color: 'var(--text-secondary)' }}>{mod.descripcion}</p>
            {mod.proximamente && (
              <span className="finanzas-proximamente">Próximamente</span>
            )}
          </button>
        ))}
      </div>
    </main>
  );
};

export default FinanzasHub;
