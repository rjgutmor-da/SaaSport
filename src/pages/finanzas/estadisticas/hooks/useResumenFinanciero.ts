/**
 * useResumenFinanciero.ts
 * Hook que resume ingresos y egresos reales de Cajas/Bancos.
 *
 * Fuente de datos:
 *   - Ingresos: cobros_aplicados con caja_id real.
 *   - Egresos: pagos_aplicados con caja_id real.
 *
 * Los saldos iniciales, ajustes o aplicaciones de anticipos sin caja_id no se
 * incluyen porque no mueven efectivo en Cajas/Bancos.
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
    const rango = calcularRango(intervalo);
    cargarDatos(escuelaId, rango.desde, rango.hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escuelaId, intervalo, desdePersonalizado, hastaPersonalizado, tick]);

  async function cargarDatos(eid: string, desde: string, hasta: string) {
    setCargando(true);
    setError(null);

    try {
      const { data, error: rpcErr } = await supabase
        .rpc('rpc_resumen_financiero', {
          p_escuela_id: eid,
          p_desde: desde,
          p_hasta: hasta,
        });

      if (rpcErr) throw new Error(rpcErr.message);

      const ingresosData: ItemResumen[] = (data || [])
        .filter((r: any) => r.tipo === 'ingreso')
        .map((r: any) => ({
          nombre: String(r.nombre),
          monto: Number(r.monto || 0),
          porcentaje: Number(r.porcentaje || 0),
        }));

      const egresosData: ItemResumen[] = (data || [])
        .filter((r: any) => r.tipo === 'egreso')
        .map((r: any) => ({
          nombre: String(r.nombre),
          monto: Number(r.monto || 0),
          porcentaje: Number(r.porcentaje || 0),
        }));

      setIngresos(ingresosData);
      setEgresos(egresosData);

      const totalIng = ingresosData.reduce((sum, item) => sum + item.monto, 0);
      const totalEgr = egresosData.reduce((sum, item) => sum + item.monto, 0);

      setTotalIngresos(totalIng);
      setTotalEgresos(totalEgr);
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  return { ingresos, egresos, totalIngresos, totalEgresos, cargando, error, recargar };
}
