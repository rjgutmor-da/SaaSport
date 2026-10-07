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

// En Caja y Bancos el concepto ya tiene su propia columna. La referencia del
// cobro debe ser solamente el mes o torneo registrado, no un conteo de cuotas.
const obtenerReferenciaCxc = (detalles: any[] | null | undefined): string => {
  const meses: string[] = [];
  const torneos: string[] = [];

  (detalles || []).forEach(detalle => {
    const concepto = String(detalle?.catalogo_items?.nombre || '').toLowerCase();

    if (concepto.includes('mensualidad')) {
      (Array.isArray(detalle?.periodo_meses) ? detalle.periodo_meses : []).forEach((mes: string) => {
        const mesCorto = formatearMesCorto(mes);
        if (mesCorto && !meses.includes(mesCorto)) meses.push(mesCorto);
      });
      return;
    }

    if (concepto.includes('torneo')) {
      const torneo = String(detalle?.detalle_extra || '').trim();
      if (torneo && !torneos.includes(torneo)) torneos.push(torneo);
    }
  });

  return [...meses, ...torneos].join(', ');
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
    const referenciaCxc = obtenerReferenciaCxc(detallesCombinados);

    resultado.push({
      ...principal,
      id: `grupo-${grupo.map(mov => mov.id).join('-')}`,
      debe: grupo.reduce((total, mov) => total + mov.debe, 0),
      haber: grupo.reduce((total, mov) => total + mov.haber, 0),
      cuenta_nombre: conceptos.join(', ') || principal.cuenta_nombre,
      descripcion: detallesCombinados.length > 0 ? referenciaCxc : principal.descripcion,
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

export const useCxpEntidades = (escuelaId: string | null, filtros: any, habilitado = true) =>
  useQuery({
    queryKey: ['cxp-entidades', escuelaId, filtros],
    queryFn: () => fetchCxpEntidades(escuelaId!, filtros),
    enabled: habilitado && !!escuelaId,
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

export interface RangoFecha {
  desde: string;
  hasta: string;
  usarRpc: boolean;
}

export interface CursorMovimientos {
  dia: string;
  registro: string;
  id: string;
  origen: 'cobro' | 'pago';
  filtro: string;
}

interface GrupoMovimiento {
  ids: string[];
  origen: 'cobro' | 'pago';
  saldo_historico: string;
}

export interface MovimientosResult {
  movimientos: MovimientoFinanciero[];
  hayMas: boolean;
  cursorSiguiente: CursorMovimientos | null;
}

const fetchMovimientos = async (
  escuelaId: string, cajaId: string, rango: RangoFecha | null,
  busqueda: string, cursor: CursorMovimientos | null, signal: AbortSignal
): Promise<MovimientosResult> => {
  const { data: pagina, error } = await supabase.rpc('rpc_listar_movimientos_caja', {
    p_caja_id: cajaId, p_desde: rango?.desde || null, p_hasta: rango?.hasta || null,
    p_busqueda: busqueda.trim() || null, p_cursor: cursor, p_limite: 50
  }).abortSignal(signal);
  if (error) throw error;
  const grupos: GrupoMovimiento[] = pagina?.grupos || [];
  const cobros: any[] = [];
  const pagos: any[] = [];
  // Enriquecer solo los identificadores de esta pagina, en lotes acotados.
  await Promise.all((['cobro', 'pago'] as const).map(async origen => {
    const ids = grupos.filter(g => g.origen === origen).flatMap(g => g.ids);
    for (let desde = 0; desde < ids.length; desde += 50) {
      const lote = ids.slice(desde, desde + 50);
      const { data, error: errorDetalle } = origen === 'cobro'
        ? await supabase.from('cobros_aplicados').select(`
      id, monto_aplicado, fecha, created_at, caja_id, documento_referencia, conciliado,
      cuentas_cobrar (
        id, descripcion, nro_recibo, es_anticipo, es_ingreso_directo, ciclo_inicio, ciclo_fin,
        alumnos ( nombres, apellidos, telefono_padre, telefono_madre, telefono_deportista, whatsapp_preferido ),
        cxc_detalle (
          id,
          catalogo_item_id,
          periodo_meses,
          detalle_extra,
          ciclo_inicio,
          ciclo_fin,
          catalogo_items ( nombre )
        )
      )
    `)
            .eq('escuela_id', escuelaId).eq('caja_id', cajaId).in('id', lote).limit(50).abortSignal(signal)
        : await supabase.from('pagos_aplicados').select(`
      id, monto_aplicado, fecha, created_at, caja_id, referencia, conciliado,
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
            .eq('escuela_id', escuelaId).eq('caja_id', cajaId).in('id', lote).limit(50).abortSignal(signal);
      if (errorDetalle) throw errorDetalle;
      if (data?.length !== lote.length) throw new Error('Los movimientos cambiaron. Actualice el historial.');
      (origen === 'cobro' ? cobros : pagos).push(...(data || []));
    }
  }));
    const movsCaja: MovimientoFinanciero[] = [];

    // Mapear cobros
    cobros.forEach((c: any) => {
      const monto = Number(c.monto_aplicado) || 0;
      const items = c.cuentas_cobrar?.cxc_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
      const tieneDetalleCxc = (c.cuentas_cobrar?.cxc_detalle?.length || 0) > 0;
      const referenciaCxc = obtenerReferenciaCxc(c.cuentas_cobrar?.cxc_detalle);
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
        descripcion: tieneDetalleCxc ? referenciaCxc : c.cuentas_cobrar?.descripcion || 'Cobro / Ingreso',
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
    pagos.forEach((p: any) => {
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


  const porId = new Map(movsCaja.map(m => [m.tipo_origen + ':' + m.id, m]));
  const movimientos = grupos.map(grupo => {
    const miembros = grupo.ids.map(id => porId.get(grupo.origen + ':' + id));
    if (miembros.some(m => !m)) throw new Error('Los movimientos cambiaron. Actualice el historial.');
    const agrupados = agruparCobrosDeUnaTransaccion(miembros as MovimientoFinanciero[]);
    if (agrupados.length !== 1) throw new Error('La transaccion cambio. Actualice el historial.');
    return { ...agrupados[0], saldo_historico: Number(grupo.saldo_historico) };
  });
  return { movimientos, hayMas: pagina.hay_mas, cursorSiguiente: pagina.cursor_siguiente };
};

// Precios, cantidades y datos completos del recibo se obtienen al abrirlo.
export const cargarDetalleMovimiento = async (mov: MovimientoFinanciero): Promise<MovimientoFinanciero> => {
  if (mov.tipo_origen !== 'cobro') return mov;
  const ids = mov.original_ids || [mov.id];
  const detalles: any[] = [];
  let alumno = mov.alumno_raw;
  for (let desde = 0; desde < ids.length; desde += 50) {
    const { data, error } = await supabase.from('cobros_aplicados').select(`
      id, cuentas_cobrar (alumnos (nombres, apellidos, telefono_padre, telefono_madre, telefono_deportista, whatsapp_preferido),
        ciclo_inicio, ciclo_fin,
        cxc_detalle (id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario, periodo_meses, detalle_extra,
          ciclo_inicio, ciclo_fin, catalogo_items (nombre)))
    `).eq('caja_id', mov.cuenta_id).in('id', ids.slice(desde, desde + 50)).limit(50);
    if (error) throw error;
    if (data?.length !== ids.slice(desde, desde + 50).length) throw new Error('El recibo cambio. Actualice el historial.');
    for (const fila of (data || []) as any[]) {
      const cicloNotaInicio = fila.cuentas_cobrar?.ciclo_inicio || null;
      const cicloNotaFin = fila.cuentas_cobrar?.ciclo_fin || null;
      detalles.push(...(fila.cuentas_cobrar?.cxc_detalle || []).map((detalle: any) => ({
        ...detalle,
        ciclo_nota_inicio: cicloNotaInicio,
        ciclo_nota_fin: cicloNotaFin,
      })));
      const alumnoFila = Array.isArray(fila.cuentas_cobrar?.alumnos)
        ? fila.cuentas_cobrar?.alumnos[0]
        : fila.cuentas_cobrar?.alumnos;
      if (alumnoFila) {
        alumno = { ...(alumno || {}), ...alumnoFila };
      }
    }
  }
  return { ...mov, detalles_cxc: detalles, alumno_raw: alumno };
};

export const useCajasBancos = (escuelaId: string | null) =>
  useQuery({
    queryKey: ['cajas-bancos', escuelaId],
    queryFn: () => fetchCajasBancos(escuelaId!),
    enabled: !!escuelaId,
    staleTime: 1000 * 30, // 30 segundos de datos frescos
  });

export const useMovimientos = (
  alcance: AlcanceBusquedaCxc & { rol: string | null },
  cajaId: string | null, rango: RangoFecha | null, busqueda: string,
  cursor: CursorMovimientos | null, habilitado = true
) => useQuery({
  queryKey: ['movimientos-financieros', alcance.escuelaId, alcance, cajaId, rango, busqueda, cursor],
  queryFn: ({ signal }) => fetchMovimientos(alcance.escuelaId!, cajaId!, rango, busqueda, cursor, signal),
  enabled: habilitado && !!alcance.escuelaId && !!cajaId,
  staleTime: 30_000,
});
