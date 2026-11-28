/** Tipos del módulo de registro, edición y archivo de alumnos en SaaSport. */

export type EstadoFiltroAlumnos = 'activos' | 'archivados';
export type WhatsAppPreferido = 'padre' | 'madre';

export interface AlumnoListadoSaaSport {
  id: string;
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  carnet_identidad: string | null;
  foto_url: string | null;
  es_arquero: boolean;
  sub: number | null;
  nombre_padre: string | null;
  telefono_padre: string | null;
  nombre_madre: string | null;
  telefono_madre: string | null;
  whatsapp_preferido: WhatsAppPreferido;
  colegio: string | null;
  direccion: string | null;
  mensualidad: number | null;
  sucursal_id: string | null;
  sucursal_nombre: string | null;
  cancha_id: string | null;
  grupo_nombre: string | null;
  observaciones: string | null;
  archivado: boolean;
  archivado_at: string | null;
  saldo_pendiente: number;
  borradores_pendientes: number;
}

export interface FiltrosAlumnosSaaSport {
  estado: EstadoFiltroAlumnos;
  busqueda: string;
  sucursalId: string;
  grupoId: string;
  sub: string;
  pagina: number;
  limite: number;
}

export interface RespuestaListadoAlumnosSaaSport {
  items: AlumnoListadoSaaSport[];
  total_resultados: number;
  pagina: number;
  limite: number;
  resumen: {
    total_activos: number;
    total_archivados: number;
  };
  facetas: {
    subs: number[];
  };
}

export interface FormularioAlumnoDatos {
  nombres: string;
  apellidos: string;
  fecha_nacimiento: string;
  carnet_identidad: string;
  es_arquero: boolean;
  nombre_padre: string;
  telefono_padre: string;
  nombre_madre: string;
  telefono_madre: string;
  whatsapp_preferido: WhatsAppPreferido;
  colegio: string;
  direccion: string;
  mensualidad: string;
  sucursal_id: string;
  cancha_id: string;
  observaciones: string;
}

export interface AdvertenciaDuplicado {
  archivado: boolean;
  motivo: 'nombre' | 'carnet' | 'nombre_y_carnet' | null;
}

export interface NotaIngresoBorrador {
  id: string;
  alumno_id: string;
  sucursal_id: string | null;
  fecha_emision: string;
  fecha_vencimiento: string | null;
  ciclo_inicio: string | null;
  ciclo_fin: string | null;
  observaciones: string | null;
  es_anticipo: boolean;
  estado: 'borrador';
}
