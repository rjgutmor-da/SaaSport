/**
 * PanelEscuela.tsx — Panel de información de la escuela en SaaSport.
 *
 * Muestra estadísticas generales (alumnos, entrenadores, usuarios) y
 * accesos rápidos a gestión de Sucursales, Usuarios, y Canchas/Horarios,
 * que navegan a AsisPort con SSO automático.
 *
 * Solo accesible para SuperAdministrador y Dueño.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, School, Users, UserCheck, GraduationCap,
  Building2, UserCog, MapPin, ExternalLink
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { navegarAAsisport } from '../../lib/navegacion';

interface EscuelaInfo {
  id: string;
  nombre: string;
  zona_horaria: string | null;
  activa: boolean;
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

      // Obtener perfil del usuario actual para el escuela_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión expirada.');

      const { data: perfil, error: perfilError } = await supabase
        .from('usuarios')
        .select('escuela_id')
        .eq('id', user.id)
        .single();

      if (perfilError || !perfil) throw new Error('No se encontró el perfil del usuario.');
      const { escuela_id } = perfil;

      // Cargar datos en paralelo
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
          <p style={{ color: 'var(--text-secondary)' }}>Cargando información de la escuela...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/configuraciones')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <School size={28} style={{ marginRight: '0.5rem' }} />
              Panel de Escuela
            </h1>
            <p className="pc-subtitulo">Información y estadísticas de tu academia</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="login-error" style={{ margin: '1rem 0' }}>
          <span>{error}</span>
        </div>
      )}

      {/* Hero — Info de la Escuela */}
      {escuela && (
        <div className="panel-escuela-hero">
          <div className="panel-escuela-icon">
            <School size={48} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h2 className="panel-escuela-nombre">{escuela.nombre}</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontFamily: 'monospace', marginTop: '0.25rem' }}>
              ID: {escuela.id}
            </p>
            {escuela.zona_horaria && (
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                🕐 {escuela.zona_horaria}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Grid de Estadísticas */}
      <div className="panel-escuela-stats">
        <div className="stat-card stat-orange">
          <div className="stat-icon"><GraduationCap size={32} /></div>
          <div>
            <p className="stat-label">Alumnos Activos</p>
            <p className="stat-valor">{stats.alumnosActivos}</p>
          </div>
        </div>

        <div className="stat-card stat-green">
          <div className="stat-icon"><UserCheck size={32} /></div>
          <div>
            <p className="stat-label">Entrenadores</p>
            <p className="stat-valor">{stats.entrenadoresActivos}</p>
          </div>
        </div>

        <div className="stat-card stat-blue">
          <div className="stat-icon"><Users size={32} /></div>
          <div>
            <p className="stat-label">Usuarios Totales</p>
            <p className="stat-valor">{stats.usuariosActivos}</p>
          </div>
        </div>
      </div>

      {/* Accesos Rápidos → AsisPort vía SSO */}
      <div style={{ marginTop: '2rem' }}>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <ExternalLink size={14} />
          Se abrirán en AsiSport con tu sesión activa
        </p>
        <div className="panel-escuela-accesos">
          <button className="acceso-card" onClick={() => navegarAAsisport('/admin/sucursales')}>
            <Building2 size={40} style={{ marginBottom: '0.75rem', color: 'var(--primary)' }} />
            <h3>Sucursales</h3>
            <p>Gestionar sedes y ubicaciones</p>
          </button>

          <button className="acceso-card" onClick={() => navegarAAsisport('/admin/usuarios')}>
            <UserCog size={40} style={{ marginBottom: '0.75rem', color: 'var(--primary)' }} />
            <h3>Usuarios</h3>
            <p>Gestionar roles y permisos</p>
          </button>

          <button className="acceso-card" onClick={() => navegarAAsisport('/admin/configuraciones')}>
            <MapPin size={40} style={{ marginBottom: '0.75rem', color: 'var(--primary)' }} />
            <h3>Canchas y Horarios</h3>
            <p>Configurar canchas y turnos</p>
          </button>
        </div>
      </div>
    </main>
  );
};

export default PanelEscuela;
