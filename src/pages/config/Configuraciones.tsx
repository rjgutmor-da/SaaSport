/**
 * Configuraciones.tsx
 * Página principal de Configuraciones del sistema.
 * Desde aquí se accede a la auditoría y otros ajustes.
 */
import React from 'react';
import {
  ChevronLeft, Shield, Settings
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Configuraciones: React.FC = () => {
  const navigate = useNavigate();

  /** Opciones de configuración */
  const opciones = [
    {
      titulo: 'Auditoría',
      descripcion: 'Huella verificable de operaciones financieras (CxC, CxP, Banco)',
      icono: <Shield size={32} />,
      color: '#38bdf8',
      ruta: '/configuraciones/auditoria',
    },
  ];

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <Settings size={28} style={{ marginRight: '0.5rem' }} />
              Configuraciones
            </h1>
            <p className="pc-subtitulo">Administración y ajustes del sistema</p>
          </div>
        </div>
      </div>

      {/* Grid de opciones */}
      <div className="config-grid">
        {opciones.map(op => (
          <button
            key={op.ruta}
            className="config-card"
            onClick={() => navigate(op.ruta)}
          >
            <div className="config-card-icono" style={{ color: op.color }}>
              {op.icono}
            </div>
            <div className="config-card-info">
              <h3>{op.titulo}</h3>
              <p>{op.descripcion}</p>
            </div>
          </button>
        ))}
      </div>
    </main>
  );
};

export default Configuraciones;
