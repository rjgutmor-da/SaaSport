/** Modal de creación y edición de alumno adaptado al plan de la escuela. */
import React, { useEffect, useMemo, useState } from 'react';
import { X, UserPlus, Edit2 } from 'lucide-react';
import AdvertenciaAlumnoDuplicado from './AdvertenciaAlumnoDuplicado';
import SelectorFotoAlumno from './SelectorFotoAlumno';
import { useAlumnoDuplicado } from '../../hooks/useAlumnoDuplicado';
import {
  actualizarAlumnoSaaSport,
  crearAlumnoSaaSport,
  obtenerAdvertenciaDuplicadoDesdeError,
} from '../../services/alumnos';
import type {
  AlumnoListadoSaaSport,
  FormularioAlumnoDatos,
  NotaIngresoBorrador,
  WhatsAppPreferido,
} from '../../types/alumnos';

export interface SucursalOpcion {
  id: string;
  nombre: string;
  escuela_id: string;
}

export interface GrupoOpcion {
  id: string;
  nombre: string;
  escuela_id: string;
  sucursal_id: string | null;
  activo?: boolean;
}

interface ModalFormularioAlumnoProps {
  visible: boolean;
  escuelaId: string;
  usuarioId: string;
  esSaaSportLite: boolean;
  incluyeAsisport: boolean;
  sucursales: SucursalOpcion[];
  grupos: GrupoOpcion[];
  sucursalBloqueadaId: string | null;
  alumnoEditar?: AlumnoListadoSaaSport | null;
  onCerrar: () => void;
  onGuardado: (resultado: {
    modo: 'crear' | 'editar';
    alumno: AlumnoListadoSaaSport;
    notaIngreso: NotaIngresoBorrador | null;
  }) => void;
}

const estadoInicialFormulario = (
  alumnoEditar: AlumnoListadoSaaSport | null | undefined,
  sucursalDefecto: string,
): FormularioAlumnoDatos => {
  if (alumnoEditar) {
    return {
      nombres: alumnoEditar.nombres || '',
      apellidos: alumnoEditar.apellidos || '',
      fecha_nacimiento: alumnoEditar.fecha_nacimiento || '',
      carnet_identidad: alumnoEditar.carnet_identidad || '',
      es_arquero: Boolean(alumnoEditar.es_arquero),
      nombre_padre: alumnoEditar.nombre_padre || '',
      telefono_padre: alumnoEditar.telefono_padre || '',
      nombre_madre: alumnoEditar.nombre_madre || '',
      telefono_madre: alumnoEditar.telefono_madre || '',
      whatsapp_preferido: alumnoEditar.whatsapp_preferido || 'padre',
      colegio: alumnoEditar.colegio || '',
      direccion: alumnoEditar.direccion || '',
      mensualidad:
        alumnoEditar.mensualidad !== null && alumnoEditar.mensualidad !== undefined
          ? String(alumnoEditar.mensualidad)
          : '',
      sucursal_id: alumnoEditar.sucursal_id || sucursalDefecto,
      cancha_id: alumnoEditar.cancha_id || '',
      observaciones: (alumnoEditar.observaciones || '').slice(0, 30),
    };
  }

  return {
    nombres: '',
    apellidos: '',
    fecha_nacimiento: '',
    carnet_identidad: '',
    es_arquero: false,
    nombre_padre: '',
    telefono_padre: '',
    nombre_madre: '',
    telefono_madre: '',
    whatsapp_preferido: 'padre',
    colegio: '',
    direccion: '',
    mensualidad: '',
    sucursal_id: sucursalDefecto,
    cancha_id: '',
    observaciones: '',
  };
};

const ModalFormularioAlumno: React.FC<ModalFormularioAlumnoProps> = ({
  visible,
  escuelaId,
  usuarioId,
  esSaaSportLite,
  incluyeAsisport,
  sucursales,
  grupos,
  sucursalBloqueadaId,
  alumnoEditar,
  onCerrar,
  onGuardado,
}) => {
  const esEdicion = Boolean(alumnoEditar);

  const sucursalesEscuela = useMemo(
    () => sucursales.filter(s => s.escuela_id === escuelaId),
    [sucursales, escuelaId],
  );

  const sucursalDefecto = useMemo(() => {
    if (sucursalBloqueadaId) return sucursalBloqueadaId;
    if (sucursalesEscuela.length === 1) return sucursalesEscuela[0].id;
    return '';
  }, [sucursalBloqueadaId, sucursalesEscuela]);

  const mostrarSelectorSucursal = !sucursalBloqueadaId && sucursalesEscuela.length > 1;
  const mostrarCampoGrupo = !esSaaSportLite;
  const grupoObligatorio = mostrarCampoGrupo && incluyeAsisport;

  const [formData, setFormData] = useState<FormularioAlumnoDatos>(() =>
    estadoInicialFormulario(alumnoEditar, sucursalDefecto),
  );
  const [archivoFoto, setArchivoFoto] = useState<File | null>(null);
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({});
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const {
    advertenciaDuplicado,
    errorVerificacionDuplicado,
    verificandoDuplicado,
    verificarAhora: verificarDuplicadoAhora,
    mostrarAdvertenciaDesdeResultado,
    limpiarValidacionDuplicado,
  } = useAlumnoDuplicado({
    nombres: formData.nombres,
    apellidos: formData.apellidos,
    carnetIdentidad: formData.carnet_identidad,
    alumnoId: alumnoEditar?.id || null,
    enabled: visible,
  });

  useEffect(() => {
    if (!visible) return;
    setFormData(estadoInicialFormulario(alumnoEditar, sucursalDefecto));
    setArchivoFoto(null);
    setErroresCampo({});
    setErrorGeneral(null);
    limpiarValidacionDuplicado();
  }, [visible, alumnoEditar, sucursalDefecto, limpiarValidacionDuplicado]);

  const gruposDisponibles = useMemo(() => {
    const activos = grupos.filter(g => g.escuela_id === escuelaId && g.activo !== false);
    if (!formData.sucursal_id) return activos;
    return activos.filter(g => !g.sucursal_id || g.sucursal_id === formData.sucursal_id);
  }, [grupos, escuelaId, formData.sucursal_id]);

  const actualizarCampo = (campo: keyof FormularioAlumnoDatos, valor: string | boolean) => {
    setErrorGeneral(null);
    if (campo === 'es_arquero') {
      setFormData(prev => ({ ...prev, es_arquero: Boolean(valor) }));
      return;
    }

    const texto = String(valor);
    if (campo === 'carnet_identidad') {
      const soloNumeros = texto.replace(/[^0-9]/g, '');
      setFormData(prev => ({ ...prev, carnet_identidad: soloNumeros }));
    } else if (campo === 'observaciones') {
      setFormData(prev => ({ ...prev, observaciones: texto.slice(0, 30) }));
    } else if (campo === 'sucursal_id') {
      setFormData(prev => {
        const grupoActual = grupos.find(g => g.id === prev.cancha_id);
        const mantenerGrupo = !grupoActual?.sucursal_id || grupoActual.sucursal_id === texto;
        return {
          ...prev,
          sucursal_id: texto,
          cancha_id: mantenerGrupo ? prev.cancha_id : '',
        };
      });
    } else if (campo === 'cancha_id') {
      const grupoSeleccionado = grupos.find(g => g.id === texto);
      setFormData(prev => ({
        ...prev,
        cancha_id: texto,
        sucursal_id:
          !sucursalBloqueadaId && grupoSeleccionado?.sucursal_id
            ? grupoSeleccionado.sucursal_id
            : prev.sucursal_id,
      }));
    } else {
      setFormData(prev => ({ ...prev, [campo]: texto }));
    }

    if (erroresCampo[campo]) {
      setErroresCampo(prev => {
        const copia = { ...prev };
        delete copia[campo];
        return copia;
      });
    }
    if ((campo === 'nombre_padre' || campo === 'nombre_madre') && erroresCampo.representante) {
      setErroresCampo(prev => {
        const copia = { ...prev };
        delete copia.representante;
        return copia;
      });
    }
  };

  const validarFormulario = (): boolean => {
    const nuevosErrores: Record<string, string> = {};

    if (!formData.nombres.trim()) {
      nuevosErrores.nombres = 'Ingresa los nombres del alumno.';
    }
    if (!formData.apellidos.trim()) {
      nuevosErrores.apellidos = 'Ingresa los apellidos del alumno.';
    }
    if (!formData.fecha_nacimiento) {
      nuevosErrores.fecha_nacimiento = 'Selecciona la fecha de nacimiento.';
    }
    if (!formData.nombre_padre.trim() && !formData.nombre_madre.trim()) {
      nuevosErrores.representante = 'Registra al menos un representante legal (Padre o Madre con su nombre).';
    }
    if (mostrarSelectorSucursal && !formData.sucursal_id) {
      nuevosErrores.sucursal_id = 'Selecciona una sucursal.';
    }
    if (grupoObligatorio && !formData.cancha_id) {
      nuevosErrores.cancha_id = 'Selecciona un grupo para el entrenamiento.';
    }
    if (formData.mensualidad.trim() !== '') {
      const monto = Number(formData.mensualidad);
      if (Number.isNaN(monto) || monto < 0) {
        nuevosErrores.mensualidad = 'La mensualidad debe ser mayor o igual a 0.';
      }
    }

    setErroresCampo(nuevosErrores);
    return Object.keys(nuevosErrores).length === 0;
  };

  const manejarEnvio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardando) return;

    setErrorGeneral(null);
    if (!validarFormulario()) return;

    setGuardando(true);
    try {
      const resultadoDup = await verificarDuplicadoAhora();
      if (resultadoDup.duplicado) {
        setErrorGeneral(
          resultadoDup.archivado
            ? 'Este alumno ya existe en los registros archivados. Restáuralo desde la pestaña Archivados.'
            : 'Ya existe un alumno activo con el mismo nombre completo o carnet.',
        );
        return;
      }

      const datosNormalizados: FormularioAlumnoDatos = {
        ...formData,
        sucursal_id: formData.sucursal_id || sucursalDefecto,
        cancha_id: mostrarCampoGrupo ? formData.cancha_id : '',
        es_arquero: incluyeAsisport ? formData.es_arquero : false,
      };

      const fotoEnviar = incluyeAsisport ? archivoFoto : null;

      if (esEdicion && alumnoEditar) {
        const actualizado = await actualizarAlumnoSaaSport(
          alumnoEditar.id,
          datosNormalizados,
          fotoEnviar,
        );
        onGuardado({ modo: 'editar', alumno: actualizado, notaIngreso: null });
      } else {
        const { alumno, notaIngreso } = await crearAlumnoSaaSport(
          datosNormalizados,
          { escuelaId, usuarioId },
          fotoEnviar,
        );
        onGuardado({ modo: 'crear', alumno, notaIngreso });
      }
    } catch (err: unknown) {
      const advertencia = obtenerAdvertenciaDuplicadoDesdeError(err);
      if (advertencia) {
        mostrarAdvertenciaDesdeResultado(advertencia);
      }
      const mensaje = err instanceof Error ? err.message : 'No se pudo guardar el alumno.';
      setErrorGeneral(mensaje);
    } finally {
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={() => !guardando && onCerrar()}>
      <div className="cxc-modal alumno-form-modal" onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            {esEdicion ? <Edit2 size={20} /> : <UserPlus size={20} />}
            {esEdicion ? 'Editar Alumno' : 'Nuevo Alumno'}
          </h2>
          <button type="button" onClick={onCerrar} disabled={guardando} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={manejarEnvio} className="cxc-modal-form alumno-form-cuerpo">
          {/* 1. Datos del Alumno */}
          <section className="alumno-form-seccion">
            <h3 className="alumno-form-subtitulo">Datos del Alumno</h3>
            <div className="modal-form-grid">
              <div className="form-campo">
                <label>Nombres *</label>
                <input
                  type="text"
                  value={formData.nombres}
                  onChange={e => actualizarCampo('nombres', e.target.value)}
                  placeholder="Ej: Juan Carlos"
                  disabled={guardando}
                  autoFocus
                />
                {erroresCampo.nombres && <span className="alumno-campo-error">{erroresCampo.nombres}</span>}
              </div>

              <div className="form-campo">
                <label>Apellidos *</label>
                <input
                  type="text"
                  value={formData.apellidos}
                  onChange={e => actualizarCampo('apellidos', e.target.value)}
                  placeholder="Ej: Pérez Gómez"
                  disabled={guardando}
                />
                {erroresCampo.apellidos && <span className="alumno-campo-error">{erroresCampo.apellidos}</span>}
              </div>

              <div className="form-campo full-width" style={{ margin: 0 }}>
                <AdvertenciaAlumnoDuplicado
                  advertencia={advertenciaDuplicado}
                  error={errorVerificacionDuplicado}
                  verificando={verificandoDuplicado}
                />
              </div>

              <div className="form-campo">
                <label>Fecha de Nacimiento *</label>
                <input
                  type="date"
                  value={formData.fecha_nacimiento}
                  onChange={e => actualizarCampo('fecha_nacimiento', e.target.value)}
                  disabled={guardando}
                />
                {erroresCampo.fecha_nacimiento && (
                  <span className="alumno-campo-error">{erroresCampo.fecha_nacimiento}</span>
                )}
              </div>

              <div className="form-campo">
                <label>Carnet de Identidad (Opcional)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formData.carnet_identidad}
                  onChange={e => actualizarCampo('carnet_identidad', e.target.value)}
                  placeholder="Solo números"
                  disabled={guardando}
                />
              </div>

              {incluyeAsisport && (
                <div className="form-campo full-width">
                  <label className="alumno-checkbox-arquero">
                    <input
                      type="checkbox"
                      checked={formData.es_arquero}
                      onChange={e => actualizarCampo('es_arquero', e.target.checked)}
                      disabled={guardando}
                    />
                    <span>Es Arquero (visible para Entrenador de Arqueros en AsiSport)</span>
                  </label>
                </div>
              )}
            </div>
          </section>

          {/* 2. Representantes Legales */}
          <section className="alumno-form-seccion">
            <h3 className="alumno-form-subtitulo">Representantes Legales</h3>
            {erroresCampo.representante && (
              <div className="login-error" style={{ margin: 0 }}>
                <span>{erroresCampo.representante}</span>
              </div>
            )}

            <div className="modal-form-grid">
              <div className="form-campo">
                <label>Nombre del Padre</label>
                <input
                  type="text"
                  value={formData.nombre_padre}
                  onChange={e => actualizarCampo('nombre_padre', e.target.value)}
                  placeholder="Nombre completo"
                  disabled={guardando}
                />
              </div>

              <div className="form-campo">
                <label>Teléfono Padre</label>
                <input
                  type="tel"
                  value={formData.telefono_padre}
                  onChange={e => actualizarCampo('telefono_padre', e.target.value)}
                  placeholder="Ej: 70012345"
                  disabled={guardando}
                />
              </div>

              <div className="form-campo">
                <label>Nombre de la Madre</label>
                <input
                  type="text"
                  value={formData.nombre_madre}
                  onChange={e => actualizarCampo('nombre_madre', e.target.value)}
                  placeholder="Nombre completo"
                  disabled={guardando}
                />
              </div>

              <div className="form-campo">
                <label>Teléfono Madre</label>
                <input
                  type="tel"
                  value={formData.telefono_madre}
                  onChange={e => actualizarCampo('telefono_madre', e.target.value)}
                  placeholder="Ej: 70012345"
                  disabled={guardando}
                />
              </div>

              <div className="form-campo full-width">
                <label>Primer contacto (WhatsApp preferido)</label>
                <div className="alumno-radios-contacto">
                  {(['padre', 'madre'] as WhatsAppPreferido[]).map(opcion => (
                    <label key={opcion} className="alumno-radio-opcion">
                      <input
                        type="radio"
                        name="whatsapp_preferido"
                        value={opcion}
                        checked={formData.whatsapp_preferido === opcion}
                        onChange={() => actualizarCampo('whatsapp_preferido', opcion)}
                        disabled={guardando}
                      />
                      <span>{opcion === 'padre' ? 'Padre' : 'Madre'}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-campo">
                <label>Colegio (Opcional)</label>
                <input
                  type="text"
                  value={formData.colegio}
                  onChange={e => actualizarCampo('colegio', e.target.value)}
                  placeholder="Nombre del colegio"
                  disabled={guardando}
                />
              </div>

              <div className="form-campo">
                <label>Dirección del Domicilio (Opcional)</label>
                <input
                  type="text"
                  value={formData.direccion}
                  onChange={e => actualizarCampo('direccion', e.target.value)}
                  placeholder="Ej: Av. Principal #123"
                  disabled={guardando}
                />
              </div>
            </div>
          </section>

          {/* 3. Información Interna */}
          <section className="alumno-form-seccion">
            <h3 className="alumno-form-subtitulo">Información Interna</h3>
            <div className="modal-form-grid">
              <div className="form-campo">
                <label>Mensualidad</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={formData.mensualidad}
                  onChange={e => actualizarCampo('mensualidad', e.target.value)}
                  placeholder="0 o en blanco para becado"
                  disabled={guardando}
                />
                {erroresCampo.mensualidad && (
                  <span className="alumno-campo-error">{erroresCampo.mensualidad}</span>
                )}
              </div>

              {mostrarSelectorSucursal && (
                <div className="form-campo">
                  <label>Sucursal *</label>
                  <select
                    value={formData.sucursal_id}
                    onChange={e => actualizarCampo('sucursal_id', e.target.value)}
                    disabled={guardando}
                  >
                    <option value="">Selecciona una sucursal</option>
                    {sucursalesEscuela.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                  {erroresCampo.sucursal_id && (
                    <span className="alumno-campo-error">{erroresCampo.sucursal_id}</span>
                  )}
                </div>
              )}

              {mostrarCampoGrupo && (
                <div className="form-campo">
                  <label>{grupoObligatorio ? 'Grupo *' : 'Grupo (Opcional)'}</label>
                  <select
                    value={formData.cancha_id}
                    onChange={e => actualizarCampo('cancha_id', e.target.value)}
                    disabled={guardando}
                  >
                    <option value="">{grupoObligatorio ? 'Selecciona un grupo' : 'Sin grupo asignado'}</option>
                    {gruposDisponibles.map(g => (
                      <option key={g.id} value={g.id}>{g.nombre}</option>
                    ))}
                  </select>
                  {erroresCampo.cancha_id && (
                    <span className="alumno-campo-error">{erroresCampo.cancha_id}</span>
                  )}
                </div>
              )}

              <div className={`form-campo ${!mostrarSelectorSucursal && !mostrarCampoGrupo ? '' : 'full-width'}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ marginBottom: '0.5rem' }}>Observaciones para Ficha Financiera</label>
                  <span className="alumno-obs-contador">{formData.observaciones.length}/30</span>
                </div>
                <input
                  type="text"
                  maxLength={30}
                  value={formData.observaciones}
                  onChange={e => actualizarCampo('observaciones', e.target.value)}
                  placeholder="Ej: Beca 50%, hermano..."
                  disabled={guardando}
                />
              </div>

              {incluyeAsisport && (
                <div className="form-campo full-width">
                  <label>Foto del Alumno (Opcional)</label>
                  <SelectorFotoAlumno
                    fotoUrlActual={alumnoEditar?.foto_url || null}
                    onChange={setArchivoFoto}
                    disabled={guardando}
                  />
                </div>
              )}
            </div>
          </section>

          {errorGeneral && (
            <div className="login-error" style={{ margin: 0 }}>
              <span>{errorGeneral}</span>
            </div>
          )}

          <div className="alumno-form-pie">
            <button
              type="button"
              className="btn-refrescar"
              onClick={onCerrar}
              disabled={guardando}
              style={{ width: 'auto', padding: '0 1.25rem' }}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn-guardar-cuenta"
              disabled={guardando}
              style={{ width: 'auto', padding: '0 1.75rem' }}
            >
              {guardando ? 'Guardando...' : esEdicion ? 'Guardar Cambios' : 'Registrar Alumno'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ModalFormularioAlumno;
