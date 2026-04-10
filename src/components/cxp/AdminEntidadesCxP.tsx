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
  Save, X, AlertCircle, Check, Truck, Users, RefreshCw, Trash2
} from 'lucide-react';
import ModalEntidadCxP from './ModalEntidadCxP';

type TabActiva = 'proveedores' | 'personal';

interface Proveedor {
  id: string;
  nombre: string;
  nit_ci: string | null;
  telefono: string | null;
  direccion: string | null;
  contacto: string | null;
  /** Categoría única del proveedor */
  categoria: string;
  activo: boolean;
}

/** Etiquetas de categorías de proveedor */
const CATEGORIAS_PROVEEDOR = [
  { value: 'uniforme',          label: 'Proveedor de Uniformes' },
  { value: 'trabajador',        label: 'Trabajadores' },
  { value: 'servicios_basicos', label: 'Servicios Básicos' },
  { value: 'alquiler',          label: 'Alquileres' },
  { value: 'otro',              label: 'Otros' },
];

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

  // Modal de edición
  const [mostrarModal, setMostrarModal] = useState(false);
  const [itemAEditar, setItemAEditar] = useState<any | null>(null);
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
        .select('id, nombre, nit_ci, telefono, direccion, contacto, categoria, activo')
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

  /** Abrir modal de registro/edición */
  const abrirEditar = (item: Proveedor | Personal | 'nuevo') => {
    if (item === 'nuevo') {
      setItemAEditar(null);
    } else {
      setItemAEditar(item);
    }
    setMostrarModal(true);
  };

  /** Toggle activo/inactivo */
  const toggleActivo = async (id: string, activo: boolean) => {
    const tabla = tab === 'proveedores' ? 'proveedores' : 'personal';
    await supabase.from(tabla).update({ activo: !activo }).eq('id', id);
    cargarDatos();
  };

  return (
    <main className="main-content">
      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={onVolver} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Administrar Proveedores y Personal</h1>
          </div>
        </div>
        <div className="cxc-header-acciones">
          <button
            className="btn-nueva-cuenta"
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
          onClick={() => { setTab('proveedores'); setMostrarModal(false); }}
          style={{ padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Truck size={15} /> Proveedores
        </button>
        <button
          className={`nota-mes-btn ${tab === 'personal' ? 'nota-mes-btn--activo' : ''}`}
          onClick={() => { setTab('personal'); setMostrarModal(false); }}
          style={{ padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <Users size={15} /> Personal / Trabajadores
        </button>
      </div>



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
              <span>Categoría</span>
              <span>Contacto</span>
              <span>Teléfono</span>
              <span className="cxc-col-center">Estado</span>
              <span></span>
            </div>
            {proveedores.map(p => (
              <div key={p.id} className="cxc-alumno-row">
                <span className="cxc-alumno-nombre" style={{ opacity: p.activo ? 1 : 0.45 }}>
                  <Truck size={13} /> {p.nombre}
                </span>
                <span className="cxc-alumno-meta" style={{ fontSize: '0.8rem' }}>
                  {CATEGORIAS_PROVEEDOR.find(c => c.value === p.categoria)?.label ?? 'Otro'}
                </span>
                <span className="cxc-alumno-meta">{p.contacto || '—'}</span>
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

      {/* Modal Premium de Registro */}
      <ModalEntidadCxP 
        visible={mostrarModal}
        tipo={tab === 'proveedores' ? 'proveedor' : 'personal'}
        itemAEditar={itemAEditar}
        escuelaId={escuelaId}
        onCerrar={() => { setMostrarModal(false); setItemAEditar(null); }}
        onGuardado={cargarDatos}
      />
    </main>
  );
};

export default AdminEntidadesCxP;
