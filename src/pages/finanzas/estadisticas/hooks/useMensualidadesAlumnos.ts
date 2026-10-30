/**
 * useMensualidadesAlumnos.ts
 * Hook que obtiene la mensualidad registrada en la ficha de cada alumno ACTIVO
 * (no archivado) de la escuela, junto con su entrenador y grupo.
 *
 * - La consulta está acotada a la escuela y a alumnos activos (foto actual, sin histórico).
 * - Se pagina en lotes de 1000 para no truncar resultados.
 * - Alumnos sin mensualidad registrada se tratan como 0.
 * - Los filtros (sucursal, entrenador, grupo, horario) se aplican en el componente,
 *   porque el promedio y la moda siempre se calculan sobre TODOS los alumnos activos.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabaseClient';

export interface AlumnoMensualidad {
  id: string;
  nombre_completo: string;
  entrenador: string;
  grupo: string;
  mensualidad: number;
  sucursal_id: string;
  entrenador_id: string;
  grupo_id: string;
  horario_id: string;
}

export interface UseMensualidadesAlumnosResult {
  alumnos: AlumnoMensualidad[];
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

const TAMANO_LOTE = 1000;

export function useMensualidadesAlumnos(escuelaId: string | null): UseMensualidadesAlumnosResult {
  const [alumnos, setAlumnos] = useState<AlumnoMensualidad[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId) return;
    let cancelado = false;

    const cargar = async () => {
      setCargando(true);
      setError(null);
      try {
        // Nombres de grupos de la escuela (se mapean en memoria)
        const { data: grupos, error: errGrupos } = await supabase
          .from('grupos')
          .select('id, nombre')
          .eq('escuela_id', escuelaId);
        if (errGrupos) throw new Error(errGrupos.message);
        const nombresGrupo = new Map<string, string>(
          (grupos ?? []).map((g: any) => [g.id, g.nombre]),
        );

        // Alumnos activos paginados
        const filas: any[] = [];
        for (let inicio = 0; ; inicio += TAMANO_LOTE) {
          const { data, error: errAlumnos } = await supabase
            .from('alumnos')
            .select(`
              id,
              nombres,
              apellidos,
              mensualidad,
              sucursal_id,
              grupo_id,
              horario_id,
              profesor_asignado_id,
              usuarios!alumnos_profesor_asignado_id_fkey ( nombres, apellidos )
            `)
            .eq('escuela_id', escuelaId)
            .eq('archivado', false)
            .order('id')
            .range(inicio, inicio + TAMANO_LOTE - 1);
          if (errAlumnos) throw new Error(errAlumnos.message);
          filas.push(...(data ?? []));
          if (!data || data.length < TAMANO_LOTE) break;
        }

        const resultado: AlumnoMensualidad[] = filas.map((a: any) => {
          const entrenador = Array.isArray(a.usuarios) ? a.usuarios[0] : a.usuarios;
          return {
            id: a.id,
            nombre_completo: `${a.nombres ?? ''} ${a.apellidos ?? ''}`.trim(),
            entrenador: entrenador ? `${entrenador.nombres ?? ''} ${entrenador.apellidos ?? ''}`.trim() : '—',
            grupo: a.grupo_id ? (nombresGrupo.get(a.grupo_id) ?? '—') : '—',
            mensualidad: Number(a.mensualidad) || 0,
            sucursal_id: a.sucursal_id ?? '',
            entrenador_id: a.profesor_asignado_id ?? '',
            grupo_id: a.grupo_id ?? '',
            horario_id: a.horario_id ?? '',
          };
        });

        resultado.sort((x, y) => x.nombre_completo.localeCompare(y.nombre_completo, 'es'));
        if (!cancelado) setAlumnos(resultado);
      } catch (e: any) {
        if (!cancelado) setError(e?.message || 'Error al cargar las mensualidades de los alumnos.');
      } finally {
        if (!cancelado) setCargando(false);
      }
    };

    cargar();
    return () => { cancelado = true; };
  }, [escuelaId, tick]);

  return { alumnos, cargando, error, recargar };
}
