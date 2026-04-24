/**
 * tipos/cxc.ts
 * Interfaces TypeScript para el módulo de Cuentas por Cobrar.
 * Incluye tipos para catálogo de ítems, detalle de notas y vista agrupada.
 */

/** Ítem del catálogo (re-exportado desde cuentas para evitar duplicados) */
export type { CatalogoItem } from './cuentas';

/** Línea de detalle de una Nota de Servicios */
export interface CxcDetalle {
  id: string;
  escuela_id: string;
  cuenta_cobrar_id: string;
  catalogo_item_id: string;
  cantidad: number;
  precio_unitario: number;
  periodo_meses: string[] | null; // Meses seleccionados (ej: ["Ene-2026","Feb-2026"])
  detalle_extra: string | null;  // Nombre de torneo o periodo custom
  subtotal: number;
  created_at: string;

  // Campos enriquecidos (join con catalogo_items)
  item_nombre?: string;
  item_tipo?: string;
}

/** Línea temporal para el formulario de Nota de Servicios */
export interface LineaNota {
  catalogo_item_id: string;
  nombre: string;
  tipo: 'producto' | 'servicio';
  cantidad: number;
  precio_unitario: number;
  costo_unitario?: number;
  periodo_meses: string[];
  detalle_personalizado?: string; // Para torneos o periodos específicos
  subtotal: number;
  cuenta_ingreso_id?: string | null;
}


/** Registro de cuenta por cobrar con datos calculados de la vista */
export interface CuentaCobrar {
  id: string;
  escuela_id: string;
  sucursal_id: string | null;
  alumno_id: string | null;
  cuenta_contable_id: string;
  comprobante_id: string | null;
  venta_id: string | null;
  monto_total: number;
  periodo: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  descripcion: string | null;
  observaciones: string | null;
  estado: 'pendiente' | 'parcial' | 'pagada' | 'vencida';
  // Campos de control de edición
  editado: boolean;
  editado_por: string | null;
  editado_at: string | null;
  anulada: boolean;
  anulada_por: string | null;
  anulada_at: string | null;
  created_at: string;
  updated_at: string;
  // Campos calculados de la vista v_cuentas_cobrar
  total_cobrado: number;
  saldo_pendiente: number;
  alumno_nombres: string | null;
  alumno_apellidos: string | null;
  nombre_padre: string | null;
  telefono_padre: string | null;
  nombre_madre: string | null;
  telefono_madre: string | null;
  whatsapp_preferido: string | null;
  alumno_sucursal_id: string | null;
  alumno_cancha_id: string | null;
  alumno_horario_id: string | null;
  alumno_entrenador_id: string | null;
  sucursal_nombre: string | null;
  cancha_nombre: string | null;
  horario_hora: string | null;
  entrenador_nombre: string | null;
}

/** Alumno con resumen de deuda (vista v_alumnos_deuda) */
export interface AlumnoDeuda {
  alumno_id: string;
  escuela_id: string;
  nombres: string;
  apellidos: string;
  sucursal_id: string | null;
  cancha_id: string | null;
  horario_id: string | null;
  entrenador_id: string | null;
  nombre_padre: string | null;
  telefono_padre: string | null;
  nombre_madre: string | null;
  telefono_madre: string | null;
  whatsapp_preferido: string | null;
  sucursal_nombre: string | null;
  cancha_nombre: string | null;
  horario_hora: string | null;
  entrenador_nombre: string | null;
  total_deuda: number;
  total_cobrado: number;
  saldo_pendiente: number;
  cxc_pendientes: number;
  cxc_total: number;
  asistencias_actual: number;   // Nuevos campos
  asistencias_anterior: number;
  meses_permanencia_inicial?: number; // Datos legados
  ingresos_iniciales?: number;
  fecha_inicio?: string;
  fecha_nacimiento?: string | null;
  sub?: number;
  // Campos centralizados
  total_ingresos_historico?: number;
  cantidad_meses_actividad?: number;
  fecha_inicio_consolidada?: string;
}

/** Colores y etiquetas por estado */
export const ESTADOS_CXC: Record<CuentaCobrar['estado'], { color: string; bg: string; label: string }> = {
  pendiente: { color: '#facc15', bg: 'rgba(250,204,21,0.1)', label: 'Pendiente' },
  parcial:   { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)',  label: 'Parcial' },
  pagada:    { color: '#4ade80', bg: 'rgba(74,222,128,0.1)',  label: 'Pagada' },
  vencida:   { color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Vencida' },
};

/** Meses del año para selector de mensualidades */
export const MESES_ANIO = [
  'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
  'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
];
