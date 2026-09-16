import { supabase } from './supabaseClient';

/** Suma saldos actuales por producto, paginando y conservando el alcance de RLS. */
export const obtenerInventarioConsolidado = async (
  escuelaId: string,
  signal?: AbortSignal,
): Promise<Record<string, number>> => {
  const totales: Record<string, number> = {};
  const lote = 500;
  for (let desde = 0; ; desde += lote) {
    let query = supabase.from('inventario_saldos')
      .select('catalogo_item_id,cantidad_disponible')
      .eq('escuela_id', escuelaId)
      .order('sucursal_id').order('catalogo_item_id')
      .range(desde, desde + lote - 1);
    if (signal) query = query.abortSignal(signal);
    const { data, error } = await query;
    if (error) throw error;
    for (const saldo of data ?? []) {
      totales[saldo.catalogo_item_id] = (totales[saldo.catalogo_item_id] ?? 0) + Number(saldo.cantidad_disponible);
    }
    if (!data || data.length < lote) return totales;
  }
};

/** Comprueba la apertura antes de crear una nota con productos. */
export const validarAperturaInventario = async (
  escuelaId: string,
  sucursalId: string | null | undefined,
  catalogoItemIds: string[],
): Promise<void> => {
  const ids = [...new Set(catalogoItemIds.filter(Boolean))];
  if (ids.length === 0) return;

  const { data: items, error: errorItems } = await supabase
    .from('catalogo_items')
    .select('id,categoria')
    .eq('escuela_id', escuelaId)
    .in('id', ids);
  if (errorItems) throw errorItems;
  if (!(items ?? []).some(item => item.categoria === 'producto')) return;
  if (!sucursalId) throw new Error('Selecciona una sucursal para registrar productos.');

  const { data: apertura, error: errorApertura } = await supabase
    .from('inventario_aperturas')
    .select('id')
    .eq('escuela_id', escuelaId)
    .eq('sucursal_id', sucursalId)
    .maybeSingle();
  if (errorApertura) throw errorApertura;
  if (!apertura) throw new Error('Confirma el conteo inicial de esta sucursal antes de registrar productos.');
};

/** Obtiene mapa de saldos disponibles por producto en una sucursal. */
export const obtenerSaldosPorSucursal = async (
  escuelaId: string,
  sucursalId: string | null | undefined,
): Promise<Map<string, number>> => {
  const mapa = new Map<string, number>();
  if (!escuelaId || !sucursalId) return mapa;

  const { data, error } = await supabase
    .from('inventario_saldos')
    .select('catalogo_item_id, cantidad_disponible')
    .eq('escuela_id', escuelaId)
    .eq('sucursal_id', sucursalId);

  if (error) {
    console.error('Error al obtener saldos de inventario:', error);
    return mapa;
  }

  (data ?? []).forEach(s => {
    mapa.set(s.catalogo_item_id, Number(s.cantidad_disponible));
  });

  return mapa;
};
