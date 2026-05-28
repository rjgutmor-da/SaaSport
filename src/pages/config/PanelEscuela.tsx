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
 *   - Modal de Edición de Escuela (Nombre, Eslogan y Logotipo subido a Storage)
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  School, Users, UserCheck, GraduationCap,
  Building2, UserCog, MapPin, Activity, RefreshCw
} from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import LogoPlaneta from '../../assets/LogoPlaneta.png';
import { useAuthSaaSport } from '../../lib/authHelper';

interface EscuelaInfo {
  id: string;
  nombre: string;
  zona_horaria: string | null;
  activa: boolean;
  logo_url?: string | null;
  slogan?: string | null;
}

interface SucursalStats {
  id: string;
  nombre: string;
  count: number;
}

interface Estadisticas {
  alumnosActivos: number;
  usuariosActivos: number;
  entrenadoresActivos: number;
  alumnosPorSucursal: SucursalStats[];
}

const PanelEscuela: React.FC = () => {
  const navigate = useNavigate();
  const { recargarDatosAuth } = useAuthSaaSport();

  const [loading, setLoading] = useState(true);
  const [escuela, setEscuela] = useState<EscuelaInfo | null>(null);
  const [stats, setStats] = useState<Estadisticas>({
    alumnosActivos: 0,
    usuariosActivos: 0,
    entrenadoresActivos: 0,
    alumnosPorSucursal: [],
  });
  const [error, setError] = useState<string | null>(null);

  // Estados para el Modal de Edición
  const [isEditing, setIsEditing] = useState(false);
  const [editNombre, setEditNombre] = useState('');

  const [editLogoUrl, setEditLogoUrl] = useState<string | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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
        { data: alumnosData },
        { count: usuariosCount },
        { count: entrenadoresCount },
        { data: sucursalesData },
      ] = await Promise.all([
        supabase.from('escuelas').select('*').eq('id', escuela_id).single(),
        supabase.from('alumnos').select('id, sucursal_id')
          .eq('escuela_id', escuela_id).eq('archivado', false),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('activo', true),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('rol', 'Entrenador').eq('activo', true),
        supabase.from('sucursales').select('id, nombre').eq('escuela_id', escuela_id),
      ]);

      if (escuelaError) throw new Error('Error al cargar datos de la escuela.');

      const alumnosActivos = alumnosData ? alumnosData.length : 0;
      const sucursalesMap = sucursalesData || [];
      const alumnosPorSucursal: SucursalStats[] = sucursalesMap.map(suc => ({
        id: suc.id,
        nombre: suc.nombre,
        count: (alumnosData || []).filter(a => a.sucursal_id === suc.id).length
      })).filter(s => s.count > 0);

      const sinSucursalCount = (alumnosData || []).filter(a => !a.sucursal_id).length;
      if (sinSucursalCount > 0) {
        alumnosPorSucursal.push({ id: 'sin-sucursal', nombre: 'Sin sucursal', count: sinSucursalCount });
      }

      setEscuela(escuelaData);
      setStats({
        alumnosActivos,
        usuariosActivos: usuariosCount ?? 0,
        entrenadoresActivos: entrenadoresCount ?? 0,
        alumnosPorSucursal
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Por favor, selecciona un archivo de imagen válido.');
      return;
    }

    const MAX_SIZE = 250 * 1024; // 250 KB
    if (file.size > MAX_SIZE) {
      alert('La imagen excede el límite de tamaño permitido (250 KB). Por favor, elige una imagen más ligera.');
      return;
    }

    setLogoFile(file);
    setEditLogoUrl(null);
    const reader = new FileReader();
    reader.onloadend = () => {
      setLogoPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGuardar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuela) return;

    try {
      setGuardando(true);
      setModalError(null);

      let finalLogoUrl = editLogoUrl;

      if (logoFile) {
        const fileExt = logoFile.name.split('.').pop() || 'png';
        const fileName = `logo_${escuela.id}_${Date.now()}.${fileExt}`;
        const filePath = `logos_escuelas/${fileName}`;

        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, logoFile, {
            cacheControl: '3600',
            upsert: true
          });

        if (uploadError) {
          throw new Error('Error al subir la imagen: ' + uploadError.message);
        }

        const { data: { publicUrl } } = supabase.storage
          .from('avatars')
          .getPublicUrl(filePath);

        finalLogoUrl = publicUrl;
      }

      const { error: dbError } = await supabase
        .from('escuelas')
        .update({
          nombre: editNombre.trim(),
          logo_url: finalLogoUrl,
          updated_at: new Date().toISOString()
        })
        .eq('id', escuela.id);

      if (dbError) {
        throw new Error('Error al guardar datos de la escuela: ' + dbError.message);
      }

      await cargarDatos();
      await recargarDatosAuth();
      setIsEditing(false);
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setGuardando(false);
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
              <button 
                onClick={() => {
                  setEditNombre(escuela.nombre);
                  setEditLogoUrl(escuela.logo_url || null);
                  setLogoFile(null);
                  setLogoPreview(null);
                  setModalError(null);
                  setIsEditing(true);
                }}
                className="btn-nueva-cuenta"
                style={{ 
                  marginTop: '1.25rem', 
                  padding: '0.5rem 1.25rem', 
                  fontSize: '0.85rem', 
                  height: '36px',
                  width: 'fit-content'
                }}
              >
                Configurar Escuela
              </button>
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

              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
                <img
                  src={LogoPlaneta}
                  alt="Logo Planeta FC"
                  className="pe-logo-img"
                />
              </div>
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

        <div className="pe-stat-card pe-stat-purple">
          <div className="pe-stat-icon" style={{ alignSelf: 'flex-start' }}>
            <MapPin size={32} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="pe-stat-label">Por Sucursal</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.5rem' }}>
              {stats.alumnosPorSucursal && stats.alumnosPorSucursal.length > 0 ? (
                stats.alumnosPorSucursal.map(suc => (
                  <div key={suc.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginRight: '0.5rem' }}>{suc.nombre}</span>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{suc.count}</span>
                  </div>
                ))
              ) : (
                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>Sin datos</span>
              )}
            </div>
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

      {/* ─── ACCESOS RÁPIDAS ─── */}
      <div style={{ marginTop: '2.5rem' }}>
        <div className="pe-accesos-grid">

          {/* Sucursales → ruta interna */}
          <button className="pe-acceso-card pe-acceso-orange" onClick={() => navigate('/panel-escuela/sucursales')}>
            <div className="pe-acceso-icon">
              <MapPin size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Sucursales</h3>
            <p className="pe-acceso-desc">Gestionar sedes</p>
          </button>

          {/* Usuarios → ruta interna */}
          <button className="pe-acceso-card pe-acceso-blue" onClick={() => navigate('/panel-escuela/usuarios')}>
            <div className="pe-acceso-icon">
              <UserCog size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Usuarios</h3>
            <p className="pe-acceso-desc">Roles y permisos</p>
          </button>

          {/* Grupos y Horarios → ruta interna */}
          <button className="pe-acceso-card pe-acceso-green" onClick={() => navigate('/panel-escuela/canchas-horarios')}>
            <div className="pe-acceso-icon">
              <Building2 size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Grupos y Horarios</h3>
            <p className="pe-acceso-desc">Configuración general</p>
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

      {/* ─── MODAL DE EDICIÓN ─── */}
      {isEditing && escuela && (
        <div className="cxc-modal-overlay">
          <div className="cxc-modal" style={{ maxWidth: '480px' }}>
            <div className="cxc-modal-header">
              <h2>Configuración de Escuela</h2>
              <button onClick={() => setIsEditing(false)} disabled={guardando}>✕</button>
            </div>
            
            <form onSubmit={handleGuardar} className="cxc-modal-form">
              <div className="form-campo">
                <label>Nombre de la Escuela</label>
                <input 
                  type="text" 
                  value={editNombre} 
                  onChange={(e) => setEditNombre(e.target.value)} 
                  required 
                  maxLength={100}
                  placeholder="Ej. Planeta FC"
                />
              </div>



              <div className="form-campo">
                <label>Logotipo de la Escuela</label>
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '1rem', 
                  alignItems: 'center', 
                  background: 'rgba(255, 255, 255, 0.02)', 
                  padding: '1.25rem', 
                  borderRadius: '6px', 
                  border: '1px solid var(--border)' 
                }}>
                  
                  {/* Preview del logo */}
                  {logoPreview || editLogoUrl ? (
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img 
                        src={logoPreview || editLogoUrl || ''} 
                        alt="Vista previa del logo" 
                        style={{ 
                          width: '120px', 
                          height: '120px', 
                          objectFit: 'contain', 
                          background: '#0D0D0D', 
                          border: '1px solid var(--border)', 
                          borderRadius: '8px', 
                          padding: '0.5rem' 
                        }} 
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          setLogoFile(null);
                          setLogoPreview(null);
                          setEditLogoUrl(null);
                        }}
                        style={{
                          position: 'absolute',
                          top: '-8px',
                          right: '-8px',
                          background: 'var(--danger)',
                          color: '#fff',
                          borderRadius: '50%',
                          width: '24px',
                          height: '24px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.8rem',
                          boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                          cursor: 'pointer',
                          border: 'none'
                        }}
                        title="Eliminar logo"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 0' }}>
                      Sin logotipo configurado (se usará el logo por defecto)
                    </div>
                  )}

                  <input 
                    type="file" 
                    accept="image/png, image/jpeg, image/jpg" 
                    onChange={handleFileChange}
                    style={{ display: 'none' }}
                    id="logo-upload-input"
                  />
                  <label 
                    htmlFor="logo-upload-input" 
                    className="btn-volver"
                    style={{ cursor: 'pointer', margin: 0, height: '36px', fontSize: '0.82rem', padding: '0 1rem', display: 'flex', alignItems: 'center' }}
                  >
                    Seleccionar Imagen
                  </label>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                    Recomendado: Imagen cuadrada PNG o JPG, máximo 250 KB
                  </span>
                </div>
              </div>

              {modalError && (
                <div className="login-error" style={{ margin: '0' }}>
                  <span>{modalError}</span>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                <button 
                  type="button" 
                  onClick={() => setIsEditing(false)} 
                  className="btn-volver"
                  disabled={guardando}
                  style={{ height: '40px', padding: '0 1.25rem' }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn-nueva-cuenta"
                  disabled={guardando}
                  style={{ height: '40px', padding: '0 1.25rem' }}
                >
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default PanelEscuela;
