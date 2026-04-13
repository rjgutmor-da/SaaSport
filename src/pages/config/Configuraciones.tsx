/**
 * Configuraciones.tsx
 * Página principal de Configuraciones del sistema.
 * Desde aquí se accede a la auditoría, Panel de Escuela y otros ajustes.
 */
import React from 'react';
import {
  ChevronLeft, Shield, Settings, School
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../lib/authHelper';

const Configuraciones: React.FC = () => {
  const navigate = useNavigate();
  const { esSuperAdmin } = useAuthSaaSport();

  /** Opciones de configuración */
  const opcionesBase = [
    {
      titulo: 'Auditoría',
      descripcion: 'Huella verificable de operaciones financieras (CxC, CxP, Banco)',
      icono: <Shield size={32} />,
      color: '#38bdf8',
      ruta: '/configuraciones/auditoria',
    },
  ];

  /** Panel de Escuela — solo SuperAdministrador y Dueño */
  const opcionPanelEscuela = {
    titulo: 'Panel de Escuela',
    descripcion: 'Estadísticas generales, sucursales, usuarios y configuraciones',
    icono: <School size={32} />,
    color: '#f97316',
    ruta: '/configuraciones/panel-escuela',
  };

  const opciones = esSuperAdmin
    ? [...opcionesBase, opcionPanelEscuela]
    : opcionesBase;

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
