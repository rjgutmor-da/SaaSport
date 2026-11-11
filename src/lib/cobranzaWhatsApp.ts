export const MAX_CARACTERES_COBRANZA = 600;
export const PARRAFO_COBRANZA_PREDETERMINADO = 'Si ya realizó alguno de estos pagos, por favor envíenos el comprobante por este medio para actualizar su estado. Muchas gracias. 🩶';

export const contarCaracteresCobranza = (texto: string): number => Array.from(texto).length;

export const normalizarParrafoCobranza = (texto: string): string | null => {
  if (contarCaracteresCobranza(texto) > MAX_CARACTERES_COBRANZA) {
    throw new Error('El párrafo final no puede superar los 600 caracteres.');
  }
  return texto.trim() || null;
};

export const resolverParrafoCobranza = (texto?: string | null): string =>
  texto?.trim() || PARRAFO_COBRANZA_PREDETERMINADO;
