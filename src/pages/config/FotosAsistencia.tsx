/**
 * FotosAsistencia.tsx — Visor de fotos grupales de asistencia en SaaSport.
 *
 * Solo accesible desde el Panel de Escuela en desktop (PC).
 * Permite al SuperAdministrador ver las fotos grupales tomadas por los entrenadores
 * como respaldo de las asistencias, con filtros por fecha, grupo y entrenador.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Camera, Calendar, Search, Filter,
  RefreshCw, Download, ZoomIn, X, ChevronLeft, ChevronRight, Lock
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';

// Escuelas con acceso habilitado a Fotos de Asistencia Grupal
const ESCUELAS_CON_FOTOS_ASISTENCIA = ['Fundación Inter Stars'];

interface FotoAsistencia {
  id: string;
  fecha: string;
  foto_url: string;
  created_at: string;
  grupo: { id: string; nombre: string } | null;
  horario: { id: string; hora: string } | null;
  entrenador: { nombres: string; apellidos: string; email: string } | null;
}

interface Grupo {
  id: string;
  nombre: string;
}

interface Horario {
  id: string;
  hora: string;
}

interface Entrenador {
  id: string;
  nombres: string;
  apellidos: string;
}

const FotosAsistencia: React.FC = () => {
  const navigate = useNavigate();

  // Control de acceso por escuela
  const [accesoVerificado, setAccesoVerificado] = useState(false);
  const [tieneAcceso, setTieneAcceso] = useState(false);

  // Filtros
  const [fechaDesde, setFechaDesde] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [fechaHasta, setFechaHasta] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [filtroGrupo, setFiltroGrupo] = useState('');
  const [filtroHorario, setFiltroHorario] = useState('');
  const [filtroEntrenador, setFiltroEntrenador] = useState('');

  // Datos
  const [fotos, setFotos] = useState<FotoAsistencia[]>([]);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [entrenadores, setEntrenadores] = useState<Entrenador[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [totalFotos, setTotalFotos] = useState(0);

  // Lightbox
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Cargar datos maestros (grupos, horarios, entrenadores) + verificar acceso
  useEffect(() => {
    const cargarMaestros = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: perfil } = await supabase
        .from('usuarios')
        .select('escuela_id, sucursal_id, rol')
        .eq('id', user.id)
        .single();

      if (!perfil) return;
      const escuelaId = perfil.escuela_id;

      // Verificar acceso por nombre de escuela
      const { data: escuelaData } = await supabase
        .from('escuelas')
        .select('nombre')
        .eq('id', escuelaId)
        .single();

      const acceso = escuelaData ? ESCUELAS_CON_FOTOS_ASISTENCIA.includes(escuelaData.nombre) : false;
      setTieneAcceso(acceso);
      setAccesoVerificado(true);

      if (!acceso) return; // No cargar más datos si no tiene acceso

      let gruposQuery = supabase.from('grupos').select('id, nombre').eq('escuela_id', escuelaId).order('nombre');
      let entrenadoresQuery = supabase.from('usuarios').select('id, nombres, apellidos')
        .eq('escuela_id', escuelaId).in('rol', ['Entrenador', 'Entrenarqueros']).eq('activo', true).order('apellidos');
      if (perfil.rol !== 'SuperAdministrador' && perfil.sucursal_id) {
        gruposQuery = gruposQuery.eq('sucursal_id', perfil.sucursal_id);
        entrenadoresQuery = entrenadoresQuery.eq('sucursal_id', perfil.sucursal_id);
      }

      const [
        { data: gruposData },
        { data: horariosData },
        { data: entrenadoresData },
      ] = await Promise.all([
        gruposQuery,
        supabase.from('horarios').select('id, hora').eq('escuela_id', escuelaId).order('hora'),
        entrenadoresQuery,
      ]);

      setGrupos(gruposData || []);
      setHorarios(horariosData || []);
      setEntrenadores(entrenadoresData || []);
    };
    cargarMaestros();
  }, []);

  // Cargar fotos con filtros
  const cargarFotos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión expirada.');

      const { data: perfil } = await supabase
        .from('usuarios')
        .select('escuela_id, sucursal_id, rol')
        .eq('id', user.id)
        .single();

      if (!perfil) throw new Error('No se encontró el perfil del usuario.');

      let query = supabase
        .from('fotos_asistencia_grupal')
        .select(`
          id,
          fecha,
          foto_url,
          created_at,
          grupo:grupos!inner(id, nombre, sucursal_id),
          horario:horarios(id, hora),
          entrenador:usuarios!fotos_asistencia_grupal_entrenador_id_fkey(nombres, apellidos, email)
        `)
        .eq('escuela_id', perfil.escuela_id)
        .gte('fecha', fechaDesde)
        .lte('fecha', fechaHasta)
        .order('fecha', { ascending: false })
        .order('created_at', { ascending: false });

      if (filtroGrupo) query = query.eq('grupo_id', filtroGrupo);
      if (perfil.rol !== 'SuperAdministrador' && perfil.sucursal_id) query = query.eq('grupo.sucursal_id', perfil.sucursal_id);
      if (filtroHorario) query = query.eq('horario_id', filtroHorario);
      if (filtroEntrenador) query = query.eq('entrenador_id', filtroEntrenador);

      const { data, error: queryError, count } = await query;

      if (queryError) throw new Error('Error al cargar fotos: ' + queryError.message);

      // Normalizar: Supabase devuelve array para FK joins
      const fotosNormalizadas = (data || []).map((f: any) => ({
        ...f,
        grupo: Array.isArray(f.grupo) ? f.grupo[0] || null : f.grupo,
        horario: Array.isArray(f.horario) ? f.horario[0] || null : f.horario,
        entrenador: Array.isArray(f.entrenador) ? f.entrenador[0] || null : f.entrenador,
      }));

      setFotos(fotosNormalizadas);
      setTotalFotos(count || fotosNormalizadas.length);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fechaDesde, fechaHasta, filtroGrupo, filtroHorario, filtroEntrenador]);

  // Cargar fotos solo si tiene acceso
  useEffect(() => {
    if (accesoVerificado && tieneAcceso) {
      cargarFotos();
    }
  }, [cargarFotos, accesoVerificado, tieneAcceso]);

  // Helpers
  const formatFecha = (fechaStr: string) => {
    const fecha = new Date(fechaStr + 'T12:00:00');
    return fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  };

  const formatHora = (fechaStr: string) => {
    return new Date(fechaStr).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  };

  const abrirLightbox = (index: number) => setLightboxIndex(index);
  const cerrarLightbox = () => setLightboxIndex(null);
  const anteriorFoto = () => setLightboxIndex(i => i !== null && i > 0 ? i - 1 : i);
  const siguienteFoto = () => setLightboxIndex(i => i !== null && i < fotos.length - 1 ? i + 1 : i);

  // Navegación con teclado en lightbox
  useEffect(() => {
    if (lightboxIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') anteriorFoto();
      if (e.key === 'ArrowRight') siguienteFoto();
      if (e.key === 'Escape') cerrarLightbox();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxIndex]);

  const limpiarFiltros = () => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    setFechaDesde(d.toISOString().split('T')[0]);
    setFechaHasta(new Date().toISOString().split('T')[0]);
    setFiltroGrupo('');
    setFiltroHorario('');
    setFiltroEntrenador('');
  };

  const hayFiltrosActivos = filtroGrupo || filtroHorario || filtroEntrenador;

  return (
    <main className="main-content">

      {/* ─── PANTALLA DE ACCESO DENEGADO ─── */}
      {accesoVerificado && !tieneAcceso && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '65vh',
          gap: '1.5rem',
          textAlign: 'center',
        }}>
          <div style={{
            background: 'rgba(168, 85, 247, 0.08)',
            border: '1px solid rgba(168, 85, 247, 0.2)',
            borderRadius: '50%',
            padding: '2rem',
            color: 'rgba(168, 85, 247, 0.5)',
          }}>
            <Lock size={52} />
          </div>
          <div>
            <h2 style={{ color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Acceso no disponible
            </h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '380px', lineHeight: 1.6 }}>
              La funcionalidad de <strong>Fotos de Asistencia Grupal</strong> no está habilitada
              en el plan de tu escuela. Contáctanos para activarla.
            </p>
          </div>
          <button
            onClick={() => navigate('/panel-escuela')}
            className="btn-volver"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', height: '40px', padding: '0 1.25rem' }}
          >
            <ArrowLeft size={16} />
            Volver al Panel de Escuela
          </button>
        </div>
      )}

      {/* ─── CONTENIDO PRINCIPAL (solo si tiene acceso) ─── */}
      {(!accesoVerificado || tieneAcceso) && (<>

      {/* ─── HEADER ─── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '2rem' }}>
        <button
          onClick={() => navigate('/panel-escuela')}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.5rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          title="Volver al Panel de Escuela"
        >
          <ArrowLeft size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
          <div style={{
            background: 'rgba(168, 85, 247, 0.15)',
            borderRadius: '10px',
            padding: '0.6rem',
            color: '#a855f7',
            display: 'flex',
          }}>
            <Camera size={24} />
          </div>
          <div>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
              Fotos de Asistencia Grupal
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
              Respaldo fotográfico de las listas de asistencia
            </p>
          </div>
        </div>

        <button
          onClick={cargarFotos}
          disabled={loading}
          style={{
            background: 'transparent',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            padding: '0.5rem 1rem',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.85rem',
            transition: 'all 0.2s',
          }}
          onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--primary)')}
          onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Actualizar
        </button>
      </div>

      {/* ─── PANEL DE FILTROS ─── */}
      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '1.25rem 1.5rem',
        marginBottom: '1.5rem',
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1rem',
        alignItems: 'flex-end',
      }}>
        {/* Icono de filtro */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', paddingBottom: '0.35rem' }}>
          <Filter size={16} />
          <span style={{ fontSize: '0.82rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Filtros</span>
        </div>

        {/* Fecha Desde */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '150px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            <Calendar size={12} style={{ display: 'inline', marginRight: '0.3rem' }} />
            Desde
          </label>
          <input
            type="date"
            value={fechaDesde}
            onChange={e => setFechaDesde(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              colorScheme: 'dark',
            }}
          />
        </div>

        {/* Fecha Hasta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '150px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
            <Calendar size={12} style={{ display: 'inline', marginRight: '0.3rem' }} />
            Hasta
          </label>
          <input
            type="date"
            value={fechaHasta}
            onChange={e => setFechaHasta(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
              colorScheme: 'dark',
            }}
          />
        </div>

        {/* Grupo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '160px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Grupo</label>
          <select
            value={filtroGrupo}
            onChange={e => setFiltroGrupo(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="">Todos los grupos</option>
            {grupos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </div>

        {/* Horario */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '150px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Horario</label>
          <select
            value={filtroHorario}
            onChange={e => setFiltroHorario(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="">Todos los horarios</option>
            {horarios.map(h => <option key={h.id} value={h.id}>{h.hora}</option>)}
          </select>
        </div>

        {/* Entrenador */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: '180px' }}>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Entrenador</label>
          <select
            value={filtroEntrenador}
            onChange={e => setFiltroEntrenador(e.target.value)}
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.75rem',
              color: 'var(--text-primary)',
              fontSize: '0.85rem',
            }}
          >
            <option value="">Todos los entrenadores</option>
            {entrenadores.map(e => <option key={e.id} value={e.id}>{e.apellidos} {e.nombres}</option>)}
          </select>
        </div>

        {/* Botón limpiar filtros */}
        {hayFiltrosActivos && (
          <button
            onClick={limpiarFiltros}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.5rem 0.9rem',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '0.82rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              alignSelf: 'flex-end',
            }}
          >
            <X size={14} />
            Limpiar
          </button>
        )}
      </div>

      {/* ─── CONTADOR ─── */}
      {!loading && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {fotos.length === 0
              ? 'No se encontraron fotos con los filtros aplicados'
              : `${fotos.length} foto${fotos.length !== 1 ? 's' : ''} encontrada${fotos.length !== 1 ? 's' : ''}`}
          </span>
          {hayFiltrosActivos && (
            <span style={{
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#a855f7',
              fontSize: '0.72rem',
              fontWeight: 600,
              padding: '0.2rem 0.6rem',
              borderRadius: '999px',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>
              Filtros activos
            </span>
          )}
        </div>
      )}

      {/* ─── ESTADOS ─── */}
      {loading && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '40vh', flexDirection: 'column', gap: '1rem' }}>
          <RefreshCw size={32} className="spin" style={{ color: 'var(--primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Cargando fotos...</p>
        </div>
      )}

      {error && (
        <div className="login-error" style={{ margin: '1rem 0' }}>
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && fotos.length === 0 && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '35vh',
          gap: '1rem',
          color: 'var(--text-tertiary)',
        }}>
          <div style={{
            background: 'rgba(168, 85, 247, 0.08)',
            borderRadius: '50%',
            padding: '1.5rem',
            color: 'rgba(168, 85, 247, 0.4)',
          }}>
            <Camera size={48} />
          </div>
          <p style={{ fontSize: '1rem', fontWeight: 600 }}>Sin fotos para el período seleccionado</p>
          <p style={{ fontSize: '0.85rem' }}>Ajusta los filtros o amplía el rango de fechas</p>
        </div>
      )}

      {/* ─── GRID DE FOTOS ─── */}
      {!loading && fotos.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          gap: '1.25rem',
        }}>
          {fotos.map((foto, index) => (
            <div
              key={foto.id}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                overflow: 'hidden',
                transition: 'all 0.2s',
                cursor: 'pointer',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLElement).style.borderColor = '#a855f7';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
                (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 24px rgba(168,85,247,0.15)';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(0)';
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
              }}
              onClick={() => abrirLightbox(index)}
            >
              {/* Imagen */}
              <div style={{ position: 'relative', aspectRatio: '16/9', overflow: 'hidden', background: '#0a0a0a' }}>
                <img
                  src={foto.foto_url}
                  alt={`Foto asistencia ${foto.fecha}`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s' }}
                  onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.04)')}
                  onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
                />
                {/* Overlay con icono de zoom */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background 0.2s',
                  color: 'white',
                  opacity: 0,
                }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.35)';
                    (e.currentTarget as HTMLElement).style.opacity = '1';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0)';
                    (e.currentTarget as HTMLElement).style.opacity = '0';
                  }}
                >
                  <ZoomIn size={36} />
                </div>
              </div>

              {/* Info */}
              <div style={{ padding: '1rem' }}>
                <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem', margin: 0, textTransform: 'capitalize' }}>
                  {formatFecha(foto.fecha)}
                </p>
                <div style={{ marginTop: '0.6rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                  {foto.grupo && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)', display: 'inline-block', flexShrink: 0 }} />
                      {foto.grupo.nombre}
                    </span>
                  )}
                  {foto.horario && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--secondary)', display: 'inline-block', flexShrink: 0 }} />
                      {foto.horario.hora}
                    </span>
                  )}
                  {foto.entrenador && (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#a855f7', display: 'inline-block', flexShrink: 0 }} />
                      {foto.entrenador.apellidos} {foto.entrenador.nombres}
                    </span>
                  )}
                </div>
                <div style={{
                  marginTop: '0.75rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)' }}>
                    Subida a las {formatHora(foto.created_at)}
                  </span>
                  <a
                    href={foto.foto_url}
                    download={`asistencia_${foto.fecha}.jpg`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      color: 'var(--text-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      fontSize: '0.72rem',
                      textDecoration: 'none',
                      transition: 'color 0.2s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#a855f7')}
                    onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                  >
                    <Download size={13} />
                    Descargar
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ─── LIGHTBOX ─── */}
      {lightboxIndex !== null && fotos[lightboxIndex] && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.92)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
          }}
          onClick={cerrarLightbox}
        >
          {/* Botón cerrar */}
          <button
            onClick={cerrarLightbox}
            style={{
              position: 'absolute',
              top: '1.5rem',
              right: '1.5rem',
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              borderRadius: '50%',
              width: '44px',
              height: '44px',
              color: 'white',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.2rem',
              transition: 'background 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
          >
            <X size={22} />
          </button>

          {/* Botón anterior */}
          {lightboxIndex > 0 && (
            <button
              onClick={e => { e.stopPropagation(); anteriorFoto(); }}
              style={{
                position: 'absolute',
                left: '1.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                width: '48px',
                height: '48px',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              <ChevronLeft size={26} />
            </button>
          )}

          {/* Imagen principal */}
          <div onClick={e => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', maxWidth: '90vw' }}>
            <img
              src={fotos[lightboxIndex].foto_url}
              alt={`Foto asistencia ${fotos[lightboxIndex].fecha}`}
              style={{
                maxWidth: '85vw',
                maxHeight: '75vh',
                objectFit: 'contain',
                borderRadius: '8px',
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
              }}
            />
            {/* Info en lightbox */}
            <div style={{
              background: 'rgba(255,255,255,0.07)',
              backdropFilter: 'blur(10px)',
              borderRadius: '8px',
              padding: '0.75rem 1.5rem',
              display: 'flex',
              gap: '1.5rem',
              alignItems: 'center',
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}>
              <span style={{ color: 'white', fontWeight: 700, fontSize: '0.9rem', textTransform: 'capitalize' }}>
                {formatFecha(fotos[lightboxIndex].fecha)}
              </span>
              {fotos[lightboxIndex].grupo && (
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
                  📍 {fotos[lightboxIndex].grupo!.nombre}
                </span>
              )}
              {fotos[lightboxIndex].horario && (
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
                  🕐 {fotos[lightboxIndex].horario!.hora}
                </span>
              )}
              {fotos[lightboxIndex].entrenador && (
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem' }}>
                  👤 {fotos[lightboxIndex].entrenador!.apellidos} {fotos[lightboxIndex].entrenador!.nombres}
                </span>
              )}
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.78rem' }}>
                {lightboxIndex + 1} / {fotos.length}
              </span>
              <a
                href={fotos[lightboxIndex].foto_url}
                download
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#a855f7', fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: '0.3rem', textDecoration: 'none' }}
              >
                <Download size={14} /> Descargar
              </a>
            </div>
          </div>

          {/* Botón siguiente */}
          {lightboxIndex < fotos.length - 1 && (
            <button
              onClick={e => { e.stopPropagation(); siguienteFoto(); }}
              style={{
                position: 'absolute',
                right: '1.5rem',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                borderRadius: '50%',
                width: '48px',
                height: '48px',
                color: 'white',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.1)')}
            >
              <ChevronRight size={26} />
            </button>
          )}
        </div>
      )}
      {/* Fin bloque acceso habilitado */}
      </>)}
    </main>
  );
};

export default FotosAsistencia;
