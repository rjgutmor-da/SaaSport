import { supabase } from './supabaseClient.ts';

/**
 * idempotenciaNotas.ts
 *
 * Módulo especializado para la gestión robusta de identificadores de operación,
 * persistencia duradera de operaciones en estado incierto y resolución estricta del escenario
 * "el servidor guardó, el cliente perdió la respuesta" (fallos de red, timeouts, cortes de conexión).
 */

export type TipoOperacionNota = 'cxc_individual' | 'cxc_masiva' | 'cxp_individual';

export interface OperacionIncierta<T = any> {
  operacionId: string;
  tipo: TipoOperacionNota;
  escuelaId: string;
  usuarioId: string; // Usuario autenticado obligatorio para aislar operaciones entre usuarios
  claveEntidad: string; // ej. alumno_${alumnoId}, prov_${provId}, pers_${persId}, o 'general'
  documentoId?: string | null; // ID de la nota cuando corresponda a una edición
  payloadOriginal: T;
  timestamp: number;
  estado: 'incierto' | 'completado';
  errorUltimoIntento?: string;
  notaId?: string;
}

export type ResultadoVerificacionNota =
  | { estado: 'guardada'; notaId: string }
  | { estado: 'no_guardada' }
  | { estado: 'error_consulta'; mensaje: string };

const CLAVE_STORAGE = 'saasport:operaciones_inciertas';

/**
 * Carga el mapa de todas las operaciones inciertas desde localStorage.
 */
export function cargarTodasOperaciones(): Map<string, OperacionIncierta> {
  const mapa = new Map<string, OperacionIncierta>();
  try {
    if (typeof window === 'undefined' || !window.localStorage) return mapa;
    const raw = window.localStorage.getItem(CLAVE_STORAGE);
    if (!raw) return mapa;
    const arr: OperacionIncierta[] = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const item of arr) {
        if (item && item.operacionId) {
          mapa.set(item.operacionId, item);
        }
      }
    }
  } catch (e) {
    console.warn('Error al deserializar operaciones inciertas desde localStorage:', e);
  }
  return mapa;
}

/**
 * Guarda el mapa completo de operaciones inciertas en localStorage.
 */
export function guardarMapaEnStorage(mapa: Map<string, OperacionIncierta>): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const arr = Array.from(mapa.values());
    window.localStorage.setItem(CLAVE_STORAGE, JSON.stringify(arr));
  } catch (e) {
    console.warn('Error al guardar operaciones inciertas en localStorage:', e);
  }
}

/**
 * Registra o actualiza una operación en estado incierto de forma duradera.
 */
export function guardarOperacionIncierta<T>(op: OperacionIncierta<T>): void {
  try {
    const mapa = cargarTodasOperaciones();
    mapa.set(op.operacionId, op);
    guardarMapaEnStorage(mapa);
  } catch (e) {
    console.warn('No se pudo persistir la operación incierta:', e);
  }
}

/**
 * Obtiene una operación incierta separada por escuela, usuario autenticado, tipo, entidad y documento.
 * Impide que otro usuario del mismo navegador recupere o envíe operaciones ajenas.
 */
export function obtenerOperacionIncierta<T>(
  tipo: TipoOperacionNota,
  escuelaId: string,
  usuarioId: string,
  claveEntidad?: string,
  documentoId?: string | null,
): OperacionIncierta<T> | null {
  if (!escuelaId || !usuarioId) return null;

  try {
    const mapa = cargarTodasOperaciones();

    // 1. Coincidencia exacta de entidad si se especificó una entidad concreta (alumno, proveedor, etc.)
    if (claveEntidad && claveEntidad !== 'general') {
      for (const op of mapa.values()) {
        if (
          op.tipo === tipo
          && op.escuelaId === escuelaId
          && op.usuarioId === usuarioId
          && op.claveEntidad === claveEntidad
          && op.estado === 'incierto'
        ) {
          if (documentoId !== undefined && (op.documentoId || null) !== (documentoId || null)) {
            continue;
          }
          return op as OperacionIncierta<T>;
        }
      }
    }

    // 2. Coincidencia para el formulario general (cuando la operación o la consulta es de ámbito general)
    for (const op of mapa.values()) {
      if (
        op.tipo === tipo
        && op.escuelaId === escuelaId
        && op.usuarioId === usuarioId
        && op.estado === 'incierto'
      ) {
        if (documentoId !== undefined && (op.documentoId || null) !== (documentoId || null)) {
          continue;
        }
        if ((!claveEntidad || claveEntidad === 'general') && (!op.claveEntidad || op.claveEntidad === 'general')) {
          return op as OperacionIncierta<T>;
        }
      }
    }
  } catch (e) {
    console.warn('Error al buscar operación incierta:', e);
  }
  return null;
}

/**
 * Obtiene todas las operaciones inciertas filtradas estrictamente por tipo, escuela y usuario.
 */
export function obtenerTodasOperacionesInciertas(
  tipo?: TipoOperacionNota,
  escuelaId?: string,
  usuarioId?: string,
): OperacionIncierta[] {
  try {
    const mapa = cargarTodasOperaciones();
    return Array.from(mapa.values()).filter(op => {
      if (tipo && op.tipo !== tipo) return false;
      if (escuelaId && op.escuelaId !== escuelaId) return false;
      if (usuarioId && op.usuarioId !== usuarioId) return false;
      return op.estado === 'incierto';
    });
  } catch (e) {
    console.warn('Error al obtener lista de operaciones inciertas:', e);
    return [];
  }
}

/**
 * Remueve una operación resuelta del almacenamiento local.
 */
export function removerOperacionIncierta(operacionId: string): void {
  try {
    const mapa = cargarTodasOperaciones();
    if (mapa.delete(operacionId)) {
      guardarMapaEnStorage(mapa);
    }
  } catch (e) {
    console.warn('Error al remover operación incierta:', e);
  }
}

/**
 * Determina si un error corresponde a una respuesta incierta (red, timeout, 5xx, interrupción).
 * Si es un error de negocio de PostgreSQL con ROLLBACK asegurado (códigos P0001, 23505, etc.), retorna false.
 */
export function esRespuestaIncierta(err: any): boolean {
  if (!err) return false;

  // Errores con ROLLBACK garantizado en PostgreSQL
  const codigosConcluyentes = ['23505', '23503', '23502', '22000', '42501', 'P0001'];
  if (err.code && codigosConcluyentes.includes(err.code)) {
    return false;
  }

  const msg = (err.message || '').toLowerCase();
  const name = (err.name || '').toLowerCase();

  // Validaciones semánticas deterministas
  if (
    msg.includes('no autorizado')
    || msg.includes('saldo insuficiente')
    || msg.includes('stock insuficiente')
    || msg.includes('confirma el conteo')
    || msg.includes('no es un producto')
    || msg.includes('debe seleccionar una sucursal')
  ) {
    return false;
  }

  // Errores de transporte, red, timeout o HTTP 5xx
  if (
    err instanceof TypeError
    || name.includes('abort')
    || name.includes('network')
    || msg.includes('failed to fetch')
    || msg.includes('networkerror')
    || msg.includes('timeout')
    || msg.includes('timed out')
    || msg.includes('connection')
    || msg.includes('gateway')
    || (typeof err.status === 'number' && err.status >= 500)
  ) {
    return true;
  }

  // Si no se puede descartar que la transacción se aplicó, tratamos con precaución como incierto
  return true;
}

/**
 * Consulta en la base de datos si una nota con el operacion_id ya fue guardada.
 * Resuelve el caso "servidor guardó, cliente perdió la respuesta".
 *
 * IMPORTANTE: Un fallo al consultar (error de red/servidor) NO demuestra que la nota no exista.
 * En dicho caso retorna `{ estado: 'error_consulta' }` para conservar el pendiente.
 */
export async function verificarSiNotaSeGuardo(
  tipo: TipoOperacionNota,
  escuelaId: string,
  operacionId: string,
  client: any = supabase,
): Promise<ResultadoVerificacionNota> {
  if (!operacionId || !escuelaId) return { estado: 'no_guardada' };

  try {
    const tabla = tipo === 'cxp_individual' ? 'cuentas_pagar' : 'cuentas_cobrar';
    const { data, error } = await client
      .from(tabla)
      .select('id')
      .eq('escuela_id', escuelaId)
      .eq('operacion_id', operacionId)
      .maybeSingle();

    if (error) {
      // Un fallo al consultar no demuestra que la nota no exista: conserva el pendiente
      return { estado: 'error_consulta', mensaje: error.message };
    }

    if (data?.id) {
      return { estado: 'guardada', notaId: data.id };
    }

    return { estado: 'no_guardada' };
  } catch (err: any) {
    // Fallo de conexión/red durante la consulta
    return { estado: 'error_consulta', mensaje: err?.message || 'Error de conexión al verificar nota' };
  }
}

/**
 * Resuelve una operación incierta contra la base de datos:
 * Si la nota existe, la marca como guardada y la limpia del almacenamiento local.
 * Si la consulta falló, conserva el pendiente intacto.
 */
export async function resolverOperacionIncierta(
  tipo: TipoOperacionNota,
  escuelaId: string,
  operacionId: string,
  client: any = supabase,
): Promise<ResultadoVerificacionNota> {
  const res = await verificarSiNotaSeGuardo(tipo, escuelaId, operacionId, client);
  if (res.estado === 'guardada' && res.notaId) {
    removerOperacionIncierta(operacionId);
  }
  return res;
}
