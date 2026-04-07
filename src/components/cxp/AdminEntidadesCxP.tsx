/**
 * AdminEntidadesCxP.tsx
 * Panel de administración CRUD para Proveedores y Personal (Trabajadores).
 * Permite crear, editar y activar/desactivar registros con datos básicos:
 *  - Nombre
 *  - Dirección
 *  - Teléfono
 *  - Contacto (persona de contacto del proveedor o cónyuge/emergencia del trabajador)
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  ChevronLeft, Plus, Edit2, ToggleLeft, ToggleRight,
  Save, X, AlertCircle, Check, Truck, Users, RefreshCw
} from 'lucide-react';

type TabActiva = 'proveedores' | 'personal';

interface Proveedor {
  id: string;
  nombre: string;
  nit_ci: string | null;
  telefono: string | null;
  direccion: string | null;
  contacto: string | null;
  activo: boolean;
}

interface Personal {
  id: string;
  nombres: string;
  apellidos: string;
  cargo: string | null;
  telefono: string | null;
  direccion: string | null;
  contacto_emergencia: string | null;
  salario_base: number | null;
  activo: boolean;
}

interface Props {
  onVolver: () => void;
}

const AdminEntidadesCxP: React.FC<Props> = ({ onVolver }) => {
  const [tab, setTab] = useState<TabActiva>('proveedores');
  const [escuelaId, setEscuelaId] = useState<string | null>(null);

  // Datos
  const [proveedores, setProveedores] = useState<Proveedor[]>([]);
  const [personal, setPersonal] = useState<Personal[]>([]);
  const [cargando, setCargando] = useState(true);

  // Formulario activo
  const [editandoId, setEditandoId] = useState<string | 'nuevo' | null>(null);
  const [formProv, setFormProv] = useState<Partial<Proveedor>>({});
  const [formPers, setFormPers] = useState<Partial<Personal>>({});
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  /** Inicializar escuela */
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      setEscuelaId(data?.escuela_id ?? null);
    };
    init();
  }, []);

  /** Cargar datos según tab */
  useEffect(() => {
    if (!escuelaId) return;
    cargarDatos();
  }, [escuelaId, tab]);

  const cargarDatos = async () => {
    if (!escuelaId) return;
    setCargando(true);
    if (tab === 'proveedores') {
      const { data } = await supabase.from('proveedores')
        .select('id, nombre, nit_ci, telefono, direccion, contacto, activo')
        .eq('escuela_id', escuelaId).order('nombre');
      setProveedores(data ?? []);
    } else {
      const { data } = await supabase.from('personal')
        .select('id, nombres, apellidos, cargo, telefono, direccion, contacto_emergencia, salario_base, activo')
        .eq('escuela_id', escuelaId).order('nombres');
      setPersonal(data ?? []);
    }
    setCargando(false);
  };

  /** Abrir formulario de edición */
  const abrirEditar = (item: Proveedor | Personal | 'nuevo') => {
    setError(null); setExito(null);
    if (item === 'nuevo') {
      setEditandoId('nuevo');
      tab === 'proveedores'
        ? setFormProv({ nombre: '', activo: true })
        : setFormPers({ nombres: '', apellidos: '', activo: true });
    } else if (tab === 'proveedores') {
      setEditandoId((item as Proveedor).id);
      setFormProv({ ...(item as Proveedor) });
    } else {
      setEditandoId((item as Personal).id);
      setFormPers({ ...(item as Personal) });
    }
  };

  /** Guardar proveedor */
  const guardarProveedor = async () => {
    if (!formProv.nombre?.trim()) { setError('El nombre es obligatorio.'); return; }
    setGuardando(true); setError(null);

    const payload = {
      escuela_id: escuelaId!,
      nombre: formProv.nombre!.trim(),
      nit_ci: formProv.nit_ci?.trim() || null,
      telefono: formProv.telefono?.trim() || null,
      direccion: formProv.direccion?.trim() || null,
      contacto: formProv.contacto?.trim() || null,
      activo: formProv.activo ?? true,
    };

    if (editandoId === 'nuevo') {
      const { error: err } = await supabase.from('proveedores').insert(payload);
      if (err) { setError(err.message); setGuardando(false); return; }
    } else {
      const { error: err } = await supabase.from('proveedores').update(payload).eq('id', editandoId!);
      if (err) { setError(err.message); setGuardando(false); return; }
    }

    setExito('✅ Proveedor guardado correctamente.');
    setGuardando(false);
    setEditandoId(null);
    setTimeout(() => { setExito(null); cargarDatos(); }, 1200);
  };

  /** Guardar personal */
  const guardarPersonal = async () => {
    if (!formPers.nombres?.trim() || !formPers.apellidos?.trim()) {
      setError('Nombres y apellidos son obligatorios.'); return;
    }
    setGuardando(true); setError(null);

    const payload = {
      escuela_id: escuelaId!,
      nombres: formPers.nombres!.trim(),
      apellidos: formPers.apellidos!.trim(),
      cargo: formPers.cargo?.trim() || null,
      telefono: formPers.telefono?.trim() || null,
      direccion: formPers.direccion?.trim() || null,
      contacto_emergencia: formPers.contacto_emergencia?.trim() || null,
      salario_base: formPers.salario_base ? Number(formPers.salario_base) : null,
      activo: formPers.activo ?? true,
    };

    if (editandoId === 'nuevo') {
      const { error: err } = await supabase.from('personal').insert(payload);
      if (err) { setError(err.message); setGuardando(false); return; }
    } else {
      const { error: err } = await supabase.from('personal').update(payload).eq('id', editandoId!);
      if (err) { setError(err.message); setGuardando(false); return; }
    }

    setExito('✅ Trabajador guardado correctamente.');
    setGuardando(false);
    setEditandoId(null);
    setTimeout(() => { setExito(null); cargarDatos(); }, 1200);
  };

  /** Toggle activo/inactivo */
  const toggleActivo = async (id: string, activo: boolean) => {
    const tabla = tab === 'proveedores' ? 'proveedores' : 'personal';
    await supabase.from(tabla).update({ activo: !activo }).eq('id', id);
    cargarDatos();
  };

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={onVolver} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo" style={{ color: '#8b5cf6' }}>
              ⚙️ Administrar Proveedores y Personal
            </h1>
            <p className="pc-subtitulo">
              Gestiona los datos básicos de tus proveedores y trabajadores
            </p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button
            className="btn-nueva-cuenta"
            style={{ background: '#8b5cf6' }}
            onClick={() => abrirEditar('nuevo')}
          >
            <Plus size={18} /> {tab === 'proveedores' ? 'Nuevo Proveedor' : 'Nuevo Trabajador'}
          </button>
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <button
          className={`nota-mes-btn ${tab === 'proveedores' ? 'nota-mes-btn--activo' : ''}`}
          onClick={() => { setTab('proveedores'); setEditandoId(null); }}
          style={{ padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Truck size={15} /> Proveedores
        </button>
        <button
          className={`nota-mes-btn ${tab === 'personal' ? 'nota-mes-btn--activo' : ''}`}
          onClick={() => { setTab('personal'); setEditandoId(null); }}
          style={{ padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Users size={15} /> Personal / Trabajadores
        </button>
      </div>

      {/* Formulario de creación/edición (inline) */}
      {editandoId !== null && (
        <div style={{
          background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.3)',
          borderRadius: '12px', padding: '1.25rem', marginBottom: '1.5rem'
        }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '1rem', color: '#a78bfa' }}>
            {editandoId === 'nuevo'
              ? (tab === 'proveedores' ? '🏭 Nuevo Proveedor' : '👤 Nuevo Trabajador')
              : '✏️ Editar'
            }
          </h3>

          {tab === 'proveedores' ? (
            <div className="admin-form-grid">
              <div className="form-campo">
                <label>Nombre *</label>
                <input type="text" value={formProv.nombre || ''} onChange={e => setFormProv(p => ({ ...p, nombre: e.target.value }))} placeholder="Nombre del proveedor" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>NIT / CI</label>
                <input type="text" value={formProv.nit_ci || ''} onChange={e => setFormProv(p => ({ ...p, nit_ci: e.target.value }))} placeholder="NIT o CI" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Teléfono</label>
                <input type="text" value={formProv.telefono || ''} onChange={e => setFormProv(p => ({ ...p, telefono: e.target.value }))} placeholder="Teléfono de contacto" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Persona de Contacto</label>
                <input type="text" value={formProv.contacto || ''} onChange={e => setFormProv(p => ({ ...p, contacto: e.target.value }))} placeholder="Nombre del encargado" disabled={guardando} />
              </div>
              <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
                <label>Dirección</label>
                <input type="text" value={formProv.direccion || ''} onChange={e => setFormProv(p => ({ ...p, direccion: e.target.value }))} placeholder="Dirección del proveedor" disabled={guardando} />
              </div>
            </div>
          ) : (
            <div className="admin-form-grid">
              <div className="form-campo">
                <label>Nombres *</label>
                <input type="text" value={formPers.nombres || ''} onChange={e => setFormPers(p => ({ ...p, nombres: e.target.value }))} placeholder="Nombres" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Apellidos *</label>
                <input type="text" value={formPers.apellidos || ''} onChange={e => setFormPers(p => ({ ...p, apellidos: e.target.value }))} placeholder="Apellidos" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Cargo</label>
                <input type="text" value={formPers.cargo || ''} onChange={e => setFormPers(p => ({ ...p, cargo: e.target.value }))} placeholder="Ej: Entrenador, Administrador..." disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Teléfono</label>
                <input type="text" value={formPers.telefono || ''} onChange={e => setFormPers(p => ({ ...p, telefono: e.target.value }))} placeholder="Teléfono" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Cónyuge / Contacto de emergencia</label>
                <input type="text" value={formPers.contacto_emergencia || ''} onChange={e => setFormPers(p => ({ ...p, contacto_emergencia: e.target.value }))} placeholder="Nombre del cónyuge o contacto" disabled={guardando} />
              </div>
              <div className="form-campo">
                <label>Salario base (Bs)</label>
                <input type="number" step="0.01" min="0" value={formPers.salario_base || ''} onChange={e => setFormPers(p => ({ ...p, salario_base: parseFloat(e.target.value) }))} placeholder="0.00" disabled={guardando} />
              </div>
              <div className="form-campo" style={{ gridColumn: '1 / -1' }}>
                <label>Dirección</label>
                <input type="text" value={formPers.direccion || ''} onChange={e => setFormPers(p => ({ ...p, direccion: e.target.value }))} placeholder="Dirección del trabajador" disabled={guardando} />
              </div>
            </div>
          )}

          {error && <div className="form-msg form-msg--error" style={{ marginTop: '0.5rem' }}><AlertCircle size={13} /> {error}</div>}
          {exito && <div className="form-msg form-msg--exito" style={{ marginTop: '0.5rem' }}><Check size={13} /> {exito}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn-guardar-cuenta"
              onClick={tab === 'proveedores' ? guardarProveedor : guardarPersonal}
              disabled={guardando}
            >
              <Save size={15} /> {guardando ? 'Guardando...' : 'Guardar'}
            </button>
            <button
              type="button"
              className="btn-refrescar"
              onClick={() => { setEditandoId(null); setError(null); setExito(null); }}
              disabled={guardando}
            >
              <X size={15} /> Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Listado */}
      {cargando ? (
        <div className="pc-cargando"><RefreshCw size={28} className="spin" /><p>Cargando...</p></div>
      ) : tab === 'proveedores' ? (
        proveedores.length === 0 ? (
          <div className="arbol-vacio">
            <Truck size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p>No hay proveedores registrados. Agrega el primero.</p>
          </div>
        ) : (
          <div className="cxc-lista">
            <div className="cxc-alumno-row cxc-alumno-row--header">
              <span>Nombre</span>
              <span>Contacto</span>
              <span>Teléfono</span>
              <span>Dirección</span>
              <span className="cxc-col-center">Estado</span>
              <span></span>
            </div>
            {proveedores.map(p => (
              <div key={p.id} className="cxc-alumno-row">
                <span className="cxc-alumno-nombre" style={{ opacity: p.activo ? 1 : 0.45 }}>
                  <Truck size={13} /> {p.nombre}
                </span>
                <span className="cxc-alumno-meta">{p.contacto || '—'}</span>
                <span className="cxc-alumno-meta">{p.telefono || '—'}</span>
                <span className="cxc-alumno-meta" style={{ fontSize: '0.8rem', color: '#64748b' }}>{p.direccion || '—'}</span>
                <span className="cxc-col-center">
                  <button
                    onClick={() => toggleActivo(p.id, p.activo)}
                    title={p.activo ? 'Desactivar' : 'Activar'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.activo ? '#4ade80' : '#64748b' }}
                  >
                    {p.activo ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                </span>
                <span>
                  <button className="cxc-btn-nota-rapida" onClick={() => abrirEditar(p)} title="Editar">
                    <Edit2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )
      ) : (
        personal.length === 0 ? (
          <div className="arbol-vacio">
            <Users size={36} style={{ opacity: 0.3, marginBottom: '0.75rem' }} />
            <p>No hay trabajadores registrados. Agrega el primero.</p>
          </div>
        ) : (
          <div className="cxc-lista">
            <div className="cxc-alumno-row cxc-alumno-row--header">
              <span>Nombre</span>
              <span>Cargo</span>
              <span>Contacto emergencia</span>
              <span>Teléfono</span>
              <span className="cxc-col-center">Estado</span>
              <span></span>
            </div>
            {personal.map(p => (
              <div key={p.id} className="cxc-alumno-row">
                <span className="cxc-alumno-nombre" style={{ opacity: p.activo ? 1 : 0.45 }}>
                  <Users size={13} /> {p.nombres} {p.apellidos}
                </span>
                <span className="cxc-alumno-meta">{p.cargo || '—'}</span>
                <span className="cxc-alumno-meta">{p.contacto_emergencia || '—'}</span>
                <span className="cxc-alumno-meta">{p.telefono || '—'}</span>
                <span className="cxc-col-center">
                  <button
                    onClick={() => toggleActivo(p.id, p.activo)}
                    title={p.activo ? 'Desactivar' : 'Activar'}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: p.activo ? '#4ade80' : '#64748b' }}
                  >
                    {p.activo ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                  </button>
                </span>
                <span>
                  <button className="cxc-btn-nota-rapida" onClick={() => abrirEditar(p)} title="Editar">
                    <Edit2 size={13} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        )
      )}
    </main>
  );
};

export default AdminEntidadesCxP;
