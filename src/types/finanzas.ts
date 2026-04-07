/**
 * Tipos TypeScript para el Módulo de Finanzas de SaaSport.
 * Corresponden a las tablas creadas en supabase/migrations/20260327_finanzas_schema.sql
 */

// ==========================================
// Plan de Cuentas
// ==========================================

/** Tipos de cuenta contable válidos en la base de datos */
export type TipoCuenta = 'activo' | 'pasivo' | 'patrimonio' | 'ingreso' | 'gasto';

/** Fila de la tabla `plan_cuentas` */
export interface CuentaContable {
  id: string;
  escuela_id: string | null;
  codigo: string;
  nombre: string;
  tipo: TipoCuenta;
  es_transaccional: boolean;
  created_at: string;
}

/** Nodo del árbol jerárquico (agrega hijos calculados en frontend) */
export interface NodoCuenta extends CuentaContable {
  hijos: NodoCuenta[];
  nivel: number;
  expandido: boolean;
}

// ==========================================
// Asientos y Movimientos Contables
// ==========================================

/** Métodos de pago admitidos */
export type MetodoPago = 'efectivo' | 'transferencia' | 'qr';

/** Fila de la tabla `asientos_contables` */
export interface AsientoContable {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  usuario_id: string | null;
  fecha: string;
  descripcion: string;
  metodo_pago: MetodoPago;
  created_at: string;
}

/** Fila de la tabla `movimientos_contables` */
export interface MovimientoContable {
  id: string;
  escuela_id: string;
  asiento_id: string;
  cuenta_contable_id: string;
  debe: number;
  haber: number;
  created_at: string;
  // Relación expandida (join)
  cuenta?: CuentaContable;
}

// ==========================================
// Colores por tipo de cuenta (UI)
// ==========================================
export const COLORES_TIPO: Record<TipoCuenta, { bg: string; texto: string; borde: string }> = {
  activo:     { bg: '#0d3b26', texto: '#4ade80', borde: '#16a34a' },
  pasivo:     { bg: '#3b1c0d', texto: '#fb923c', borde: '#ea580c' },
  patrimonio: { bg: '#1c1c3b', texto: '#a78bfa', borde: '#7c3aed' },
  ingreso:    { bg: '#0d2d3b', texto: '#38bdf8', borde: '#0284c7' },
  gasto:      { bg: '#3b0d1c', texto: '#f472b6', borde: '#db2777' },
};

// ==========================================
// Etiquetas legibles para la UI (español)
// ==========================================
export const ETIQUETAS_TIPO: Record<TipoCuenta, string> = {
  activo: 'Activo',
  pasivo: 'Pasivo',
  patrimonio: 'Patrimonio',
  ingreso: 'Ingreso',
  gasto: 'Egreso / Gasto',
};
