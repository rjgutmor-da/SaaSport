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

const convertirLista = (mapa: Record<string, number>): { lista: ItemResumen[]; total: number } => {
  const total = Object.values(mapa).reduce((s, v) => s + v, 0);
  const lista = Object.entries(mapa)
    .map(([nombre, monto]) => ({
      nombre,
      monto,
      porcentaje: total > 0 ? (monto / total) * 100 : 0,
    }))
    .sort((a, b) => b.monto - a.monto);

  return { lista, total };
};

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
      const { data: cajasData, error: cajasErr } = await supabase
        .from('cajas_bancos')
        .select('id')
        .eq('escuela_id', eid)
        .eq('activo', true);

      if (cajasErr) throw new Error(`Cajas/Bancos: ${cajasErr.message}`);

      const cajaIds = (cajasData || []).map((c: any) => c.id).filter(Boolean);
      if (cajaIds.length === 0) {
        setIngresos([]);
        setEgresos([]);
        setTotalIngresos(0);
        setTotalEgresos(0);
        return;
      }

      // Ingresos: cobros que entraron efectivamente a una caja/banco.
      const { data: cobrosData, error: cobrosErr } = await supabase
        .from('cobros_aplicados')
        .select(`
          monto_aplicado,
          fecha,
          caja_id,
          cuentas_cobrar!cobros_aplicados_cuenta_cobrar_id_fkey (
            id,
            monto_total,
            descripcion,
            anulada,
            cxc_detalle (
              subtotal,
              catalogo_items!cxc_detalle_catalogo_item_id_fkey (nombre)
            )
          )
        `)
        .eq('escuela_id', eid)
        .in('caja_id', cajaIds);

      if (cobrosErr) throw new Error(`Ingresos: ${cobrosErr.message}`);

      const mapIng: Record<string, number> = {};
      for (const cobro of (cobrosData || [])) {
        const fechaCobro = cobro.fecha?.split('T')[0];
        if (!fechaCobro || fechaCobro < desde || fechaCobro > hasta) continue;

        const cc = (cobro as any).cuentas_cobrar;
        if (!cc || cc.anulada) continue;

        const montoCobrado = Number(cobro.monto_aplicado || 0);
        const detalles = cc.cxc_detalle || [];

        if (montoCobrado <= 0) continue;

        const totalDetalles = detalles.reduce((sum: number, det: any) => sum + Number(det.subtotal || 0), 0);

        if (detalles.length === 0 || totalDetalles <= 0) {
          const desc = cc.descripcion || 'Otros Ingresos';
          mapIng[desc] = (mapIng[desc] ?? 0) + montoCobrado;
          continue;
        }

        for (const det of detalles) {
          const nombre = det.catalogo_items?.nombre ?? cc.descripcion ?? 'Otros Ingresos';
          const proporcion = Number(det.subtotal || 0) / totalDetalles;
          mapIng[nombre] = (mapIng[nombre] ?? 0) + montoCobrado * proporcion;
        }
      }

      const ingresosCalc = convertirLista(mapIng);
      setIngresos(ingresosCalc.lista);
      setTotalIngresos(ingresosCalc.total);

      // Egresos: pagos que salieron efectivamente de una caja/banco.
      const { data: pagosData, error: pagosErr } = await supabase
        .from('pagos_aplicados')
        .select(`
          monto_aplicado,
          fecha,
          caja_id,
          cuentas_pagar!pagos_aplicados_cuenta_pagar_id_fkey (
            id,
            monto_total,
            descripcion,
            anulada,
            cxp_detalle (
              subtotal,
              catalogo_items!cxp_detalle_catalogo_item_id_fkey (nombre)
            )
          )
        `)
        .eq('escuela_id', eid)
        .in('caja_id', cajaIds);

      if (pagosErr) throw new Error(`Egresos: ${pagosErr.message}`);

      const mapEg: Record<string, number> = {};
      for (const pago of (pagosData || [])) {
        const fechaPago = pago.fecha?.split('T')[0];
        if (!fechaPago || fechaPago < desde || fechaPago > hasta) continue;

        const cp = (pago as any).cuentas_pagar;
        if (!cp || cp.anulada) continue;

        const montoPagado = Number(pago.monto_aplicado || 0);
        const detalles = cp.cxp_detalle || [];

        if (montoPagado <= 0) continue;

        const totalDetalles = detalles.reduce((sum: number, det: any) => sum + Number(det.subtotal || 0), 0);

        if (detalles.length === 0 || totalDetalles <= 0) {
          const desc = cp.descripcion || 'Otros Egresos';
          mapEg[desc] = (mapEg[desc] ?? 0) + montoPagado;
          continue;
        }

        for (const det of detalles) {
          const nombre = det.catalogo_items?.nombre ?? cp.descripcion ?? 'Otros Egresos';
          const proporcion = Number(det.subtotal || 0) / totalDetalles;
          mapEg[nombre] = (mapEg[nombre] ?? 0) + montoPagado * proporcion;
        }
      }

      const egresosCalc = convertirLista(mapEg);
      setEgresos(egresosCalc.lista);
      setTotalEgresos(egresosCalc.total);
    } catch (e: any) {
      setError(e.message ?? 'Error desconocido');
    } finally {
      setCargando(false);
    }
  }

  return { ingresos, egresos, totalIngresos, totalEgresos, cargando, error, recargar };
}
