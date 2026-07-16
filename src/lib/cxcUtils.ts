/** Observaciones que fueron agregadas automáticamente a registros de anticipos. */
export const esObservacionAnticipoAutomatica = (observacion: string | null | undefined): boolean => {
  if (!observacion) return false;

  return observacion === 'Cobro Anticipado - Saldo a Favor'
    || observacion === 'SIA-'
    || observacion.startsWith('Generado automáticamente por pago de Bs ');
};
