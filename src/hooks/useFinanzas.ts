import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

const normalizar = (str: string) =>
  str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export const queryKeys = {
  cxc_resumen: (filtros: any) => ['cxc-resumen', filtros] as const,
  cxp_resumen: ['cxp-resumen'] as const,
  cxc_alumnos: (filtros: any) => ['cxc-alumnos', filtros] as const,
  cxp_entidades: (filtros: any) => ['cxp-entidades', filtros] as const,
};

export interface MovimientoFinanciero {
  id: string;
  tipo_origen: 'cobro' | 'pago';
  debe: number;
  haber: number;
  fecha: string;
  descripcion: string;
  nro_transaccion: string;
  cuenta_id: string;
  cuenta_nombre: string;
  conciliado: boolean;
  cliente?: string;
  saldo_historico?: number;
  cuenta_maestra_id?: string;
  asiento_id?: string | null;
}

// --- Resúmenes (Fase 1: Cálculos en DB) ---

const fetchCxcResumen = async (escuelaId: string, filtros: any) => {
  // Si no hay filtros relevantes, usamos la vista de resumen pre-calculada para mayor velocidad
  const tieneFiltros = filtros.sucursalId || filtros.entrenadorId || filtros.canchaId || filtros.horarioId || filtros.busqueda?.trim();
  
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

const fetchCxpResumen = async (escuelaId: string) => {
  const { data, error } = await supabase
    .from('v_cxp_resumen')
    .select('*')
    .eq('escuela_id', escuelaId)
    .single();
  if (error) throw error;
  return data;
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
  return { data, count };
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

export const useCxpResumen = (escuelaId: string | null) =>
  useQuery({
    queryKey: queryKeys.cxp_resumen,
    queryFn: () => fetchCxpResumen(escuelaId!),
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

const fetchMovimientos = async (escuelaId: string, cajaIds: string[]) => {
  if (!escuelaId || cajaIds.length === 0) return [];
  
  const [cobros, pagos] = await Promise.all([
    supabase.from('cobros_aplicados').select(`
      id, caja_id, monto_aplicado, fecha, conciliado, created_at, asiento_id, documento_referencia,
      cuentas_cobrar (
        id, descripcion, nro_recibo, es_anticipo,
        alumnos ( nombres, apellidos ),
        cxc_detalle (
          catalogo_items ( nombre )
        )
      )
    `).in('caja_id', cajaIds),
    supabase.from('pagos_aplicados').select(`
      id, caja_id, monto_aplicado, fecha, conciliado, created_at, asiento_id, referencia,
      cuentas_pagar (
        id, descripcion,
        proveedores ( nombre ),
        personal ( nombres, apellidos ),
        cxp_detalle (
          catalogo_items ( nombre )
        )
      )
    `).in('caja_id', cajaIds)
  ]);

  if (cobros.error) throw cobros.error;
  if (pagos.error) throw pagos.error;

  const movsAgrupados = new Map<string, any>();
  const movsFinales: any[] = [];

  const addMov = (mov: any) => {
    if (mov.asiento_id) {
      if (!movsAgrupados.has(mov.asiento_id)) {
        movsAgrupados.set(mov.asiento_id, {
          ...mov,
          descripcion: mov.tipo_origen === 'cobro' ? 'Cobro Consolidado de Deuda' : 'Pago Consolidado',
          debe: 0,
          haber: 0,
          cuenta_nombre_list: [],
          id: mov.asiento_id,
          is_grouped: true,
          original_ids: [],
          conciliados_count: 0,
          total_count: 0
        });
      }
      const g = movsAgrupados.get(mov.asiento_id);
      g.debe += mov.debe;
      g.haber += mov.haber;
      if (mov.cuenta_nombre && !g.cuenta_nombre_list.includes(mov.cuenta_nombre)) {
        g.cuenta_nombre_list.push(mov.cuenta_nombre);
      }
      g.original_ids.push(mov.id);
      g.total_count += 1;
      if (mov.conciliado) g.conciliados_count += 1;
      g.conciliado = g.conciliados_count === g.total_count;
      g.cuenta_nombre = g.cuenta_nombre_list.join(', ');
    } else {
      movsFinales.push(mov);
    }
  };

  cobros.data.forEach((c: any) => {
    addMov({
      id: c.id,
      tipo_origen: 'cobro',
      debe: Number(c.monto_aplicado) || 0,
      haber: 0,
      fecha: c.fecha || c.created_at,
      created_at: c.created_at,
      descripcion: c.cuentas_cobrar?.descripcion || 'Cobro / Ingreso',
      nro_transaccion: c.documento_referencia || c.cuentas_cobrar?.nro_recibo || '',
      cliente: c.cuentas_cobrar?.alumnos ? `${c.cuentas_cobrar.alumnos.nombres} ${c.cuentas_cobrar.alumnos.apellidos}` : '—',
      cuenta_id: c.caja_id,
      cuenta_nombre: (() => {
        const items = c.cuentas_cobrar?.cxc_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
        if (!items || items.length === 0) {
          if (c.cuentas_cobrar?.es_anticipo) return c.cuentas_cobrar?.descripcion || 'Anticipo';
          return c.cuentas_cobrar?.descripcion || 'Concepto no especificado';
        }
        return Array.from(new Set(items)).join(', ');
      })(),
      conciliado: c.conciliado || false,
      cuenta_maestra_id: c.cuentas_cobrar?.id,
      asiento_id: c.asiento_id
    });
  });

  pagos.data.forEach((p: any) => {
    addMov({
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
        const items = p.cuentas_pagar?.cxp_detalle?.map((d: any) => d.catalogo_items?.nombre).filter(Boolean);
        if (!items || items.length === 0) return 'Concepto no especificado';
        let res = Array.from(new Set(items)).join(', ');
        if (p.cuentas_pagar?.personal && res === 'ACF') return 'Sueldos y Salarios';
        return res;
      })(),
      conciliado: p.conciliado || false,
      cuenta_maestra_id: p.cuentas_pagar?.id,
      asiento_id: p.asiento_id
    });
  });

  movsFinales.push(...Array.from(movsAgrupados.values()));

  // Ordenar descendente: 1ero por Fecha (solo el día), 2do por fecha de creación real (para ordenar correctamente los ingresos del mismo día)
  return movsFinales.sort((a, b) => {
    const getJustDate = (f: string) => {
      if (!f) return 0;
      const match = f.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (match) {
        return new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10)).getTime();
      }
      return 0;
    };

    const dateB = getJustDate(b.fecha);
    const dateA = getJustDate(a.fecha);
    
    if (dateB !== dateA) return dateB - dateA;
    
    // Si la fecha es idéntica, el más recientemente registrado va arriba
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
};

export const useCajasBancos = (escuelaId: string | null) =>
  useQuery({
    queryKey: ['cajas-bancos', escuelaId],
    queryFn: () => fetchCajasBancos(escuelaId!),
    enabled: !!escuelaId,
    staleTime: 0, // Siempre verificar saldo fresco
  });

export const useMovimientos = (escuelaId: string | null, cajaIds: string[]) =>
  useQuery({
    queryKey: ['movimientos-contables', escuelaId, cajaIds],
    queryFn: () => fetchMovimientos(escuelaId!, cajaIds),
    enabled: !!escuelaId && cajaIds.length > 0,
    staleTime: 0, // Siempre verificar movimientos frescos
  });
