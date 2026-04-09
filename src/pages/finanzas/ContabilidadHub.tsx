/**
 * ContabilidadHub.tsx
 * Pantalla principal del módulo de Contabilidad y Estadísticas.
 * Sustituye al antiguo FinanzasHub.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { TreePine, BookOpen, ChevronLeft, BarChart3, Activity } from 'lucide-react';

const ContabilidadHub: React.FC = () => {
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
      ruta: '/contabilidad/plan-cuentas',
      hoverClass: 'hover-color-green',
    },
    {
      id: 'libro-diario',
      titulo: 'Libro Diario',
      descripcion: 'Registro inmutable de asientos contables con partida doble.',
      icono: <BookOpen size={60} strokeWidth={1.5} />,
      ruta: '/contabilidad/libro-diario',
      hoverClass: 'hover-color-blue',
    },
    {
      id: 'estadisticas',
      titulo: 'Estadísticas',
      descripcion: 'Reportes financieros, gráficos de ingresos y gastos dinámicos.',
      icono: <BarChart3 size={60} strokeWidth={1.5} />,
      ruta: '/contabilidad/estadisticas',
      hoverClass: 'hover-color-orange',
      proximamente: true,
    },
    {
      id: 'registro-actividad',
      titulo: 'Registro de Actividad',
      descripcion: 'Auditoría de cambios y registros realizados en el sistema contable.',
      icono: <Activity size={60} strokeWidth={1.5} />,
      ruta: '/contabilidad/auditoria',
      hoverClass: 'hover-color-blue',
      proximamente: true,
    },
  ];

  return (
    <main className="main-content cxc-main">
      {/* Encabezado - Mismo estilo que otros módulos */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver al Dashboard">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Contabilidad y Estadísticas</h1>
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

export default ContabilidadHub;
