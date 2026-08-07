import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Settings, Plus, CheckCircle, XCircle, Edit2, Save, X, AlertTriangle } from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  getAllCanchas,
  getAllHorarios,
  createCancha,
  createHorario,
  updateCancha,
  updateHorario,
  toggleCanchaStatus,
  toggleHorarioStatus
} from '../../services/maestros';
import type { Cancha, Horario } from '../../services/maestros';
import { getSucursales } from '../../services/sucursales';
import type { Sucursal } from '../../services/sucursales';

const ConfiguracionCanchas: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId } = useAuthSaaSport();

  const [activeTab, setActiveTab] = useState<'canchas' | 'horarios'>('canchas');
  const [loading, setLoading] = useState(true);

  // Estado de Canchas
  const [canchas, setCanchas] = useState<Cancha[]>([]);
  const [newCanchaName, setNewCanchaName] = useState('');
  const [newCanchaSucursal, setNewCanchaSucursal] = useState('');
  const [newCanchaHorarios, setNewCanchaHorarios] = useState<string[]>([]);
  const [editingCancha, setEditingCancha] = useState<string | null>(null);
  const [editCanchaName, setEditCanchaName] = useState('');
  const [editCanchaSucursal, setEditCanchaSucursal] = useState('');
  const [editCanchaHorarios, setEditCanchaHorarios] = useState<string[]>([]);

  // Estado de Sucursales
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);

  // Estado de Horarios
  const [horarios, setHorarios] = useState<Horario[]>([]);
  const [newHorarioTime, setNewHorarioTime] = useState('');
  const [editingHorario, setEditingHorario] = useState<string | null>(null);
  const [editHorarioTime, setEditHorarioTime] = useState('');

  // Alerta local
  const [alerta, setAlerta] = useState<{ tipo: 'success' | 'error'; mensaje: string } | null>(null);

  useEffect(() => {
    if (escuelaId) {
      loadData();
    }
  }, [escuelaId]);

  // Limpiar alerta automática de éxito
  useEffect(() => {
    if (alerta && alerta.tipo === 'success') {
      const timer = setTimeout(() => {
        setAlerta(null);
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [alerta]);

  const loadData = async () => {
    if (!escuelaId) return;
    try {
      setLoading(true);
      const [chs, hrs, sucs] = await Promise.all([
        getAllCanchas(escuelaId),
        getAllHorarios(escuelaId),
        getSucursales(escuelaId)
      ]);
      setCanchas(chs || []);
      setHorarios(hrs || []);
      setSucursales(sucs || []);
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cargar las configuraciones.' });
    } finally {
      setLoading(false);
    }
  };

  // ========================================================================
  // Funciones de Canchas
  // ========================================================================

  const handleCreateCancha = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId || !newCanchaName.trim()) return;

    setAlerta(null);
    try {
      await createCancha(escuelaId, newCanchaName.trim(), newCanchaSucursal || null, newCanchaHorarios);
      setAlerta({ tipo: 'success', mensaje: 'Grupo creado correctamente.' });
      setNewCanchaName('');
      setNewCanchaSucursal('');
      setNewCanchaHorarios([]);
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al crear la cancha.' });
    }
  };

  const startEditCancha = (cancha: Cancha) => {
    setEditingCancha(cancha.id);
    setEditCanchaName(cancha.nombre);
    setEditCanchaSucursal(cancha.sucursal_id || '');
    setEditCanchaHorarios(cancha.horario_ids || []);
    setAlerta(null);
  };

  const cancelEditCancha = () => {
    setEditingCancha(null);
    setEditCanchaName('');
    setEditCanchaSucursal('');
    setEditCanchaHorarios([]);
    setAlerta(null);
  };

  const handleUpdateCancha = async (id: string) => {
    if (!escuelaId || !editCanchaName.trim()) return;

    setAlerta(null);
    try {
      await updateCancha(escuelaId, id, editCanchaName.trim(), editCanchaSucursal || null, editCanchaHorarios);
      setAlerta({ tipo: 'success', mensaje: 'Grupo actualizado correctamente.' });
      setEditingCancha(null);
      setEditCanchaName('');
      setEditCanchaSucursal('');
      setEditCanchaHorarios([]);
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al actualizar la cancha.' });
    }
  };

  const handleToggleCanchaStatus = async (id: string, currentStatus: boolean) => {
    if (!escuelaId) return;
    setAlerta(null);
    try {
      await toggleCanchaStatus(escuelaId, id, currentStatus);
      setAlerta({
        tipo: 'success',
        mensaje: `Grupo ${currentStatus ? 'desactivado' : 'activado'} correctamente.`
      });
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cambiar el estado de la cancha.' });
    }
  };

  // ========================================================================
  // Funciones de Horarios
  // ========================================================================

  const handleCreateHorario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId || !newHorarioTime.trim()) return;

    setAlerta(null);
    try {
      await createHorario(escuelaId, newHorarioTime.trim());
      setAlerta({ tipo: 'success', mensaje: 'Horario creado correctamente.' });
      setNewHorarioTime('');
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al crear el horario.' });
    }
  };

  const startEditHorario = (horario: Horario) => {
    setEditingHorario(horario.id);
    setEditHorarioTime(horario.hora);
    setAlerta(null);
  };

  const cancelEditHorario = () => {
    setEditingHorario(null);
    setEditHorarioTime('');
    setAlerta(null);
  };

  const handleUpdateHorario = async (id: string) => {
    if (!escuelaId || !editHorarioTime.trim()) return;

    setAlerta(null);
    try {
      await updateHorario(escuelaId, id, editHorarioTime.trim());
      setAlerta({ tipo: 'success', mensaje: 'Horario actualizado correctamente.' });
      setEditingHorario(null);
      setEditHorarioTime('');
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al actualizar el horario.' });
    }
  };

  const handleToggleHorarioStatus = async (id: string, currentStatus: boolean) => {
    if (!escuelaId) return;
    setAlerta(null);
    try {
      await toggleHorarioStatus(escuelaId, id, currentStatus);
      setAlerta({
        tipo: 'success',
        mensaje: `Horario ${currentStatus ? 'desactivado' : 'activada'} correctamente.`
      });
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cambiar el estado del horario.' });
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
              <Settings size={28} style={{ marginRight: '0.5rem', color: 'var(--primary)' }} />
              Grupos y Horarios
            </h1>
            <p className="pc-subtitulo">Configura los espacios y los horarios disponibles para tus entrenamientos</p>
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem' }}>
        <button
          onClick={() => {
            setActiveTab('canchas');
            setAlerta(null);
          }}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            color: activeTab === 'canchas' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'canchas' ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: '-1px'
          }}
        >
          Grupos
        </button>
        <button
          onClick={() => {
            setActiveTab('horarios');
            setAlerta(null);
          }}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            color: activeTab === 'horarios' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'horarios' ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: '-1px'
          }}
        >
          Horarios
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Cargando configuraciones...
        </div>
      ) : activeTab === 'canchas' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Formulario de Canchas */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
              Agregar Nuevo Grupo
            </h2>
            <form onSubmit={handleCreateCancha} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Nombre del grupo</label>
                <input
                  type="text"
                  placeholder="Ej: Grupo Formativo 1"
                  value={newCanchaName}
                  onChange={(e) => setNewCanchaName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  required
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Sucursal Asignada</label>
                <select
                  value={newCanchaSucursal}
                  onChange={(e) => setNewCanchaSucursal(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px' }}
                >
                  <option value="">-- Selecciona sucursal (Opcional) --</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>

              <div style={{ flex: '1 1 100%', marginTop: '0.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Horarios Disponibles para el Grupo</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', background: 'var(--bg-input)', padding: '0.8rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  {horarios.length === 0 ? (
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No hay horarios registrados. Crea horarios en la pestaña "Horarios".</span>
                  ) : (
                    horarios.filter(h => h.activo).map((h) => (
                      <label key={h.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', color: 'var(--text-primary)', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={newCanchaHorarios.includes(h.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewCanchaHorarios([...newCanchaHorarios, h.id]);
                            } else {
                              setNewCanchaHorarios(newCanchaHorarios.filter(id => id !== h.id));
                            }
                          }}
                        />
                        {h.hora}
                      </label>
                    ))
                  )}
                </div>
              </div>

              <button
                type="submit"
                className="btn-nueva-cuenta"
                style={{ height: '42px', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.5rem' }}
              >
                <Plus size={18} />
                Agregar Grupo
              </button>
            </form>
            {sucursales.length === 0 && (
              <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <AlertTriangle size={14} /> No tienes sucursales registradas. Primero crea una sucursal en el Panel de Escuela.
              </p>
            )}
          </div>

          {/* Tabla de Canchas */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Nombre</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Sucursal</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Horarios</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {canchas.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No hay grupos registrados en el sistema.
                    </td>
                  </tr>
                ) : (
                  canchas.map((cancha) => (
                    <tr key={cancha.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'var(--transition)' }} className="hover-row">
                      <td style={{ padding: '1rem' }}>
                        {editingCancha === cancha.id ? (
                          <input
                            type="text"
                            value={editCanchaName}
                            onChange={(e) => setEditCanchaName(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', width: '200px' }}
                            autoFocus
                          />
                        ) : (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{cancha.nombre}</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {editingCancha === cancha.id ? (
                          <select
                            value={editCanchaSucursal}
                            onChange={(e) => setEditCanchaSucursal(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', height: '34px' }}
                          >
                            <option value="">-- Selecciona sucursal (Opcional) --</option>
                            {sucursales.map((s) => (
                              <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {cancha.sucursal?.nombre || <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>Sin sucursal</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {editingCancha === cancha.id ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', maxWidth: '300px' }}>
                            {horarios.filter(h => h.activo).map((h) => (
                              <label key={h.id} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2rem', fontSize: '0.75rem' }}>
                                <input
                                  type="checkbox"
                                  checked={editCanchaHorarios.includes(h.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setEditCanchaHorarios([...editCanchaHorarios, h.id]);
                                    } else {
                                      setEditCanchaHorarios(editCanchaHorarios.filter(id => id !== h.id));
                                    }
                                  }}
                                />
                                {h.hora}
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                            {(!cancha.horarios || cancha.horarios.length === 0) ? (
                              <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', italic: 'true' }}>Sin horarios</span>
                            ) : (
                              cancha.horarios.map((h) => (
                                <span key={h.id} style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: '4px', padding: '0.1rem 0.4rem', fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}>
                                  {h.hora}
                                </span>
                              ))
                            )}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        {cancha.activo ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--success)', fontSize: '0.85rem', fontWeight: 600 }}>
                            <CheckCircle size={15} /> Activa
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--danger)', fontSize: '0.85rem', fontWeight: 600 }}>
                            <XCircle size={15} /> Inactiva
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          {editingCancha === cancha.id ? (
                            <>
                              <button
                                onClick={() => handleUpdateCancha(cancha.id)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(0, 210, 106, 0.3)',
                                  background: 'var(--success-bg)',
                                  color: 'var(--success)',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}
                              >
                                <Save size={14} /> Guardar
                              </button>
                              <button
                                onClick={cancelEditCancha}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-glass)',
                                  color: 'var(--text-secondary)',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}
                              >
                                <X size={14} /> Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditCancha(cancha)}
                                style={{
                                  padding: '0.4rem',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-glass)',
                                  color: 'var(--text-secondary)',
                                  display: 'inline-flex',
                                  alignItems: 'center'
                                }}
                                title="Editar grupo"
                                className="hover-color-orange"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleToggleCanchaStatus(cancha.id, cancha.activo)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: `1px solid ${cancha.activo ? 'rgba(255, 59, 48, 0.3)' : 'rgba(0, 210, 106, 0.3)'}`,
                                  background: cancha.activo ? 'var(--danger-bg)' : 'var(--success-bg)',
                                  color: cancha.activo ? 'var(--danger)' : 'var(--success)',
                                  fontWeight: 600
                                }}
                              >
                                {cancha.activo ? 'Desactivar' : 'Activar'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Formulario de Horarios */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
              Agregar Nuevo Horario
            </h2>
            <form onSubmit={handleCreateHorario} style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', maxWidth: '500px' }}>
              <div style={{ flex: '1' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Hora de Entrenamiento</label>
                <input
                  type="text"
                  placeholder="HH:MM (ej: 18:30)"
                  value={newHorarioTime}
                  onChange={(e) => setNewHorarioTime(e.target.value)}
                  pattern="^([01]\d|2[0-3]):([0-5]\d)$"
                  title="Formato de hora de 24 horas: HH:MM (ejemplo: 17:00)"
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  required
                />
              </div>
              <button
                type="submit"
                className="btn-nueva-cuenta"
                style={{ height: '42px', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Plus size={18} />
                Agregar Horario
              </button>
            </form>
          </div>

          {/* Tabla de Horarios */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Hora</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {horarios.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No hay horarios registrados en el sistema.
                    </td>
                  </tr>
                ) : (
                  horarios.map((horario) => (
                    <tr key={horario.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'var(--transition)' }} className="hover-row">
                      <td style={{ padding: '1rem' }}>
                        {editingHorario === horario.id ? (
                          <input
                            type="text"
                            value={editHorarioTime}
                            onChange={(e) => setEditHorarioTime(e.target.value)}
                            pattern="^([01]\d|2[0-3]):([0-5]\d)$"
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', width: '150px' }}
                            autoFocus
                          />
                        ) : (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{horario.hora}</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        {horario.activo ? (
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
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                          {editingHorario === horario.id ? (
                            <>
                              <button
                                onClick={() => handleUpdateHorario(horario.id)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(0, 210, 106, 0.3)',
                                  background: 'var(--success-bg)',
                                  color: 'var(--success)',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}
                              >
                                <Save size={14} /> Guardar
                              </button>
                              <button
                                onClick={cancelEditHorario}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-glass)',
                                  color: 'var(--text-secondary)',
                                  fontWeight: 600,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '0.25rem'
                                }}
                              >
                                <X size={14} /> Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditHorario(horario)}
                                style={{
                                  padding: '0.4rem',
                                  borderRadius: '4px',
                                  border: '1px solid var(--border)',
                                  background: 'var(--bg-glass)',
                                  color: 'var(--text-secondary)',
                                  display: 'inline-flex',
                                  alignItems: 'center'
                                }}
                                title="Editar horario"
                                className="hover-color-orange"
                              >
                                <Edit2 size={16} />
                              </button>
                              <button
                                onClick={() => handleToggleHorarioStatus(horario.id, horario.activo)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: `1px solid ${horario.activo ? 'rgba(255, 59, 48, 0.3)' : 'rgba(0, 210, 106, 0.3)'}`,
                                  background: horario.activo ? 'var(--danger-bg)' : 'var(--success-bg)',
                                  color: horario.activo ? 'var(--danger)' : 'var(--success)',
                                  fontWeight: 600
                                }}
                              >
                                {horario.activo ? 'Desactivar' : 'Activar'}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
};

export default ConfiguracionCanchas;
