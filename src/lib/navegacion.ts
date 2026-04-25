/**
 * navegacion.ts — Utilidades de navegación simple hacia AsisPort.
 */

/** URL base de AsisPort en producción */
export const ASISPORT_URL = 'https://asisport.saasport.pro';

/**
 * Redirige a AsisPort directamente (la sesión se comparte vía cookies).
 */
export const navegarAAsisport = (rutaDestino: string = '/dashboard'): void => {
  const route = rutaDestino.startsWith('/') ? rutaDestino : `/${rutaDestino}`;
  window.location.href = `${ASISPORT_URL}${route}`;
};
