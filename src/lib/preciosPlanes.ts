/** Cálculo de precios en USD para el plan contratado y servicios adicionales por tramo. */
import type { EstadoPlanEscuela, TramoPlan } from '../types/planes';

export interface ServicioAdicionalPrecio {
  clave: string;
  nombre: string;
  precioMensualUsd: number;
}

export interface ResumenPrecioPlan {
  precioPlanBaseUsd: number;
  serviciosAdicionales: ServicioAdicionalPrecio[];
  subtotalMensualUsd: number;
  descuentoAnualPorcentaje: number;
  descuentoMensualUsd: number;
  totalMensualUsd: number;
  totalAnualUsd: number;
  esAnual: boolean;
}

const PRECIO_USUARIO_ADICIONAL_USD = 2;
const DESCUENTO_ANUAL_PORCENTAJE = 15;

const PRECIO_FOTOS_ASISTENCIA: Record<TramoPlan, number> = {
  basico: 5,
  crecimiento: 5,
  profesional: 7,
  completa: 7,
};

const PRECIO_PERFIL_MEDICO: Record<TramoPlan, number> = {
  basico: 5,
  crecimiento: 5,
  profesional: 7,
  completa: 7,
};

const PRECIO_FICHA_DEPORTIVA: Record<TramoPlan, number> = {
  basico: 5,
  crecimiento: 5,
  profesional: 7,
  completa: 7,
};

const PRECIO_COBRANZA_AUTOMATICA: Record<TramoPlan, number> = {
  basico: 10,
  crecimiento: 15,
  profesional: 20,
  completa: 25,
};

export const formatearUsd = (monto: number): string =>
  `USD ${monto.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const calcularResumenPrecioPlan = (estadoPlan: EstadoPlanEscuela): ResumenPrecioPlan => {
  const { plan, addons } = estadoPlan;
  const tramo = plan.tramo;
  const precioPlanBaseUsd = Number(plan.precio_mensual_usd || 0);
  const serviciosAdicionales: ServicioAdicionalPrecio[] = [];

  if (addons.usuarios_adicionales > 0) {
    const cantidad = addons.usuarios_adicionales;
    serviciosAdicionales.push({
      clave: 'usuarios_adicionales',
      nombre: cantidad === 1 ? '1 Usuario Adicional' : `${cantidad} Usuarios Adicionales`,
      precioMensualUsd: cantidad * PRECIO_USUARIO_ADICIONAL_USD,
    });
  }

  if (addons.fotos_asistencia) {
    serviciosAdicionales.push({
      clave: 'fotos_asistencia',
      nombre: 'Fotos de Asistencia',
      precioMensualUsd: PRECIO_FOTOS_ASISTENCIA[tramo] ?? 5,
    });
  }

  if (addons.perfil_medico) {
    serviciosAdicionales.push({
      clave: 'perfil_medico',
      nombre: 'Perfil Médico',
      precioMensualUsd: PRECIO_PERFIL_MEDICO[tramo] ?? 4,
    });
  }

  if (addons.ficha_deportiva) {
    serviciosAdicionales.push({
      clave: 'ficha_deportiva',
      nombre: 'Ficha Deportiva',
      precioMensualUsd: PRECIO_FICHA_DEPORTIVA[tramo] ?? 5,
    });
  }

  if (addons.cobranza_automatica) {
    serviciosAdicionales.push({
      clave: 'cobranza_automatica',
      nombre: 'Cobranza Automática WhatsApp',
      precioMensualUsd: PRECIO_COBRANZA_AUTOMATICA[tramo] ?? 10,
    });
  }

  serviciosAdicionales.sort((a, b) => b.precioMensualUsd - a.precioMensualUsd);

  const totalExtrasUsd = serviciosAdicionales.reduce((acc, item) => acc + item.precioMensualUsd, 0);
  const subtotalMensualUsd = precioPlanBaseUsd + totalExtrasUsd;
  const esAnual = Boolean(addons.suscripcion_anual);
  const descuentoMensualUsd = esAnual
    ? Number(((subtotalMensualUsd * DESCUENTO_ANUAL_PORCENTAJE) / 100).toFixed(2))
    : 0;
  const totalMensualUsd = Number((subtotalMensualUsd - descuentoMensualUsd).toFixed(2));
  const totalAnualUsd = Number((totalMensualUsd * 12).toFixed(2));

  return {
    precioPlanBaseUsd,
    serviciosAdicionales,
    subtotalMensualUsd,
    descuentoAnualPorcentaje: esAnual ? DESCUENTO_ANUAL_PORCENTAJE : 0,
    descuentoMensualUsd,
    totalMensualUsd,
    totalAnualUsd,
    esAnual,
  };
};
