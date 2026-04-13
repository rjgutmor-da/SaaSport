/**
 * estadisticasUtils.ts
 * Utilidades compartidas para el módulo de Estadísticas:
 * - Cálculo de rangos de fechas predefinidos
 * - Formateo de montos y fechas
 * - Cálculo de porcentajes para gráfico de torta
 */

export type IntervaloPredefinido =
  | 'este-mes'
  | 'mes-pasado'
  | 'este-año'
  | 'año-pasado'
  | 'personalizado';

export interface RangoFechas {
  desde: string; // ISO date string YYYY-MM-DD
  hasta: string; // ISO date string YYYY-MM-DD
}

/** Convierte un intervalo predefinido en un rango de fechas concreto */
export function calcularRango(
  intervalo: IntervaloPredefinido,
  desdePersonalizado?: string,
  hastaPersonalizado?: string
): RangoFechas {
  const hoy = new Date();
  const año = hoy.getFullYear();
  const mes = hoy.getMonth(); // 0-indexed

  const fmt = (d: Date): string => d.toISOString().split('T')[0];

  switch (intervalo) {
    case 'este-mes': {
      const inicio = new Date(año, mes, 1);
      const fin = new Date(año, mes + 1, 0);
      return { desde: fmt(inicio), hasta: fmt(fin) };
    }
    case 'mes-pasado': {
      const inicio = new Date(año, mes - 1, 1);
      const fin = new Date(año, mes, 0);
      return { desde: fmt(inicio), hasta: fmt(fin) };
    }
    case 'este-año': {
      return { desde: `${año}-01-01`, hasta: `${año}-12-31` };
    }
    case 'año-pasado': {
      return { desde: `${año - 1}-01-01`, hasta: `${año - 1}-12-31` };
    }
    case 'personalizado': {
      return {
        desde: desdePersonalizado || fmt(new Date(año, mes, 1)),
        hasta: hastaPersonalizado || fmt(hoy),
      };
    }
    default:
      return { desde: fmt(new Date(año, mes, 1)), hasta: fmt(new Date(año, mes + 1, 0)) };
  }
}

/** Formatea un monto en Bolivianos */
export function fmtMonto(n: number): string {
  return n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Colores vibrantes para la torta (ciclo rotativo) */
export const COLORES_TORTA = [
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#10b981', // emerald
  '#ef4444', // red
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#f97316', // orange
  '#14b8a6', // teal
  '#ec4899', // pink
  '#84cc16', // lime
  '#06b6d4', // cyan
  '#a855f7', // purple
];

/** Asigna colores a un array de ítems */
export function asignarColores<T extends { nombre: string }>(
  items: T[]
): (T & { color: string })[] {
  return items.map((item, i) => ({
    ...item,
    color: COLORES_TORTA[i % COLORES_TORTA.length],
  }));
}

/** Nombres de los meses en español */
export const NOMBRES_MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

/** Etiqueta legible para un intervalo predefinido */
export function etiquetaIntervalo(intervalo: IntervaloPredefinido): string {
  const mapa: Record<IntervaloPredefinido, string> = {
    'este-mes': 'Este mes',
    'mes-pasado': 'Mes pasado',
    'este-año': 'Este año',
    'año-pasado': 'Año pasado',
    'personalizado': 'Personalizado',
  };
  return mapa[intervalo];
}
