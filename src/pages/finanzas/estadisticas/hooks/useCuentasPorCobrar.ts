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
  sucursalId?: string,
  entrenadorId?: string,
  horarioId?: string,
  grupoId?: string
): UseCuentasPorCobrarResult {
  const [datos, setDatos] = useState<CuentaPorCobrarRow[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const recargar = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!escuelaId) return;
    const rango = calcularRango(intervalo);
    cargarDatos(escuelaId, rango.desde, rango.hasta);
  }, [escuelaId, intervalo, desdePersonalizado, hastaPersonalizado, tick, sucursalId, entrenadorId, horarioId, grupoId]);

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
        .eq('es_anticipo', false)
        .gt('saldo_pendiente', 0)
        .gte('fecha_emision', desde)
        .lte('fecha_emision', hasta);

      // Filtros opcionales (basados en las columnas de la vista)
      if (sucursalId) query = query.eq('alumno_sucursal_id', sucursalId);
      if (entrenadorId) query = query.eq('alumno_entrenador_id', entrenadorId);
      if (horarioId) query = query.eq('alumno_horario_id', horarioId);
      if (grupoId) query = query.eq('alumno_grupo_id', grupoId);

      const { data, error: err } = await query;

      if (err) throw new Error(err.message);

      // Agrupamos las deudas por alumno (cliente) para consolidar su deuda total
      interface CuentaPorCobrarAcumulador {
        detalle_id: string;
        cxc_id: string;
        alumno: string;
        entrenador: string;
        sub: string;
        monto_adeudado: number;
        telefono: string;
        fecha: string;
        sucursal_id: string;
        entrenador_id: string;
        horario_id: string;
        cancha_id: string;
        mesesMensualidad: string[];
        otrosDetallesMensualidad: string[];
        otrosConceptos: string[];
      }

      const agrupados: { [key: string]: CuentaPorCobrarAcumulador } = {};

      (data || []).forEach((cxc: any) => {
        const detalles = cxc.cxc_detalle || [];
        
        detalles.forEach((d: any) => {
          // Calcular proporción del saldo pendiente para este ítem
          const proporcion = Number(d.subtotal || 0) / Number(cxc.monto_total || 1);
          const montoAdeudadoItem = Number(cxc.saldo_pendiente || 0) * proporcion;

          // Determinar si es una deuda de Mensualidad
          const esMensualidad = d.catalogo_items?.nombre?.toLowerCase().includes('mensualidad') ?? false;

          let itemMeses: string[] = [];
          let itemOtrosDetalles: string[] = [];
          let itemOtrosConceptos: string[] = [];

          if (esMensualidad) {
            if (Array.isArray(d.periodo_meses) && d.periodo_meses.length > 0) {
              itemMeses = [...d.periodo_meses];
            } else if (d.detalle_extra) {
              itemOtrosDetalles = [d.detalle_extra];
            } else {
              itemOtrosDetalles = ['Mensualidad'];
            }
          } else {
            let conceptoStr = d.catalogo_items?.nombre || 'Desconocido';
            if (Array.isArray(d.periodo_meses) && d.periodo_meses.length > 0) {
              const meses = ordenarMesesCalendario(d.periodo_meses);
              conceptoStr += ` (${meses.join(', ')})`;
            } else if (d.detalle_extra) {
              conceptoStr += ` (${d.detalle_extra})`;
            }
            itemOtrosConceptos = [conceptoStr];
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

          const alumnoNombre = `${cxc.alumno_nombres} ${cxc.alumno_apellidos}`.trim();
          const claveCliente = cxc.alumno_id || alumnoNombre;

          if (!agrupados[claveCliente]) {
            agrupados[claveCliente] = {
              detalle_id: d.id,
              cxc_id: cxc.id,
              alumno: alumnoNombre,
              entrenador: cxc.entrenador_nombre || 'Sin Entrenador',
              sub: subCalculado,
              monto_adeudado: montoAdeudadoItem,
              telefono: tel || '—',
              fecha: cxc.fecha_emision,
              sucursal_id: cxc.alumno_sucursal_id,
              entrenador_id: cxc.alumno_entrenador_id,
              horario_id: cxc.alumno_horario_id,
              cancha_id: cxc.alumno_grupo_id,
              mesesMensualidad: itemMeses,
              otrosDetallesMensualidad: itemOtrosDetalles,
              otrosConceptos: itemOtrosConceptos
            };
          } else {
            const itemExistente = agrupados[claveCliente];
            itemExistente.monto_adeudado += montoAdeudadoItem;
            // Concatenamos las IDs de los detalles para que la clave/key sea única en la tabla de React
            itemExistente.detalle_id += `_${d.id}`;

            // Agregamos nuevos meses evitando duplicados
            itemMeses.forEach(m => {
              if (!itemExistente.mesesMensualidad.includes(m)) {
                itemExistente.mesesMensualidad.push(m);
              }
            });

            // Agregamos otros detalles de Mensualidad
            itemOtrosDetalles.forEach(od => {
              if (!itemExistente.otrosDetallesMensualidad.includes(od)) {
                itemExistente.otrosDetallesMensualidad.push(od);
              }
            });

            // Agregamos otros conceptos
            itemOtrosConceptos.forEach(oc => {
              if (!itemExistente.otrosConceptos.includes(oc)) {
                itemExistente.otrosConceptos.push(oc);
              }
            });

            // Consolidar entrenadores si difieren
            if (cxc.entrenador_nombre && itemExistente.entrenador !== cxc.entrenador_nombre) {
              const entrenadores = itemExistente.entrenador.split(', ');
              if (!entrenadores.includes(cxc.entrenador_nombre)) {
                if (itemExistente.entrenador === 'Sin Entrenador') {
                  itemExistente.entrenador = cxc.entrenador_nombre;
                } else {
                  itemExistente.entrenador += `, ${cxc.entrenador_nombre}`;
                }
              }
            }

            // Consolidar Sub (Categorías) si difieren
            if (subCalculado && subCalculado !== '—' && itemExistente.sub !== subCalculado) {
              const subs = itemExistente.sub.split(', ');
              if (!subs.includes(subCalculado)) {
                if (itemExistente.sub === '—') {
                  itemExistente.sub = subCalculado;
                } else {
                  itemExistente.sub += `, ${subCalculado}`;
                }
              }
            }
          }
        });
      });

      // Mapeamos los datos acumulados a las filas finales, ordenando y formateando el concepto
      const rows: CuentaPorCobrarRow[] = Object.values(agrupados).map(acc => {
        const partesConcepto: string[] = [];

        // 1. Si hay meses de Mensualidad, los ordenamos cronológicamente y los agregamos
        if (acc.mesesMensualidad.length > 0) {
          const mesesOrdenados = ordenarMesesCalendario(acc.mesesMensualidad);
          partesConcepto.push(mesesOrdenados.join(', '));
        }

        // 2. Si hay otros detalles de Mensualidad, los agregamos
        if (acc.otrosDetallesMensualidad.length > 0) {
          partesConcepto.push(acc.otrosDetallesMensualidad.join(', '));
        }

        // 3. Si hay otros conceptos, los agregamos
        if (acc.otrosConceptos.length > 0) {
          partesConcepto.push(acc.otrosConceptos.join(', '));
        }

        return {
          detalle_id: acc.detalle_id,
          cxc_id: acc.cxc_id,
          alumno: acc.alumno,
          entrenador: acc.entrenador,
          concepto: partesConcepto.join(', '),
          sub: acc.sub,
          monto_adeudado: acc.monto_adeudado,
          telefono: acc.telefono,
          fecha: acc.fecha,
          sucursal_id: acc.sucursal_id,
          entrenador_id: acc.entrenador_id,
          horario_id: acc.horario_id,
          cancha_id: acc.cancha_id
        };
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
