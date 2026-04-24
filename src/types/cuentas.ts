/**
 * tipos/inventarios.ts
 * Interfaces TypeScript para el módulo de Cuentas (ex-Inventarios).
 */

/** Ítem del catálogo (producto, servicio, gasto, otros) */
export interface CatalogoItem {
  id: string;
  escuela_id: string;
  nombre: string;
  tipo: 'producto' | 'servicio'; // Mantenido por compatibilidad legacy
  categoria: 'producto' | 'servicio' | 'gasto' | 'otro';
  tipo_movimiento: 'ingreso' | 'egreso' | 'ambos';
  precio_venta: number | null;
  costo_unitario?: number | null;
  cuenta_ingreso_id?: string | null;
  cuenta_gasto_id?: string | null;
  activo: boolean;
  created_at: string;
}

/** Stock de un producto */
export interface StockProducto {
  id: string;
  escuela_id: string;
  catalogo_item_id: string;
  cantidad_disponible: number;
  updated_at: string;
  // Join
  item_nombre?: string;
}

/** Movimiento de stock (entrada/salida) - se registra como log */
export interface MovimientoStock {
  id: string;
  escuela_id: string;
  catalogo_item_id: string;
  tipo: 'entrada' | 'salida';
  cantidad: number;
  motivo: string;
  created_at: string;
}
