import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotaConCiclo {
  id: string;
  alumnos: { id: string } | null;
  ciclo_inicio: string | null;
  ciclo_fin: string | null;
}

export type ConteoAsistencias = number | null | 'error';

/** Tablas de asistencia que suman al conteo del ciclo anterior. */
const TABLAS_ASISTENCIA = ['asistencias_normales', 'asistencias_arqueros'] as const;
/** Alumnos por consulta: mantiene la URL corta (filtro `in`) y pocas solicitudes en total. */
const ALUMNOS_POR_LOTE = 80;
/** Tamaño de página solicitado; si el servidor devuelve menos, se sigue paginando según el total. */
const FILAS_POR_PAGINA = 1000;
/** Consultas por lote en paralelo; con lotes grandes bastan pocas conexiones simultáneas. */
const MAX_CONSULTAS_SIMULTANEAS = 6;

function fechaValida(fecha: string | null): fecha is string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const valor = new Date(`${fecha}T00:00:00Z`);
  return Number.isFinite(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
}

export function tieneCicloValido(nota: NotaConCiclo): boolean {
  return Boolean(nota.alumnos?.id && fechaValida(nota.ciclo_inicio)
    && fechaValida(nota.ciclo_fin) && nota.ciclo_inicio <= nota.ciclo_fin);
}

/** Mes previo al inicio del ciclo; ajusta el día si el mes anterior es más corto. */
export function obtenerCicloAnterior(nota: NotaConCiclo): { inicio: string; fin: string } | null {
  if (!tieneCicloValido(nota)) return null;
  const inicioFacturado = new Date(`${nota.ciclo_inicio}T00:00:00Z`);
  const inicio = new Date(inicioFacturado);
  const dia = inicio.getUTCDate();
  inicio.setUTCDate(1);
  inicio.setUTCMonth(inicio.getUTCMonth() - 1);
  const ultimoDiaMes = new Date(inicioFacturado);
  ultimoDiaMes.setUTCDate(0);
  inicio.setUTCDate(Math.min(dia, ultimoDiaMes.getUTCDate()));
  const fin = new Date(inicioFacturado);
  fin.setUTCDate(fin.getUTCDate() - 1);
  return { inicio: inicio.toISOString().slice(0, 10), fin: fin.toISOString().slice(0, 10) };
}

interface TareaConsulta {
  lote: number;
  tabla: string;
  alumnoIds: string[];
  desde: string;
  hasta: string;
}

/**
 * Descarga (paginando) las fechas con estado Presente de un lote de alumnos en una tabla.
 * Usa el total exacto de la primera página para no depender del límite de filas del servidor.
 */
async function descargarFechasPresentes(
  cliente: SupabaseClient,
  tarea: TareaConsulta,
  signal: AbortSignal,
): Promise<{ alumno_id: string; fecha: string }[]> {
  const filas: { alumno_id: string; fecha: string }[] = [];
  let total: number | null = null;
  while (total === null || filas.length < total) {
    signal.throwIfAborted();
    const respuesta = await cliente
      .from(tarea.tabla)
      .select('alumno_id, fecha', total === null ? { count: 'exact' } : undefined)
      .in('alumno_id', tarea.alumnoIds)
      .eq('estado', 'Presente')
      .gte('fecha', tarea.desde)
      .lte('fecha', tarea.hasta)
      .order('alumno_id')
      .order('fecha')
      .range(filas.length, filas.length + FILAS_POR_PAGINA - 1)
      .abortSignal(signal);
    if (respuesta.error) throw new Error('No se pudieron obtener las asistencias');
    if (total === null) {
      if (respuesta.count === null) throw new Error('No se pudo obtener el total de asistencias');
      total = respuesta.count;
    }
    const pagina = (respuesta.data ?? []) as { alumno_id: string; fecha: string }[];
    if (pagina.length === 0) break;
    filas.push(...pagina);
  }
  if (filas.length < (total ?? 0)) throw new Error('Descarga de asistencias incompleta');
  return filas;
}

/**
 * Cuenta registros Presente del ciclo anterior, respetando la sesión y RLS del cliente.
 * En lugar de una consulta por nota y tabla, agrupa alumnos en lotes y cuenta en memoria,
 * reduciendo cientos de solicitudes HTTP a unas pocas.
 */
export async function contarAsistenciasCicloAnterior(
  cliente: SupabaseClient,
  notas: readonly NotaConCiclo[],
  signal: AbortSignal,
): Promise<Record<string, ConteoAsistencias>> {
  const resultados: Record<string, ConteoAsistencias> = {};
  const ciclos: { notaId: string; alumnoId: string; inicio: string; fin: string }[] = [];
  const rangoPorAlumno = new Map<string, { desde: string; hasta: string }>();

  for (const nota of notas) {
    const cicloAnterior = obtenerCicloAnterior(nota);
    if (!cicloAnterior) {
      resultados[nota.id] = null;
      continue;
    }
    const alumnoId = nota.alumnos!.id;
    ciclos.push({ notaId: nota.id, alumnoId, ...cicloAnterior });
    const rango = rangoPorAlumno.get(alumnoId);
    rangoPorAlumno.set(alumnoId, rango
      ? {
        desde: cicloAnterior.inicio < rango.desde ? cicloAnterior.inicio : rango.desde,
        hasta: cicloAnterior.fin > rango.hasta ? cicloAnterior.fin : rango.hasta,
      }
      : { desde: cicloAnterior.inicio, hasta: cicloAnterior.fin });
  }

  // Ordenar por fecha agrupa alumnos con ciclos parecidos y acota el rango de cada lote.
  const alumnosOrdenados = [...rangoPorAlumno.entries()]
    .sort(([, a], [, b]) => a.desde.localeCompare(b.desde));
  const loteDeAlumno = new Map<string, number>();
  const tareas: TareaConsulta[] = [];
  for (let i = 0; i < alumnosOrdenados.length; i += ALUMNOS_POR_LOTE) {
    const lote = i / ALUMNOS_POR_LOTE;
    const grupo = alumnosOrdenados.slice(i, i + ALUMNOS_POR_LOTE);
    const desde = grupo.reduce((min, [, r]) => (r.desde < min ? r.desde : min), grupo[0][1].desde);
    const hasta = grupo.reduce((max, [, r]) => (r.hasta > max ? r.hasta : max), grupo[0][1].hasta);
    const alumnoIds = grupo.map(([id]) => id);
    alumnoIds.forEach(id => loteDeAlumno.set(id, lote));
    for (const tabla of TABLAS_ASISTENCIA) tareas.push({ lote, tabla, alumnoIds, desde, hasta });
  }

  const fechasPorAlumno = new Map<string, string[]>();
  const lotesConError = new Set<number>();
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < tareas.length && !signal.aborted) {
      const tarea = tareas[siguiente++];
      if (lotesConError.has(tarea.lote)) continue;
      try {
        const filas = await descargarFechasPresentes(cliente, tarea, signal);
        for (const { alumno_id, fecha } of filas) {
          const fechas = fechasPorAlumno.get(alumno_id);
          if (fechas) fechas.push(fecha);
          else fechasPorAlumno.set(alumno_id, [fecha]);
        }
      } catch {
        if (!signal.aborted) lotesConError.add(tarea.lote);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONSULTAS_SIMULTANEAS, tareas.length) }, trabajador));
  signal.throwIfAborted();

  for (const { notaId, alumnoId, inicio, fin } of ciclos) {
    // Un error en cualquier tabla del lote no se presenta como cero ni como conteo parcial.
    if (lotesConError.has(loteDeAlumno.get(alumnoId)!)) {
      resultados[notaId] = 'error';
      continue;
    }
    const fechas = fechasPorAlumno.get(alumnoId) ?? [];
    resultados[notaId] = fechas.filter(fecha => fecha >= inicio && fecha <= fin).length;
  }
  return resultados;
}
