/** Servicio de acceso a datos para el módulo de Alumnos en SaaSport. */
import { supabase } from '../lib/supabaseClient';
import type {
  AdvertenciaDuplicado,
  AlumnoListadoSaaSport,
  FiltrosAlumnosSaaSport,
  FormularioAlumnoDatos,
  NotaIngresoBorrador,
  RespuestaListadoAlumnosSaaSport,
} from '../types/alumnos';

export const MENSAJE_ERROR_VERIFICACION_DUPLICADO =
  'No pudimos verificar si el alumno ya existe. Intenta nuevamente.';

export const crearAdvertenciaDuplicado = (
  archivado = false,
  motivo: AdvertenciaDuplicado['motivo'] = null,
): AdvertenciaDuplicado => ({
  archivado: Boolean(archivado),
  motivo,
});

export const obtenerAdvertenciaDuplicadoDesdeError = (error: unknown): AdvertenciaDuplicado | null => {
  if (!error || typeof error !== 'object') return null;
  const errObj = error as { advertenciaDuplicado?: AdvertenciaDuplicado; message?: string; details?: string; hint?: string; code?: string };
  if (errObj.advertenciaDuplicado) return errObj.advertenciaDuplicado;

  const contenido = [errObj.message, errObj.details, errObj.hint]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const esDuplicado = errObj.code === '23505'
    && (
      contenido.includes('este alumno ya está registrado')
      || contenido.includes('registro archivado')
      || contenido.includes('coincide el nombre completo')
      || contenido.includes('coincide el carnet')
    );

  if (!esDuplicado) return null;

  return crearAdvertenciaDuplicado(
    contenido.includes('registro archivado'),
    contenido.includes('carnet') ? 'carnet' : 'nombre',
  );
};

export const formatearTelefonoWhatsApp = (telefono?: string | null): string | null => {
  if (!telefono) return null;
  const limpio = telefono.replace(/\D/g, '');
  if (!limpio) return null;
  return limpio.length === 8 ? `591${limpio}` : limpio;
};

const textoONulo = (valor?: string | null): string | null => {
  const limpio = (valor ?? '').trim();
  return limpio.length > 0 ? limpio : null;
};

export const verificarAlumnoDuplicado = async ({
  nombres,
  apellidos,
  carnetIdentidad,
  alumnoId = null,
}: {
  nombres: string;
  apellidos: string;
  carnetIdentidad?: string | null;
  alumnoId?: string | null;
}): Promise<{ duplicado: boolean; archivado: boolean; motivo: AdvertenciaDuplicado['motivo'] }> => {
  const { data, error } = await supabase.rpc('rpc_verificar_alumno_duplicado', {
    p_nombres: nombres.trim(),
    p_apellidos: apellidos.trim(),
    p_carnet_identidad: textoONulo(carnetIdentidad),
    p_alumno_id: alumnoId,
  });

  if (error) {
    console.error('Error al verificar alumno duplicado:', error);
    throw new Error(MENSAJE_ERROR_VERIFICACION_DUPLICADO);
  }

  return (data as { duplicado: boolean; archivado: boolean; motivo: AdvertenciaDuplicado['motivo'] }) || {
    duplicado: false,
    archivado: false,
    motivo: null,
  };
};

export const listarAlumnosSaaSport = async (
  filtros: FiltrosAlumnosSaaSport,
  signal?: AbortSignal,
): Promise<RespuestaListadoAlumnosSaaSport> => {
  const payload = {
    estado: filtros.estado,
    busqueda: filtros.busqueda.trim(),
    sucursal_id: filtros.sucursalId || null,
    grupo_id: filtros.grupoId || null,
    sub: filtros.sub ? Number(filtros.sub) : null,
    pagina: filtros.pagina || 1,
    limite: filtros.limite || 30,
  };

  let query = supabase.rpc('rpc_listar_alumnos_saasport', {
    p_filtros: payload,
  });

  if (signal) {
    query = query.abortSignal(signal);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message || 'No se pudo obtener el listado de alumnos.');
  }

  return (data as RespuestaListadoAlumnosSaaSport) || {
    items: [],
    total_resultados: 0,
    pagina: payload.pagina,
    limite: payload.limite,
    resumen: { total_activos: 0, total_archivados: 0 },
    facetas: { subs: [] },
  };
};

export const obtenerBorradorIngresoAlumno = async (
  alumnoId: string,
): Promise<NotaIngresoBorrador | null> => {
  const { data: ingreso, error: ingresoError } = await supabase
    .from('mensualidades_ingreso')
    .select('cuenta_id')
    .eq('alumno_id', alumnoId)
    .maybeSingle();

  if (ingresoError || !ingreso?.cuenta_id) {
    return null;
  }

  const { data: nota, error: notaError } = await supabase
    .from('cuentas_cobrar')
    .select('id, alumno_id, sucursal_id, fecha_emision, fecha_vencimiento, ciclo_inicio, ciclo_fin, observaciones, es_anticipo, estado')
    .eq('id', ingreso.cuenta_id)
    .eq('estado', 'borrador')
    .maybeSingle();

  if (notaError || !nota) {
    return null;
  }

  return nota as NotaIngresoBorrador;
};

const validarDatosAlumno = (datos: FormularioAlumnoDatos): void => {
  if (!datos.nombres.trim() || !datos.apellidos.trim() || !datos.fecha_nacimiento) {
    throw new Error('Completa los campos obligatorios: Nombres, Apellidos y Fecha de Nacimiento.');
  }
  if (!datos.nombre_padre.trim() && !datos.nombre_madre.trim()) {
    throw new Error('Debe registrar al menos un representante legal (Padre o Madre con su nombre).');
  }
};

const construirCargaAlumno = (datos: FormularioAlumnoDatos) => {
  const grupoId = textoONulo(datos.cancha_id);
  const mensualidadTexto = datos.mensualidad.trim();
  const mensualidadNum = mensualidadTexto === '' ? null : Number(mensualidadTexto);

  if (mensualidadNum !== null && (Number.isNaN(mensualidadNum) || mensualidadNum < 0)) {
    throw new Error('La mensualidad debe ser un monto mayor o igual a cero.');
  }

  return {
    nombres: datos.nombres.trim().replace(/\s+/g, ' '),
    apellidos: datos.apellidos.trim().replace(/\s+/g, ' '),
    fecha_nacimiento: datos.fecha_nacimiento,
    carnet_identidad: textoONulo(datos.carnet_identidad),
    nombre_padre: textoONulo(datos.nombre_padre),
    telefono_padre: formatearTelefonoWhatsApp(datos.telefono_padre),
    nombre_madre: textoONulo(datos.nombre_madre),
    telefono_madre: formatearTelefonoWhatsApp(datos.telefono_madre),
    whatsapp_preferido: datos.whatsapp_preferido || 'padre',
    colegio: textoONulo(datos.colegio),
    direccion: textoONulo(datos.direccion),
    sucursal_id: textoONulo(datos.sucursal_id),
    cancha_id: grupoId,
    grupo_id: grupoId,
    mensualidad: mensualidadNum,
    observaciones: textoONulo(datos.observaciones.slice(0, 30)),
  };
};

const lanzarErrorAlumno = (error: { message?: string; code?: string; details?: string; hint?: string }): never => {
  const advertencia = obtenerAdvertenciaDuplicadoDesdeError(error);
  if (advertencia) {
    const errDuplicado = Object.assign(
      new Error(
        advertencia.archivado
          ? 'Este alumno tiene un registro archivado.'
          : 'Este alumno ya está registrado.',
      ),
      { advertenciaDuplicado: advertencia },
    );
    throw errDuplicado;
  }
  throw new Error(error.message || 'No se pudo guardar el alumno. Intenta nuevamente.');
};

export const crearAlumnoSaaSport = async (
  datos: FormularioAlumnoDatos,
  contexto: { escuelaId: string; usuarioId: string },
): Promise<{ alumno: AlumnoListadoSaaSport; notaIngreso: NotaIngresoBorrador | null }> => {
  validarDatosAlumno(datos);
  const carga = construirCargaAlumno(datos);

  const { data: alumno, error } = await supabase
    .from('alumnos')
    .insert([{
      ...carga,
      es_arquero: false,
      estado: 'Pendiente',
      tipo: 'Formativo',
      escuela_id: contexto.escuelaId,
      created_by: contexto.usuarioId,
    }])
    .select('*')
    .single();

  if (error || !alumno) {
    lanzarErrorAlumno(error || {});
  }

  const tieneMensualidadPositiva = Number(carga.mensualidad ?? 0) > 0;
  const notaIngreso = tieneMensualidadPositiva
    ? await obtenerBorradorIngresoAlumno(alumno.id)
    : null;

  return {
    alumno: alumno as AlumnoListadoSaaSport,
    notaIngreso,
  };
};

export const actualizarAlumnoSaaSport = async (
  alumnoId: string,
  datos: FormularioAlumnoDatos,
): Promise<AlumnoListadoSaaSport> => {
  validarDatosAlumno(datos);
  const carga = construirCargaAlumno(datos);

  const { data: alumno, error } = await supabase
    .from('alumnos')
    .update(carga)
    .eq('id', alumnoId)
    .select('*')
    .single();

  if (error || !alumno) {
    lanzarErrorAlumno(error || {});
  }

  return alumno as AlumnoListadoSaaSport;
};

export const archivarAlumnoSaaSport = async (
  alumnoId: string,
): Promise<{ archivado: boolean; borradores_eliminados: number }> => {
  const { data, error } = await supabase.rpc('rpc_archivar_alumno_saasport', {
    p_alumno_id: alumnoId,
  });

  if (error) {
    throw new Error(error.message || 'No se pudo archivar el alumno.');
  }

  return (data as { archivado: boolean; borradores_eliminados: number }) || {
    archivado: true,
    borradores_eliminados: 0,
  };
};

export const restaurarAlumnoSaaSport = async (
  alumnoId: string,
): Promise<{ alumno: AlumnoListadoSaaSport; notaIngreso: NotaIngresoBorrador | null }> => {
  const { data: alumno, error } = await supabase
    .from('alumnos')
    .update({
      archivado: false,
      archivado_at: null,
      archivado_por: null,
    })
    .eq('id', alumnoId)
    .select('*')
    .single();

  if (error || !alumno) {
    throw new Error(error?.message || 'No se pudo restaurar el alumno.');
  }

  const tieneMensualidadPositiva = Number((alumno as { mensualidad?: number | null }).mensualidad ?? 0) > 0;
  const notaIngreso = tieneMensualidadPositiva
    ? await obtenerBorradorIngresoAlumno(alumno.id)
    : null;

  return {
    alumno: alumno as AlumnoListadoSaaSport,
    notaIngreso,
  };
};
