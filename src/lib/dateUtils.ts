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
 * Formatea una fecha ISO (YYYY-MM-DD o ISO8601) a formato legible local (DD/MM/YYYY).
 * Evita el error de "un día antes" al no interpretar el string como UTC absoluto.
 */
export const formatFecha = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  
  try {
    // Extraer solo la parte de la fecha YYYY-MM-DD
    const parts = iso.split('T')[0].split('-');
    if (parts.length !== 3) return iso;
    
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
    const parts = iso.split('T')[0].split('-');
    if (parts.length !== 3) return iso;
    
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
