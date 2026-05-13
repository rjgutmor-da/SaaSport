/**
 * PanelEscuela.tsx — Panel central de la escuela en SaaSport.
 *
 * Accesible desde el sidebar principal (solo SuperAdministrador).
 * Muestra:
 *   - Hero card: nombre, logo/slogan dinámico e ID de la escuela
 *   - Estadísticas: alumnos activos, entrenadores, usuarios totales
 *   - Accesos rápidos: Sucursales, Usuarios, Canchas/Horarios (→ AsiSport)
 *                       Estadísticas Financieras (→ /estadisticas)
 *                       Auditoría (→ /configuraciones/auditoria)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  School, Users, UserCheck, GraduationCap,
  Building2, UserCog, MapPin, BarChart2, Shield,
  Activity, RefreshCw, ExternalLink
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { navegarAAsisport } from '../../lib/navegacion';
import LogoPlaneta from '../../assets/LogoPlaneta.png';

interface EscuelaInfo {
  id: string;
  nombre: string;
  zona_horaria: string | null;
  activa: boolean;
  logo_url?: string | null;
  slogan?: string | null;
}

interface Estadisticas {
  alumnosActivos: number;
  usuariosActivos: number;
  entrenadoresActivos: number;
}

const PanelEscuela: React.FC = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [escuela, setEscuela] = useState<EscuelaInfo | null>(null);
  const [stats, setStats] = useState<Estadisticas>({
    alumnosActivos: 0,
    usuariosActivos: 0,
    entrenadoresActivos: 0,
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    try {
      setLoading(true);
      setError(null);

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión expirada.');

      const { data: perfil, error: perfilError } = await supabase
        .from('usuarios')
        .select('escuela_id')
        .eq('id', user.id)
        .single();

      if (perfilError || !perfil) throw new Error('No se encontró el perfil del usuario.');
      const { escuela_id } = perfil;

      const [
        { data: escuelaData, error: escuelaError },
        { count: alumnosCount },
        { count: usuariosCount },
        { count: entrenadoresCount },
      ] = await Promise.all([
        supabase.from('escuelas').select('*').eq('id', escuela_id).single(),
        supabase.from('alumnos').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('archivado', false),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('activo', true),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('rol', 'Entrenador').eq('activo', true),
      ]);

      if (escuelaError) throw new Error('Error al cargar datos de la escuela.');

      setEscuela(escuelaData);
      setStats({
        alumnosActivos: alumnosCount ?? 0,
        usuariosActivos: usuariosCount ?? 0,
        entrenadoresActivos: entrenadoresCount ?? 0,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <main className="main-content">
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh', flexDirection: 'column', gap: '1rem' }}>
          <RefreshCw size={32} className="spin" style={{ color: 'var(--primary)' }} />
          <p style={{ color: 'var(--text-secondary)' }}>Cargando información de la escuela...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main-content">

      {/* ─── HERO DE ESCUELA ─── */}
      {escuela && (
        <div className="pe-hero">
          <div className="pe-hero-izq">
            <div className="pe-hero-icon">
              <School size={32} />
            </div>
            <div>
              <h1 className="pe-hero-nombre">{escuela.nombre}</h1>
              <p className="pe-hero-label">ID de Escuela</p>
              <p className="pe-hero-id">{escuela.id}</p>
              {escuela.zona_horaria && (
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                  🕐 {escuela.zona_horaria}
                </p>
              )}
            </div>
          </div>

          {/* Logo dinámico */}
          <div className="pe-hero-logo">
            {escuela.logo_url ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={escuela.logo_url}
                  alt={`Logo ${escuela.nombre}`}
                  className="pe-logo-img"
                />
                {escuela.slogan && (
                  <p className="pe-hero-slogan">"{escuela.slogan}"</p>
                )}
              </div>
            ) : (
              <img
                src={LogoPlaneta}
                alt="Logo Planeta FC"
                className="pe-logo-img"
              />
            )}
          </div>

          {/* Glow decorativo */}
          <div className="pe-hero-glow-1" />
          <div className="pe-hero-glow-2" />
        </div>
      )}

      {error && (
        <div className="login-error" style={{ margin: '1rem 0' }}>
          <span>{error}</span>
        </div>
      )}

      {/* ─── ESTADÍSTICAS RÁPIDAS ─── */}
      <div className="pe-stats-grid">
        <div className="pe-stat-card pe-stat-orange">
          <div className="pe-stat-icon">
            <GraduationCap size={32} />
          </div>
          <div>
            <p className="pe-stat-label">Alumnos Activos</p>
            <p className="pe-stat-valor">{stats.alumnosActivos}</p>
          </div>
        </div>

        <div className="pe-stat-card pe-stat-green">
          <div className="pe-stat-icon">
            <UserCheck size={32} />
          </div>
          <div>
            <p className="pe-stat-label">Entrenadores</p>
            <p className="pe-stat-valor">{stats.entrenadoresActivos}</p>
          </div>
        </div>

        <div className="pe-stat-card pe-stat-blue">
          <div className="pe-stat-icon">
            <Users size={32} />
          </div>
          <div>
            <p className="pe-stat-label">Usuarios Totales</p>
            <p className="pe-stat-valor">{stats.usuariosActivos}</p>
          </div>
        </div>
      </div>

      {/* ─── ACCESOS RÁPIDOS ─── */}
      <div style={{ marginTop: '2.5rem' }}>
        <p style={{
          color: 'var(--text-secondary)',
          fontSize: '0.75rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: '1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem'
        }}>
          <ExternalLink size={13} />
          Los módulos marcados con flecha se abren en AsiSport con tu sesión activa
        </p>

        <div className="pe-accesos-grid">

          {/* Sucursales → AsiSport */}
          <button className="pe-acceso-card pe-acceso-orange" onClick={() => navegarAAsisport('/admin/sucursales')}>
            <div className="pe-acceso-icon">
              <MapPin size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Sucursales</h3>
            <p className="pe-acceso-desc">Gestionar sedes</p>
            <ExternalLink size={14} className="pe-acceso-ext" />
          </button>

          {/* Usuarios → AsiSport */}
          <button className="pe-acceso-card pe-acceso-blue" onClick={() => navegarAAsisport('/admin/usuarios')}>
            <div className="pe-acceso-icon">
              <UserCog size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Usuarios</h3>
            <p className="pe-acceso-desc">Roles y permisos</p>
            <ExternalLink size={14} className="pe-acceso-ext" />
          </button>

          {/* Canchas y Horarios → AsiSport */}
          <button className="pe-acceso-card pe-acceso-green" onClick={() => navegarAAsisport('/admin/configuraciones')}>
            <div className="pe-acceso-icon">
              <Building2 size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Canchas y Horarios</h3>
            <p className="pe-acceso-desc">Configuración general</p>
            <ExternalLink size={14} className="pe-acceso-ext" />
          </button>

          {/* Registro de Actividad → ruta interna */}
          <button className="pe-acceso-card pe-acceso-red" onClick={() => navigate('/finanzas/registro-actividad')}>
            <div className="pe-acceso-icon">
              <Activity size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Reg. Actividad</h3>
            <p className="pe-acceso-desc">Auditoría de acciones</p>
          </button>

        </div>
      </div>
    </main>
  );
};

export default PanelEscuela;
