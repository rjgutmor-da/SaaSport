import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabaseClient';

export const queryKeys = {
  cxc_resumen: ['cxc-resumen'] as const,
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
}

// --- Resúmenes (Fase 1: Cálculos en DB) ---

const fetchCxcResumen = async (escuelaId: string) => {
  const { data, error } = await supabase
    .from('v_cxc_resumen')
    .select('*')
    .eq('escuela_id', escuelaId)
    .single();
  if (error) throw error;
  return data;
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
    const q = `%${filtros.busqueda.trim()}%`;
    query = query.or(`nombres.ilike.${q},apellidos.ilike.${q}`);
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

export const useCxcResumen = (escuelaId: string | null) =>
  useQuery({
    queryKey: queryKeys.cxc_resumen,
    queryFn: () => fetchCxcResumen(escuelaId!),
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
    .order('nombre');
  if (error) throw error;
  return data;
};

const fetchMovimientos = async (escuelaId: string, cajaIds: string[]) => {
  if (!escuelaId || cajaIds.length === 0) return [];
  
  const [cobros, pagos] = await Promise.all([
    supabase.from('cobros_aplicados').select(`
      id, caja_id, monto_aplicado, fecha, conciliado, created_at,
      cuentas_cobrar (
        id, descripcion, nro_recibo,
        alumnos ( nombres, apellidos )
      )
    `).in('caja_id', cajaIds),
    supabase.from('pagos_aplicados').select(`
      id, caja_id, monto_aplicado, fecha, conciliado, created_at,
      cuentas_pagar (
        id, descripcion,
        proveedores ( nombre ),
        personal ( nombres, apellidos )
      )
    `).in('caja_id', cajaIds)
  ]);

  if (cobros.error) throw cobros.error;
  if (pagos.error) throw pagos.error;

  const movs: any[] = [];
  
  cobros.data.forEach((c: any) => {
    movs.push({
      id: c.id,
      tipo_origen: 'cobro',
      debe: Number(c.monto_aplicado) || 0,
      haber: 0,
      fecha: c.fecha || c.created_at,
      descripcion: c.cuentas_cobrar?.descripcion || 'Cobro / Ingreso',
      nro_transaccion: c.cuentas_cobrar?.nro_recibo || '',
      cliente: c.cuentas_cobrar?.alumnos ? `${c.cuentas_cobrar.alumnos.nombres} ${c.cuentas_cobrar.alumnos.apellidos}` : '—',
      cuenta_id: c.caja_id,
      conciliado: c.conciliado || false,
      cuenta_maestra_id: c.cuentas_cobrar?.id
    });
  });

  pagos.data.forEach((p: any) => {
    movs.push({
      id: p.id,
      tipo_origen: 'pago',
      debe: 0,
      haber: Number(p.monto_aplicado) || 0,
      fecha: p.fecha || p.created_at,
      descripcion: p.cuentas_pagar?.descripcion || 'Pago / Egreso',
      nro_transaccion: '',
      cliente: p.cuentas_pagar?.proveedores?.nombre || (p.cuentas_pagar?.personal ? `${p.cuentas_pagar.personal.nombres} ${p.cuentas_pagar.personal.apellidos}` : '—'),
      cuenta_id: p.caja_id,
      conciliado: p.conciliado || false,
      cuenta_maestra_id: p.cuentas_pagar?.id
    });
  });

  // Sort descending for UI (newest first)
  return movs.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());
};

export const useCajasBancos = (escuelaId: string | null) =>
  useQuery({
    queryKey: ['cajas-bancos', escuelaId],
    queryFn: () => fetchCajasBancos(escuelaId!),
    enabled: !!escuelaId,
    staleTime: 1000 * 60 * 5,
  });

export const useMovimientos = (escuelaId: string | null, cajaIds: string[]) =>
  useQuery({
    queryKey: ['movimientos-contables', escuelaId, cajaIds],
    queryFn: () => fetchMovimientos(escuelaId!, cajaIds),
    enabled: !!escuelaId && cajaIds.length > 0,
    staleTime: 1000 * 60 * 1,
  });
