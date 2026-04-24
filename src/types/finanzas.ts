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

/** Fila de la tabla `cajas_bancos` */
export interface CajaBanco {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  nombre: string;
  responsable: string | null;
  tipo: 'caja_chica' | 'cuenta_bancaria';
  activo: boolean;
  saldo_actual: number;
  created_at: string;
}

/** Fila de la tabla `sucursales` */
export interface Sucursal {
  id: string;
  nombre: string;
  direccion: string | null;
  escuela_id: string | null;
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
  es_conciliado?: boolean; // Note: using conciliado since we added the column
  conciliado: boolean;
  created_at: string;
  // Relación expandida (join)
  cuenta?: CuentaContable;
}

// ==========================================
// Colores por tipo de cuenta (UI)
// ==========================================
export const COLORES_TIPO: Record<TipoCuenta, { bg: string; texto: string; borde: string }> = {
  activo:     { bg: 'rgba(0, 210, 106, 0.1)', texto: '#00D26A', borde: '#00D26A' },
  pasivo:     { bg: 'rgba(255, 107, 53, 0.1)', texto: '#FF6B35', borde: '#FF6B35' },
  patrimonio: { bg: 'rgba(10, 132, 255, 0.1)', texto: '#0A84FF', borde: '#0A84FF' },
  ingreso:    { bg: 'rgba(0, 210, 106, 0.1)', texto: '#00D26A', borde: '#00D26A' },
  gasto:      { bg: 'rgba(255, 107, 53, 0.1)', texto: '#FF6B35', borde: '#FF6B35' },
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
