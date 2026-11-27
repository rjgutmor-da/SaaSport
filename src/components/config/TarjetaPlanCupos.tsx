/** Tarjeta visual con el plan activo, servicios adicionales y termómetro de cupos. */
import React from 'react';
import { ShieldCheck, GraduationCap, Users, MapPin, AlertTriangle, RefreshCw } from 'lucide-react';
import type { DetalleCupo, EstadoPlanEscuela } from '../../types/planes';

interface TarjetaPlanCuposProps {
  estadoPlan: EstadoPlanEscuela | null | undefined;
  cargando?: boolean;
  error?: string | null;
}

interface EstadoTermometro {
  porcentajeVisual: number;
  porcentajeTexto: number;
  color: string;
  etiqueta: string;
  lleno: boolean;
}

const calcularEstadoTermometro = (cupo: DetalleCupo): EstadoTermometro => {
  const porcentajeReal = cupo.limite > 0 ? (cupo.usados / cupo.limite) * 100 : 100;
  const porcentajeVisual = Math.min(100, Math.max(0, porcentajeReal));
  const porcentajeTexto = Math.round(porcentajeReal);
  const lleno = cupo.usados >= cupo.limite;

  if (lleno || porcentajeReal >= 95) {
    return {
      porcentajeVisual,
      porcentajeTexto,
      color: '#ef4444',
      etiqueta: lleno ? 'Cupo lleno' : 'Casi lleno',
      lleno,
    };
  }

  if (porcentajeReal >= 75) {
    return {
      porcentajeVisual,
      porcentajeTexto,
      color: '#FF6B35',
      etiqueta: 'Cerca del límite',
      lleno: false,
    };
  }

  return {
    porcentajeVisual,
    porcentajeTexto,
    color: '#00D26A',
    etiqueta: 'Disponible',
    lleno: false,
  };
};

interface MedidorCupoProps {
  titulo: string;
  icono: React.ReactNode;
  cupo: DetalleCupo;
}

const MedidorCupo: React.FC<MedidorCupoProps> = ({ titulo, icono, cupo }) => {
  const estado = calcularEstadoTermometro(cupo);

  return (
    <div className="pe-plan-medidor">
      <div className="pe-plan-medidor-cabecera">
        <div className="pe-plan-medidor-titulo">
          <span className="pe-plan-medidor-icono" style={{ color: estado.color }}>
            {icono}
          </span>
          <span>{titulo}</span>
        </div>
        <span
          className="pe-plan-estado-pill"
          style={{
            color: estado.color,
            borderColor: `${estado.color}40`,
            backgroundColor: `${estado.color}18`,
          }}
        >
          {estado.etiqueta}
        </span>
      </div>

      <div className="pe-plan-medidor-numeros">
        <span className="pe-plan-cifra">
          <strong>{cupo.usados}</strong> / {cupo.limite}
        </span>
        <span className="pe-plan-porcentaje" style={{ color: estado.color }}>
          {estado.porcentajeTexto}%
        </span>
      </div>

      <div
        className="pe-plan-barra-fondo"
        role="progressbar"
        aria-label={titulo}
        aria-valuenow={cupo.usados}
        aria-valuemin={0}
        aria-valuemax={cupo.limite}
      >
        <div
          className="pe-plan-barra-relleno"
          style={{
            width: `${estado.porcentajeVisual}%`,
            backgroundColor: estado.color,
          }}
        />
      </div>

      <p className="pe-plan-medidor-detalle">
        {cupo.adicionales > 0
          ? `Base ${cupo.base} + ${cupo.adicionales} adicional(es)`
          : `Tope base del plan: ${cupo.base}`}
      </p>
    </div>
  );
};

const TarjetaPlanCupos: React.FC<TarjetaPlanCuposProps> = ({ estadoPlan, cargando, error }) => {
  if (cargando && !estadoPlan) {
    return (
      <section className="pe-plan-card" aria-label="Mi Plan y Cupos">
        <div className="pe-plan-cargando">
          <RefreshCw size={20} className="spin" style={{ color: 'var(--primary)' }} />
          <span>Cargando consumo del plan...</span>
        </div>
      </section>
    );
  }

  if (error && !estadoPlan) {
    return (
      <section className="pe-plan-card" aria-label="Mi Plan y Cupos">
        <div className="login-error" style={{ margin: 0 }}>
          <span>{error}</span>
        </div>
      </section>
    );
  }

  if (!estadoPlan) return null;

  const { plan, addons, cupos } = estadoPlan;

  const serviciosAdicionales = [
    addons.fotos_asistencia && 'Fotos de Asistencia',
    addons.perfil_medico && 'Perfil Médico',
    addons.ficha_deportiva && 'Ficha Deportiva',
    addons.cobranza_automatica && 'Cobranza Automática WhatsApp',
  ].filter((item): item is string => Boolean(item));

  const hayAlgunCupoLleno =
    cupos.alumnos.usados >= cupos.alumnos.limite ||
    cupos.usuarios.usados >= cupos.usuarios.limite ||
    cupos.sucursales.usados >= cupos.sucursales.limite;

  return (
    <section className="pe-plan-card" aria-label="Mi Plan y Cupos">
      <div className="pe-plan-header">
        <div className="pe-plan-titulo-grupo">
          <div className="pe-plan-icono">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="pe-plan-titulo">Mi Plan y Cupos</h2>
            <p className="pe-plan-subtitulo">
              Control de capacidad mensual según tu suscripción vigente
            </p>
          </div>
        </div>

        <div className="pe-plan-badges">
          <span className="pe-plan-badge-principal">
            {plan.nombre_producto} — Plan {plan.nombre_tramo}
          </span>
          {addons.suscripcion_anual && (
            <span className="pe-plan-badge-anual">Suscripción Anual</span>
          )}
        </div>
      </div>

      {serviciosAdicionales.length > 0 && (
        <div className="pe-plan-addons">
          <span className="pe-plan-addons-label">Servicios adicionales activos:</span>
          {serviciosAdicionales.map((servicio) => (
            <span key={servicio} className="pe-plan-addon-chip">
              {servicio}
            </span>
          ))}
        </div>
      )}

      <div className="pe-plan-grid">
        <MedidorCupo
          titulo="Alumnos Activos"
          icono={<GraduationCap size={18} />}
          cupo={cupos.alumnos}
        />
        <MedidorCupo
          titulo="Usuarios Activos"
          icono={<Users size={18} />}
          cupo={cupos.usuarios}
        />
        <MedidorCupo
          titulo="Sucursales"
          icono={<MapPin size={18} />}
          cupo={cupos.sucursales}
        />
      </div>

      {hayAlgunCupoLleno && (
        <div className="pe-plan-alerta">
          <AlertTriangle size={16} />
          <span>
            Alcanzaste el tope en uno de tus recursos. Archiva registros inactivos o solicita ampliar tu plan para habilitar más cupos.
          </span>
        </div>
      )}
    </section>
  );
};

export default TarjetaPlanCupos;
