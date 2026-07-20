import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, UserCog, CheckCircle, XCircle, UserPlus, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import { getUsuarios, updateUserRole, toggleUserStatus, updateUserSucursal, createUserDirectly } from '../../services/usuarios';
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

  const rolesOptions = getRoleOptions({ fichaMedicaHabilitada });

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

      setAlerta({
        tipo: 'success',
        mensaje: `✓ Usuario con correo "${formData.email.trim().toLowerCase()}" creado correctamente. Ya puede iniciar sesión.`
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
                  <label>Contraseña *</label>
                  <input
                    type="password"
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
    </main>
  );
};

export default AdminUsuarios;
