import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';
import { formatearMesCorto, obtenerOrdenMes } from '../lib/dateUtils';

const normalizar = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Legacy key eliminada

export const queryKeys = {
  cxc_resumen: (filtros: any) => ['cxc-resumen', filtros] as const,
  cxp_resumen: (filtros: any) => ['cxp-resumen', filtros] as const,
  cxc_alumnos: (filtros: any) => ['cxc-alumnos', filtros] as const,
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

const fetchCxcResumen = async (escuelaId: string, filtros: any) => {
  // Si no hay filtros relevantes, usamos la vista de resumen pre-calculada para mayor velocidad
  const tieneFiltros = filtros.sucursalId || filtros.entrenadorId || filtros.canchaId || filtros.horarioId || filtros.busqueda?.trim() || filtros.filtroEstadoAlumno;
  
  if (!tieneFiltros) {
    const { data, error } = await supabase
      .from('v_cxc_resumen')
      .select('*')
      .eq('escuela_id', escuelaId)
      .single();
    if (error) throw error;
    return data;
  }

  // Si hay filtros, calculamos el resumen dinámicamente desde v_alumnos_deuda
  let query = supabase
    .from('v_alumnos_deuda')
    .select('saldo_pendiente')
    .eq('escuela_id', escuelaId);

  if (filtros.sucursalId) query = query.eq('sucursal_id', filtros.sucursalId);
  if (filtros.entrenadorId) query = query.eq('entrenador_id', filtros.entrenadorId);
  if (filtros.canchaId) query = query.eq('cancha_id', filtros.canchaId);
  if (filtros.horarioId) query = query.eq('horario_id', filtros.horarioId);
  if (filtros.filtroEstadoAlumno) query = query.eq('archivado', filtros.filtroEstadoAlumno === 'archivados');
  
  if (filtros.busqueda?.trim()) {
    const q = `%${normalizar(filtros.busqueda)}%`;
    query = query.ilike('terminos_busqueda', q);
  }

  const { data, error } = await query;
  if (error) throw error;

  const totalAlumnos = data.length;
  const conDeuda = data.filter(a => Number(a.saldo_pendiente) > 0).length;
  const totalPendiente = data.reduce((acc, a) => acc + Number(a.saldo_pendiente), 0);

  return {
    total_alumnos: totalAlumnos,
    con_deuda: conDeuda,
    total_pendiente: totalPendiente
  };
};

const fetchCxpResumen = async (escuelaId: string, filtros?: any) => {
  const tieneFiltros = filtros && (filtros.categoria || filtros.antiguedad || filtros.busqueda?.trim());

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

  // Filtrado de antigüedad en memoria
  if (filtros.antiguedad) {
    const hoy = new Date();
    const limite = filtros.antiguedad === 'mas' ? 45 : parseInt(filtros.antiguedad);
    lista = lista.filter(e => {
      if (!e.fecha_mas_antigua) return false;
      const fecha = new Date(e.fecha_mas_antigua);
      const dias = Math.floor((hoy.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24));
      if (filtros.antiguedad === 'mas') return dias > 45;
      return dias <= limite && dias > 0;
    });
  }

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

const fetchCxcAlumnos = async (escuelaId: string, filtros: any) => {
  let query = supabase
    .from('v_alumnos_deuda')
    .select('*, fecha_nacimiento', { count: 'exact' })
    .eq('escuela_id', escuelaId);

  if (filtros.sucursalId) query = query.eq('sucursal_id', filtros.sucursalId);
  if (filtros.entrenadorId) query = query.eq('entrenador_id', filtros.entrenadorId);
  if (filtros.canchaId) query = query.eq('cancha_id', filtros.canchaId);
  if (filtros.horarioId) query = query.eq('horario_id', filtros.horarioId);
  if (filtros.soloConDeuda) query = query.gt('saldo_pendiente', 0);
  if (filtros.filtroEstadoAlumno) query = query.eq('archivado', filtros.filtroEstadoAlumno === 'archivados');
  
  if (filtros.busqueda?.trim()) {
    const q = `%${normalizar(filtros.busqueda)}%`;
    query = query.ilike('terminos_busqueda', q);
  }

  const desde = (filtros.pagina - 1) * filtros.itemsPorPagina;
  const hasta = desde + filtros.itemsPorPagina - 1;
  
  const { data, error, count } = await query
    .order('nombres', { ascending: true })
    .range(desde, hasta);

  if (error) throw error;

  const lista = data || [];
  const alumnoIds = lista.map((a: any) => a.alumno_id).filter(Boolean);

  if (alumnoIds.length === 0) return { data: lista, count };

  const { data: mensualidades, error: errMensualidades } = await supabase
    .from('cuentas_cobrar')
    .select(`
      alumno_id,
      fecha_emision,
      cxc_detalle (
        id,
        periodo_meses,
        catalogo_items!cxc_detalle_catalogo_item_id_fkey (nombre)
      )
    `)
    .eq('escuela_id', escuelaId)
    .eq('anulada', false)
    .in('alumno_id', alumnoIds);

  if (errMensualidades) throw errMensualidades;

  const ultimaPorAlumno: Record<string, { mes: string; fecha: string; orden: number }> = {};

  for (const nota of (mensualidades || []) as any[]) {
    const detallesMensualidad = (nota.cxc_detalle || []).filter((det: any) =>
      det.catalogo_items?.nombre?.toLowerCase().includes('mensualidad')
    );

    for (const det of detallesMensualidad) {
      const meses = Array.isArray(det.periodo_meses) ? det.periodo_meses : [];
      for (const mes of meses) {
        const orden = obtenerOrdenMes(mes);
        if (!orden) continue;

        const actual = ultimaPorAlumno[nota.alumno_id];
        const fecha = nota.fecha_emision || '';
        if (!actual || fecha > actual.fecha || (fecha === actual.fecha && orden > actual.orden)) {
          ultimaPorAlumno[nota.alumno_id] = { mes, fecha, orden };
        }
      }
    }
  }

  return {
    data: lista.map((alumno: any) => ({
      ...alumno,
      ultima_mensualidad: formatearMesCorto(
        ultimaPorAlumno[alumno.alumno_id]?.mes ?? alumno.ultima_mensualidad,
      ),
    })),
    count,
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

  // Filtrado de antigüedad en memoria (ya que calcularDias es complejo para SQL puro sin extensiones)
  if (filtros.antiguedad) {
    const hoy = new Date();
    const limite = filtros.antiguedad === 'mas' ? 45 : parseInt(filtros.antiguedad);
    lista = lista.filter(e => {
      if (!e.fecha_mas_antigua) return false;
      const fecha = new Date(e.fecha_mas_antigua);
      const dias = Math.floor((hoy.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24));
      if (filtros.antiguedad === 'mas') return dias > 45;
      return dias <= limite && dias > 0;
    });
  }

  // Ordenar: primero con saldo, después por nombre
  lista.sort((a: any, b: any) => {
    if (b.saldo_pendiente !== a.saldo_pendiente) return b.saldo_pendiente - a.saldo_pendiente;
    return a.nombre.localeCompare(b.nombre);
  });

  return lista;
};

// --- Hooks ---

export const useCxcResumen = (escuelaId: string | null, filtros: any) =>
  useQuery({
    queryKey: queryKeys.cxc_resumen(filtros),
    queryFn: () => fetchCxcResumen(escuelaId!, filtros),
    enabled: !!escuelaId,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });

export const useCxpResumen = (escuelaId: string | null, filtros: any) =>
  useQuery({
    queryKey: queryKeys.cxp_resumen(filtros),
    queryFn: () => fetchCxpResumen(escuelaId!, filtros),
    enabled: !!escuelaId,
    staleTime: 1000 * 60 * 5, // 5 minutos
  });

export const useCxcAlumnos = (escuelaId: string | null, filtros: any) =>
  useQuery({
    queryKey: queryKeys.cxc_alumnos(filtros),
    queryFn: () => fetchCxcAlumnos(escuelaId!, filtros),
    enabled: !!escuelaId,
    staleTime: 1000 * 60 * 2, // 2 minutos
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

  // Consultar de forma concurrente para cada caja
  await Promise.all(
    cajas.map(async (caja) => {
      let queryCobros = supabase.from('cobros_aplicados').select(`
        *,
        cuentas_cobrar (
          id, descripcion, nro_recibo, es_anticipo, ciclo_inicio, ciclo_fin,
          alumnos ( nombres, apellidos, telefono_padre, telefono_madre, whatsapp_preferido ),
          cxc_detalle (
            cantidad,
            precio_unitario,
            periodo_meses,
            detalle_extra,
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
      cobrosRes.data.forEach((c: any) => {
        const monto = Number(c.monto_aplicado) || 0;
        movsCaja.push({
          id: c.id,
          tipo_origen: 'cobro',
          debe: monto > 0 ? monto : 0,
          haber: monto < 0 ? -monto : 0,
          fecha: c.fecha || c.created_at,
          created_at: c.created_at,
          descripcion: c.cuentas_cobrar?.descripcion || 'Cobro / Ingreso',
          nro_transaccion: c.documento_referencia || c.cuentas_cobrar?.nro_recibo || '',
          cliente: c.cuentas_cobrar?.alumnos ? `${c.cuentas_cobrar.alumnos.nombres} ${c.cuentas_cobrar.alumnos.apellidos}` : '—',
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
            const items = c.cuentas_cobrar?.cxc_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
            if (!items || items.length === 0) {
              return c.cuentas_cobrar?.descripcion || 'Concepto no especificado';
            }
            return Array.from(new Set(items)).join(', ');
          })(),
          conciliado: c.conciliado || false,
           cuenta_maestra_id: c.cuentas_cobrar?.id,
          alumno_raw: c.cuentas_cobrar?.alumnos || null,
          detalles_cxc: c.cuentas_cobrar?.cxc_detalle || [],
          ciclo_inicio: c.cuentas_cobrar?.ciclo_inicio || null,
          ciclo_fin: c.cuentas_cobrar?.ciclo_fin || null
        });
      });

      // Mapear pagos
      pagosRes.data.forEach((p: any) => {
        movsCaja.push({
          id: p.id,
          tipo_origen: 'pago',
          debe: 0,
          haber: Number(p.monto_aplicado) || 0,
          fecha: p.fecha || p.created_at,
          created_at: p.created_at,
          descripcion: p.cuentas_pagar?.descripcion || 'Pago / Egreso',
          nro_transaccion: p.referencia || '',
          cliente: p.cuentas_pagar?.proveedores?.nombre || (p.cuentas_pagar?.personal ? `${p.cuentas_pagar.personal.nombres} ${p.cuentas_pagar.personal.apellidos}` : '—'),
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
          cuenta_maestra_id: p.cuentas_pagar?.id
        });
      });

      // Ordenar descendente: primero por fecha (día), luego por timestamp de creación
      movsCaja.sort(compararMovimientosDesc);

      const movimientosAgrupados = agruparCobrosDeUnaTransaccion(movsCaja);
      movimientosAgrupados.sort(compararMovimientosDesc);

      // Evaluar si se excede el límite usando fila centinela
      const masDe200 = movsCaja.length > 200 || cobrosRes.data.length > 200 || pagosRes.data.length > 200;
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

      todosLosMovimientos.push(...sliceMovs);
    })
  );

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
    staleTime: 0, // Siempre verificar saldo fresco
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
    staleTime: 0, // Siempre verificar movimientos frescos
  });
