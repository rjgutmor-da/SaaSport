/**
 * vencimientoUtils.ts
 * Utilidades para calcular el estado de vencimiento de notas de pago/cobro.
 */

/**
 * Determina si una nota está vencida en base a su fecha de vencimiento y estado.
 * Una nota se considera vencida si:
 * - Tiene fecha de vencimiento asignada
 * - Esa fecha ya pasó (es anterior a hoy)
 * - El estado no es 'pagada' (las notas pagadas no se marcan como vencidas)
 */
export const esNotaVencida = (
  fechaVencimiento: string | null,
  estado: string
): boolean => {
  if (!fechaVencimiento || estado === 'pagada') return false;
  // Comparar solo por fecha (ignorar hora)
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fv = new Date(fechaVencimiento);
  fv.setHours(0, 0, 0, 0);
  return fv < hoy;
};
