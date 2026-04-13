/**
 * useResumenFinanciero.ts
 * Hook que consulta los datos de ingresos y egresos agrupados por ítem del catálogo.
 * Permite filtrar por rango de fechas.
 *
 * Fuente de datos:
 *   - Ingresos: tabla cxc_detalle + catalogo_items (notas de servicios / cobros)
 *   - Egresos: tabla cxp_detalle + catalogo_items (cuentas por pagar)
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import { calcularRango, type IntervaloPredefinido } from '../utils/estadisticasUtils';

export interface ItemResumen {
  nombre: string;
  monto: number;
  porcentaje: number;
}

export interface ResumenFinanciero {
  ingresos: ItemResumen[];
  egresos: ItemResumen[];
  totalIngresos: number;
  totalEgresos: number;
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

export function useResumenFinanciero(
  escuelaId: string | null,
  intervalo: IntervaloPredefinido,
  desdePersonalizado?: string,
  hastaPersonalizado?: string
): ResumenFinanciero {
  const [ingresos, setIngresos] = useState<ItemResumen[]>([]);
  const [egresos, setEgresos] = useState<ItemResumen[]>([]);
  const [totalIngresos, setTotalIngresos] = useState(0);
  const [totalEgresos, setTotalEgresos] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId) return;
    const rango = calcularRango(intervalo, desdePersonalizado, hastaPersonalizado);
    cargarDatos(escuelaId, rango.desde, rango.hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escuelaId, intervalo, desdePersonalizado, hastaPersonalizado, tick]);

  async function cargarDatos(eid: string, desde: string, hasta: string) {
    setCargando(true);
    setError(null);

    try {
      // ── Ingresos: cxc_detalle (via cuentas_cobrar para filtrar fecha) ──
      const { data: ingData, error: ingErr } = await supabase
        .from('cxc_detalle')
        .select(`
          subtotal,
          catalogo_items!cxc_detalle_catalogo_item_id_fkey (nombre),
          cuentas_cobrar!cxc_detalle_cuenta_cobrar_id_fkey (fecha_emision, anulada)
        `)
        .eq('escuela_id', eid);

      if (ingErr) throw new Error(`Ingresos: ${ingErr.message}`);

      // Filtrar por fecha y no anuladas en JS (para mayor compatibilidad con tipos)
      const ingFiltrados = (ingData || []).filter((row: any) => {
        if (row.cuentas_cobrar?.anulada) return false;
        const fecha = row.cuentas_cobrar?.fecha_emision;
        if (!fecha) return false;
        return fecha >= desde && fecha <= hasta;
      });

      // Agrupar por nombre de ítem
      const mapIng: Record<string, number> = {};
      for (const row of ingFiltrados) {
        const nombre = (row as any).catalogo_items?.nombre ?? 'Sin categoría';
        mapIng[nombre] = (mapIng[nombre] ?? 0) + Number((row as any).subtotal ?? 0);
      }

      const totalIng = Object.values(mapIng).reduce((s, v) => s + v, 0);
      const listaIng: ItemResumen[] = Object.entries(mapIng)
        .map(([nombre, monto]) => ({
          nombre,
          monto,
          porcentaje: totalIng > 0 ? (monto / totalIng) * 100 : 0,
        }))
        .sort((a, b) => b.monto - a.monto);

      setIngresos(listaIng);
      setTotalIngresos(totalIng);

      // ── Egresos: cxp_detalle (via cuentas_pagar para filtrar fecha) ──
      const { data: egData, error: egErr } = await supabase
        .from('cxp_detalle')
        .select(`
          subtotal,
          catalogo_items!cxp_detalle_catalogo_item_id_fkey (nombre),
          cuentas_pagar!cxp_detalle_cuenta_pagar_id_fkey (fecha_emision, anulada)
        `)
        .eq('escuela_id', eid);

      if (egErr) throw new Error(`Egresos: ${egErr.message}`);

      const egFiltrados = (egData || []).filter((row: any) => {
        if (row.cuentas_pagar?.anulada) return false;
        const fecha = row.cuentas_pagar?.fecha_emision;
        if (!fecha) return false;
        return fecha >= desde && fecha <= hasta;
      });

      const mapEg: Record<string, number> = {};
      for (const row of egFiltrados) {
        const nombre = (row as any).catalogo_items?.nombre ?? 'Sin categoría';
        mapEg[nombre] = (mapEg[nombre] ?? 0) + Number((row as any).subtotal ?? 0);
      }

      const totalEg = Object.values(mapEg).reduce((s, v) => s + v, 0);
      const listaEg: ItemResumen[] = Object.entries(mapEg)
        .map(([nombre, monto]) => ({
          nombre,
          monto,
          porcentaje: totalEg > 0 ? (monto / totalEg) * 100 : 0,
        }))
        .sort((a, b) => b.monto - a.monto);

      setEgresos(listaEg);
      setTotalEgresos(totalEg);
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  return { ingresos, egresos, totalIngresos, totalEgresos, cargando, error, recargar };
}
