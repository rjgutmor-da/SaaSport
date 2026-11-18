/**
 * cumpleanosPersonalUtils.ts
 * Utilidades puras para detectar y clasificar cumpleaños de empleados (hoy, ayer y mañana)
 * y construir enlaces de felicitación por WhatsApp.
 */
import type { EntidadCxP } from '../../types/cxp.ts';

export type EstadoCumpleanosPersonal = 'hoy' | 'ayer' | 'manana' | null;

export interface EmpleadoCumpleanos {
  id: string;
  nombre: string;
  cargo?: string | null;
  telefono?: string | null;
  fecha_nacimiento: string;
  edadCumplida: number | null;
  estadoCumple: 'hoy' | 'ayer' | 'manana';
}

export interface ResumenCumpleanosPersonal {
  hoy: EmpleadoCumpleanos[];
  ayer: EmpleadoCumpleanos[];
  manana: EmpleadoCumpleanos[];
  totalConFecha: number;
}

const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/**
 * Extrae año, mes y día de una fecha ISO (YYYY-MM-DD) sin desplazamientos de zona horaria.
 */
export const parsearFechaNacimiento = (
  fechaISO?: string | null,
): { anio: number; mes: number; dia: number } | null => {
  if (!fechaISO) return null;
  const coincidencia = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fechaISO).trim());
  if (!coincidencia) return null;

  const anio = Number(coincidencia[1]);
  const mes = Number(coincidencia[2]);
  const dia = Number(coincidencia[3]);

  if (anio < 1900 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  const fechaValidacion = new Date(anio, mes - 1, dia);
  if (
    fechaValidacion.getFullYear() !== anio ||
    fechaValidacion.getMonth() !== mes - 1 ||
    fechaValidacion.getDate() !== dia
  ) {
    return null;
  }

  return { anio, mes, dia };
};

/** Indica si un año es bisiesto en el calendario gregoriano. */
const esAnioBisiesto = (anio: number): boolean =>
  (anio % 4 === 0 && anio % 100 !== 0) || anio % 400 === 0;

/** Crea una fecha local fijada al mediodía para evitar cambios de día por horario de verano. */
const crearFechaMediodia = (base: Date, deltaDias: number): Date =>
  new Date(base.getFullYear(), base.getMonth(), base.getDate() + deltaDias, 12, 0, 0, 0);

/**
 * Verifica si un cumpleaños (mes/día) coincide con la fecha de referencia.
 * Para nacidos el 29 de febrero en años no bisiestos, se celebra el 28 de febrero.
 */
export const coincideMesDia = (mesNac: number, diaNac: number, fechaRef: Date): boolean => {
  const mesRef = fechaRef.getMonth() + 1;
  const diaRef = fechaRef.getDate();
  const anioRef = fechaRef.getFullYear();

  if (mesNac === 2 && diaNac === 29 && !esAnioBisiesto(anioRef)) {
    return mesRef === 2 && diaRef === 28;
  }

  return mesNac === mesRef && diaNac === diaRef;
};

/**
 * Determina si una fecha de nacimiento corresponde a hoy, ayer o mañana.
 */
export const obtenerEstadoCumpleanos = (
  fechaISO?: string | null,
  hoyRef: Date = new Date(),
): EstadoCumpleanosPersonal => {
  const fechaNac = parsearFechaNacimiento(fechaISO);
  if (!fechaNac) return null;

  const hoy = crearFechaMediodia(hoyRef, 0);
  if (coincideMesDia(fechaNac.mes, fechaNac.dia, hoy)) return 'hoy';

  const ayer = crearFechaMediodia(hoyRef, -1);
  if (coincideMesDia(fechaNac.mes, fechaNac.dia, ayer)) return 'ayer';

  const manana = crearFechaMediodia(hoyRef, 1);
  if (coincideMesDia(fechaNac.mes, fechaNac.dia, manana)) return 'manana';

  return null;
};

/**
 * Clasifica al personal en listas de cumpleaños para hoy, ayer y mañana.
 */
export const clasificarCumpleanosPersonal = (
  entidades: EntidadCxP[],
  hoyRef: Date = new Date(),
): ResumenCumpleanosPersonal => {
  const hoyLista: EmpleadoCumpleanos[] = [];
  const ayerLista: EmpleadoCumpleanos[] = [];
  const mananaLista: EmpleadoCumpleanos[] = [];
  let totalConFecha = 0;

  const fechasObjetivo: Record<'hoy' | 'ayer' | 'manana', Date> = {
    hoy: crearFechaMediodia(hoyRef, 0),
    ayer: crearFechaMediodia(hoyRef, -1),
    manana: crearFechaMediodia(hoyRef, 1),
  };

  for (const entidad of entidades) {
    if (entidad.tipo !== 'personal' || !entidad.fecha_nacimiento) continue;

    const fechaNac = parsearFechaNacimiento(entidad.fecha_nacimiento);
    if (!fechaNac) continue;

    totalConFecha += 1;
    const estado = obtenerEstadoCumpleanos(entidad.fecha_nacimiento, hoyRef);
    if (!estado) continue;

    const anioCumple = fechasObjetivo[estado].getFullYear();
    const edadCalculada = anioCumple - fechaNac.anio;
    const edadCumplida = edadCalculada > 0 && edadCalculada < 120 ? edadCalculada : null;

    const item: EmpleadoCumpleanos = {
      id: entidad.id,
      nombre: entidad.nombre,
      cargo: entidad.cargo ?? null,
      telefono: entidad.telefono ?? null,
      fecha_nacimiento: entidad.fecha_nacimiento,
      edadCumplida,
      estadoCumple: estado,
    };

    if (estado === 'hoy') hoyLista.push(item);
    else if (estado === 'ayer') ayerLista.push(item);
    else mananaLista.push(item);
  }

  const ordenarPorNombre = (a: EmpleadoCumpleanos, b: EmpleadoCumpleanos) =>
    a.nombre.localeCompare(b.nombre, 'es');

  hoyLista.sort(ordenarPorNombre);
  ayerLista.sort(ordenarPorNombre);
  mananaLista.sort(ordenarPorNombre);

  return {
    hoy: hoyLista,
    ayer: ayerLista,
    manana: mananaLista,
    totalConFecha,
  };
};

/** Formatea una fecha de nacimiento como DD/MM para listados compactos. */
export const formatearDiaMesCorto = (fechaISO?: string | null): string => {
  const fechaNac = parsearFechaNacimiento(fechaISO);
  if (!fechaNac) return '';
  return `${String(fechaNac.dia).padStart(2, '0')}/${String(fechaNac.mes).padStart(2, '0')}`;
};

/** Formatea una fecha de nacimiento como "18 de noviembre" para tarjetas de cumpleaños. */
export const formatearDiaMesLargo = (fechaISO?: string | null): string => {
  const fechaNac = parsearFechaNacimiento(fechaISO);
  if (!fechaNac) return '';
  return `${fechaNac.dia} de ${MESES_LARGO[fechaNac.mes - 1]}`;
};

/** Obtiene hasta dos iniciales en mayúscula a partir del nombre del empleado. */
export const obtenerInicialesNombre = (nombre: string): string => {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return 'EM';
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return `${partes[0][0]}${partes[1][0]}`.toUpperCase();
};

/**
 * Limpia un número telefónico para WhatsApp y agrega el prefijo de Bolivia (591)
 * cuando se trata de un celular local de 8 dígitos iniciado en 6 o 7.
 */
export const formatearTelefonoWhatsApp = (telefono?: string | null): string => {
  const digitos = String(telefono || '').replace(/\D/g, '');
  if (!digitos) return '';
  if (digitos.length === 8 && /^[67]/.test(digitos)) {
    return `591${digitos}`;
  }
  return digitos;
};

/**
 * Construye el enlace de WhatsApp con mensaje de felicitación de cumpleaños para un empleado.
 */
export const construirUrlWhatsAppCumpleanos = (
  nombre: string,
  telefono?: string | null,
): string | null => {
  const telefonoLimpio = formatearTelefonoWhatsApp(telefono);
  if (!telefonoLimpio || telefonoLimpio.length < 7) return null;

  const primerNombre = nombre.trim().split(/\s+/)[0] || 'compañero';
  const mensaje = `🎉🎂 ¡Feliz cumpleaños, ${primerNombre}!\nDe parte de todo nuestro equipo te enviamos un gran abrazo y nuestros mejores deseos en tu día. ¡Que tengas un excelente cumpleaños! 🥳👏`;

  return `https://wa.me/${telefonoLimpio}?text=${encodeURIComponent(mensaje)}`;
};
