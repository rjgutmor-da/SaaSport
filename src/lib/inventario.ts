import { supabase } from './supabaseClient';

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
