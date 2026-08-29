import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Settings, Plus, CheckCircle, XCircle, Edit2, Save, X, AlertTriangle, Trash2 } from 'lucide-react';
import { useAuthSaaSport } from '../../lib/authHelper';
import {
  getAllGrupos,
  getAllHorarios,
  createGrupo,
  createHorario,
  updateGrupo,
  updateHorario,
  toggleGrupoStatus,
  toggleHorarioStatus,
  deleteGrupo
} from '../../services/maestros';
import type { Grupo, Horario } from '../../services/maestros';
import { getSucursales } from '../../services/sucursales';
import type { Sucursal } from '../../services/sucursales';
import { getUsuarios } from '../../services/usuarios';
import type { Usuario } from '../../services/usuarios';

const ConfiguracionGrupos: React.FC = () => {
  const navigate = useNavigate();
  const { escuelaId, perfil } = useAuthSaaSport();

  const [activeTab, setActiveTab] = useState<'grupos' | 'horarios'>('grupos');
  const [loading, setLoading] = useState(true);

  // Estado de Grupos
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [newGrupoName, setNewGrupoName] = useState('');
  const [newGrupoSucursal, setNewGrupoSucursal] = useState('');
  const [newGrupoHorario, setNewGrupoHorario] = useState('');
  const [newGrupoEntrenador, setNewGrupoEntrenador] = useState('');
  const [editingGrupo, setEditingGrupo] = useState<string | null>(null);
  const [editGrupoName, setEditGrupoName] = useState('');
  const [editGrupoSucursal, setEditGrupoSucursal] = useState('');
  const [editGrupoHorario, setEditGrupoHorario] = useState('');
  const [editGrupoEntrenador, setEditGrupoEntrenador] = useState('');

  // Estado de Sucursales y Entrenadores
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [entrenadores, setEntrenadores] = useState<Usuario[]>([]);

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
      const [chs, hrs, sucs, usrs] = await Promise.all([
        getAllGrupos(escuelaId),
        getAllHorarios(escuelaId),
        getSucursales(escuelaId),
        perfil ? getUsuarios(escuelaId, perfil) : Promise.resolve([])
      ]);
      setGrupos(chs || []);
      setHorarios(hrs || []);
      setSucursales(sucs || []);
      setEntrenadores((usrs || []).filter(u => u.rol === 'Entrenador' && u.activo));
    } catch (error: any) {
      console.error(error);
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cargar las configuraciones.' });
    } finally {
      setLoading(false);
    }
  };

  // ========================================================================
  // Funciones de Grupos
  // ========================================================================

  const handleCreateGrupo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!escuelaId || !newGrupoName.trim()) return;

    if (!newGrupoHorario) {
      setAlerta({ tipo: 'error', mensaje: 'Debes seleccionar un horario para el grupo.' });
      return;
    }

    setAlerta(null);
    try {
      await createGrupo(
        escuelaId,
        newGrupoName.trim(),
        newGrupoSucursal || null,
        newGrupoHorario || null,
        newGrupoEntrenador || null
      );
      setAlerta({ tipo: 'success', mensaje: 'Grupo creado correctamente con su horario y entrenador asignado.' });
      setNewGrupoName('');
      setNewGrupoSucursal('');
      setNewGrupoHorario('');
      setNewGrupoEntrenador('');
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al crear el grupo.' });
    }
  };

  const startEditGrupo = (grupo: Grupo) => {
    setEditingGrupo(grupo.id);
    setEditGrupoName(grupo.nombre);
    setEditGrupoSucursal(grupo.sucursal_id || '');
    setEditGrupoHorario(grupo.horario_id || (grupo.horario_ids?.[0] || ''));
    setEditGrupoEntrenador(grupo.entrenador_id || '');
    setAlerta(null);
  };

  const cancelEditGrupo = () => {
    setEditingGrupo(null);
    setEditGrupoName('');
    setEditGrupoSucursal('');
    setEditGrupoHorario('');
    setEditGrupoEntrenador('');
    setAlerta(null);
  };

  const handleUpdateGrupo = async (id: string) => {
    if (!escuelaId || !editGrupoName.trim()) return;

    setAlerta(null);
    try {
      await updateGrupo(
        escuelaId,
        id,
        editGrupoName.trim(),
        editGrupoSucursal || null,
        editGrupoHorario || null,
        editGrupoEntrenador || null
      );
      setAlerta({ tipo: 'success', mensaje: 'Grupo actualizado correctamente.' });
      setEditingGrupo(null);
      setEditGrupoName('');
      setEditGrupoSucursal('');
      setEditGrupoHorario('');
      setEditGrupoEntrenador('');
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al actualizar el grupo.' });
    }
  };

  const handleToggleGrupoStatus = async (id: string, currentStatus: boolean) => {
    if (!escuelaId) return;
    setAlerta(null);
    try {
      await toggleGrupoStatus(escuelaId, id, currentStatus);
      setAlerta({
        tipo: 'success',
        mensaje: `Grupo ${currentStatus ? 'desactivado' : 'activado'} correctamente.`
      });
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al cambiar el estado del grupo.' });
    }
  };

  const handleDeleteGrupo = async (id: string, nombre: string) => {
    if (!escuelaId) return;
    if (!window.confirm(`¿Estás seguro de que deseas eliminar permanentemente el grupo "${nombre}"?`)) return;

    setAlerta(null);
    try {
      await deleteGrupo(escuelaId, id);
      setAlerta({ tipo: 'success', mensaje: 'Grupo eliminado correctamente.' });
      loadData();
    } catch (error: any) {
      setAlerta({ tipo: 'error', mensaje: error.message || 'Error al eliminar el grupo.' });
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
        <button
          onClick={() => {
            setActiveTab('grupos');
            setAlerta(null);
          }}
          style={{
            padding: '0.75rem 1.5rem',
            fontWeight: 600,
            fontSize: '1rem',
            color: activeTab === 'grupos' ? 'var(--primary)' : 'var(--text-secondary)',
            borderBottom: activeTab === 'grupos' ? '2px solid var(--primary)' : '2px solid transparent',
            marginBottom: '-1px'
          }}
        >
          Grupos
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Cargando configuraciones...
        </div>
      ) : activeTab === 'grupos' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {/* Formulario de Grupos */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '1.25rem' }}>
              Agregar Nuevo Grupo
            </h2>
            <form onSubmit={handleCreateGrupo} style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Nombre del grupo *</label>
                <input
                  type="text"
                  placeholder="Ej: Grupo Formativo 1"
                  value={newGrupoName}
                  onChange={(e) => setNewGrupoName(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px', borderRadius: '4px' }}
                  required
                />
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Sucursal Asignada</label>
                <select
                  value={newGrupoSucursal}
                  onChange={(e) => setNewGrupoSucursal(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px', borderRadius: '4px' }}
                >
                  <option value="">-- Selecciona sucursal (Opcional) --</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>{s.nombre}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Horario del Grupo *</label>
                <select
                  value={newGrupoHorario}
                  onChange={(e) => setNewGrupoHorario(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px', borderRadius: '4px' }}
                  required
                >
                  <option value="">-- Selecciona horario --</option>
                  {horarios.filter(h => h.activo).map((h) => (
                    <option key={h.id} value={h.id}>{h.hora}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: '1 1 200px' }}>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>Entrenador Asignado</label>
                <select
                  value={newGrupoEntrenador}
                  onChange={(e) => setNewGrupoEntrenador(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', height: '42px', borderRadius: '4px' }}
                >
                  <option value="">-- Sin asignar --</option>
                  {entrenadores.map((u) => (
                    <option key={u.id} value={u.id}>{u.nombres} {u.apellidos}</option>
                  ))}
                </select>
              </div>

              <div style={{ width: '100%', display: 'flex', justifyContent: 'flex-start', marginTop: '0.5rem' }}>
                <button
                  type="submit"
                  className="btn-nueva-cuenta"
                  style={{ height: '42px', padding: '0 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                >
                  <Plus size={18} />
                  Agregar Grupo
                </button>
              </div>
            </form>
            {sucursales.length === 0 && (
              <p style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <AlertTriangle size={14} /> No tienes sucursales registradas. Primero crea una sucursal en el Panel de Escuela.
              </p>
            )}
          </div>

          {/* Tabla de Grupos */}
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid var(--border)' }}>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Nombre</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Sucursal</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Horario</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem' }}>Entrenador</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'center' }}>Estado</th>
                  <th style={{ padding: '1rem', color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {grupos.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                      No hay grupos registrados en el sistema.
                    </td>
                  </tr>
                ) : (
                  grupos.map((grupo) => (
                    <tr key={grupo.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)', transition: 'var(--transition)' }} className="hover-row">
                      <td style={{ padding: '1rem' }}>
                        {editingGrupo === grupo.id ? (
                          <input
                            type="text"
                            value={editGrupoName}
                            onChange={(e) => setEditGrupoName(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', width: '180px' }}
                            autoFocus
                          />
                        ) : (
                          <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{grupo.nombre}</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {editingGrupo === grupo.id ? (
                          <select
                            value={editGrupoSucursal}
                            onChange={(e) => setEditGrupoSucursal(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', height: '34px' }}
                          >
                            <option value="">-- Selecciona sucursal --</option>
                            {sucursales.map((s) => (
                              <option key={s.id} value={s.id}>{s.nombre}</option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {grupo.sucursal?.nombre || <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>Sin sucursal</span>}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {editingGrupo === grupo.id ? (
                          <select
                            value={editGrupoHorario}
                            onChange={(e) => setEditGrupoHorario(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', height: '34px' }}
                          >
                            <option value="">-- Selecciona horario --</option>
                            {horarios.filter(h => h.activo).map((h) => (
                              <option key={h.id} value={h.id}>{h.hora}</option>
                            ))}
                          </select>
                        ) : (
                          grupo.horario_hora ? (
                            <span style={{ background: 'var(--success-bg)', border: '1px solid rgba(0, 210, 106, 0.3)', borderRadius: '4px', padding: '0.15rem 0.5rem', fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>
                              {grupo.horario_hora}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', fontStyle: 'italic' }}>Sin horario</span>
                          )
                        )}
                      </td>
                      <td style={{ padding: '1rem' }}>
                        {editingGrupo === grupo.id ? (
                          <select
                            value={editGrupoEntrenador}
                            onChange={(e) => setEditGrupoEntrenador(e.target.value)}
                            style={{ padding: '0.4rem 0.6rem', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: '4px', height: '34px' }}
                          >
                            <option value="">-- Sin asignar --</option>
                            {entrenadores.map((u) => (
                              <option key={u.id} value={u.id}>{u.nombres} {u.apellidos}</option>
                            ))}
                          </select>
                        ) : (
                          grupo.entrenador_nombre ? (
                            <span style={{ color: 'var(--text-primary)', fontWeight: 500, fontSize: '0.9rem' }}>
                              {grupo.entrenador_nombre}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem', fontStyle: 'italic' }}>
                              Sin asignar
                            </span>
                          )
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        {grupo.activo ? (
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
                          {editingGrupo === grupo.id ? (
                            <>
                              <button
                                onClick={() => handleUpdateGrupo(grupo.id)}
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
                                onClick={cancelEditGrupo}
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
                                onClick={() => startEditGrupo(grupo)}
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
                                onClick={() => handleToggleGrupoStatus(grupo.id, grupo.activo)}
                                style={{
                                  fontSize: '0.75rem',
                                  padding: '0.4rem 0.75rem',
                                  borderRadius: '4px',
                                  border: `1px solid ${grupo.activo ? 'rgba(255, 59, 48, 0.3)' : 'rgba(0, 210, 106, 0.3)'}`,
                                  background: grupo.activo ? 'var(--danger-bg)' : 'var(--success-bg)',
                                  color: grupo.activo ? 'var(--danger)' : 'var(--success)',
                                  fontWeight: 600
                                }}
                              >
                                {grupo.activo ? 'Desactivar' : 'Activar'}
                              </button>
                              <button
                                onClick={() => handleDeleteGrupo(grupo.id, grupo.nombre)}
                                style={{
                                  padding: '0.4rem',
                                  borderRadius: '4px',
                                  border: '1px solid rgba(255, 59, 48, 0.3)',
                                  background: 'var(--danger-bg)',
                                  color: 'var(--danger)',
                                  display: 'inline-flex',
                                  alignItems: 'center'
                                }}
                                title="Eliminar grupo"
                              >
                                <Trash2 size={16} />
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

export default ConfiguracionGrupos;
