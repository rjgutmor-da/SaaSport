/** Tipos del sistema de planes, servicios adicionales y cupos por escuela. */

export type ProductoPlan = 'saasport_lite' | 'saasport' | 'asisport' | 'combo';
export type TramoPlan = 'basico' | 'crecimiento' | 'profesional' | 'completa';

export interface PlanContratadoInfo {
  id: string;
  producto: ProductoPlan;
  tramo: TramoPlan;
  nombre_producto: string;
  nombre_tramo: string;
  precio_mensual_usd: number;
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
    alumnos: DetalleCupo;
    usuarios: DetalleCupo;
    sucursales: DetalleCupo;
  };
  resumen_escuela: ResumenEscuelaPlan;
}
