/**
 * dateUtils.ts
 * Utilidades para el manejo de fechas evitando desplazamientos por zona horaria.
 */

/**
 * Retorna la fecha actual en formato YYYY-MM-DD respetando la hora local.
 */
export const getHoyISO = (): string => {
  const hoy = new Date();
  const year = hoy.getFullYear();
  const month = String(hoy.getMonth() + 1).padStart(2, '0');
  const day = String(hoy.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Retorna la hora actual en formato HH:mm.
 */
export const getHoraLocal = (): string => {
  const ahora = new Date();
  const hh = String(ahora.getHours()).padStart(2, '0');
  const mm = String(ahora.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
};

/** Fecha mínima permitida para cualquier movimiento financiero. */
export const FECHA_MINIMA_MOVIMIENTO_FINANCIERO = '2020-01-01';

/**
 * Valida fechas de cobros, pagos, ingresos, egresos y transferencias.
 * No debe usarse para fecha_nacimiento ni fecha_inicio del alumno.
 */
export const validarFechaMovimientoFinanciero = (fecha: string | null | undefined): string | null => {
  const fechaSoloDia = String(fecha || '').slice(0, 10);
  if (!fechaSoloDia) return 'Debe seleccionar una fecha.';
  if (fechaSoloDia < FECHA_MINIMA_MOVIMIENTO_FINANCIERO) {
    return 'La fecha del movimiento financiero no puede ser anterior al 01/01/2020.';
  }
  return null;
};

/**
 * Calcula el mes estadistico desde la fecha de inicio de un ciclo (y opcionalmente fecha de fin).
 * Si el ciclo inicia y termina dentro del mismo mes calendario (prorrateo de fin de mes),
 * pertenece exclusivamente a ese mes calendario.
 * En otros casos: del dia 1 al 16 usa el mes de inicio; desde el 17 usa el mes siguiente.
 * Retorna siempre el primer dia del mes en formato YYYY-MM-DD.
 */
export const calcularPeriodoEstadistico = (fechaInicio: string, fechaFin?: string | null): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaInicio);
  if (!match) return '';

  let year = Number(match[1]);
  let month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  const fechaValidacion = new Date(year, month - 1, day);
  if (
    fechaValidacion.getFullYear() !== year
    || fechaValidacion.getMonth() !== month - 1
    || fechaValidacion.getDate() !== day
  ) return '';

  // Si inicio y fin caen en el mismo mes calendario, pertenece a ese mismo mes
  if (fechaFin) {
    const matchFin = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fechaFin);
    if (matchFin && matchFin[1] === match[1] && matchFin[2] === match[2]) {
      return `${year}-${String(month).padStart(2, '0')}-01`;
    }
  }

  if (day >= 17) {
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }

  return `${year}-${String(month).padStart(2, '0')}-01`;
};

/** Formato corto y estable para mostrar un periodo YYYY-MM-DD. */
export const formatPeriodoEstadistico = (periodo: string): string => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(periodo);
  if (!match) return '—';
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  return `${meses[Number(match[2]) - 1]} ${match[1]}`;
};

/**
 * Construye un timestamp ISO con el offset de zona horaria local explícito.
 * Evita el bug de new Date(...).toISOString() que convierte a UTC y desplaza
 * la fecha un día en zonas UTC negativas (ej: Bolivia UTC-4).
 *
 * Ejemplo:
 *   buildTimestampLocal('2026-05-11', '20:00')
 *   => '2026-05-11T20:00:00-04:00'  (correcto para Bolivia)
 *
 *   new Date('2026-05-11T20:00').toISOString()
 *   => '2026-05-12T00:00:00.000Z'   (INCORRECTO, desplaza un día)
 *
 * @param fecha  Fecha en formato YYYY-MM-DD
 * @param hora   Hora en formato HH:mm (opcional, usa hora actual si se omite)
 */
export const buildTimestampLocal = (fecha: string, hora?: string): string => {
  const horaFinal = hora || getHoraLocal();
  const offsetMin = -new Date().getTimezoneOffset(); // positivo = adelante de UTC
  const offsetSign = offsetMin >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMin);
  const offsetHH = String(Math.floor(absOffset / 60)).padStart(2, '0');
  const offsetMM = String(absOffset % 60).padStart(2, '0');
  return `${fecha}T${horaFinal}:00${offsetSign}${offsetHH}:${offsetMM}`;
};

/**
 * Formatea una fecha ISO (YYYY-MM-DD o ISO8601) a formato legible local (DD/MM/YYYY).
 * Evita el error de "un día antes" al no interpretar el string como UTC absoluto.
 */
export const formatFecha = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  
  try {
    // Extraemos solo la parte YYYY-MM-DD ignorando T o espacios para evitar desfases de zona horaria
    const datePart = iso.includes('T') ? iso.split('T')[0] : iso.split(' ')[0];
    const parts = datePart.split('-');
    
    if (parts.length !== 3) {
      // Fallback por si el formato es distinto
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const dia = String(d.getDate()).padStart(2, '0');
      const mes = String(d.getMonth() + 1).padStart(2, '0');
      const anio = d.getFullYear();
      return `${dia}/${mes}/${anio}`;
    }
    
    const year = parts[0];
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    return `${day}/${month}/${year}`;
  } catch {
    return iso;
  }
};

/**
 * Formatea una fecha ISO a formato corto con mes en texto (DD de Mes de YYYY).
 */
export const formatFechaCorta = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  
  try {
    const datePart = iso.includes('T') ? iso.split('T')[0] : iso.split(' ')[0];
    const parts = datePart.split('-');
    
    if (parts.length !== 3) {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      return d.toLocaleDateString('es-BO', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      });
    }

    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    
    const d = new Date(year, month, day);
    return d.toLocaleDateString('es-BO', { 
      day: '2-digit', 
      month: 'short', 
      year: 'numeric' 
    });
  } catch {
    return iso;
  }
};

/**
 * Formatea fecha y hora local desde un timestamp ISO.
 */
export const formatFechaHora = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', {
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit', 
    minute: '2-digit'
  });
};

const ORDEN_MESES: Record<string, number> = {
  ene: 1,
  enero: 1,
  feb: 2,
  febrero: 2,
  mar: 3,
  marzo: 3,
  abr: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  junio: 6,
  jul: 7,
  julio: 7,
  ago: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  septiembre: 9,
  set: 9,
  setiembre: 9,
  oct: 10,
  octubre: 10,
  nov: 11,
  noviembre: 11,
  dic: 12,
  diciembre: 12,
};

const normalizarMes = (mes: string): string =>
  mes
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/-[0-9]{4}$/, '')
    .replace(/\.$/, '');

export const obtenerOrdenMes = (mes: string | null | undefined): number => {
  if (!mes) return 0;
  const str = mes.trim();

  // 1. Formato ISO YYYY-MM o YYYY-MM-DD (ej: "2026-08", "2026-08-31")
  const isoMatch = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(str);
  if (isoMatch) {
    const num = Number(isoMatch[2]);
    return num >= 1 && num <= 12 ? num : 0;
  }

  // 2. Formato MM-YYYY (ej: "08-2026")
  const mmYyyyMatch = /^(\d{1,2})-(\d{4})$/.exec(str);
  if (mmYyyyMatch) {
    const num = Number(mmYyyyMatch[1]);
    return num >= 1 && num <= 12 ? num : 0;
  }

  // 3. Número directo de mes (ej: "8", "08")
  if (/^\d{1,2}$/.test(str)) {
    const num = Number(str);
    return num >= 1 && num <= 12 ? num : 0;
  }

  // 4. Nombre o abreviatura de mes (ej: "Ago-2026", "Agosto", "Ago.", "ago")
  return ORDEN_MESES[normalizarMes(str)] ?? 0;
};

/**
 * Unifica los periodos de mensualidad para mostrarlos sin el año completo.
 * Acepta valores heredados como "Jun-2026", fechas ISO como "2026-08" y devuelve "Jun" o "Ago".
 */
export const formatearMesCorto = (mes: string | null | undefined): string => {
  if (!mes) return '';

  const orden = obtenerOrdenMes(mes);
  const mesesCortos = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

  if (orden >= 1 && orden <= 12) {
    return mesesCortos[orden - 1];
  }

  // Si no se reconoce el mes, limpiar sufijo de año si existe y retornar texto limpio
  return mes.trim().replace(/-[0-9]{4}$/, '');
};

/**
 * Unifica el formato de un mes para que siempre incluya su año (ej: "Sep-2026").
 * Si el valor ya tiene año (ej: "Sep-2026", "2026-09", "09-2026"), lo normaliza a "Sep-2026".
 * Si no tiene año, utiliza anioFallback (o el año de una fecha ISO / año actual).
 */
export const formatearMesConAnio = (
  mes: string | null | undefined,
  anioFallback?: number | string | null
): string => {
  if (!mes) return '';
  const str = mes.trim();

  // 1. Formato ISO YYYY-MM o YYYY-MM-DD (ej: "2026-09", "2026-09-01")
  const isoMatch = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(str);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = formatearMesCorto(isoMatch[2]);
    return m ? `${m}-${y}` : str;
  }

  // 2. Formato MM-YYYY (ej: "09-2026")
  const mmYyyyMatch = /^(\d{1,2})-(\d{4})$/.exec(str);
  if (mmYyyyMatch) {
    const m = formatearMesCorto(mmYyyyMatch[1]);
    const y = mmYyyyMatch[2];
    return m ? `${m}-${y}` : str;
  }

  // 3. Formato Mes-YYYY o Mes YYYY (ej: "Sep-2026", "Septiembre 2026")
  const mesAnioMatch = /^(.+?)[-\s](\d{4})$/.exec(str);
  if (mesAnioMatch) {
    const m = formatearMesCorto(mesAnioMatch[1]);
    const y = mesAnioMatch[2];
    return m ? `${m}-${y}` : str;
  }

  // 4. Mes sin año: normalizar a nombre corto y adjuntar año
  const mesCorto = formatearMesCorto(str);
  if (!mesCorto) return str;

  let anioStr = '';
  if (anioFallback) {
    const rawAnio = String(anioFallback).trim();
    const matchYear = rawAnio.match(/\b(20\d\d)\b/);
    if (matchYear) {
      anioStr = matchYear[1];
    }
  }
  if (!anioStr) {
    anioStr = String(new Date().getFullYear());
  }

  return `${mesCorto}-${anioStr}`;
};

/**
 * Normaliza y formatea un arreglo de meses para que todos incluyan su año.
 */
export const formatearMesesConAnio = (
  meses: string[] | null | undefined,
  anioFallback?: number | string | null
): string[] => {
  if (!meses || meses.length === 0) return [];
  return meses.map(m => formatearMesConAnio(m, anioFallback)).filter(Boolean);
};

export const ordenarMesesCalendario = (meses: string[] | null | undefined): string[] =>
  [...(meses || [])].sort((a, b) => {
    const anioA = Number(/^(\d{4})-/.exec(a.trim())?.[1] || /-([0-9]{4})$/.exec(a.trim())?.[1] || 0);
    const anioB = Number(/^(\d{4})-/.exec(b.trim())?.[1] || /-([0-9]{4})$/.exec(b.trim())?.[1] || 0);
    if (anioA && anioB && anioA !== anioB) return anioA - anioB;

    const ordenA = obtenerOrdenMes(a) || 99;
    const ordenB = obtenerOrdenMes(b) || 99;
    return ordenA - ordenB;
  });

/**
 * Formatea el rango de inicio y fin de ciclo como "Día Mes a Día Mes".
 * Retorna null solo si el ciclo abarca un mes calendario completo
 * (día 1 hasta el último día del mismo mes) o si las fechas son inválidas.
 */
export const formatCiclo = (inicioStr: string | null | undefined, finStr: string | null | undefined): string | null => {
  if (!inicioStr || !finStr) return null;
  
  const inicioParts = inicioStr.split('-');
  const finParts = finStr.split('-');
  if (inicioParts.length !== 3 || finParts.length !== 3) return null;
  
  const diaIni = parseInt(inicioParts[2], 10);
  const mesIni = parseInt(inicioParts[1], 10);
  const anioIni = parseInt(inicioParts[0], 10);
  const diaFin = parseInt(finParts[2], 10);
  const mesFin = parseInt(finParts[1], 10);
  const anioFin = parseInt(finParts[0], 10);

  const valoresFecha = [diaIni, mesIni, anioIni, diaFin, mesFin, anioFin];
  if (valoresFecha.some(valor => !Number.isInteger(valor))) return null;

  const ultimoDiaMes = new Date(Date.UTC(anioIni, mesIni, 0)).getUTCDate();
  const esMesCalendarioCompleto =
    diaIni === 1 &&
    anioIni === anioFin &&
    mesIni === mesFin &&
    diaFin === ultimoDiaMes;

  if (esMesCalendarioCompleto) return null;
  
  const meses = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  
  const nombreMesIni = meses[mesIni - 1] || '';
  const nombreMesFin = meses[mesFin - 1] || '';
  
  return `${diaIni} ${nombreMesIni} a ${diaFin} ${nombreMesFin}`;
};

/**
 * Conserva la descripción de ciclo usada por notas históricas que todavía
 * guardan el rango en detalle_extra en vez de las columnas de ciclo.
 */
export const formatCicloMensualidad = (
  inicioStr: string | null | undefined,
  finStr: string | null | undefined,
  detalleExtra?: string | null,
): string | null => {
  const ciclo = formatCiclo(inicioStr, finStr);
  if (ciclo) return ciclo;

  const detalleHistorico = detalleExtra?.trim();
  return detalleHistorico && /\d/.test(detalleHistorico) && /\b(?:a|al)\b/i.test(detalleHistorico)
    ? detalleHistorico
    : null;
};

/**
 * Formatea un rango de ciclo completo como "Día Mes al Día Mes" sin omitir el día 1.
 */
export const formatCicloCompleto = (inicioStr: string | null | undefined, finStr: string | null | undefined): string | null => {
  if (!inicioStr || !finStr) return null;
  
  const inicioParts = inicioStr.split('-');
  const finParts = finStr.split('-');
  if (inicioParts.length !== 3 || finParts.length !== 3) return null;
  
  const diaIni = parseInt(inicioParts[2], 10);
  const mesIni = parseInt(inicioParts[1], 10);
  const diaFin = parseInt(finParts[2], 10);
  const mesFin = parseInt(finParts[1], 10);
  
  const meses = [
    'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
    'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
  ];
  
  const nombreMesIni = meses[mesIni - 1] || '';
  const nombreMesFin = meses[mesFin - 1] || '';
  
  return `${diaIni} ${nombreMesIni} al ${diaFin} ${nombreMesFin}`;
};

/** Formato breve para mensajes: "21 Sep a 20 Oct de 2026". */
export const formatCicloWhatsApp = (inicioStr: string | null | undefined, finStr: string | null | undefined): string | null => {
  if (!inicioStr || !finStr) return null;
  const inicioParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicioStr);
  const finParts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(finStr);
  if (!inicioParts || !finParts) return null;

  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const fecha = (parts: RegExpExecArray) => `${Number(parts[3])} ${meses[Number(parts[2]) - 1]}`;
  if (!meses[Number(inicioParts[2]) - 1] || !meses[Number(finParts[2]) - 1]) return null;
  return inicioParts[1] === finParts[1]
    ? `${fecha(inicioParts)} a ${fecha(finParts)} de ${finParts[1]}`
    : `${fecha(inicioParts)} de ${inicioParts[1]} a ${fecha(finParts)} de ${finParts[1]}`;
};

/**
 * Calcula la diferencia en meses transcurridos entre dos fechas YYYY-MM-DD.
 * Retorna (fechaB.año - fechaA.año) * 12 + (fechaB.mes - fechaA.mes).
 */
export const diferenciaEnMeses = (fechaA: string, fechaB: string): number => {
  const matchA = /^(\d{4})-(\d{2})/.exec(fechaA);
  const matchB = /^(\d{4})-(\d{2})/.exec(fechaB);
  if (!matchA || !matchB) return 0;
  const aY = Number(matchA[1]);
  const aM = Number(matchA[2]);
  const bY = Number(matchB[1]);
  const bM = Number(matchB[2]);
  return (bY - aY) * 12 + (bM - aM);
};

/**
 * Retorna la etiqueta de la categoría deportiva Sub (ej. "Sub-14").
 * En fútbol formativo, la categoría se rige exclusivamente por el año de nacimiento
 * (Año actual - Año de nacimiento), sin depender del día o mes de cumpleaños.
 */
export const formatearCategoriaSub = (
  sub?: number | null,
  fechaNacimiento?: string | null,
  textoDefault = 'Categoría'
): string => {
  if (sub && !isNaN(sub) && sub > 0) {
    return `Sub-${sub}`;
  }
  if (fechaNacimiento) {
    const anioNac = parseInt(String(fechaNacimiento).split('-')[0], 10);
    const anioActual = new Date().getFullYear();
    if (!isNaN(anioNac) && anioNac > 1900 && anioActual >= anioNac) {
      return `Sub-${anioActual - anioNac}`;
    }
  }
  return textoDefault;
};
