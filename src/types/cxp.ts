/**
 * tipos/cxp.ts
 * Interfaces TypeScript para el módulo de Cuentas por Pagar.
 */

export interface EntidadCxP {
  id: string;
  tipo: 'proveedor' | 'personal';
  nombre: string;
  categoria: string;
  cargo?: string;
  telefono?: string;
  saldo_pendiente: number;
  notas_pendientes: number;
  fecha_mas_antigua: string | null;
}

export interface NotaResumenCxP {
  id: string;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  estado: string;
  monto_total: number;
  monto_pagado: number;
  deuda_restante: number;
  descripcion: string | null;
  tipo_gasto: string;
  proveedor_nombre?: string;
  personal_nombre?: string;
}
