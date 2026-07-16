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
  Building2, UserCog, MapPin, Activity, RefreshCw, Camera, Lock, Settings, Eye
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabaseClient';
import LogoPorDefecto from '../../assets/LogoPorDefecto.png';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  configuracionFacturacionKey,
  configuracionFacturacionManual,
  useConfiguracionFacturacion,
  type ConfiguracionFacturacion,
} from '../../hooks/useConfiguracionFacturacion';

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
  const queryClient = useQueryClient();
  const { recargarDatosAuth, escuelaId, perfil } = useAuthSaaSport();

  // Escuelas con acceso habilitado a Fotos de Asistencia Grupal
  const ESCUELAS_CON_FOTOS_ASISTENCIA = ['Fundación Inter Stars'];

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
  const [configFacturacionAbierta, setConfigFacturacionAbierta] = useState(false);
  const [guardandoFacturacion, setGuardandoFacturacion] = useState(false);
  const [errorFacturacion, setErrorFacturacion] = useState<string | null>(null);
  const [configFacturacionForm, setConfigFacturacionForm] = useState<ConfiguracionFacturacion | null>(null);
  const configFacturacionQuery = useConfiguracionFacturacion(escuelaId, configFacturacionAbierta);

  useEffect(() => {
    if (!configFacturacionAbierta || !escuelaId) return;
    if (configFacturacionQuery.data) {
      setConfigFacturacionForm(configFacturacionQuery.data);
    } else if (!configFacturacionQuery.isLoading) {
      setConfigFacturacionForm(configuracionFacturacionManual(escuelaId));
    }
  }, [configFacturacionAbierta, escuelaId, configFacturacionQuery.data, configFacturacionQuery.isLoading]);

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
        supabase.from('escuelas').select('id, nombre, zona_horaria, activa, logo_url, slogan').eq('id', escuela_id).single(),
        supabase.from('alumnos').select('id, sucursal_id')
          .eq('escuela_id', escuela_id).eq('archivado', false),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).eq('activo', true),
        supabase.from('usuarios').select('id', { count: 'exact', head: true })
          .eq('escuela_id', escuela_id).in('rol', ['Entrenador', 'Entrenarqueros']).eq('activo', true),
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
            cacheControl: '86400',
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

  const handleGuardarFacturacion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId || !perfil || !configFacturacionForm) return;

    if (configFacturacionForm.plan_calculo_monto === 'asistencia') {
      const x = configFacturacionForm.asistencias_minimo_completo;
      const y = configFacturacionForm.asistencias_minimo_parcial;
      if (x === null || y === null || x <= y || y < 0) {
        setErrorFacturacion('X debe ser mayor que Y, y ambos deben ser valores válidos.');
        return;
      }
    }

    if (
      configFacturacionForm.plan_momento_emision === 'adelantado'
      && configFacturacionForm.plan_calculo_monto === 'asistencia'
    ) {
      setErrorFacturacion('El cálculo por asistencia no puede emitirse por adelantado.');
      return;
    }

    try {
      setGuardandoFacturacion(true);
      setErrorFacturacion(null);
      const usaAsistencia = configFacturacionForm.plan_calculo_monto === 'asistencia';
      const { error: guardarError } = await supabase
        .from('configuracion_facturacion')
        .upsert({
          escuela_id: escuelaId,
          plan_momento_emision: configFacturacionForm.plan_momento_emision,
          plan_calculo_monto: configFacturacionForm.plan_calculo_monto,
          asistencias_minimo_completo: usaAsistencia
            ? configFacturacionForm.asistencias_minimo_completo
            : null,
          asistencias_minimo_parcial: usaAsistencia
            ? configFacturacionForm.asistencias_minimo_parcial
            : null,
          porcentaje_monto_parcial: configFacturacionForm.porcentaje_monto_parcial,
          activo: true,
          updated_by: perfil.id,
        }, { onConflict: 'escuela_id' });

      if (guardarError) throw guardarError;
      await queryClient.invalidateQueries({ queryKey: configuracionFacturacionKey(escuelaId) });
      setConfigFacturacionAbierta(false);
    } catch (err: any) {
      setErrorFacturacion(err.message || 'No se pudo guardar la configuración de facturación.');
    } finally {
      setGuardandoFacturacion(false);
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
                  src={LogoPorDefecto}
                  alt="Logo por defecto"
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

          <button
            className="pe-acceso-card pe-acceso-orange"
            onClick={() => {
              setErrorFacturacion(null);
              setConfigFacturacionForm(null);
              setConfigFacturacionAbierta(true);
            }}
          >
            <div className="pe-acceso-icon">
              <Settings size={32} />
            </div>
            <h3 className="pe-acceso-titulo">Facturación</h3>
            <p className="pe-acceso-desc">Planes y asistencias</p>
          </button>

          {/* Fotos de Asistencia → solo escuelas habilitadas */}
          {(() => {
            const tieneAcceso = escuela && ESCUELAS_CON_FOTOS_ASISTENCIA.includes(escuela.nombre);
            return (
              <button
                className={`pe-acceso-card pe-acceso-purple${!tieneAcceso ? ' pe-acceso-bloqueado' : ''}`}
                onClick={() => tieneAcceso ? navigate('/panel-escuela/fotos-asistencia') : undefined}
                disabled={!tieneAcceso}
                title={tieneAcceso ? 'Ver fotos grupales de asistencia' : 'Funcionalidad no disponible en tu plan actual'}
                style={!tieneAcceso ? { opacity: 0.45, cursor: 'not-allowed', filter: 'grayscale(0.3)' } : {}}
              >
                <div className="pe-acceso-icon" style={{ position: 'relative' }}>
                  <Camera size={32} />
                  {!tieneAcceso && (
                    <div style={{
                      position: 'absolute',
                      bottom: '-4px',
                      right: '-4px',
                      background: 'var(--surface)',
                      borderRadius: '50%',
                      padding: '2px',
                      lineHeight: 0,
                      border: '1px solid var(--border)',
                    }}>
                      <Lock size={11} style={{ color: 'var(--text-tertiary)' }} />
                    </div>
                  )}
                </div>
                <h3 className="pe-acceso-titulo">Fotos Asistencia</h3>
                <p className="pe-acceso-desc">
                  {tieneAcceso ? 'Respaldo fotográfico' : 'No disponible en tu plan'}
                </p>
              </button>
            );
          })()}

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

      {configFacturacionAbierta && escuelaId && (
        <div className="cxc-modal-overlay">
          <div className="cxc-modal" style={{ maxWidth: '560px' }}>
            <div className="cxc-modal-header">
              <h2>Configuración de Facturación</h2>
              <button
                onClick={() => setConfigFacturacionAbierta(false)}
                disabled={guardandoFacturacion}
              >✕</button>
            </div>

            {configFacturacionQuery.isLoading || !configFacturacionForm ? (
              <div style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
                <RefreshCw className="spin" size={26} style={{ color: 'var(--primary)' }} />
              </div>
            ) : (
              <form onSubmit={handleGuardarFacturacion} className="cxc-modal-form">
                <div className="form-campo">
                  <label>Momento de emisión</label>
                  <select
                    value={configFacturacionForm.plan_momento_emision}
                    onChange={(e) => setConfigFacturacionForm({
                      ...configFacturacionForm,
                      plan_momento_emision: e.target.value as ConfiguracionFacturacion['plan_momento_emision'],
                    })}
                    disabled={guardandoFacturacion}
                  >
                    <option value="manual">Manual</option>
                    <option value="adelantado">Al inicio del ciclo</option>
                    <option value="atrasado">Al finalizar el ciclo</option>
                  </select>
                </div>

                <div className="form-campo">
                  <label>Cálculo del monto</label>
                  <select
                    value={configFacturacionForm.plan_calculo_monto}
                    onChange={(e) => {
                      const calculo = e.target.value as ConfiguracionFacturacion['plan_calculo_monto'];
                      setConfigFacturacionForm({
                        ...configFacturacionForm,
                        plan_calculo_monto: calculo,
                        asistencias_minimo_completo: calculo === 'asistencia'
                          ? configFacturacionForm.asistencias_minimo_completo
                          : null,
                        asistencias_minimo_parcial: calculo === 'asistencia'
                          ? configFacturacionForm.asistencias_minimo_parcial
                          : null,
                      });
                    }}
                    disabled={guardandoFacturacion}
                  >
                    <option value="manual">Manual</option>
                    <option value="fijo">Mensualidad de la ficha</option>
                    <option value="asistencia">Según asistencia</option>
                  </select>
                </div>

                {configFacturacionForm.plan_calculo_monto === 'asistencia' && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '0.75rem', alignItems: 'start' }}>
                    <div style={{ display: 'grid', gap: '0.75rem' }}>
                      <div className="form-campo">
                        <label>X · monto completo</label>
                        <input
                          type="number"
                          min="1"
                          value={configFacturacionForm.asistencias_minimo_completo ?? ''}
                          onChange={(e) => setConfigFacturacionForm({
                            ...configFacturacionForm,
                            asistencias_minimo_completo: e.target.value === '' ? null : Number(e.target.value),
                          })}
                          disabled={guardandoFacturacion}
                          required
                        />
                      </div>
                      <div className="form-campo">
                        <label>Porcentaje parcial</label>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          value={configFacturacionForm.porcentaje_monto_parcial}
                          onChange={(e) => setConfigFacturacionForm({
                            ...configFacturacionForm,
                            porcentaje_monto_parcial: Number(e.target.value),
                          })}
                          disabled={guardandoFacturacion}
                          required
                        />
                      </div>
                    </div>
                    <div className="form-campo">
                      <label>Y · monto parcial</label>
                      <input
                        type="number"
                        min="0"
                        value={configFacturacionForm.asistencias_minimo_parcial ?? ''}
                        onChange={(e) => setConfigFacturacionForm({
                          ...configFacturacionForm,
                          asistencias_minimo_parcial: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        disabled={guardandoFacturacion}
                        required
                      />
                    </div>
                  </div>
                )}

                <div style={{ padding: '0.85rem', background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', color: 'var(--text-secondary)', fontSize: '0.8rem', lineHeight: 1.5 }}>
                  {configFacturacionForm.plan_calculo_monto === 'asistencia'
                    ? `Desde ${configFacturacionForm.asistencias_minimo_completo ?? 'X'} asistencias se cobra 100%; desde ${configFacturacionForm.asistencias_minimo_parcial ?? 'Y'} se cobra ${configFacturacionForm.porcentaje_monto_parcial}%; por debajo de Y se cobra 0%. Sin registros, el alumno queda para revisión.`
                    : configFacturacionForm.plan_calculo_monto === 'fijo'
                      ? 'El monto se tomará de la mensualidad configurada en la ficha de cada alumno.'
                      : 'La creación y el monto continuarán siendo manuales.'}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setConfigFacturacionAbierta(false);
                    navigate('/finanzas/historial-facturacion');
                  }}
                  className="btn-volver"
                  style={{ width: '100%', marginTop: '0.75rem', justifyContent: 'center', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Eye size={16} />
                  Ver Historial de Facturación Automática
                </button>

                {(errorFacturacion || configFacturacionQuery.error) && (
                  <div className="login-error" style={{ margin: 0 }}>
                    <span>{errorFacturacion || (configFacturacionQuery.error as Error)?.message}</span>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                  <button
                    type="button"
                    className="btn-volver"
                    onClick={() => setConfigFacturacionAbierta(false)}
                    disabled={guardandoFacturacion}
                  >Cancelar</button>
                  <button
                    type="submit"
                    className="btn-nueva-cuenta"
                    disabled={guardandoFacturacion}
                  >{guardandoFacturacion ? 'Guardando...' : 'Guardar configuración'}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
};

export default PanelEscuela;
