/**
 * useResumenFinanciero.ts
 * Hook que resume ingresos y egresos reales de Cajas/Bancos.
 *
 * Fuente de datos: la RPC resume exclusivamente los movimientos de las
 * cajas/bancos activas. Incluye saldos iniciales, movimientos directos,
 * ajustes y devoluciones; excluye transferencias internas emparejadas.
 * El saldo del periodo anterior se muestra separado de los movimientos.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import { calcularRango, type IntervaloPredefinido } from '../utils/estadisticasUtils';

import { separarResumenFinanciero, type ItemResumen } from '../utils/resumenFinancieroUtils';
export type { ItemResumen } from '../utils/resumenFinancieroUtils';

export interface ResumenFinanciero {
  ingresos: ItemResumen[];
  egresos: ItemResumen[];
  totalIngresos: number;
  totalEgresos: number;
  saldoPeriodoAnterior: number;
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
  const [saldoPeriodoAnterior, setSaldoPeriodoAnterior] = useState(0);
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
      const { data, error: rpcErr } = await supabase
        .rpc('rpc_resumen_financiero', {
          p_escuela_id: eid,
          p_desde: desde,
          p_hasta: hasta,
        });

      if (rpcErr) throw new Error(rpcErr.message);

      const resumen = separarResumenFinanciero(data || []);
      setIngresos(resumen.ingresos);
      setEgresos(resumen.egresos);
      setSaldoPeriodoAnterior(resumen.saldoPeriodoAnterior);
      setTotalIngresos(resumen.totalIngresos);
      setTotalEgresos(resumen.totalEgresos);
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  return { ingresos, egresos, totalIngresos, totalEgresos, saldoPeriodoAnterior, cargando, error, recargar };
}
