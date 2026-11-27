/** Tipos del sistema de planes, servicios adicionales, cupos y bloqueos manuales por escuela. */

export type ProductoPlan = 'saasport_lite' | 'saasport' | 'asisport' | 'combo';
export type TramoPlan = 'basico' | 'crecimiento' | 'profesional' | 'completa';

export interface PlanContratadoInfo {
  id: string;
  producto: ProductoPlan;
  tramo: TramoPlan;
  nombre_producto: string;
  nombre_tramo: string;
  precio_mensual_usd: number;
  dia_pago?: number | null;
  monto_contratado_usd?: number | null;
  monto_correspondiente_usd?: number | null;
  incluye_saasport_lite: boolean;
  incluye_saasport_full: boolean;
  incluye_asisport: boolean;
}

export interface AddonsPlanInfo {
  fotos_asistencia: boolean;
  perfil_medico: boolean;
  ficha_deportiva: boolean;
  cobranza_automatica: boolean;
  suscripcion_anual: boolean;
  usuarios_adicionales: number;
  alumnos_adicionales: number;
  sucursales_adicionales: number;
}

export interface DetalleCupo {
  usados: number;
  base: number;
  adicionales: number;
  limite: number;
}

export interface DetalleCupoAlumnos extends DetalleCupo {
  margen_porcentaje?: number;
  limite_con_margen?: number;
  en_margen_gracia?: boolean;
}

export interface SiguientePlanInfo {
  id: string;
  nombre_producto: string;
  nombre_tramo: string;
  precio_mensual_usd: number;
  max_alumnos: number;
  max_usuarios: number;
  max_sucursales: number;
}

export interface RecomendacionPlan {
  tipo: 'usuarios_adicionales' | 'subir_plan' | 'plan_a_medida' | 'ajuste_tarifa';
  usuarios_faltantes: number;
  costo_usuarios_extra_usd: number;
  monto_correspondiente_usd?: number;
  mensaje: string;
}

export interface BloqueosManualesEscuela {
  bloquear_creacion_alumnos: boolean;
  bloquear_creacion_usuarios: boolean;
  bloquear_creacion_sucursales: boolean;
  motivo_bloqueo: string | null;
}

export interface AlertaPlanEscuela {
  requiere_atencion: boolean;
  en_margen_gracia_alumnos: boolean;
  excede_alumnos: boolean;
  excede_usuarios: boolean;
  excede_sucursales: boolean;
  siguiente_plan: SiguientePlanInfo | null;
  recomendacion: RecomendacionPlan | null;
}

export interface SucursalConteo {
  id: string;
  nombre: string;
  count: number;
}

export interface ResumenEscuelaPlan {
  entrenadores_activos: number;
  alumnos_por_sucursal: SucursalConteo[];
}

export interface EstadoPlanEscuela {
  plan: PlanContratadoInfo;
  addons: AddonsPlanInfo;
  cupos: {
    alumnos: DetalleCupoAlumnos;
    usuarios: DetalleCupo;
    sucursales: DetalleCupo;
  };
  bloqueos_manuales?: BloqueosManualesEscuela;
  alerta?: AlertaPlanEscuela;
  resumen_escuela: ResumenEscuelaPlan;
}
