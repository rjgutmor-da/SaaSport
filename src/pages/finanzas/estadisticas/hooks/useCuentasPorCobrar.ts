/**
 * useCuentasPorCobrar.ts
 * Hook que obtiene la lista de deudas pendientes (saldo_pendiente > 0)
 * desglosadas por concepto (una línea por cada ítem en la nota).
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../../lib/supabaseClient';
import { calcularRango, type IntervaloPredefinido } from '../utils/estadisticasUtils';
import { ordenarMesesCalendario } from '../../../../lib/dateUtils';

export interface CuentaPorCobrarRow {
  detalle_id: string;
  cxc_id: string;
  alumno: string;
  entrenador: string;
  concepto: string;
  sub: string;
  monto_adeudado: number;
  telefono: string;
  fecha: string;
  sucursal_id: string;
  entrenador_id: string;
  horario_id: string;
  cancha_id: string;
}

export interface UseCuentasPorCobrarResult {
  datos: CuentaPorCobrarRow[];
  cargando: boolean;
  error: string | null;
  recargar: () => void;
}

export function useCuentasPorCobrar(
  escuelaId: string | null,
  intervalo: IntervaloPredefinido,
  desdePersonalizado?: string,
  hastaPersonalizado?: string,
  entrenadorId?: string,
  sucursalId?: string,
  horarioId?: string,
  canchaId?: string
): UseCuentasPorCobrarResult {
  const [datos, setDatos] = useState<CuentaPorCobrarRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId) return;
    const rango = calcularRango(intervalo, desdePersonalizado, hastaPersonalizado);
    cargarDatos(escuelaId, rango.desde, rango.hasta);
  }, [escuelaId, intervalo, desdePersonalizado, hastaPersonalizado, tick, entrenadorId, sucursalId, horarioId, canchaId]);

  async function cargarDatos(eid: string, desde: string, hasta: string) {
    setCargando(true);
    setError(null);

    try {
      // Usamos la VISTA v_cuentas_cobrar que ya tiene saldo_pendiente calculado
      // y unimos con cxc_detalle para desglosar por concepto.
      let query = supabase
        .from('v_cuentas_cobrar')
        .select(`
          *,
          cxc_detalle (
            id,
            subtotal,
            periodo_meses,
            detalle_extra,
            catalogo_items ( nombre )
          )
        `)
        .eq('escuela_id', eid)
        .gt('saldo_pendiente', 0)
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta);

      // Filtros opcionales (basados en las columnas de la vista)
      if (entrenadorId) query = query.eq('alumno_entrenador_id', entrenadorId);
      if (sucursalId) query = query.eq('alumno_sucursal_id', sucursalId);
      if (horarioId) query = query.eq('alumno_horario_id', horarioId);
      if (canchaId) query = query.eq('alumno_cancha_id', canchaId);

      const { data, error: err } = await query;

      if (err) throw new Error(err.message);

      const rows: CuentaPorCobrarRow[] = [];

      (data || []).forEach((cxc: any) => {
        const detalles = cxc.cxc_detalle || [];
        
        detalles.forEach((d: any) => {
          // Calcular proporción del saldo pendiente para este ítem
          const proporcion = Number(d.subtotal || 0) / Number(cxc.monto_total || 1);
          const montoAdeudadoItem = Number(cxc.saldo_pendiente || 0) * proporcion;

          // Concepto formateado
          let conceptoStr = d.catalogo_items?.nombre || 'Desconocido';
          if (Array.isArray(d.periodo_meses) && d.periodo_meses.length > 0) {
            const meses = ordenarMesesCalendario(d.periodo_meses);
            conceptoStr += ` (${meses.join(', ')})`;
          } else if (d.detalle_extra) {
            conceptoStr += ` (${d.detalle_extra})`;
          }

          // Sub (Categoría)
          let subCalculado = '—';
          if (cxc.fecha_nacimiento) {
            const anioNac = parseInt(cxc.fecha_nacimiento.split('-')[0], 10);
            const anioActual = new Date().getFullYear();
            if (!isNaN(anioNac)) subCalculado = `Sub-${anioActual - anioNac}`;
          }

          // Teléfono (con fallback si el preferido no existe)
          const tel = cxc.whatsapp_preferido === 'madre' 
            ? (cxc.telefono_madre || cxc.telefono_padre) 
            : (cxc.telefono_padre || cxc.telefono_madre);

          rows.push({
            detalle_id: d.id,
            cxc_id: cxc.id,
            alumno: `${cxc.alumno_nombres} ${cxc.alumno_apellidos}`.trim(),
            entrenador: cxc.entrenador_nombre || 'Sin Entrenador',
            concepto: conceptoStr,
            sub: subCalculado,
            monto_adeudado: montoAdeudadoItem,
            telefono: tel || '—',
            fecha: cxc.fecha_emision,
            sucursal_id: cxc.alumno_sucursal_id,
            entrenador_id: cxc.alumno_entrenador_id,
            horario_id: cxc.alumno_horario_id,
            cancha_id: cxc.alumno_cancha_id
          });
        });
      });

      // Ordenar por alumno
      rows.sort((a, b) => a.alumno.localeCompare(b.alumno));
      setDatos(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCargando(false);
    }
  }

  return { datos, cargando, error, recargar };
}
