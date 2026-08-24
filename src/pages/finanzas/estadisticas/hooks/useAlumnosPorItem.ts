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
  montosUnicos: number[];
}

export function useAlumnosPorItem(
  escuelaId: string | null,
  catalogoItemId: string | null,
  intervalo: IntervaloPredefinido,
  desdePersonalizado?: string,
  hastaPersonalizado?: string,
  filtroSubItems?: string[], // meses o texto de torneo
  sucursalId?: string,
  entrenadorId?: string,
  horarioId?: string,
  canchaId?: string,
  conceptoNombre?: string, // Para setear el concepto en el resultado
  pagadoFiltro?: string,
  anioMensualidad?: number,
  montosExactos?: number[],
  montoRango?: { desde?: number; hasta?: number },
): UseAlumnosPorItemResult {
  const [alumnos, setAlumnos] = useState<AlumnoPorItem[]>([]);
  const [montosUnicos, setMontosUnicos] = useState<number[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId || !catalogoItemId) {
      setAlumnos([]);
      setMontosUnicos([]);
      return;
    }
    const rangoIntervalo = calcularRango(intervalo);
    const rango = anioMensualidad
      ? {
          desde: rangoIntervalo.desde > `${anioMensualidad}-01-01` ? rangoIntervalo.desde : `${anioMensualidad}-01-01`,
          hasta: rangoIntervalo.hasta < `${anioMensualidad}-12-31` ? rangoIntervalo.hasta : `${anioMensualidad}-12-31`,
        }
      : rangoIntervalo;

    if (rango.desde > rango.hasta) {
      setAlumnos([]);
      setMontosUnicos([]);
      return;
    }
    cargarAlumnos(escuelaId, catalogoItemId, rango.desde, rango.hasta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escuelaId, catalogoItemId, intervalo, desdePersonalizado, hastaPersonalizado, tick,
    // serializar filtros para evitar re-renders infinitos
    JSON.stringify(filtroSubItems), sucursalId, entrenadorId, horarioId, canchaId, conceptoNombre, pagadoFiltro,
    anioMensualidad, JSON.stringify(montosExactos), JSON.stringify(montoRango)]);

  async function cargarAlumnos(
    eid: string,
    itemId: string,
    desde: string,
    hasta: string
  ) {
    setCargando(true);
    setError(null);

    try {
      // Consultamos las notas emitidas para que el saldo represente la deuda real,
      // no solo los cobros ya aplicados.
      let query = supabase
        .from('cuentas_cobrar')
        .select(`
          id,
          monto_total,
          fecha_emision,
          periodo_estadistico,
          anulada,
          alumno_id,
          descripcion,
          estado,
          cobros_aplicados (
            monto_aplicado
          ),
          cxc_detalle (
            id,
            subtotal,
            periodo_meses,
            detalle_extra,
            catalogo_item_id,
            ciclo_inicio,
            ciclo_fin,
            periodo_estadistico
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
        `)
        .eq('escuela_id', eid)
        .eq('anulada', false)
        // Los anticipos pueden reclasificarse con el concepto final al aplicarse,
        // pero no representan una compra adicional en esta estadística.
        .eq('es_anticipo', false)
        .or(`and(periodo_estadistico.gte.${desde},periodo_estadistico.lte.${hasta}),and(periodo_estadistico.is.null,fecha_emision.gte.${desde},fecha_emision.lte.${hasta})`)
        .limit(5000);

      // Una nota puede contener mensualidades de varios ciclos. Esta segunda
      // consulta recupera las notas por el periodo de cada linea, aunque la
      // cabecera no tenga un unico periodo representativo.
      let queryPorPeriodoDetalle = supabase
        .from('cuentas_cobrar')
        .select(`
          id,
          monto_total,
          fecha_emision,
          periodo_estadistico,
          anulada,
          alumno_id,
          descripcion,
          estado,
          cobros_aplicados (
            monto_aplicado
          ),
          cxc_detalle!inner (
            id,
            subtotal,
            periodo_meses,
            detalle_extra,
            catalogo_item_id,
            ciclo_inicio,
            ciclo_fin,
            periodo_estadistico
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
        `)
        .eq('escuela_id', eid)
        .eq('anulada', false)
        .eq('es_anticipo', false)
        .eq('cxc_detalle.catalogo_item_id', itemId)
        .gte('cxc_detalle.periodo_estadistico', desde)
        .lte('cxc_detalle.periodo_estadistico', hasta)
        .limit(5000);

      // Filtros adicionales condicionales
      if (entrenadorId) {
        query = query.eq('alumnos.profesor_asignado_id', entrenadorId);
        queryPorPeriodoDetalle = queryPorPeriodoDetalle.eq('alumnos.profesor_asignado_id', entrenadorId);
      }
      if (sucursalId) {
        query = query.eq('alumnos.sucursal_id', sucursalId);
        queryPorPeriodoDetalle = queryPorPeriodoDetalle.eq('alumnos.sucursal_id', sucursalId);
      }
      if (horarioId) {
        query = query.eq('alumnos.horario_id', horarioId);
        queryPorPeriodoDetalle = queryPorPeriodoDetalle.eq('alumnos.horario_id', horarioId);
      }
      if (canchaId) {
        query = query.eq('alumnos.cancha_id', canchaId);
        queryPorPeriodoDetalle = queryPorPeriodoDetalle.eq('alumnos.cancha_id', canchaId);
      }

      const [
        { data: dataCabecera, error: errorCabecera },
        { data: dataDetalle, error: errorDetalle },
      ] = await Promise.all([query, queryPorPeriodoDetalle]);

      if (errorCabecera) throw new Error(errorCabecera.message);
      if (errorDetalle) throw new Error(errorDetalle.message);

      const notasPorId = new Map<string, any>();
      for (const nota of [...(dataCabecera || []), ...(dataDetalle || [])] as any[]) {
        const existente = notasPorId.get(nota.id);
        if (!existente || (nota.cxc_detalle?.length || 0) > (existente.cxc_detalle?.length || 0)) {
          notasPorId.set(nota.id, nota);
        }
      }

      const resultado: AlumnoPorItem[] = [];

      for (const cxc of notasPorId.values()) {
        const fechaEmision = cxc.fecha_emision?.split('T')[0] ?? cxc.fecha_emision;
        if (cxc.anulada) continue;
        if (String(cxc.descripcion || '').toLowerCase().includes('saldo inicial')) continue;

        const alu = cxc.alumnos;
        if (!alu) continue;

        // Validar filtros del alumno en JS para asegurar que no se incluyan registros vacíos o no correspondientes
        if (entrenadorId && alu.profesor_asignado_id !== entrenadorId) continue;
        if (sucursalId && alu.sucursal_id !== sucursalId) continue;
        if (horarioId && alu.horario_id !== horarioId) continue;
        if (canchaId && alu.cancha_id !== canchaId) continue;


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

        const montoTotalNota = Number(cxc.monto_total || 0);
        const montoCobrado = (cxc.cobros_aplicados || []).reduce(
          (s: number, cobro: any) => s + Number(cobro.monto_aplicado || 0),
          0
        );
        const saldoNota = Math.max(0, montoTotalNota - montoCobrado);
        const detalles = cxc.cxc_detalle || [];

        if (montoTotalNota <= 0) continue;

        const nombres = alu.nombres ?? '';
        const apellidos = alu.apellidos ?? '';
        const detallesInteres = detalles.filter((d: any) => d.catalogo_item_id === itemId);

        for (const detInteres of detallesInteres) {
          const fechaEstadistica = detInteres.periodo_estadistico || cxc.periodo_estadistico || fechaEmision;
          if (!fechaEstadistica || fechaEstadistica < desde || fechaEstadistica > hasta) continue;

          // Filtro de sub-ítems (Meses o Torneos)
          if (filtroSubItems && filtroSubItems.length > 0) {
            let cumpleSub = false;
            const mesPeriodoEstadistico = /^\d{4}-(\d{2})-(\d{2})$/.exec(
              detInteres.periodo_estadistico || cxc.periodo_estadistico || '',
            )?.[1];
            if (mesPeriodoEstadistico) {
              const ordenesFiltro = filtroSubItems.map(f => obtenerOrdenMes(f)).filter(o => o > 0);
              cumpleSub = ordenesFiltro.includes(Number(mesPeriodoEstadistico));
            } else if (Array.isArray(detInteres.periodo_meses)) {
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

          let detalleStr = '';
          if (Array.isArray(detInteres.periodo_meses) && detInteres.periodo_meses.length > 0) {
            detalleStr = ordenarMesesCalendario(detInteres.periodo_meses as string[]).join(', ');
          } else if (detInteres.detalle_extra) {
            detalleStr = String(detInteres.detalle_extra);
          }

          const proporcion = Number(detInteres.subtotal || 0) / montoTotalNota;
          const montoItem = Number(detInteres.subtotal || 0);
          const saldoItem = Math.max(0, saldoNota * proporcion);
          const pagadoItem: AlumnoPorItem['pagado'] = saldoItem <= 0.005
            ? 'Si'
            : saldoItem >= montoItem - 0.005
              ? 'No'
              : 'Parcial';

          resultado.push({
            alumno_id: cxc.alumno_id ?? '',
            nombre_completo: `${nombres} ${apellidos}`.trim() || 'Sin nombre',
            monto: montoItem,
            fecha: fechaEmision,
            detalle: detalleStr,
            nota_id: detInteres.id,
            cxc_id: cxc.id,
            concepto: conceptoNombre ?? 'Desconocido',
            sub: subCalculado,
            entrenador: alu.usuarios ? `${alu.usuarios.nombres} ${alu.usuarios.apellidos}`.trim() : 'Sin Entrenador',
            saldo_pendiente: saldoItem,
            pagado: pagadoItem
          });
        }
      }

      let finalResultado = resultado;
      if (pagadoFiltro) {
        finalResultado = finalResultado.filter(a =>
          pagadoFiltro === 'No' ? a.pagado !== 'Si' : a.pagado === 'Si'
        );
      }

      // Obtener los montos únicos disponibles antes de filtrar por monto
      const mUnicos = Array.from(new Set(finalResultado.map(a => a.monto))).sort((a, b) => a - b);
      setMontosUnicos(mUnicos);

      // Filtro de montos exactos (chips)
      if (montosExactos && montosExactos.length > 0) {
        finalResultado = finalResultado.filter(a => montosExactos.includes(a.monto));
      }

      // Filtro de rango de montos
      if (montoRango) {
        if (montoRango.desde !== undefined && !isNaN(montoRango.desde)) {
          finalResultado = finalResultado.filter(a => a.monto >= montoRango.desde!);
        }
        if (montoRango.hasta !== undefined && !isNaN(montoRango.hasta)) {
          finalResultado = finalResultado.filter(a => a.monto <= montoRango.hasta!);
        }
      }

      finalResultado.sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo));
      setAlumnos(finalResultado);
    } catch (e: any) {
      setError(e.message ?? 'Error');
    } finally {
      setCargando(false);
    }
  }

  return { alumnos, montosUnicos, cargando, error, recargar };
}
