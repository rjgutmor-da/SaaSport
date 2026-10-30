/**
 * mensualidadesUtils.ts
 * Funciones puras para la pestaña "Mensualidades" de Estadísticas:
 * promedio, moda (con empates) y límites del rango de mensualidades.
 */

export interface ModaMensualidad {
  monto: number;
  cantidad: number;
}

/** Redondea a 2 decimales para evitar diferencias por coma flotante */
const redondear = (n: number) => Math.round(n * 100) / 100;

/** Promedio simple de una lista de montos (0 si está vacía) */
export function calcularPromedio(montos: number[]): number {
  if (montos.length === 0) return 0;
  const suma = montos.reduce((s, m) => s + m, 0);
  return redondear(suma / montos.length);
}

/**
 * Calcula la(s) moda(s) de los montos.
 * Si hay empate devuelve todos los montos empatados, ordenados de menor a mayor.
 */
export function calcularModas(montos: number[]): ModaMensualidad[] {
  if (montos.length === 0) return [];
  const conteo = new Map<number, number>();
  for (const m of montos) {
    const clave = redondear(m);
    conteo.set(clave, (conteo.get(clave) ?? 0) + 1);
  }
  const maximo = Math.max(...conteo.values());
  return [...conteo.entries()]
    .filter(([, cantidad]) => cantidad === maximo)
    .map(([monto, cantidad]) => ({ monto, cantidad }))
    .sort((a, b) => a.monto - b.monto);
}

/** Obtiene el mínimo y máximo de una lista de montos */
export function calcularLimites(montos: number[]): { min: number; max: number } {
  if (montos.length === 0) return { min: 0, max: 0 };
  return { min: Math.min(...montos), max: Math.max(...montos) };
}
