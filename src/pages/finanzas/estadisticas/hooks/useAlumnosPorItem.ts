/**
 * useAlumnosPorItem.ts
 * Hook que obtiene la lista de alumnos que tienen notas de servicio (cxc_detalle)
 * para un ítem específico del catálogo, con soporte a subfiltros:
 *   - Mensualidad → filtro por mes(es) (campo periodo_meses JSONB)
 *   - Inscripción a Torneos → filtro por texto en detalle_extra
 *
 * También permite filtrar por rango de fechas de la nota de servicio.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import { calcularRango, type IntervaloPredefinido } from '../utils/estadisticasUtils';

export interface AlumnoPorItem {
  alumno_id: string;
  nombre_completo: string;
  monto: number;
  fecha: string;         // fecha_emision de la nota
  detalle: string;       // periodo_meses o detalle_extra
  nota_id: string;       // cxc_detalle id
  cxc_id: string;        // cuentas_cobrar id
}

export interface UseAlumnosPorItemResult {
  alumnos: AlumnoPorItem[];
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

export function useAlumnosPorItem(
  escuelaId: string | null,
  catalogoItemId: string | null,
  intervalo: IntervaloPredefinido,
  desdePersonalizado?: string,
  hastaPersonalizado?: string,
  filtroSubItems?: string[] // meses o texto de torneo
): UseAlumnosPorItemResult {
  const [alumnos, setAlumnos] = useState<AlumnoPorItem[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId || !catalogoItemId) {
      setAlumnos([]);
      return;
    }
    const rango = calcularRango(intervalo, desdePersonalizado, hastaPersonalizado);
    cargarAlumnos(escuelaId, catalogoItemId, rango.desde, rango.hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escuelaId, catalogoItemId, intervalo, desdePersonalizado, hastaPersonalizado, tick,
    // serializar filtroSubItems para evitar re-renders infinitos
    JSON.stringify(filtroSubItems)]);

  async function cargarAlumnos(
    eid: string,
    itemId: string,
    desde: string,
    hasta: string
  ) {
    setCargando(true);
    setError(null);

    try {
      const { data, error: err } = await supabase
        .from('cxc_detalle')
        .select(`
          id,
          subtotal,
          periodo_meses,
          detalle_extra,
          cuenta_cobrar_id,
          cuentas_cobrar!cxc_detalle_cuenta_cobrar_id_fkey (
            fecha_emision,
            anulada,
            alumno_id,
            alumnos!cuentas_cobrar_alumno_id_fkey (nombres, apellidos)
          )
        `)
        .eq('escuela_id', eid)
        .eq('catalogo_item_id', itemId);

      if (err) throw new Error(err.message);

      // Filtrar por fecha y no anuladas
      let filtrados = (data || []).filter((row: any) => {
        if (row.cuentas_cobrar?.anulada) return false;
        const fecha = row.cuentas_cobrar?.fecha_emision;
        if (!fecha) return false;
        return fecha >= desde && fecha <= hasta;
      });

      // Aplicar subfiltro de meses (periodo_meses es un array JSONB)
      if (filtroSubItems && filtroSubItems.length > 0) {
        filtrados = filtrados.filter((row: any) => {
          // Para Mensualidad: periodo_meses es array de meses
          if (Array.isArray(row.periodo_meses)) {
            return (row.periodo_meses as string[]).some(m => filtroSubItems.includes(m));
          }
          // Para Torneos: detalle_extra contiene el nombre del torneo
          if (row.detalle_extra) {
            return filtroSubItems.some(f =>
              row.detalle_extra.toLowerCase().includes(f.toLowerCase())
            );
          }
          return false;
        });
      }

      // Mapear a la estructura final
      const resultado: AlumnoPorItem[] = filtrados.map((row: any) => {
        const cxc = row.cuentas_cobrar ?? {};
        const alu = cxc.alumnos ?? {};
        const nombres = alu.nombres ?? '';
        const apellidos = alu.apellidos ?? '';

        // Construir descripción del detalle
        let detalle = '';
        if (Array.isArray(row.periodo_meses) && row.periodo_meses.length > 0) {
          detalle = (row.periodo_meses as string[]).join(', ');
        } else if (row.detalle_extra) {
          detalle = String(row.detalle_extra);
        }

        return {
          alumno_id: cxc.alumno_id ?? '',
          nombre_completo: `${nombres} ${apellidos}`.trim() || 'Sin nombre',
          monto: Number(row.subtotal ?? 0),
          fecha: cxc.fecha_emision ?? '',
          detalle,
          nota_id: row.id,
          cxc_id: row.cuenta_cobrar_id ?? '',
        };
      });

      // Ordenar por apellido+nombre
      resultado.sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
      setAlumnos(resultado);
    } catch (e: any) {
      setError(e.message ?? 'Error');
    } finally {
      setCargando(false);
    }
  }

  return { alumnos, cargando, error, recargar };
}
