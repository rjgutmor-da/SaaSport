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
import { ordenarMesesCalendario, obtenerOrdenMes } from '../../../../lib/dateUtils';
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
  subFiltro?: string, // Filtro por categoría SUB (ej. Sub-6)
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
    JSON.stringify(filtroSubItems), entrenadorId, subFiltro, horarioId, canchaId, conceptoNombre, pagadoFiltro]);

  async function cargarAlumnos(
    eid: string,
    itemId: string,
    desde: string,
    hasta: string
  ) {
    setCargando(true);
    setError(null);

    try {
      // Consultamos cobros_aplicados filtrando en base de datos para reducir drásticamente el payload
      let query = supabase
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
              fecha_nacimiento,
              profesor_asignado_id,
              sucursal_id,
              horario_id,
              cancha_id,
              sucursales ( nombre ),
              usuarios!alumnos_profesor_asignado_id_fkey ( nombres, apellidos )
            )
          )
        `)
        .eq('escuela_id', eid)
        .gte('fecha', `${desde}T00:00:00`)
        .lte('fecha', `${hasta}T23:59:59`)
        .eq('cuentas_cobrar.anulada', false)
        .eq('cuentas_cobrar.cxc_detalle.catalogo_item_id', itemId)
        .not('cuentas_cobrar.descripcion', 'ilike', '%saldo inicial%')
        .limit(1000);

      // Filtros adicionales condicionales
      if (entrenadorId) {
        query = query.eq('cuentas_cobrar.alumnos.profesor_asignado_id', entrenadorId);
      }
      if (horarioId) {
        query = query.eq('cuentas_cobrar.alumnos.horario_id', horarioId);
      }
      if (canchaId) {
        query = query.eq('cuentas_cobrar.alumnos.cancha_id', canchaId);
      }

      const { data, error: err } = await query;

      if (err) throw new Error(err.message);

      const resultado: AlumnoPorItem[] = [];

      for (const cobro of (data || [])) {
        const fechaCobro = cobro.fecha?.split('T')[0];
        if (!fechaCobro || fechaCobro < desde || fechaCobro > hasta) continue;

        const cxc = (cobro as any).cuentas_cobrar;
        if (!cxc || cxc.anulada) continue;

        const alu = cxc.alumnos ?? {};

        // Calcular SUB (Categoría por edad)
        let subCalculado = '—';
        if (alu.fecha_nacimiento) {
          try {
            // Extraer el año de forma segura (YYYY-MM-DD)
            const anioNac = parseInt(alu.fecha_nacimiento.split('-')[0], 10);
            const anioActual = new Date().getFullYear();
            if (!isNaN(anioNac)) {
              subCalculado = `Sub-${anioActual - anioNac}`;
            }
          } catch (e) {
            subCalculado = '—';
          }
        }

        // Filtro adicional en JS para SUB
        if (subFiltro && subCalculado !== subFiltro) continue;

        const montoTotalNota = Number(cxc.monto_total || 0);
        const montoCobrado = Number(cobro.monto_aplicado || 0);
        const detalles = cxc.cxc_detalle || [];

        if (montoTotalNota <= 0) continue;

        // Buscamos si esta nota tiene el ítem que nos interesa
        const detInteres = detalles.find((d: any) => d.catalogo_item_id === itemId);
        if (!detInteres) continue;

        // Filtro de sub-ítems (Meses o Torneos)
        if (filtroSubItems && filtroSubItems.length > 0) {
          let cumpleSub = false;
          if (Array.isArray(detInteres.periodo_meses)) {
            // Comparación robusta de meses (coincidir "Abr" con "Abril" usando el orden del mes)
            const ordenesFiltro = filtroSubItems.map(f => obtenerOrdenMes(f)).filter(o => o > 0);
            cumpleSub = (detInteres.periodo_meses as string[]).some(m => {
              const ordenM = obtenerOrdenMes(m);
              return filtroSubItems.includes(m) || (ordenM > 0 && ordenesFiltro.includes(ordenM));
            });
          } else if (detInteres.detalle_extra) {
            cumpleSub = filtroSubItems.some(f => detInteres.detalle_extra.toLowerCase().includes(f.toLowerCase()));
          }
          if (!cumpleSub) continue;
        }

        const nombres = alu.nombres ?? '';
        const apellidos = alu.apellidos ?? '';

        // Construir descripción del detalle
        let detalleStr = '';
        if (Array.isArray(detInteres.periodo_meses) && detInteres.periodo_meses.length > 0) {
          detalleStr = ordenarMesesCalendario(detInteres.periodo_meses as string[]).join(', ');
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
          fecha: fechaCobro,
          detalle: detalleStr,
          nota_id: detInteres.id,
          cxc_id: cxc.id,
          concepto: conceptoNombre ?? 'Desconocido',
          sub: subCalculado,
          entrenador: alu.usuarios ? `${alu.usuarios.nombres} ${alu.usuarios.apellidos}`.trim() : 'Sin Entrenador',
          saldo_pendiente: 0,
          pagado: 'Si'
        });
      }

      let finalResultado = resultado;
      if (pagadoFiltro && pagadoFiltro !== 'Si') {
        finalResultado = [];
      }

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
