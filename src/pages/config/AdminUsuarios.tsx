import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, UserCog, CheckCircle, XCircle, UserPlus, X, AlertTriangle, ShieldAlert, Trash2, Copy } from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import { getUsuarios, updateUserRole, toggleUserStatus, updateUserSucursal, createUserDirectly, deleteUser } from '../../services/usuarios';
import type { Usuario } from '../../services/usuarios';
import { getSucursales } from '../../services/sucursales';
import type { Sucursal } from '../../services/sucursales';
import { supabase } from '../../lib/supabaseClient';
import { getRoleOptions } from '../../config/roles';

const AdminUsuarios: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId, perfil: currentUser } = useAuthSaaSport();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [fichaMedicaHabilitada, setFichaMedicaHabilitada] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);

  // Determinar si ya existe un SuperAdministrador activo en la escuela
  const tieneSuperAdminActivo = usuarios.some(u => u.rol === 'SuperAdministrador' && u.activo);

  // Estado para Crear Usuario
  const [isCreating, setIsCreating] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Usuario | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [formData, setFormData] = useState({
    nombres: '',
    apellidos: '',
    email: '',
    password: '',
    rol: 'Entrenador' as any,
    sucursal_id: ''
  });

  // Alerta interna de la página
  const [alerta, setAlerta] = useState<{ tipo: 'success' | 'error'; mensaje: string } | null>(null);
  
  // Estado y control para el modal de credenciales recién creadas
  const [credencialesCreadas, setCredencialesCreadas] = useState<{ nombres: string; apellidos: string; email: string; password: string } | null>(null);
  const [copiado, setCopiado] = useState(false);

  // Generar una contraseña aleatoria robusta de 10 caracteres
  const generarContrasenaAleatoria = () => {
    const caracteres = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let nuevaContrasena = '';
    const array = new Uint32Array(10);
    window.crypto.getRandomValues(array);
    for (let i = 0; i < 10; i++) {
      nuevaContrasena += caracteres[array[i] % caracteres.length];
    }
    setFormData(prev => ({ ...prev, password: nuevaContrasena }));
  };

  const rolesOptions = getRoleOptions({ fichaMedicaHabilitada });
  const activeSuperAdminCount = usuarios.filter(u => u.rol === 'SuperAdministrador' && u.activo).length;
  const canDeleteUsers = currentUser?.rol === 'SuperAdministrador';

  useEffect(() => {
    if (escuelaId && currentUser) {
      loadData();
    }
  }, [escuelaId, currentUser]);

  // Limpiar alerta automática si es de tipo éxito
  useEffect(() => {
    if (alerta && alerta.tipo === 'success') {
      const timer = setTimeout(() => {
        setAlerta(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [alerta]);

  const loadData = async () => {
    if (!escuelaId || !currentUser) return;
    try {
      setLoading(true);
      const [usuariosData, sucursalesData, escuelaRes] = await Promise.all([
        getUsuarios(escuelaId, currentUser),
        getSucursales(escuelaId),
        supabase.from('escuelas').select('ficha_medica_habilitada').eq('id', escuelaId).single()
      ]);
      setUsuarios(usuariosData || []);
      setSucursales(sucursalesData || []);
      if (escuelaRes?.data) {
        setFichaMedicaHabilitada(!!escuelaRes.data.ficha_medica_habilitada);
      }
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cargar los datos de usuarios o sucursales.' });
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    if (!escuelaId) return;
    setAlerta(null);

    try {
      // Validar: solo puede haber un SuperAdministrador por escuela
      if (newRole === 'SuperAdministrador') {
        const adminExistente = usuarios.find(u => u.rol === 'SuperAdministrador' && u.id !== userId);
        if (adminExistente) {
          setAlerta({
            tipo: 'error',
            mensaje: `Ya existe un SuperAdministrador: ${adminExistente.nombres} ${adminExistente.apellidos}. Solo puede haber un SuperAdministrador por escuela.`
          });
          return;
        }
      }

      await updateUserRole(userId, newRole);
      setAlerta({ tipo: 'success', mensaje: 'Rol del usuario actualizado correctamente.' });
      loadData();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al actualizar el rol.' });
    }
  };

  const handleSucursalChange = async (userId: string, sucursalId: string) => {
    setAlerta(null);
    try {
      await updateUserSucursal(userId, sucursalId || null);
      setAlerta({ tipo: 'success', mensaje: 'Sucursal del usuario actualizada correctamente.' });
      loadData();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al actualizar la sucursal.' });
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    setAlerta(null);
    try {
      await toggleUserStatus(userId, currentStatus);
      setAlerta({
        tipo: 'success',
        mensaje: `Usuario ${currentStatus ? 'desactivado' : 'activado'} con éxito.`
      });
      loadData();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cambiar el estado del usuario.' });
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    setAlerta(null);

    try {
      await deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      setAlerta({ tipo: 'success', mensaje: `El usuario ${deleteTarget.email} fue eliminado correctamente.` });
      await loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'No se pudo eliminar el usuario.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId) return;
    setAlerta(null);

    if (!formData.nombres.trim() || !formData.apellidos.trim() || !formData.email.trim() || !formData.password.trim()) {
      setAlerta({ tipo: 'error', mensaje: 'Por favor, completa todos los campos obligatorios.' });
      return;
    }

    if (formData.password.length < 6) {
      setAlerta({ tipo: 'error', mensaje: 'La contraseña debe tener al menos 6 caracteres.' });
      return;
    }

    if (formData.rol === 'SuperAdministrador') {
      const adminExistente = usuarios.find(u => u.rol === 'SuperAdministrador' && u.activo);
      if (adminExistente) {
        setAlerta({
          tipo: 'error',
          mensaje: `Ya existe un SuperAdministrador activo: ${adminExistente.nombres} ${adminExistente.apellidos}. Solo puede haber un SuperAdministrador por escuela.`
        });
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await createUserDirectly(escuelaId, {
        ...formData,
        sucursal_id: formData.rol === 'SuperAdministrador' ? '' : formData.sucursal_id
      });

      // Almacenamos los datos para mostrarlos en el modal de única vez antes de reiniciar el formulario
      setCredencialesCreadas({
        nombres: formData.nombres.trim(),
        apellidos: formData.apellidos.trim(),
        email: formData.email.trim().toLowerCase(),
        password: formData.password
      });

      setAlerta({
        tipo: 'success',
        mensaje: `✓ Usuario con correo "${formData.email.trim().toLowerCase()}" creado correctamente. Consulta sus credenciales en la ventana emergente.`
      });
      
      setFormData({
        nombres: '',
        apellidos: '',
        email: '',
        password: '',
        rol: 'Entrenador',
        sucursal_id: ''
      });
      setIsCreating(false);
      loadData();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al crear el usuario.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="main-content">
      {/* Cabecera */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/panel-escuela')} title="Volver al Panel">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <UserCog size={28} style={{ marginRight: '0.5rem', color: 'var(--primary)' }} />
              Administración de Usuarios
            </h1>
            <p className="pc-subtitulo">Gestiona los accesos, roles y sucursales del personal de la escuela.</p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button
            onClick={() => {
              setIsCreating(!isCreating);
              setAlerta(null);
            }}
            className="btn-nueva-cuenta"
            style={{ height: '40px', padding: '0 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            {isCreating ? <X size={18} /> : <UserPlus size={18} />}
            {isCreating ? 'Cancelar' : 'Nuevo Usuario'}
          </button>
        </div>
      </div>

      {/* Banner de Feedback/Alerta */}
      {alerta && (
        <div 
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.5rem',
            borderRadius: 'var(--radius-md)',
            border: `1px solid ${alerta.tipo === 'success' ? 'var(--success)' : 'var(--danger)'}`,
            background: alerta.tipo === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)',
            color: alerta.tipo === 'success' ? 'var(--success)' : 'var(--danger)',
            marginBottom: '1.5rem',
            animation: 'fadeIn 0.3s ease-out'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {alerta.tipo === 'success' ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}
            <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>{alerta.mensaje}</span>
          </div>
          <button onClick={() => setAlerta(null)} style={{ color: 'inherit', display: 'flex', alignItems: 'center' }}>
            <X size={18} />
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
        {/* Formulario Creación de Usuario */}
        {isCreating && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <UserPlus size={18} style={{ color: 'var(--primary)' }} />
              Registrar Nuevo Usuario
            </h2>
            <form onSubmit={handleCreateUser} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1.25rem' }}>
                <div className="form-campo">
                  <label>Nombres *</label>
                  <input
                    type="text"
                    value={formData.nombres}
                    onChange={e => setFormData({ ...formData, nombres: e.target.value })}
                    required
                    placeholder="Ej: Carlos Alberto"
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="form-campo">
                  <label>Apellidos *</label>
                  <input
                    type="text"
                    value={formData.apellidos}
                    onChange={e => setFormData({ ...formData, apellidos: e.target.value })}
                    required
                    placeholder="Ej: Gómez Rojas"
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="form-campo">
                  <label>Correo Electrónico *</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    required
                    placeholder="carlos.gomez@gmail.com"
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="form-campo">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                    <label style={{ margin: 0 }}>Contraseña *</label>
                    <button
                      type="button"
                      onClick={generarContrasenaAleatoria}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--primary)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.25rem',
                        padding: '0.2rem 0'
                      }}
                      title="Generar una contraseña aleatoria y robusta"
                    >
                      ⚡ Generar aleatoria
                    </button>
                  </div>
                  <input
                    type="text"
                    minLength={6}
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    required
                    placeholder="Mínimo 6 caracteres"
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="form-campo">
                  <label>Rol Inicial *</label>
                  <select
                    value={formData.rol}
                    onChange={e => setFormData({ ...formData, rol: e.target.value as any })}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px' }}
                  >
                    {rolesOptions.map(opt => {
                      const isDisabled = opt.value === 'SuperAdministrador' && tieneSuperAdminActivo;
                      return (
                        <option key={opt.value} value={opt.value} disabled={isDisabled}>
                          {opt.label}{isDisabled ? ' (Límite: 1 por escuela)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="form-campo">
                  <label>Sucursal Asignada</label>
                  <select
                    value={formData.sucursal_id}
                    onChange={e => setFormData({ ...formData, sucursal_id: e.target.value })}
                    disabled={formData.rol === 'SuperAdministrador'}
                    style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px' }}
                  >
                    <option value="">Todas las sucursales (Sin restricción)</option>
                    {sucursales.map(suc => (
                      <option key={suc.id} value={suc.id}>{suc.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-nueva-cuenta"
                  style={{ height: '38px', padding: '0 2rem' }}
                >
                  {isSubmitting ? 'Registrando...' : 'Crear Usuario'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tabla de Usuarios */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Cargando usuarios...
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Nombre y Email</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Asignación de Rol y Sucursal</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No hay usuarios registrados.
                    </td>
                  </tr>
                ) : (
                  usuarios.map(u => {
                    const esMismoUsuario = u.id === currentUser?.id;
                    return (
                      <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'var(--transition)' }} className="hover-row">
                        <td style={{ padding: '1rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {u.nombres} {u.apellidos}
                            {esMismoUsuario && (
                              <span style={{ fontSize: '0.7rem', background: 'var(--primary-glow)', color: 'var(--primary)', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>TÚ</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{u.email}</div>
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxWidth: '240px' }}>
                            {/* Selector de Rol */}
                            <select
                              value={u.rol || ''}
                              onChange={(e) => handleRoleChange(u.id, e.target.value)}
                              disabled={esMismoUsuario}
                              style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px' }}
                            >
                              {rolesOptions.map(opt => {
                                const isDisabled = opt.value === 'SuperAdministrador' && tieneSuperAdminActivo && u.rol !== 'SuperAdministrador';
                                return (
                                  <option key={opt.value} value={opt.value} disabled={isDisabled}>
                                    {opt.label}{isDisabled ? ' (Límite: 1 por escuela)' : ''}
                                  </option>
                                );
                              })}
                            </select>

                            {/* Selector de Sucursal */}
                            <select
                              value={u.sucursal_id || ''}
                              onChange={(e) => handleSucursalChange(u.id, e.target.value)}
                              disabled={esMismoUsuario || u.rol === 'SuperAdministrador'}
                              style={{ width: '100%', padding: '0.35rem 0.5rem', fontSize: '0.85rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px' }}
                            >
                              <option value="">Todas las sucursales</option>
                              {sucursales.map(suc => (
                                <option key={suc.id} value={suc.id}>{suc.nombre}</option>
                              ))}
                            </select>
                          </div>
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'center' }}>
                          {u.activo ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                              <CheckCircle size={15} /> Activo
                            </span>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                              <XCircle size={15} /> Inactivo
                            </span>
                          )}
                        </td>
                        <td style={{ padding: '1rem', textAlign: 'right' }}>
                          {!esMismoUsuario ? (
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.5rem' }}>
                              <button
                                onClick={() => handleToggleStatus(u.id, u.activo)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: `1px solid ${u.activo ? 'rgba(255, 59, 48, 0.3)' : 'rgba(0, 210, 106, 0.3)'}`,
                                  background: u.activo ? 'var(--danger-bg)' : 'var(--success-bg)',
                                  color: u.activo ? 'var(--danger)' : 'var(--success)',
                                  fontWeight: 600
                                }}
                              >
                                {u.activo ? 'Desactivar' : 'Activar'}
                              </button>
                              {canDeleteUsers && (
                                <button
                                  onClick={() => setDeleteTarget(u)}
                                  disabled={u.rol === 'SuperAdministrador' && activeSuperAdminCount <= 1}
                                  title={u.rol === 'SuperAdministrador' && activeSuperAdminCount <= 1 ? 'No se puede eliminar el último SuperAdministrador.' : 'Eliminar usuario definitivamente'}
                                  style={{
                                    fontSize: '0.75rem',
                                    padding: '0.4rem 0.65rem',
                                    borderRadius: '4px',
                                    border: '1px solid rgba(255, 59, 48, 0.3)',
                                    background: 'var(--danger-bg)',
                                    color: 'var(--danger)',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '0.3rem',
                                    opacity: u.rol === 'SuperAdministrador' && activeSuperAdminCount <= 1 ? 0.45 : 1,
                                    cursor: u.rol === 'SuperAdministrador' && activeSuperAdminCount <= 1 ? 'not-allowed' : 'pointer'
                                  }}
                                >
                                  <Trash2 size={14} />
                                  Eliminar
                                </button>
                              )}
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontStyle: 'italic', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.25rem' }}>
                              <ShieldAlert size={14} /> Sin acciones
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {deleteTarget && (
        <div
          role="presentation"
          onClick={() => !isDeleting && setDeleteTarget(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', background: 'rgba(0, 0, 0, 0.65)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-user-title"
            onClick={event => event.stopPropagation()}
            style={{ width: '100%', maxWidth: '480px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
              <ShieldAlert size={24} style={{ color: 'var(--danger)', flexShrink: 0 }} />
              <div>
                <h2 id="delete-user-title" style={{ margin: 0, fontSize: '1.15rem', color: 'var(--text-primary)' }}>Eliminar usuario definitivamente</h2>
                <p style={{ margin: '0.75rem 0 0', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Esta acción es irreversible. Se eliminará la cuenta de acceso de <strong>{deleteTarget.nombres} {deleteTarget.apellidos}</strong> ({deleteTarget.email}).
                </p>
                <p style={{ margin: '0.75rem 0 0', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Solo se completará si el usuario no tiene historial, alumnos, asignaciones ni archivos asociados.
                </p>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button type="button" onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="btn-volver" style={{ padding: '0.55rem 1rem' }}>Cancelar</button>
              <button type="button" onClick={handleDeleteUser} disabled={isDeleting} style={{ padding: '0.55rem 1rem', borderRadius: '4px', border: '1px solid rgba(255, 59, 48, 0.45)', background: 'var(--danger)', color: '#fff', fontWeight: 700 }}>
                {isDeleting ? 'Eliminando...' : 'Sí, eliminar usuario'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de credenciales generadas al crear un usuario (Única visualización por seguridad) */}
      {credencialesCreadas && (
        <div
          role="presentation"
          style={{
            position: 'fixed', inset: 0, zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '1rem', background: 'rgba(0, 0, 0, 0.75)'
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="creds-modal-title"
            style={{ width: '100%', maxWidth: '520px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.75rem', boxShadow: '0 25px 70px rgba(0,0,0,0.45)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem', marginBottom: '1.25rem' }}>
              <CheckCircle size={28} style={{ color: 'var(--success)' }} />
              <div>
                <h2 id="creds-modal-title" style={{ margin: 0, fontSize: '1.2rem', color: 'var(--text-primary)' }}>¡Usuario Registrado con Éxito!</h2>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {credencialesCreadas.nombres} {credencialesCreadas.apellidos}
                </p>
              </div>
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '1rem', marginBottom: '1.25rem' }}>
              <div style={{ marginBottom: '0.75rem' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Correo Electrónico (Usuario):</span>
                <strong style={{ color: 'var(--text-primary)', fontSize: '1rem' }}>{credencialesCreadas.email}</strong>
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block' }}>Contraseña de Acceso Inicial:</span>
                <strong style={{ color: 'var(--primary)', fontSize: '1.15rem', fontFamily: 'monospace', letterSpacing: '0.5px' }}>{credencialesCreadas.password}</strong>
              </div>
            </div>

            <div style={{ background: 'var(--warning-bg, rgba(245, 158, 11, 0.1))', border: '1px solid var(--warning, #f59e0b)', borderRadius: 'var(--radius-md)', padding: '0.85rem', marginBottom: '1.5rem', display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
              <AlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0, marginTop: '2px' }} />
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)', lineHeight: 1.4 }}>
                <strong>Importante por Seguridad:</strong> Esta contraseña se ha encriptado de forma irreversible en la base de datos y <strong>no podrá volver a visualizarse en el futuro</strong>. Cópiala y entrégala en este momento al usuario.
              </p>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  const textoACopiar = `Hola ${credencialesCreadas.nombres}, tus datos de acceso al sistema son:\n🌐 Enlace: https://login.saasport.pro\n👤 Usuario: ${credencialesCreadas.email}\n🔑 Contraseña: ${credencialesCreadas.password}`;
                  navigator.clipboard.writeText(textoACopiar);
                  setCopiado(true);
                  setTimeout(() => setCopiado(false), 3500);
                }}
                className="btn-nueva-cuenta"
                style={{ height: '40px', padding: '0 1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: copiado ? 'var(--success)' : undefined }}
              >
                {copiado ? <CheckCircle size={18} /> : <Copy size={18} />}
                {copiado ? '¡Datos y Contraseña Copiados!' : 'Copiar Datos para el Usuario'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setCredencialesCreadas(null);
                  setCopiado(false);
                }}
                className="btn-volver"
                style={{ height: '40px', padding: '0 1.25rem', fontWeight: 600 }}
              >
                Entendido / Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default AdminUsuarios;
