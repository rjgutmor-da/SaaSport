/**
 * Utilidades para la gestión del símbolo de moneda de la escuela activa.
 * Permite manejar una moneda fija por escuela sin requerir esquemas complejos de multimoneda.
 */

export const OPCIONES_MONEDA = [
  { simbolo: '$',  etiqueta: '$ — Universal (USD, Colombia, Argentina, Chile, Ecuador, México…)' },
  { simbolo: 'Bs', etiqueta: 'Bs — Bolivia / Venezuela' },
  { simbolo: 'S/', etiqueta: 'S/ — Perú' },
  { simbolo: 'R$', etiqueta: 'R$ — Brasil' },
  { simbolo: 'Gs', etiqueta: 'Gs — Paraguay' },
] as const;

export type SimboloMoneda = typeof OPCIONES_MONEDA[number]['simbolo'];

let simboloActual: string = 'Bs';

/**
 * Define el símbolo de moneda de la escuela activa.
 */
export const definirSimboloMoneda = (s?: string | null): void => {
  simboloActual = s && s.trim() ? s.trim() : 'Bs';
};

/**
 * Devuelve el símbolo de moneda de la escuela activa.
 */
export const simboloMoneda = (): string => simboloActual;
