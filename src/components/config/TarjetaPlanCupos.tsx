/** Tarjeta visual con el plan activo, servicios adicionales, margen 15% y alertas sin bloqueo. */
import React from 'react';
import { ShieldCheck, GraduationCap, Users, MapPin, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import type { DetalleCupo, DetalleCupoAlumnos, EstadoPlanEscuela } from '../../types/planes';
import { calcularResumenPrecioPlan, formatearUsd } from '../../lib/preciosPlanes';

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
}

const calcularEstadoTermometro = (cupo: DetalleCupo | DetalleCupoAlumnos, esAlumnos = false): EstadoTermometro => {
  const porcentajeReal = cupo.limite > 0 ? (cupo.usados / cupo.limite) * 100 : 100;
  const porcentajeVisual = Math.min(100, Math.max(0, porcentajeReal));
  const porcentajeTexto = Math.round(porcentajeReal);
  const limiteConMargen = esAlumnos ? (cupo as DetalleCupoAlumnos).limite_con_margen ?? cupo.limite : cupo.limite;

  if (cupo.usados > limiteConMargen) {
    return {
      porcentajeVisual: 100,
      porcentajeTexto,
      color: '#ef4444',
      etiqueta: esAlumnos ? 'Supera margen 15%' : 'Excede cupo',
    };
  }

  if (esAlumnos && cupo.usados > cupo.limite) {
    return {
      porcentajeVisual: 100,
      porcentajeTexto,
      color: '#f59e0b',
      etiqueta: 'Margen gratis (15%)',
    };
  }

  if (cupo.usados >= cupo.limite || porcentajeReal >= 95) {
    return {
      porcentajeVisual,
      porcentajeTexto,
      color: '#FF6B35',
      etiqueta: cupo.usados >= cupo.limite ? 'Al 100%' : 'Casi lleno',
    };
  }

  if (porcentajeReal >= 75) {
    return {
      porcentajeVisual,
      porcentajeTexto,
      color: '#FF6B35',
      etiqueta: 'Cerca del límite',
    };
  }

  return {
    porcentajeVisual,
    porcentajeTexto,
    color: '#00D26A',
    etiqueta: 'Disponible',
  };
};

interface MedidorCupoProps {
  titulo: string;
  icono: React.ReactNode;
  cupo: DetalleCupo | DetalleCupoAlumnos;
  esAlumnos?: boolean;
}

const MedidorCupo: React.FC<MedidorCupoProps> = ({ titulo, icono, cupo, esAlumnos = false }) => {
  const estado = calcularEstadoTermometro(cupo, esAlumnos);
  const alumnosCupo = cupo as DetalleCupoAlumnos;

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
        aria-valuemax={esAlumnos ? (alumnosCupo.limite_con_margen ?? cupo.limite) : cupo.limite}
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
        {esAlumnos && alumnosCupo.limite_con_margen
          ? `Tope base: ${cupo.limite} · Margen gratis 15%: hasta ${alumnosCupo.limite_con_margen}`
          : cupo.adicionales > 0
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

  const { plan, addons, cupos, alerta, bloqueos_manuales: bloqueos } = estadoPlan;
  const resumenPrecio = calcularResumenPrecioPlan(estadoPlan);
  const montoContratado = Number(plan.monto_contratado_usd ?? resumenPrecio.totalMensualUsd);
  const montoCorrespondiente = Math.max(
    montoContratado,
    Number(plan.monto_correspondiente_usd ?? resumenPrecio.totalMensualUsd),
  );
  const diferenciaMonto = Number((montoCorrespondiente - montoContratado).toFixed(2));
  const hayIncrementoCorrespondiente = diferenciaMonto > 0.01;
  const ajusteTarifaPreferencial = Number((resumenPrecio.totalMensualUsd - montoContratado).toFixed(2));

  const bloqueosActivos = [
    bloqueos?.bloquear_creacion_alumnos && 'creación de alumnos',
    bloqueos?.bloquear_creacion_usuarios && 'creación de usuarios',
    bloqueos?.bloquear_creacion_sucursales && 'creación de sucursales',
  ].filter((item): item is string => Boolean(item));

  return (
    <section className="pe-plan-card" aria-label="Mi Plan y Cupos">
      <div className="pe-plan-header">
        <div className="pe-plan-titulo-grupo">
          <div className="pe-plan-icono">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="pe-plan-titulo">Plan Contratado y Cupos</h2>
            <p className="pe-plan-subtitulo">
              {plan.dia_pago
                ? `Día de pago mensual: ${plan.dia_pago} de cada mes`
                : 'Guía de capacidad contratada y crecimiento de tu escuela'}
            </p>
          </div>
        </div>

        {/* Desglose ordenado como suma: plan principal primero, adicionales debajo y total al pie */}
        <div className="pe-plan-desglose" aria-label="Desglose mensual del plan">
          <div className="pe-plan-suma-fila pe-plan-suma-plan">
            <span className="pe-plan-suma-concepto">
              {plan.nombre_producto} — Plan {plan.nombre_tramo}
            </span>
            <span className="pe-plan-suma-monto">
              {formatearUsd(resumenPrecio.precioPlanBaseUsd)}
            </span>
          </div>

          {resumenPrecio.serviciosAdicionales.map((servicio) => (
            <div key={servicio.clave} className="pe-plan-suma-fila pe-plan-suma-extra">
              <span className="pe-plan-suma-concepto">+ {servicio.nombre}</span>
              <span className="pe-plan-suma-monto">{formatearUsd(servicio.precioMensualUsd)}</span>
            </div>
          ))}

          {resumenPrecio.esAnual && resumenPrecio.descuentoMensualUsd > 0 && (
            <div className="pe-plan-suma-fila pe-plan-suma-descuento">
              <span className="pe-plan-suma-concepto">
                − Descuento suscripción anual ({resumenPrecio.descuentoAnualPorcentaje}%)
              </span>
              <span className="pe-plan-suma-monto">
                −{formatearUsd(resumenPrecio.descuentoMensualUsd)}
              </span>
            </div>
          )}

          {ajusteTarifaPreferencial > 0.01 && (
            <div className="pe-plan-suma-fila pe-plan-suma-descuento">
              <span className="pe-plan-suma-concepto">− Tarifa preferencial vigente</span>
              <span className="pe-plan-suma-monto">−{formatearUsd(ajusteTarifaPreferencial)}</span>
            </div>
          )}

          <div className="pe-plan-suma-fila pe-plan-suma-total">
            <span className="pe-plan-suma-concepto">Total mensual actual</span>
            <span className="pe-plan-suma-monto">{formatearUsd(montoContratado)}/mes</span>
          </div>

          {hayIncrementoCorrespondiente && (
            <div
              className="pe-plan-suma-fila pe-plan-suma-corresponde"
              title="Monto mensual correspondiente según uso actual y tarifa vigente"
            >
              <span className="pe-plan-suma-concepto">Corresponde pagar según uso</span>
              <span className="pe-plan-suma-monto">
                {formatearUsd(montoCorrespondiente)}/mes (+{formatearUsd(diferenciaMonto)})
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="pe-plan-grid">
        <MedidorCupo
          titulo="Alumnos Activos"
          icono={<GraduationCap size={18} />}
          cupo={cupos.alumnos}
          esAlumnos
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

      {alerta?.en_margen_gracia_alumnos && !alerta.requiere_atencion && (
        <div className="pe-plan-aviso-margen">
          <Info size={16} />
          <span>
            Estás usando el <strong>margen gratuito del 15%</strong> en alumnos activos ({cupos.alumnos.usados} de hasta {cupos.alumnos.limite_con_margen}).
            {alerta.siguiente_plan
              ? ` Próximo tramo sugerido: ${alerta.siguiente_plan.nombre_producto} — Plan ${alerta.siguiente_plan.nombre_tramo} (${formatearUsd(alerta.siguiente_plan.precio_mensual_usd)}/mes).`
              : ''}
          </span>
        </div>
      )}

      {alerta?.recomendacion && (alerta.requiere_atencion || hayIncrementoCorrespondiente) && (
        <div className={alerta.requiere_atencion ? 'pe-plan-alerta-destacada' : 'pe-plan-aviso-margen'}>
          <AlertTriangle size={18} />
          <div className="pe-plan-alerta-contenido">
            <div className="pe-plan-alerta-titulo">
              Monto correspondiente por tu uso actual: <strong>{formatearUsd(montoCorrespondiente)}/mes</strong>
            </div>
            <span>{alerta.recomendacion.mensaje}</span>
          </div>
        </div>
      )}

      {bloqueosActivos.length > 0 && (
        <div className="pe-plan-alerta">
          <AlertTriangle size={16} />
          <span>
            Bloqueo administrativo activo sobre: <strong>{bloqueosActivos.join(', ')}</strong>.
            {bloqueos?.motivo_bloqueo ? ` Motivo: ${bloqueos.motivo_bloqueo}` : ''}
          </span>
        </div>
      )}
    </section>
  );
};

export default TarjetaPlanCupos;
