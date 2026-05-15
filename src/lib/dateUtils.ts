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
      return d.toLocaleDateString('es-BO', { 
        day: '2-digit', 
        month: '2-digit', 
        year: 'numeric' 
      });
    }
    
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    
    const d = new Date(year, month, day);
    return d.toLocaleDateString('es-BO', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric' 
    });
  } catch (e) {
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
  } catch (e) {
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
  mes.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\.$/, '');

export const obtenerOrdenMes = (mes: string | null | undefined): number =>
  mes ? (ORDEN_MESES[normalizarMes(mes)] ?? 0) : 0;

export const ordenarMesesCalendario = (meses: string[] | null | undefined): string[] =>
  [...(meses || [])].sort((a, b) => {
    const ordenA = obtenerOrdenMes(a) || 99;
    const ordenB = obtenerOrdenMes(b) || 99;
    return ordenA - ordenB;
  });
