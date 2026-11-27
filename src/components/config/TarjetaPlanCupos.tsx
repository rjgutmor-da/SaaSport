/** Tarjeta compacta del plan contratado, desglose en suma y avisos laterales sin desplegar hacia abajo. */
import React from 'react';
import { ShieldCheck, AlertTriangle, RefreshCw, Info } from 'lucide-react';
import type { EstadoPlanEscuela } from '../../types/planes';
import { calcularResumenPrecioPlan, formatearUsd } from '../../lib/preciosPlanes';

interface TarjetaPlanCuposProps {
  estadoPlan: EstadoPlanEscuela | null | undefined;
  cargando?: boolean;
  error?: string | null;
}

const TarjetaPlanCupos: React.FC<TarjetaPlanCuposProps> = ({ estadoPlan, cargando, error }) => {
  if (cargando && !estadoPlan) {
    return (
      <section className="pe-plan-card" aria-label="Plan Contratado">
        <div className="pe-plan-cargando">
          <RefreshCw size={20} className="spin" style={{ color: 'var(--primary)' }} />
          <span>Cargando información del plan...</span>
        </div>
      </section>
    );
  }

  if (error && !estadoPlan) {
    return (
      <section className="pe-plan-card" aria-label="Plan Contratado">
        <div className="login-error" style={{ margin: 0 }}>
          <span>{error}</span>
        </div>
      </section>
    );
  }

  if (!estadoPlan) return null;

  const { plan, cupos, alerta, bloqueos_manuales: bloqueos } = estadoPlan;
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

  const mostrarAvisoMargen = Boolean(alerta?.en_margen_gracia_alumnos && !alerta.requiere_atencion);
  const mostrarAvisoRecomendacion = Boolean(alerta?.recomendacion && (alerta.requiere_atencion || hayIncrementoCorrespondiente));
  const mostrarBloqueos = bloqueosActivos.length > 0;
  const hayAvisos = mostrarAvisoMargen || mostrarAvisoRecomendacion || mostrarBloqueos;

  return (
    <section className="pe-plan-card" aria-label="Plan Contratado">
      <div className={`pe-plan-header${hayAvisos ? ' pe-plan-header--con-avisos' : ''}`}>
        <div className="pe-plan-titulo-grupo">
          <div className="pe-plan-icono">
            <ShieldCheck size={22} />
          </div>
          <div>
            <h2 className="pe-plan-titulo">Plan Contratado</h2>
            <p className="pe-plan-subtitulo">
              {plan.dia_pago
                ? `Día de pago mensual: ${plan.dia_pago} de cada mes`
                : 'Guía de suscripción y crecimiento de tu escuela'}
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

        {hayAvisos && (
          <div className="pe-plan-avisos-col">
            {mostrarAvisoMargen && (
              <div className="pe-plan-aviso-margen">
                <Info size={16} style={{ flexShrink: 0 }} />
                <span>
                  Estás usando el <strong>margen gratuito del 15%</strong> en alumnos activos ({cupos.alumnos.usados} de hasta {cupos.alumnos.limite_con_margen}).
                  {alerta?.siguiente_plan
                    ? ` Próximo tramo sugerido: ${alerta.siguiente_plan.nombre_producto} — Plan ${alerta.siguiente_plan.nombre_tramo} (${formatearUsd(alerta.siguiente_plan.precio_mensual_usd)}/mes).`
                    : ''}
                </span>
              </div>
            )}

            {mostrarAvisoRecomendacion && alerta?.recomendacion && (
              <div className={alerta.requiere_atencion ? 'pe-plan-alerta-destacada' : 'pe-plan-aviso-margen'}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
                <div className="pe-plan-alerta-contenido">
                  <div className="pe-plan-alerta-titulo">
                    Monto correspondiente por tu uso actual: <strong>{formatearUsd(montoCorrespondiente)}/mes</strong>
                  </div>
                  <span>{alerta.recomendacion.mensaje}</span>
                </div>
              </div>
            )}

            {mostrarBloqueos && (
              <div className="pe-plan-alerta">
                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                <span>
                  Bloqueo administrativo activo sobre: <strong>{bloqueosActivos.join(', ')}</strong>.
                  {bloqueos?.motivo_bloqueo ? ` Motivo: ${bloqueos.motivo_bloqueo}` : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
};

export default TarjetaPlanCupos;
