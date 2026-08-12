/**
 * navegacion.ts — Utilidades de navegación simple hacia AsisPort.
 */

/** URL base de AsisPort en producción */
export const ASISPORT_PROD_URL = 'https://asisport.saasport.pro';
export const ASISPORT_DEV_URL = 'https://localhost:3000';

/** Retorna la URL base según el entorno */
export const getAsisportUrl = (): string => {
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  return isLocal ? ASISPORT_DEV_URL.replace('localhost', window.location.hostname) : ASISPORT_PROD_URL;
};

/**
 * Redirige a AsisPort directamente (la sesión se comparte vía cookies si están en el mismo dominio o localhost).
 */
export const navegarAAsisport = (rutaDestino: string = '/dashboard'): void => {
  const baseUrl = getAsisportUrl();
  const separator = rutaDestino.includes('?') ? '&' : '?';
  const route = rutaDestino.startsWith('/') ? rutaDestino : `/${rutaDestino}`;
  
  window.location.href = `${baseUrl}${route}${separator}origin=saasport`;
};
