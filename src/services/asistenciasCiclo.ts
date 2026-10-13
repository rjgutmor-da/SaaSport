import type { SupabaseClient } from '@supabase/supabase-js';

export interface NotaConCiclo {
  id: string;
  alumnos: { id: string } | null;
  ciclo_inicio: string | null;
  ciclo_fin: string | null;
}

export type ConteoAsistencias = number | null | 'error';

const MAX_CONSULTAS_SIMULTANEAS = 20;
const solicitudesActivas = new Set<Promise<unknown>>();

function fechaValida(fecha: string | null): fecha is string {
  if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const valor = new Date(`${fecha}T00:00:00Z`);
  return Number.isFinite(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
}

export function tieneCicloValido(nota: NotaConCiclo): boolean {
  return Boolean(nota.alumnos?.id && fechaValida(nota.ciclo_inicio)
    && fechaValida(nota.ciclo_fin) && nota.ciclo_inicio <= nota.ciclo_fin);
}

async function limitarSolicitud<T>(signal: AbortSignal, consultar: () => Promise<T>): Promise<T> {
  while (solicitudesActivas.size >= MAX_CONSULTAS_SIMULTANEAS) {
    await Promise.race(solicitudesActivas);
    signal.throwIfAborted();
  }
  signal.throwIfAborted();
  const solicitud = consultar();
  // La promesa del semáforo siempre se resuelve, incluso ante errores de red.
  const turno = solicitud.then(() => undefined, () => undefined);
  solicitudesActivas.add(turno);
  try {
    return await solicitud;
  } finally {
    solicitudesActivas.delete(turno);
  }
}

/** Cuenta registros (no días únicos), respetando la sesión y RLS del cliente. */
export async function contarAsistenciasCiclos(
  cliente: SupabaseClient,
  notas: readonly NotaConCiclo[],
  signal: AbortSignal,
): Promise<Record<string, ConteoAsistencias>> {
  const resultados: Record<string, ConteoAsistencias> = {};
  let siguiente = 0;
  async function trabajador() {
    while (siguiente < notas.length && !signal.aborted) {
      const nota = notas[siguiente++];
      if (!tieneCicloValido(nota)) {
        resultados[nota.id] = null;
        continue;
      }
      try {
        let total = 0;
        for (const tabla of ['asistencias_normales', 'asistencias_arqueros']) {
          const respuesta = await limitarSolicitud(signal, async () => await cliente
            .from(tabla)
            .select('id', { count: 'exact', head: true })
            .eq('alumno_id', nota.alumnos!.id)
            .eq('estado', 'Presente')
            .gte('fecha', nota.ciclo_inicio!)
            .lte('fecha', nota.ciclo_fin!)
            .abortSignal(signal));
          if (respuesta.error || respuesta.count === null) throw new Error('No se pudo contar las asistencias');
          total += respuesta.count;
        }
        resultados[nota.id] = total;
      } catch {
        if (!signal.aborted) resultados[nota.id] = 'error';
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONSULTAS_SIMULTANEAS, notas.length) }, trabajador));
  signal.throwIfAborted();
  return resultados;
}
