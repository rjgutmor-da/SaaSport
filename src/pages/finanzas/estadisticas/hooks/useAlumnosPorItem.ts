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
  concepto: string;
  sub: string;
  entrenador: string;
  saldo_pendiente: number;
  pagado: 'Si' | 'No' | 'Parcial';
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
  filtroSubItems?: string[], // meses o texto de torneo
  entrenadorId?: string,
  sucursalId?: string,
  horarioId?: string,
  canchaId?: string,
  conceptoNombre?: string, // Para setear el concepto en el resultado
  pagadoFiltro?: string
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
    // serializar filtros para evitar re-renders infinitos
    JSON.stringify(filtroSubItems), entrenadorId, sucursalId, horarioId, canchaId, conceptoNombre, pagadoFiltro]);

  async function cargarAlumnos(
    eid: string,
    itemId: string,
    desde: string,
    hasta: string
  ) {
    setCargando(true);
    setError(null);

    try {
      // Consultamos cobros_aplicados para que la estadística sea basada en efectivo (percibido)
      const { data, error: err } = await supabase
        .from('cobros_aplicados')
        .select(`
          id,
          monto_aplicado,
          fecha,
          cuentas_cobrar!cobros_aplicados_cuenta_cobrar_id_fkey (
            id,
            monto_total,
            fecha_emision,
            anulada,
            alumno_id,
            descripcion,
            estado,
            cxc_detalle (
              id,
              subtotal,
              periodo_meses,
              detalle_extra,
              catalogo_item_id
            ),
            alumnos!cuentas_cobrar_alumno_id_fkey (
              nombres, 
              apellidos,
              profesor_asignado_id,
              sucursal_id,
              horario_id,
              cancha_id,
              sucursales ( nombre ),
              usuarios!alumnos_profesor_asignado_id_fkey ( nombres, apellidos )
            )
          )
        `)
        .eq('escuela_id', eid);

      if (err) throw new Error(err.message);

      const resultado: AlumnoPorItem[] = [];

      for (const cobro of (data || [])) {
        const fechaCobro = cobro.fecha?.split('T')[0];
        if (!fechaCobro || fechaCobro < desde || fechaCobro > hasta) continue;

        const cxc = (cobro as any).cuentas_cobrar;
        if (!cxc || cxc.anulada) continue;

        // Filtros adicionales de Alumno
        if (entrenadorId && cxc.alumnos?.profesor_asignado_id !== entrenadorId) continue;
        if (sucursalId && cxc.alumnos?.sucursal_id !== sucursalId) continue;
        if (horarioId && cxc.alumnos?.horario_id !== horarioId) continue;
        if (canchaId && cxc.alumnos?.cancha_id !== canchaId) continue;

        const montoTotalNota = Number(cxc.monto_total || 0);
        const montoCobrado = Number(cobro.monto_aplicado || 0);
        const detalles = cxc.cxc_detalle || [];

        if (montoTotalNota <= 0) continue;

        // Buscamos si esta nota tiene el ítem que nos interesa
        const detInteres = detalles.find((d: any) => d.catalogo_item_id === itemId);
        if (!detInteres) continue;

        // Exclusión de Saldos Iniciales
        const descNota = cxc.descripcion || '';
        if (descNota.toLowerCase().includes('saldo inicial')) continue;
        // El nombre del ítem ya lo tenemos validado por el itemId que entra al hook, 
        // pero si fuera necesario filtrar por nombre aquí se podría.

        // Filtro de sub-ítems (Meses o Torneos)
        if (filtroSubItems && filtroSubItems.length > 0) {
          let cumpleSub = false;
          if (Array.isArray(detInteres.periodo_meses)) {
            cumpleSub = (detInteres.periodo_meses as string[]).some(m => filtroSubItems.includes(m));
          } else if (detInteres.detalle_extra) {
            cumpleSub = filtroSubItems.some(f => detInteres.detalle_extra.toLowerCase().includes(f.toLowerCase()));
          }
          if (!cumpleSub) continue;
        }

        const alu = cxc.alumnos ?? {};
        const nombres = alu.nombres ?? '';
        const apellidos = alu.apellidos ?? '';

        // Construir descripción del detalle
        let detalleStr = '';
        if (Array.isArray(detInteres.periodo_meses) && detInteres.periodo_meses.length > 0) {
          detalleStr = (detInteres.periodo_meses as string[]).join(', ');
        } else if (detInteres.detalle_extra) {
          detalleStr = String(detInteres.detalle_extra);
        }

        // Proporción del pago para este ítem
        const proporcion = Number(detInteres.subtotal || 0) / montoTotalNota;
        const montoItemPercibido = montoCobrado * proporcion;

        resultado.push({
          alumno_id: cxc.alumno_id ?? '',
          nombre_completo: `${nombres} ${apellidos}`.trim() || 'Sin nombre',
          monto: montoItemPercibido,
          fecha: fechaCobro, // Usamos la fecha del cobro, no de la nota
          detalle: detalleStr,
          nota_id: detInteres.id,
          cxc_id: cxc.id,
          concepto: conceptoNombre ?? 'Desconocido',
          sub: alu.sucursales?.nombre ?? 'Sin Categoría',
          entrenador: alu.usuarios ? `${alu.usuarios.nombres} ${alu.usuarios.apellidos}`.trim() : 'Sin Entrenador',
          saldo_pendiente: 0, // En vista de "percibido", mostramos lo que entró
          pagado: 'Si'
        });
      }

      let finalResultado = resultado;
      if (pagadoFiltro && pagadoFiltro !== 'Si') {
        // Si el filtro de pagado es "No" o "Parcial", en modo percibido no habrá resultados 
        // porque solo listamos cobros realizados.
        finalResultado = [];
      }

      // Ordenar por apellido+nombre
      finalResultado.sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
      setAlumnos(finalResultado);
    } catch (e: any) {
      setError(e.message ?? 'Error');
    } finally {
      setCargando(false);
    }

  }

  return { alumnos, cargando, error, recargar };
}
