import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { formatearMesCorto } from '../lib/dateUtils';
import type { ResultadoBusquedaCxc } from '../types/cxc';

export const queryKeys = {
  cxc_busqueda: (alcance: AlcanceBusquedaCxc, filtros: FiltrosBusquedaCxc) => ['cxc-busqueda', alcance, filtros] as const,
  cxp_resumen: (filtros: any) => ['cxp-resumen', filtros] as const,
  cxp_entidades: (filtros: any) => ['cxp-entidades', filtros] as const,
};

export interface MovimientoFinanciero {
  id: string;
  tipo_origen: 'cobro' | 'pago';
  debe: number;
  haber: number;
  fecha: string;
  created_at?: string;
  descripcion: string;
  nro_transaccion: string;
  cuenta_id: string;
  cuenta_nombre: string;
  conciliado: boolean;
  cliente?: string;
  saldo_historico?: number;
  cuenta_maestra_id?: string;
  grupo_transaccion_id?: string | null;
  is_grouped?: boolean;
  original_ids?: string[];
  movimientos_agrupados?: Array<{
    id: string;
    descripcion: string;
    monto: number;
    ciclo_inicio?: string | null;
    ciclo_fin?: string | null;
  }>;
  alumno_raw?: any;
  detalles_cxc?: any[];
  ciclo_inicio?: string | null;
  ciclo_fin?: string | null;
  es_movimiento_directo?: boolean;
  concepto_id?: string | null;
}

// --- Resúmenes (Fase 1: Cálculos en DB) ---

const esReferenciaAgrupable = (referencia: string) => {
  const valor = referencia.trim();
  return !!valor && !/^(efectivo|transferencia|qr|transferencia bancaria|pago qr)$/i.test(valor);
};

// CxC conserva un cobro por cada nota cancelada. En Bancos, las cuotas que
// comparten transferencia se presentan como un único ingreso.
const agruparCobrosDeUnaTransaccion = (movimientos: MovimientoFinanciero[]) => {
  const grupos = new Map<string, MovimientoFinanciero[]>();

  movimientos.forEach(mov => {
    if (mov.tipo_origen !== 'cobro' || !esReferenciaAgrupable(mov.nro_transaccion)) return;
    const clave = [mov.cuenta_id, mov.cliente || '', mov.nro_transaccion.trim().toLowerCase(), mov.fecha, mov.created_at || ''].join('|');
    const grupo = grupos.get(clave) || [];
    grupo.push(mov);
    grupos.set(clave, grupo);
  });

  const idsAgrupados = new Set<string>();
  const resultado: MovimientoFinanciero[] = [];

  grupos.forEach(grupo => {
    if (grupo.length < 2) return;
    grupo.forEach(mov => idsAgrupados.add(mov.id));
    const principal = grupo[0];
    const conceptos = Array.from(new Set(grupo.map(mov => mov.cuenta_nombre).filter(Boolean)));

    // Combinar los detalles de todas las notas del grupo para que el recibo
    // muestre cada mensualidad (julio, agosto, etc.) correctamente.
    const detallesCombinados = grupo.flatMap(mov => mov.detalles_cxc || []);

    resultado.push({
      ...principal,
      id: `grupo-${grupo.map(mov => mov.id).join('-')}`,
      debe: grupo.reduce((total, mov) => total + mov.debe, 0),
      haber: grupo.reduce((total, mov) => total + mov.haber, 0),
      cuenta_nombre: conceptos.join(', ') || principal.cuenta_nombre,
      descripcion: `${principal.descripcion} (${grupo.length} cuotas)`,
      conciliado: grupo.every(mov => mov.conciliado),
      is_grouped: true,
      original_ids: grupo.map(mov => mov.id),
      detalles_cxc: detallesCombinados,
      movimientos_agrupados: grupo.map(mov => ({
        id: mov.id,
        descripcion: mov.descripcion,
        monto: mov.debe - mov.haber,
        ciclo_inicio: mov.ciclo_inicio,
        ciclo_fin: mov.ciclo_fin
      }))
    });
  });

  movimientos.forEach(mov => {
    if (!idsAgrupados.has(mov.id)) resultado.push(mov);
  });

  return resultado;
};

const fetchCxpResumen = async (escuelaId: string, filtros?: any) => {
  const tieneFiltros = filtros && (filtros.categoria || filtros.busqueda?.trim());

  if (!tieneFiltros) {
    const { data, error } = await supabase
      .from('v_cxp_resumen')
      .select('*')
      .eq('escuela_id', escuelaId)
      .single();
    if (error) throw error;
    return data;
  }

  // Si hay filtros, calculamos el resumen dinámicamente desde v_cxp_consolidado (reutilizando la misma lógica de filtros)
  let query = supabase
    .from('v_cxp_consolidado')
    .select('*')
    .eq('escuela_id', escuelaId)
    .eq('activo', true);

  if (filtros.categoria) query = query.eq('categoria', filtros.categoria);

  if (filtros.busqueda?.trim()) {
    const q = `%${filtros.busqueda.trim()}%`;
    query = query.ilike('nombre', q);
  }

  const { data, error } = await query;
  if (error) throw error;

  let lista = data || [];

  const totalEntidades = lista.length;
  const conDeuda = lista.filter(e => Number(e.saldo_pendiente) > 0).length;
  const totalPendiente = lista.reduce((acc, e) => {
    const val = Number(e.saldo_pendiente);
    return acc + (val > 0 ? val : 0);
  }, 0);
  const totalAnticipos = lista.reduce((acc, e) => {
    const val = Number(e.saldo_pendiente);
    return acc + (val < 0 ? val : 0);
  }, 0);

  return {
    total_entidades: totalEntidades,
    con_deuda: conDeuda,
    total_pendiente: totalPendiente,
    total_anticipos: totalAnticipos
  };
};

// --- Listados ---

export interface FiltrosBusquedaCxc {
  sucursalId?: string | null;
  entrenadorId?: string | null;
  grupoId?: string | null;
  horarioId?: string | null;
  soloConDeuda?: boolean;
  filtroEstadoAlumno?: 'activos' | 'archivados' | 'todos';
  busqueda?: string;
  pagina?: number;
  itemsPorPagina?: number;
}

export interface AlcanceBusquedaCxc {
  userId: string | null;
  escuelaId: string | null;
  sucursalId: string | null;
}

const fetchCxcBusqueda = async (filtros: FiltrosBusquedaCxc, signal: AbortSignal) => {
  const { data, error } = await supabase.rpc('rpc_buscar_alumnos_cxc', {
    p_busqueda: filtros.busqueda?.trim() || null,
    p_estado: filtros.filtroEstadoAlumno || 'activos',
    p_solo_con_deuda: filtros.soloConDeuda ?? false,
    p_sucursal_filtro: filtros.sucursalId || null,
    p_entrenador_id: filtros.entrenadorId || null,
    p_grupo_id: filtros.grupoId || null,
    p_horario_id: filtros.horarioId || null,
    p_pagina: filtros.pagina || 1,
    p_limite: filtros.itemsPorPagina || 30,
  }).abortSignal(signal);

  if (error) throw error;
  const resultado = data as unknown as ResultadoBusquedaCxc;
  return {
    ...resultado,
    items: (resultado?.items || []).map(alumno => ({
      ...alumno,
      ultima_mensualidad: formatearMesCorto(alumno.ultima_mensualidad),
    })),
  };
};

const fetchCxpEntidades = async (escuelaId: string, filtros: any) => {
  let query = supabase
    .from('v_cxp_consolidado')
    .select('*')
    .eq('escuela_id', escuelaId)
    .eq('activo', true);

  if (filtros.categoria) query = query.eq('categoria', filtros.categoria);
  
  if (filtros.busqueda?.trim()) {
    const q = `%${filtros.busqueda.trim()}%`;
    query = query.ilike('nombre', q);
  }

  const { data, error } = await query;
  if (error) throw error;

  let lista = data || [];

  // Ordenar: primero con saldo, después por nombre
  lista.sort((a: any, b: any) => {
    if (b.saldo_pendiente !== a.saldo_pendiente) return b.saldo_pendiente - a.saldo_pendiente;
    return a.nombre.localeCompare(b.nombre);
  });

  return lista;
};

// --- Hooks ---

export const useCxcBusqueda = (
  alcance: AlcanceBusquedaCxc,
  filtros: FiltrosBusquedaCxc,
  enabled = true,
) => useQuery({
  queryKey: queryKeys.cxc_busqueda(alcance, filtros),
  queryFn: ({ signal }) => fetchCxcBusqueda(filtros, signal),
  enabled: enabled && !!alcance.userId && !!alcance.escuelaId,
  staleTime: 1000 * 60 * 2,
  placeholderData: previousData => previousData,
});

export const useCxpResumen = (escuelaId: string | null, filtros: any) =>
  useQuery({
    queryKey: queryKeys.cxp_resumen(filtros),
    queryFn: () => fetchCxpResumen(escuelaId!, filtros),
    enabled: !!escuelaId,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });

export const useCxpEntidades = (escuelaId: string | null, filtros: any) =>
  useQuery({
    queryKey: queryKeys.cxp_entidades(filtros),
    queryFn: () => fetchCxpEntidades(escuelaId!, filtros),
    enabled: !!escuelaId,
  });

// --- Cajas y Bancos ---

const fetchCajasBancos = async (escuelaId: string) => {
  const { data, error } = await supabase
    .from('cajas_bancos')
    .select('*')
    .eq('escuela_id', escuelaId)
    .eq('activo', true)
    .order('orden');
  if (error) throw error;
  return data;
};

export interface CajaConSaldo {
  id: string;
  saldo_actual: number;
}

export interface RangoFecha {
  desde: string; // ISO String UTC
  hasta: string; // ISO String UTC
  usarRpc: boolean;
}

export interface MovimientosResult {
  movimientos: MovimientoFinanciero[];
  limiteAlcanzadoPorCaja: Record<string, boolean>;
}

// El saldo historico debe calcularse en el mismo orden que se muestra la tabla.
// Priorizamos el dia contable y, dentro del mismo dia, el momento de registro.
const compararMovimientosDesc = (a: MovimientoFinanciero, b: MovimientoFinanciero) => {
  const obtenerDia = (fecha: string) => {
    const match = fecha?.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return 0;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  };

  const diferenciaDia = obtenerDia(b.fecha) - obtenerDia(a.fecha);
  if (diferenciaDia !== 0) return diferenciaDia;

  const diferenciaCreacion =
    new Date(b.created_at || b.fecha).getTime() -
    new Date(a.created_at || a.fecha).getTime();
  if (diferenciaCreacion !== 0) return diferenciaCreacion;

  return b.id.localeCompare(a.id);
};

const fetchMovimientos = async (
  escuelaId: string,
  cajas: CajaConSaldo[],
  rango: RangoFecha | null
): Promise<MovimientosResult> => {
  if (!escuelaId || cajas.length === 0) {
    return { movimientos: [], limiteAlcanzadoPorCaja: {} };
  }

  // 1. Obtener saldos de cierre por caja
  const saldosCierre: Record<string, number> = {};
  if (rango) {
    const { data: saldosRpc, error: errorRpc } = await supabase.rpc('obtener_saldo_cierre_cajas', {
      p_caja_ids: cajas.map(c => c.id),
      p_hasta: rango.hasta
    });
    if (errorRpc) throw errorRpc;

    cajas.forEach(c => {
      const found = saldosRpc?.find((r: any) => r.caja_id === c.id);
      saldosCierre[c.id] = found ? Number(found.saldo_cierre) : 0;
    });
  } else {
    cajas.forEach(c => {
      saldosCierre[c.id] = Number(c.saldo_actual) || 0;
    });
  }

  const limiteAlcanzadoPorCaja: Record<string, boolean> = {};
  const todosLosMovimientos: MovimientoFinanciero[] = [];
  const erroresPorCaja: Record<string, any> = {};

  // Función para procesar una caja individual de forma segura
  const procesarCaja = async (caja: CajaConSaldo) => {
    let queryCobros = supabase.from('cobros_aplicados').select(`
      *,
      cuentas_cobrar (
        id, descripcion, nro_recibo, es_anticipo, es_ingreso_directo, ciclo_inicio, ciclo_fin,
        alumnos ( nombres, apellidos, telefono_padre, telefono_madre, whatsapp_preferido ),
        cxc_detalle (
          id,
          catalogo_item_id,
          cantidad,
          precio_unitario,
          periodo_meses,
          detalle_extra,
          ciclo_inicio,
          ciclo_fin,
          catalogo_items ( nombre )
        )
      )
    `)
    .eq('caja_id', caja.id)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(201); // Fila centinela

    let queryPagos = supabase.from('pagos_aplicados').select(`
      *,
      cuentas_pagar (
        id, descripcion, es_anticipo,
        proveedores ( nombre ),
        personal ( nombres, apellidos ),
        cxp_detalle (
          id,
          catalogo_item_id,
          catalogo_items ( nombre )
        )
      )
    `)
    .eq('caja_id', caja.id)
    .order('fecha', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(201); // Fila centinela

    if (rango) {
      // Filtro inclusivo de desde y exclusivo de hasta, soportando nulos de fecha de forma defensiva
      const filter = `and(fecha.gte.${rango.desde},fecha.lt.${rango.hasta}),and(fecha.is.null,created_at.gte.${rango.desde},created_at.lt.${rango.hasta})`;
      queryCobros = queryCobros.or(filter);
      queryPagos = queryPagos.or(filter);
    }

    const [cobrosRes, pagosRes] = await Promise.all([queryCobros, queryPagos]);

    if (cobrosRes.error) throw cobrosRes.error;
    if (pagosRes.error) throw pagosRes.error;

    const movsCaja: MovimientoFinanciero[] = [];

    // Mapear cobros
    (cobrosRes.data || []).forEach((c: any) => {
      const monto = Number(c.monto_aplicado) || 0;
      const items = c.cuentas_cobrar?.cxc_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
      const esIngresoDirecto = c.cuentas_cobrar?.es_ingreso_directo === true
        || (!c.cuentas_cobrar?.alumnos
        && !c.cuentas_cobrar?.descripcion?.startsWith('[INGRESO TRF]')
        && (!items || items.length === 0));
      const esIngresoDirectoSinDetalle = esIngresoDirecto && (!items || items.length === 0);
      movsCaja.push({
        id: c.id,
        tipo_origen: 'cobro',
        debe: monto > 0 ? monto : 0,
        haber: monto < 0 ? -monto : 0,
        fecha: c.fecha || c.created_at,
        created_at: c.created_at,
        descripcion: c.cuentas_cobrar?.descripcion || 'Cobro / Ingreso',
        nro_transaccion: c.documento_referencia || c.cuentas_cobrar?.nro_recibo || '',
        // Los ingresos directos antiguos sin detalle identifican el origen en
        // su descripción; debe mostrarse como Alumno / Proveedor.
        cliente: c.cuentas_cobrar?.alumnos
          ? `${c.cuentas_cobrar.alumnos.nombres} ${c.cuentas_cobrar.alumnos.apellidos}`
          : (esIngresoDirecto ? c.cuentas_cobrar?.descripcion || '—' : '—'),
        cuenta_id: c.caja_id,
        cuenta_nombre: (() => {
          if (c.cuentas_cobrar?.descripcion?.startsWith('[INGRESO TRF]')) {
            return 'Transferencia';
          }
          if (c.cuentas_cobrar?.es_anticipo) {
            const items = c.cuentas_cobrar?.cxc_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
            if (items && items.length > 0) return Array.from(new Set(items)).join(', ');
            return c.cuentas_cobrar?.descripcion || 'Anticipo';
          }
          if (!items || items.length === 0) {
            return esIngresoDirectoSinDetalle ? 'Ingreso directo' : (c.cuentas_cobrar?.descripcion || 'Concepto no especificado');
          }
          return Array.from(new Set(items)).join(', ');
        })(),
        conciliado: c.conciliado || false,
        es_movimiento_directo: esIngresoDirecto,
        cuenta_maestra_id: c.cuentas_cobrar?.id,
        alumno_raw: c.cuentas_cobrar?.alumnos || null,
        detalles_cxc: c.cuentas_cobrar?.cxc_detalle || [],
        ciclo_inicio: c.cuentas_cobrar?.ciclo_inicio || null,
        ciclo_fin: c.cuentas_cobrar?.ciclo_fin || null,
        concepto_id: c.cuentas_cobrar?.cxc_detalle?.[0]?.catalogo_item_id || null
      });
    });

    // Mapear pagos
    (pagosRes.data || []).forEach((p: any) => {
      const esEgresoDirecto = !p.cuentas_pagar?.proveedores && !p.cuentas_pagar?.personal && !p.cuentas_pagar?.descripcion?.startsWith('[EGRESO TRF]') && !p.cuentas_pagar?.es_anticipo;
      movsCaja.push({
        id: p.id,
        tipo_origen: 'pago',
        debe: 0,
        haber: Number(p.monto_aplicado) || 0,
        fecha: p.fecha || p.created_at,
        created_at: p.created_at,
        descripcion: p.cuentas_pagar?.descripcion || 'Pago / Egreso',
        nro_transaccion: p.referencia || '',
        cliente: p.cuentas_pagar?.proveedores?.nombre
          || (p.cuentas_pagar?.personal ? `${p.cuentas_pagar.personal.nombres} ${p.cuentas_pagar.personal.apellidos}` : null)
          || (esEgresoDirecto ? p.cuentas_pagar?.descripcion || '—' : '—'),
        cuenta_id: p.caja_id,
        cuenta_nombre: (() => {
          if (p.cuentas_pagar?.descripcion?.startsWith('[EGRESO TRF]')) {
            return 'Transferencia';
          }
          if (p.cuentas_pagar?.es_anticipo) {
            const items = p.cuentas_pagar?.cxp_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
            if (items && items.length > 0) return Array.from(new Set(items)).join(', ');
            return p.cuentas_pagar?.descripcion || 'Anticipo';
          }
          const items = p.cuentas_pagar?.cxp_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
          if (!items || items.length === 0) return 'Concepto no especificado';
          let res = Array.from(new Set(items)).join(', ');
          if (p.cuentas_pagar?.personal && res === 'ACF') return 'Sueldos y Salarios';
          return res;
        })(),
        conciliado: p.conciliado || false,
        cuenta_maestra_id: p.cuentas_pagar?.id,
        es_movimiento_directo: esEgresoDirecto,
        concepto_id: p.cuentas_pagar?.cxp_detalle?.[0]?.catalogo_item_id || null
      });
    });

    // Ordenar descendente: primero por fecha (día), luego por timestamp de creación
    movsCaja.sort(compararMovimientosDesc);

    const movimientosAgrupados = agruparCobrosDeUnaTransaccion(movsCaja);
    movimientosAgrupados.sort(compararMovimientosDesc);

    // Evaluar si se excede el límite usando fila centinela
    const masDe200 = movsCaja.length > 200 || (cobrosRes.data?.length || 0) > 200 || (pagosRes.data?.length || 0) > 200;
    limiteAlcanzadoPorCaja[caja.id] = masDe200;

    // Mantener solo los 200 movimientos más recientes de esta caja
    const sliceMovs = movimientosAgrupados.slice(0, 200);

    // Calcular saldo histórico hacia atrás:
    // saldoAnterior = saldoActual - debe + haber
    let runningBalance = saldosCierre[caja.id] || 0;
    for (let i = 0; i < sliceMovs.length; i++) {
      const m = sliceMovs[i];
      m.saldo_historico = runningBalance;
      runningBalance = runningBalance - m.debe + m.haber;
    }

    return sliceMovs;
  };

  // Consultar en lotes de hasta 2 cajas concurrentes para no saturar conexiones HTTP/PostgREST
  const TAMANIO_LOTE = 2;
  for (let i = 0; i < cajas.length; i += TAMANIO_LOTE) {
    const lote = cajas.slice(i, i + TAMANIO_LOTE);
    const resultados = await Promise.allSettled(lote.map(c => procesarCaja(c)));

    resultados.forEach((res, idx) => {
      const caja = lote[idx];
      if (res.status === 'fulfilled' && res.value) {
        todosLosMovimientos.push(...res.value);
      } else if (res.status === 'rejected') {
        console.error(`[Finanzas] Error al cargar movimientos de la caja ${caja.id}:`, res.reason);
        erroresPorCaja[caja.id] = res.reason;
      }
    });
  }

  // Si fallaron absolutamente todas las cajas consultadas, lanzar error para TanStack Query
  if (Object.keys(erroresPorCaja).length === cajas.length && cajas.length > 0) {
    const primerError = Object.values(erroresPorCaja)[0];
    throw primerError || new Error('No se pudieron obtener los movimientos de las cuentas');
  }

  // Ordenar la lista combinada global de forma descendente por fecha
  todosLosMovimientos.sort(compararMovimientosDesc);

  return {
    movimientos: todosLosMovimientos,
    limiteAlcanzadoPorCaja
  };
};

export const useCajasBancos = (escuelaId: string | null) =>
  useQuery({
    queryKey: ['cajas-bancos', escuelaId],
    queryFn: () => fetchCajasBancos(escuelaId!),
    enabled: !!escuelaId,
    staleTime: 1000 * 30, // 30 segundos de datos frescos
  });

export const useMovimientos = (
  escuelaId: string | null,
  cajas: CajaConSaldo[],
  rango: RangoFecha | null,
  habilitado = true
) =>
  useQuery({
    queryKey: [
      'movimientos-financieros',
      escuelaId,
      cajas.map(c => c.id).join(','),
      rango,
      cajas.map(c => c.saldo_actual).join(',')
    ],
    queryFn: () => fetchMovimientos(escuelaId!, cajas, rango),
    enabled: habilitado && !!escuelaId && cajas.length > 0,
    staleTime: 1000 * 30, // 30 segundos de datos frescos
  });
