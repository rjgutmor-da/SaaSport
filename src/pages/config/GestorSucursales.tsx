import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Building2, Plus, Edit2, Trash2, X, CheckCircle, AlertTriangle } from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import { getSucursales, createSucursal, updateSucursal, deleteSucursal } from '../../services/sucursales';
import type { Sucursal } from '../../services/sucursales';

const GestorSucursales: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId } = useAuthSaaSport();
  
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [loading, setLoading] = useState(true);

  // Formulario
  const [isEditing, setIsEditing] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ nombre: '', direccion: '', telefono: '' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Alerta interna de la página
  const [alerta, setAlerta] = useState<{ tipo: 'success' | 'error'; mensaje: string } | null>(null);

  useEffect(() => {
    if (escuelaId) {
      loadSucursales();
    }
  }, [escuelaId]);

  // Cerrar alerta automáticamente si es éxito
  useEffect(() => {
    if (alerta && alerta.tipo === 'success') {
      const timer = setTimeout(() => {
        setAlerta(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [alerta]);

  const loadSucursales = async () => {
    if (!escuelaId) return;
    try {
      setLoading(true);
      const data = await getSucursales(escuelaId);
      setSucursales(data || []);
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cargar las sucursales.' });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId) return;

    if (!formData.nombre.trim()) {
      setAlerta({ tipo: 'error', mensaje: 'El nombre de la sucursal es obligatorio.' });
      // Hacer scroll hacia arriba para que el usuario vea la alerta
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setIsSubmitting(true);
    setAlerta(null);

    try {
      if (isEditing && currentId) {
        await updateSucursal(
          escuelaId,
          currentId,
          formData.nombre.trim(),
          formData.direccion.trim(),
          formData.telefono.trim()
        );
        setAlerta({ tipo: 'success', mensaje: 'Sucursal actualizada correctamente.' });
      } else {
        await createSucursal(
          escuelaId,
          formData.nombre.trim(),
          formData.direccion.trim(),
          formData.telefono.trim()
        );
        setAlerta({ tipo: 'success', mensaje: 'Sucursal creada correctamente.' });
      }

      setFormData({ nombre: '', direccion: '', telefono: '' });
      setIsEditing(false);
      setCurrentId(null);
      loadSucursales();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al guardar la sucursal.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (sucursal: Sucursal) => {
    setIsEditing(true);
    setCurrentId(sucursal.id);
    setFormData({
      nombre: sucursal.nombre,
      direccion: sucursal.direccion || '',
      telefono: sucursal.telefono || ''
    });
    // Scroll suave hasta el formulario
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (id: string, nombre: string) => {
    if (!escuelaId) return;
    
    const confirmado = window.confirm(
      `¿Estás seguro de eliminar la sucursal "${nombre}"? Esta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    try {
      await deleteSucursal(escuelaId, id);
      setAlerta({ tipo: 'success', mensaje: 'Sucursal eliminada correctamente.' });
      loadSucursales();
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'No se pudo eliminar la sucursal.' });
    }
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setCurrentId(null);
    setFormData({ nombre: '', direccion: '', telefono: '' });
    setAlerta(null);
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
              <Building2 size={28} style={{ marginRight: '0.5rem', color: 'var(--primary)' }} />
              Gestión de Sucursales
            </h1>
            <p className="pc-subtitulo">Agrega, edita y organiza las sedes de tu escuela de fútbol</p>
          </div>
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
        {/* Panel del Formulario */}
        <div className="bg-surface border border-border rounded-lg p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isEditing ? <Edit2 size={18} style={{ color: 'var(--primary)' }} /> : <Plus size={18} style={{ color: 'var(--primary)' }} />}
            {isEditing ? 'Editar Sucursal' : 'Nueva Sucursal'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '1.25rem' }}>
              <div className="form-campo">
                <label>Nombre de la Sucursal *</label>
                <input
                  type="text"
                  name="nombre"
                  value={formData.nombre}
                  onChange={handleInputChange}
                  required
                  placeholder="Ej: Sede Central"
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="form-campo">
                <label>Dirección</label>
                <input
                  type="text"
                  name="direccion"
                  value={formData.direccion}
                  onChange={handleInputChange}
                  placeholder="Ej: Calle Bolívar #450, Zona Central"
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>

              <div className="form-campo">
                <label>Teléfono de Contacto</label>
                <input
                  type="text"
                  name="telefono"
                  value={formData.telefono}
                  onChange={handleInputChange}
                  placeholder="Ej: 78945612"
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '0.5rem' }}>
              {isEditing && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={isSubmitting}
                  className="btn-volver"
                  style={{ height: '38px', padding: '0 1.25rem' }}
                >
                  Cancelar
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn-nueva-cuenta"
                style={{ height: '38px', padding: '0 1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                {isSubmitting ? 'Guardando...' : isEditing ? 'Guardar Cambios' : 'Crear Sucursal'}
              </button>
            </div>
          </form>
        </div>

        {/* Tabla de Sucursales */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          {loading ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Cargando sucursales...
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Nombre</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Dirección</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Teléfono</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {sucursales.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No hay sucursales registradas aún. ¡Crea la primera arriba!
                    </td>
                  </tr>
                ) : (
                  sucursales.map(sucursal => (
                    <tr key={sucursal.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'var(--transition)' }} className="hover-row">
                      <td style={{ padding: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>{sucursal.nombre}</td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{sucursal.direccion || '—'}</td>
                      <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{sucursal.telefono || '—'}</td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          <button
                            onClick={() => handleEdit(sucursal)}
                            style={{
                              padding: '0.4rem',
                              borderRadius: '4px',
                              border: '1px solid var(--border)',
                              background: 'var(--bg-glass)',
                              color: 'var(--text-secondary)',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                            title="Editar sucursal"
                            className="hover-color-orange"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDelete(sucursal.id, sucursal.nombre)}
                            style={{
                              padding: '0.4rem',
                              borderRadius: '4px',
                              border: '1px solid rgba(255, 59, 48, 0.2)',
                              background: 'var(--danger-bg)',
                              color: 'var(--danger)',
                              display: 'inline-flex',
                              alignItems: 'center'
                            }}
                            title="Eliminar sucursal"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
};

export default GestorSucursales;
