import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarRange, CheckCircle, ChevronLeft, Lock, RefreshCw, Save, ShieldAlert } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../lib/authHelper';
import { getUsuarios } from '../../services/usuarios';
import type { Usuario } from '../../services/usuarios';
import { getSucursales } from '../../services/sucursales';
import {
  activarGestion,
  crearGestionSiguiente,
  getEntrenadoresGruposGestion,
  getAlumnosGruposGestion,
  getGestionesDeportivas,
  getGruposGestion,
  guardarPlanificacionGestion,
  type EntrenadorGrupo,
  type AlumnoGrupo,
  type GestionDeportiva,
  type GrupoGestion,
} from '../../services/gestionesDeportivas';

const GestionAnual: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId, perfil, escuela } = useAuthSaaSport();
  const [gestiones, setGestiones] = useState<GestionDeportiva[]>([]);
  const [grupos, setGrupos] = useState<GrupoGestion[]>([]);
  const [asignaciones, setAsignaciones] = useState<EntrenadorGrupo[]>([]);
  const [alumnos, setAlumnos] = useState<AlumnoGrupo[]>([]);
  const [entrenadores, setEntrenadores] = useState<Usuario[]>([]);
  const [sucursales, setSucursales] = useState<Array<{ id: string; nombre: string }>>([]);
  const [gestionId, setGestionId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const esSuperAdmin = perfil?.rol === 'SuperAdministrador';
  const gestion = useMemo(() => gestiones.find(item => item.id === gestionId) || null, [gestiones, gestionId]);
  const assignmentByGroup = useMemo(
    () => new Map(asignaciones.map(item => [item.grupo_gestion_id, item.entrenador_id])),
    [asignaciones],
  );
  const puedeCrear = useMemo(() => {
    const zonaHoraria = escuela?.zona_horaria || 'America/La_Paz';
    const mesLocal = new Intl.DateTimeFormat('es-BO', { timeZone: zonaHoraria, month: 'numeric' }).format(new Date());
    return Number.parseInt(mesLocal, 10) === 12;
  }, [escuela?.zona_horaria]);

  const mensajeError = (error: unknown, fallback: string) => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }
    return fallback;
  };

  const cargar = useCallback(async () => {
    if (!escuelaId || !perfil) return;
    setLoading(true);
    try {
      const [gestionData, usuariosData, sucursalesData] = await Promise.all([
        getGestionesDeportivas(escuelaId),
        getUsuarios(escuelaId, perfil),
        getSucursales(escuelaId),
      ]);
      setGestiones(gestionData);
      setEntrenadores(usuariosData.filter(user => user.rol === 'Entrenador' && user.activo));
      setSucursales(sucursalesData.map(item => ({ id: item.id, nombre: item.nombre })));
      const seleccion = gestionId && gestionData.some(item => item.id === gestionId)
        ? gestionId
        : gestionData.find(item => item.estado === 'planificacion')?.id || gestionData.find(item => item.estado === 'activa')?.id || '';
      setGestionId(seleccion);
      if (seleccion) {
        const [grupoData, asignacionData, alumnoData] = await Promise.all([
          getGruposGestion(seleccion),
          getEntrenadoresGruposGestion(seleccion),
          getAlumnosGruposGestion(seleccion),
        ]);
        setGrupos(grupoData);
        setAsignaciones(asignacionData);
        setAlumnos(alumnoData);
      } else {
        setGrupos([]);
        setAsignaciones([]);
        setAlumnos([]);
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: mensajeError(error, 'No se pudo cargar la gestión anual.') });
    } finally {
      setLoading(false);
    }
  }, [escuelaId, perfil, gestionId]);

  useEffect(() => { void cargar(); }, [cargar]);

  const seleccionarGestion = async (id: string) => {
    setGestionId(id);
    setMessage(null);
    if (!id) {
      setGrupos([]);
      setAsignaciones([]);
      setAlumnos([]);
      return;
    }
    try {
      const [grupoData, asignacionData, alumnoData] = await Promise.all([
        getGruposGestion(id),
        getEntrenadoresGruposGestion(id),
        getAlumnosGruposGestion(id),
      ]);
      setGrupos(grupoData);
      setAsignaciones(asignacionData);
      setAlumnos(alumnoData);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: mensajeError(error, 'No se pudo cargar el detalle de la gestión.') });
    }
  };

  const nombreSucursal = (sucursalId: string | null) => {
    if (!sucursalId) return 'Todas';
    return sucursales.find(item => item.id === sucursalId)?.nombre || 'Sucursal no encontrada';
  };

  const crear = async () => {
    setCreating(true);
    setMessage(null);
    try {
      const resultado = await crearGestionSiguiente();
      setMessage({ type: 'success', text: `Gestión ${resultado.anio} creada con ${resultado.grupos_copiados} grupo(s) copiado(s).` });
      await cargar();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: mensajeError(error, 'No se pudo crear la próxima gestión.') });
    } finally {
      setCreating(false);
    }
  };

  const guardar = async () => {
    if (!gestion || gestion.estado !== 'planificacion') return;
    setSaving(true);
    setMessage(null);
    try {
      await guardarPlanificacionGestion(gestion.id, {
        entrenadores: grupos
          .map(group => ({ grupo_gestion_id: group.id, entrenador_id: assignmentByGroup.get(group.id) || '' }))
          .filter(item => item.entrenador_id),
        alumnos: alumnos.map(item => ({
          alumno_id: item.alumno_id,
          grupo_gestion_id: item.grupo_gestion_id,
          decision: item.decision,
        })),
      });
      setMessage({ type: 'success', text: 'Asignaciones guardadas correctamente.' });
      await cargar();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: mensajeError(error, 'No se pudo guardar la planificación.') });
    } finally {
      setSaving(false);
    }
  };

  const activar = async () => {
    if (!gestion || gestion.estado !== 'planificacion') return;
    if (!window.confirm(`¿Activar la gestión ${gestion.anio}? Esta operación cerrará la gestión actual.`)) return;
    setSaving(true);
    setMessage(null);
    try {
      const resultado = await activarGestion(gestion.id);
      setMessage({ type: 'success', text: `Gestión activada: ${resultado.alumnos_migrados} alumno(s) migrado(s) y ${resultado.alumnos_no_continuan} marcado(s) como no continúa.` });
      await cargar();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: mensajeError(error, 'No se pudo activar la gestión.') });
    } finally {
      setSaving(false);
    }
  };

  if (!esSuperAdmin) {
    return <main className="main-content"><div className="pc-header"><h1 className="pc-titulo"><ShieldAlert size={28} /> Acceso restringido</h1></div><p>Solo un SuperAdministrador puede gestionar las asignaciones anuales.</p></main>;
  }

  return (
    <main className="main-content">
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/panel-escuela')} title="Volver al Panel"><ChevronLeft size={20} /></button>
          <div>
            <h1 className="pc-titulo"><CalendarRange size={28} style={{ marginRight: '0.5rem', color: 'var(--primary)' }} /> Gestión anual</h1>
            <p className="pc-subtitulo">Planifica grupos y profesores sin alterar el historial vigente.</p>
          </div>
        </div>
        <div className="pc-header-acciones" style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-volver" onClick={() => void cargar()} title="Actualizar"><RefreshCw size={18} /></button>
          {puedeCrear && !gestiones.some(item => item.estado === 'planificacion') && (
            <button className="btn-nueva-cuenta" onClick={() => void crear()} disabled={creating}>{creating ? 'Creando...' : 'Preparar próxima gestión'}</button>
          )}
        </div>
      </div>

      {message && <div style={{ marginBottom: '1rem', padding: '0.8rem 1rem', borderRadius: 'var(--radius-md)', border: `1px solid ${message.type === 'success' ? 'var(--success)' : 'var(--danger)'}`, color: message.type === 'success' ? 'var(--success)' : 'var(--danger)', background: message.type === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)' }}>{message.text}</div>}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
        <label className="form-campo"><span>Gestión</span><select value={gestionId} onChange={event => void seleccionarGestion(event.target.value)} disabled={loading} style={{ maxWidth: '360px', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px' }}><option value="">Selecciona una gestión</option>{gestiones.map(item => <option key={item.id} value={item.id}>{item.anio} · {item.estado}</option>)}</select></label>
        {gestion?.estado === 'planificacion' && <p style={{ margin: '0.75rem 0 0', color: 'var(--text-secondary)', fontSize: '0.88rem' }}>Los cambios están en borrador. La gestión activa no se modifica hasta pulsar “Activar gestión”.</p>}
        {gestion?.estado === 'activa' && <p style={{ margin: '0.75rem 0 0', color: 'var(--success)', fontSize: '0.88rem' }}><CheckCircle size={15} style={{ verticalAlign: 'middle' }} /> Gestión vigente</p>}
      </div>

      {loading ? <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>Cargando gestión...</div> : !gestion ? <div style={{ padding: '2rem', color: 'var(--text-secondary)' }}>No hay gestiones disponibles.</div> : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ padding: '1rem' }}>Grupo</th><th style={{ padding: '1rem' }}>Sucursal</th><th style={{ padding: '1rem' }}>Horario</th><th style={{ padding: '1rem' }}>Profesor principal</th></tr></thead>
            <tbody>{grupos.map(group => <tr key={group.id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>{group.nombre_snapshot}</td><td style={{ padding: '0.85rem 1rem' }}>{nombreSucursal(group.sucursal_id)}</td><td style={{ padding: '0.85rem 1rem' }}>{group.hora_snapshot || 'Sin horario'}</td><td style={{ padding: '0.85rem 1rem' }}>{gestion.estado === 'planificacion' ? <select value={assignmentByGroup.get(group.id) || ''} onChange={event => setAsignaciones(previous => { const next = previous.filter(item => item.grupo_gestion_id !== group.id); return event.target.value ? [...next, { id: `draft-${group.id}`, escuela_id: group.escuela_id, entrenador_id: event.target.value, grupo_gestion_id: group.id, gestion_id: group.gestion_id, estado: 'planificada', vigente_desde: null, vigente_hasta: null, motivo: 'planificacion_manual' }] : next; })} style={{ width: '100%', minWidth: '220px', padding: '0.5rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}><option value="">Selecciona profesor</option>{entrenadores.map(user => <option key={user.id} value={user.id}>{user.nombres} {user.apellidos}</option>)}</select> : <span>{entrenadores.find(user => user.id === assignmentByGroup.get(group.id))?.nombres || 'Sin asignar'}</span>}</td></tr>)}</tbody>
          </table>
          {gestion.estado === 'planificacion' && <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem' }}><button className="btn-volver" onClick={() => void guardar()} disabled={saving}><Save size={17} /> Guardar</button><button className="btn-nueva-cuenta" onClick={() => void activar()} disabled={saving}><Lock size={17} /> Activar gestión</button></div>}
        </div>
      )}

      {gestion?.estado === 'planificacion' && alumnos.length > 0 && (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', marginTop: '1.25rem' }}>
          <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border)' }}><h2 style={{ margin: 0, fontSize: '1.05rem' }}>Migración de alumnos</h2><p style={{ margin: '0.35rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Cada alumno debe migrar o marcarse como “No continúa” antes de activar.</p></div>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr style={{ borderBottom: '1px solid var(--border)' }}><th style={{ padding: '0.85rem 1rem' }}>Alumno</th><th style={{ padding: '0.85rem 1rem' }}>Destino</th><th style={{ padding: '0.85rem 1rem' }}>Decisión</th></tr></thead><tbody>{alumnos.map(item => <tr key={item.id} style={{ borderBottom: '1px solid var(--border)' }}><td style={{ padding: '0.75rem 1rem' }}>{item.alumno ? `${item.alumno.apellidos} ${item.alumno.nombres}` : item.alumno_id}</td><td style={{ padding: '0.75rem 1rem' }}><select disabled={item.decision === 'no_continua'} value={item.grupo_gestion_id} onChange={event => setAlumnos(previous => previous.map(row => row.id === item.id ? { ...row, grupo_gestion_id: event.target.value } : row))} style={{ width: '100%', minWidth: '220px', padding: '0.45rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}>{grupos.map(group => <option key={group.id} value={group.id}>{group.nombre_snapshot} · {group.hora_snapshot || 'Sin horario'}</option>)}</select></td><td style={{ padding: '0.75rem 1rem' }}><select value={item.decision} onChange={event => setAlumnos(previous => previous.map(row => row.id === item.id ? { ...row, decision: event.target.value as AlumnoGrupo['decision'] } : row))} style={{ padding: '0.45rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}><option value="migrara">Migrará</option><option value="no_continua">No continúa</option><option value="pendiente">Pendiente</option></select></td></tr>)}</tbody></table>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', padding: '1rem' }}><button className="btn-volver" onClick={() => void guardar()} disabled={saving}><Save size={17} /> Guardar decisiones</button></div>
        </div>
      )}
    </main>
  );
};

export default GestionAnual;
