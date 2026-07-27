/**
 * Cuentas.tsx
 * Módulo de Cuentas (ex-Inventarios): gestión de catálogo de ítems (productos, servicios, gastos, otros).
 * Permite definir si un ítem es de Ingreso, Egreso o Ambos.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  RefreshCw, Plus, X, Trash2,
  Edit2, Save, BookOpen, ShoppingBag, Wrench, Receipt, Layers, Search
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useCatalogo } from '../../hooks/useMasterData';
import { useQueryClient } from '@tanstack/react-query';

const obtenerCtx = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
  return data ? { escuela_id: data.escuela_id, usuario_id: user.id } : null;
};

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number | null | undefined): string =>
  n != null ? n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

/** Datos consolidados para la tabla */
interface ItemConsolidado {
  id: string;
  nombre: string;
  categoria: 'producto' | 'servicio' | 'gasto' | 'otro';
  tipo_movimiento: 'ingreso' | 'egreso' | 'ambos';
  precio_venta: number | null;
  costo_unitario?: number | null;
  saldo: number;
  ventasMesPresente: number;
  ventasMesPasado: number;
  ventasTotales: number;
  stock_id?: string;
  cuenta_ingreso_id?: string | null;
  cuenta_gasto_id?: string | null;
}

const Cuentas: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { escuelaId, cargando: authCargando } = useAuthSaaSport();

  // ── Hook de datos maestros ──
  const { data: catalogoRaw, isLoading: cargandoCatalogo, error: errorCatalogo } = useCatalogo(escuelaId);

  // Procesar items para la vista
  const items = useMemo(() => {
    return (catalogoRaw ?? []).map((item: any) => ({
      id: item.id,
      nombre: item.nombre,
      categoria: item.categoria || 'servicio',
      tipo_movimiento: item.tipo_movimiento || 'ingreso',
      precio_venta: item.precio_venta,
      costo_unitario: item.costo_unitario,
      saldo: item.stock?.[0]?.cantidad_disponible || 0,
      stock_id: item.stock?.[0]?.id,
      cuenta_ingreso_id: item.cuenta_ingreso_id,
      cuenta_gasto_id: item.cuenta_gasto_id,
      ventasMesPresente: 0,
      ventasMesPasado: 0,
      ventasTotales: 0,
    })) as ItemConsolidado[];
  }, [catalogoRaw]);

  const cargando = cargandoCatalogo || authCargando;

  // Filtro
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroMovimiento, setFiltroMovimiento] = useState('');
  const [busqueda, setBusqueda] = useState('');

  // Estados de Edición y Datos de Torneos
  const [modoEdicion, setModoEdicion] = useState<'ninguno' | 'conceptos' | 'torneos'>('ninguno');
  
  const [torneos, setTorneos] = useState<{ id: string; nombre: string; activo: boolean; contacto?: string; telefono?: string }[]>([]);
  const [cargandoTorneos, setCargandoTorneos] = useState(false);
  const [guardandoTorneos, setGuardandoTorneos] = useState(false);

  const [itemsEditables, setItemsEditables] = useState<{
    id?: string;
    nombre: string;
    categoria: 'producto' | 'servicio' | 'gasto' | 'otro';
    tipo_movimiento: 'ingreso' | 'egreso' | 'ambos';
    precio_venta: string;
    costo_unitario: string;
    cuenta_ingreso_id: string;
    cuenta_gasto_id: string;
    esNuevo: boolean;
  }[]>([]);
  const [torneosEditables, setTorneosEditables] = useState<{
    id?: string;
    nombre: string;
    activo: boolean;
    contacto?: string;
    telefono?: string;
    esNuevo: boolean;
  }[]>([]);
  const [guardandoItems, setGuardandoItems] = useState(false);

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['catalogo', escuelaId] });
  };

  const cargarTorneos = async () => {
    if (!escuelaId) return;
    setCargandoTorneos(true);
    try {
      const { data, error } = await supabase
        .from('torneos')
        .select('*')
        .eq('escuela_id', escuelaId)
        .order('nombre');
      if (error) {
        console.error("Error al cargar torneos en Cuentas:", error);
      } else {
        setTorneos(data || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setCargandoTorneos(false);
    }
  };

  useEffect(() => {
    if (escuelaId) {
      cargarTorneos();
    }
  }, [escuelaId]);

  // Lista Filtrada
  const itemsFiltrados = useMemo(() => {
    let list = items;
    if (filtroCategoria) {
      list = list.filter(i => i.categoria === filtroCategoria);
    }
    if (filtroMovimiento) {
      list = list.filter(i => i.tipo_movimiento === filtroMovimiento || i.tipo_movimiento === 'ambos');
    }
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase().trim();
      list = list.filter(i => i.nombre.toLowerCase().includes(q));
    }
    return list;
  }, [items, filtroCategoria, filtroMovimiento, busqueda]);

  // Edición de Conceptos
  const iniciarEdicion = () => {
    setItemsEditables(
      items.map(i => ({
        id: i.id,
        nombre: i.nombre,
        categoria: i.categoria,
        tipo_movimiento: i.tipo_movimiento,
        precio_venta: i.precio_venta != null ? i.precio_venta.toFixed(2) : '',
        costo_unitario: i.costo_unitario != null ? i.costo_unitario.toFixed(2) : '',
        cuenta_ingreso_id: i.cuenta_ingreso_id || '',
        cuenta_gasto_id: i.cuenta_gasto_id || '',
        esNuevo: false,
      }))
    );
    setModoEdicion('conceptos');
  };

  const agregarItem = () => {
    setItemsEditables(prev => [...prev, {
      nombre: '',
      categoria: 'servicio',
      tipo_movimiento: 'ingreso',
      precio_venta: '',
      costo_unitario: '',
      cuenta_ingreso_id: '',
      cuenta_gasto_id: '',
      esNuevo: true,
    }]);
  };

  const eliminarItemEditable = (idx: number) => {
    setItemsEditables(prev => prev.filter((_, i) => i !== idx));
  };

  const actualizarItemEditable = (idx: number, campo: string, valor: any) => {
    setItemsEditables(prev => {
      const nuevos = [...prev];
      (nuevos[idx] as any)[campo] = valor;
      return nuevos;
    });
  };

  const esItemMensualidad = (item: { nombre: string; esNuevo: boolean }) =>
    !item.esNuevo && item.nombre.trim().toLocaleLowerCase('es') === 'mensualidad';

  const guardarCatalogo = async () => {
    const validos = itemsEditables.filter(i => i.nombre.trim());
    if (validos.length === 0) { alert('Agrega al menos un ítem.'); return; }

    setGuardandoItems(true);
    let errorOcurrido = false;

    try {
      const ctx = await obtenerCtx();
      if (!ctx) {
        alert('Sesión expirada o usuario no encontrado.');
        setGuardandoItems(false);
        return;
      }

      // 1. Eliminar los ítems quitados en la tabla. Antes solo se los ocultaba
      // del estado local, por lo que reaparecían al volver a cargar el catálogo.
      // El trigger de la base de datos impide borrar cualquiera con movimientos.
      const idsEditables = new Set(
        itemsEditables
          .filter(i => !i.esNuevo && i.id)
          .map(i => i.id!)
      );
      const eliminados = items.filter(i => !idsEditables.has(i.id));

      for (const item of eliminados) {
        const { error } = await supabase
          .from('catalogo_items')
          .delete()
          .eq('id', item.id)
          .eq('escuela_id', ctx.escuela_id);

        if (error) {
          console.error('Error eliminando ítem:', error);
          alert(`No se pudo eliminar "${item.nombre}": ${error.message}`);
          errorOcurrido = true;
        }
      }

      // 2. Actualizar ítems existentes
      for (const item of validos.filter(i => !i.esNuevo && i.id && !esItemMensualidad(i))) {
        const { error } = await supabase.from('catalogo_items').update({
          nombre: item.nombre,
          categoria: item.categoria,
          tipo_movimiento: item.tipo_movimiento,
          tipo: item.categoria === 'producto' ? 'producto' : 'servicio', // Compatibilidad
          precio_venta: item.precio_venta ? parseFloat(item.precio_venta) : null,
          costo_unitario: item.costo_unitario ? parseFloat(item.costo_unitario) : null,
          cuenta_ingreso_id: item.cuenta_ingreso_id || null,
          cuenta_gasto_id: item.cuenta_gasto_id || null,
          es_ingreso: item.tipo_movimiento === 'ingreso' || item.tipo_movimiento === 'ambos',
          es_gasto: item.tipo_movimiento === 'egreso' || item.tipo_movimiento === 'ambos',
        }).eq('id', item.id!);

        if (error) {
          console.error("Error actualizando ítem:", error);
          errorOcurrido = true;
        }
      }

      // 3. Insertar ítems nuevos
      const nuevos = validos.filter(i => i.esNuevo);
      if (nuevos.length > 0) {
        const inserts = nuevos.map(i => ({
          escuela_id: ctx.escuela_id,
          nombre: i.nombre,
          categoria: i.categoria,
          tipo_movimiento: i.tipo_movimiento,
          tipo: i.categoria === 'producto' ? 'producto' : 'servicio', // Compatibilidad
          precio_venta: i.precio_venta ? parseFloat(i.precio_venta) : null,
          costo_unitario: i.costo_unitario ? parseFloat(i.costo_unitario) : null,
          cuenta_ingreso_id: i.cuenta_ingreso_id || null,
          cuenta_gasto_id: i.cuenta_gasto_id || null,
          es_ingreso: i.tipo_movimiento === 'ingreso' || i.tipo_movimiento === 'ambos',
          es_gasto: i.tipo_movimiento === 'egreso' || i.tipo_movimiento === 'ambos',
        }));

        const { data: insertados, error: errIns } = await supabase
          .from('catalogo_items').insert(inserts).select('id, categoria');

        if (errIns) {
          console.error("Error insertando ítems:", errIns);
          errorOcurrido = true;
        } else if (insertados) {
          const productosNuevos = insertados.filter(i => i.categoria === 'producto');
          if (productosNuevos.length > 0) {
            const { error: errStock } = await supabase.from('stock_productos').insert(
              productosNuevos.map(p => ({
                escuela_id: ctx.escuela_id,
                catalogo_item_id: p.id,
                cantidad_disponible: 0,
              }))
            );
            if (errStock) console.error("Error creando stock:", errStock);
          }
        }
      }

      if (errorOcurrido) {
        alert('Hubo problemas al guardar algunos ítems. Por favor revisa la consola o intenta de nuevo.');
      } else {
        setModoEdicion('ninguno');
        manejarActualizacion();
      }
    } catch (err) {
      console.error("Falla crítica al guardar:", err);
      alert('Error inesperado al conectar con el servidor.');
    } finally {
      setGuardandoItems(false);
    }
  };

  // Edición de Torneos
  const iniciarEdicionTorneos = () => {
    setTorneosEditables(
      torneos.map(t => ({
        id: t.id,
        nombre: t.nombre,
        activo: t.activo,
        contacto: t.contacto || '',
        telefono: t.telefono || '',
        esNuevo: false,
      }))
    );
    setModoEdicion('torneos');
  };

  const agregarTorneoEditable = () => {
    setTorneosEditables(prev => [...prev, {
      nombre: '',
      activo: true,
      contacto: '',
      telefono: '',
      esNuevo: true,
    }]);
  };

  const eliminarTorneoEditable = (idx: number) => {
    setTorneosEditables(prev => prev.filter((_, i) => i !== idx));
  };

  const actualizarTorneoEditable = (idx: number, campo: string, valor: any) => {
    setTorneosEditables(prev => {
      const nuevos = [...prev];
      (nuevos[idx] as any)[campo] = valor;
      return nuevos;
    });
  };

  const guardarTorneos = async () => {
    const validos = torneosEditables.filter(t => t.nombre.trim());
    if (validos.length === 0) { alert('Agrega al menos un torneo.'); return; }

    setGuardandoTorneos(true);
    let errorOcurrido = false;

    try {
      const ctx = await obtenerCtx();
      if (!ctx) {
        alert('Sesión expirada o usuario no encontrado.');
        setGuardandoTorneos(false);
        return;
      }

      // 1. Actualizar torneos existentes
      for (const torneo of validos.filter(t => !t.esNuevo && t.id)) {
        const { error } = await supabase
          .from('torneos')
          .update({
            nombre: torneo.nombre,
            activo: torneo.activo,
            contacto: torneo.contacto,
            telefono: torneo.telefono,
          })
          .eq('id', torneo.id);

        if (error) {
          console.error("Error actualizando torneo:", error);
          errorOcurrido = true;
        }
      }

      // 2. Insertar torneos nuevos
      const nuevos = validos.filter(t => t.esNuevo);
      if (nuevos.length > 0) {
        const inserts = nuevos.map(t => ({
          escuela_id: ctx.escuela_id,
          nombre: t.nombre,
          activo: t.activo,
          contacto: t.contacto,
          telefono: t.telefono,
        }));

        const { error: errIns } = await supabase
          .from('torneos')
          .insert(inserts);

        if (errIns) {
          console.error("Error insertando torneos:", errIns);
          errorOcurrido = true;
        }
      }

      if (errorOcurrido) {
        alert('Hubo problemas al guardar algunos torneos. Por favor revisa la consola.');
      } else {
        setModoEdicion('ninguno');
        await cargarTorneos();
      }
    } catch (err) {
      console.error(err);
      alert('Error inesperado al conectar con el servidor.');
    } finally {
      setGuardandoTorneos(false);
    }
  };

  const getCategoriaBadge = (cat: string) => {
    const defaultStyle = { bg: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-secondary)' };
    switch (cat) {
      case 'producto': return { ...defaultStyle, label: 'PRODUCTO', icon: <ShoppingBag size={12} /> };
      case 'servicio': return { ...defaultStyle, label: 'SERVICIO', icon: <Wrench size={12} /> };
      case 'gasto': return { ...defaultStyle, label: 'GASTO', icon: <Receipt size={12} /> };
      case 'otro': return { ...defaultStyle, label: 'OTRO', icon: <Layers size={12} /> };
      default: return { ...defaultStyle, label: 'SERVICIO', icon: <Wrench size={12} /> };
    }
  };

  const getMovimientoBadge = (mov: string) => {
    const color = 'var(--text-secondary)';
    switch (mov) {
      case 'ingreso': return { label: 'INGRESO', color };
      case 'egreso': return { label: 'EGRESO', color };
      case 'ambos': return { label: 'AMBOS', color };
      default: return { label: 'INGRESO', color };
    }
  };

  return (
    <main className="main-content cxc-main" style={{ 
      paddingTop: 0, 
      paddingBottom: '1rem', 
      paddingLeft: '1.5rem', 
      paddingRight: '1.5rem', 
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      minHeight: 'auto'
    }}>
      {/* ─── Barra de Control ─── */}
      <div className="cxc-barra-control" style={{ margin: 0, padding: '0.5rem 1.25rem' }}>
        {modoEdicion === 'ninguno' ? (
          <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="Buscar concepto..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  style={{ 
                    margin: 0, 
                    paddingLeft: '2.25rem', 
                    paddingRight: '0.75rem', 
                    minWidth: '220px', 
                    height: '36px',
                    background: 'var(--bg-input, rgba(255, 255, 255, 0.05))',
                    border: '1px solid var(--border, rgba(255, 255, 255, 0.1))',
                    borderRadius: 'var(--radius-md, 8px)',
                    color: 'var(--text-primary, #fff)',
                    fontSize: '0.85rem',
                    outline: 'none'
                  }}
                />
                <Search size={14} style={{ position: 'absolute', left: '0.75rem', color: 'var(--text-secondary, #94a3b8)', pointerEvents: 'none' }} />
              </div>

              <select
                className="cxc-filtro-select"
                value={filtroCategoria}
                onChange={e => setFiltroCategoria(e.target.value)}
                style={{ 
                  margin: 0, 
                  height: '36px', 
                  borderRadius: '8px', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--text-primary)',
                  padding: '0 0.5rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                <option value="">Todas las Categorías</option>
                <option value="producto">Productos</option>
                <option value="servicio">Servicios</option>
                <option value="gasto">Gastos</option>
                <option value="otro">Otros</option>
              </select>

              <select
                className="cxc-filtro-select"
                value={filtroMovimiento}
                onChange={e => setFiltroMovimiento(e.target.value)}
                style={{ 
                  margin: 0, 
                  height: '36px', 
                  borderRadius: '8px', 
                  border: '1px solid rgba(255,255,255,0.1)', 
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--text-primary)',
                  padding: '0 0.5rem',
                  fontSize: '0.85rem',
                  cursor: 'pointer'
                }}
              >
                <option value="">Cualquier Movimiento</option>
                <option value="ingreso">Ingresos</option>
                <option value="egreso">Egresos</option>
                <option value="ambos">Ambos</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button 
                className="btn-nueva-cuenta" 
                onClick={iniciarEdicion} 
                style={{ 
                  padding: '0.45rem 1rem', 
                  fontSize: '0.85rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.4rem',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                <Edit2 size={14} /> Conceptos
              </button>
              <button 
                className="btn-nueva-cuenta" 
                onClick={iniciarEdicionTorneos} 
                style={{ 
                  padding: '0.45rem 1rem', 
                  fontSize: '0.85rem', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.4rem',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontWeight: 600
                }}
              >
                <Edit2 size={14} /> Torneos
              </button>
              <button className="btn-refrescar" onClick={manejarActualizacion} disabled={cargando}>
                <RefreshCw size={16} className={cargando ? 'spin' : ''} />
              </button>
            </div>
          </div>
        ) : (
          <div style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ 
                fontSize: '0.95rem', 
                fontWeight: 700, 
                color: 'var(--primary)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}>
                {modoEdicion === 'conceptos' ? '📝 Editando Catálogo de Conceptos' : '🏆 TORNEOS'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button 
                className="btn-guardar-cuenta" 
                onClick={modoEdicion === 'conceptos' ? guardarCatalogo : guardarTorneos} 
                disabled={guardandoItems || guardandoTorneos} 
                style={{ 
                  padding: '0.45rem 1.2rem', 
                  fontSize: '0.85rem',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  fontWeight: 600
                }}
              >
                <Save size={14} /> {guardandoItems || guardandoTorneos ? '...' : 'Guardar'}
              </button>
              <button 
                className="btn-refrescar" 
                onClick={() => setModoEdicion('ninguno')} 
                title="Cancelar"
                style={{ 
                  borderRadius: '8px',
                  height: '36px',
                  width: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: 'var(--text-primary)',
                  cursor: 'pointer'
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      {errorCatalogo && (
        <div className="pc-error" style={{ marginBottom: '1rem' }}>
          <p>⚠️ {errorCatalogo instanceof Error ? errorCatalogo.message : 'Error desconocido'}</p>
        </div>
      )}

      {/* Edición de Catálogo in-line / Torneos in-line */}
      {modoEdicion === 'conceptos' ? (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th" style={{ width: '30%' }}>Nombre del Ítem</th>
                <th className="cxc-th" style={{ width: '20%' }}>Categoría</th>
                <th className="cxc-th" style={{ width: '20%' }}>Movimiento</th>
                <th className="cxc-th cxc-th-center" style={{ width: '15%' }}>Precio (Bs)</th>
                <th className="cxc-th cxc-th-center" style={{ width: '15%' }}>Costo (Bs)</th>
                <th className="cxc-th" style={{ width: '50px' }}></th>
              </tr>
            </thead>
            <tbody>
              {itemsEditables.map((item, idx) => {
                const itemProtegido = esItemMensualidad(item);
                return (
                <tr key={idx} className="cxc-tr">
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="text"
                      value={item.nombre}
                      onChange={e => actualizarItemEditable(idx, 'nombre', e.target.value)}
                      placeholder="Ej. Polera o Alquiler"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit'
                      }}
                      disabled={guardandoItems || itemProtegido}
                    />
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <select
                      value={item.categoria}
                      onChange={e => actualizarItemEditable(idx, 'categoria', e.target.value)}
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'rgba(255,255,255,0.03)', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                      disabled={guardandoItems || itemProtegido}
                    >
                      <option value="producto">Producto</option>
                      <option value="servicio">Servicio</option>
                      <option value="gasto">Gasto</option>
                      <option value="otro">Otro</option>
                    </select>
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <select
                      value={item.tipo_movimiento}
                      onChange={e => actualizarItemEditable(idx, 'tipo_movimiento', e.target.value)}
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'rgba(255,255,255,0.03)', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit',
                        cursor: 'pointer',
                        textAlign: 'center'
                      }}
                      disabled={guardandoItems || itemProtegido}
                    >
                      <option value="ingreso">Ingreso</option>
                      <option value="egreso">Egreso</option>
                      <option value="ambos">Ambos</option>
                    </select>
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.precio_venta}
                      onChange={e => actualizarItemEditable(idx, 'precio_venta', e.target.value)}
                      placeholder="0.00"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit',
                        textAlign: 'center'
                      }}
                      disabled={guardandoItems || itemProtegido}
                    />
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={item.costo_unitario}
                      onChange={e => actualizarItemEditable(idx, 'costo_unitario', e.target.value)}
                      placeholder="0.00"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit',
                        textAlign: 'center'
                      }}
                      disabled={guardandoItems || itemProtegido}
                    />
                  </td>
                  <td className="cxc-td cxc-td-center" style={{ padding: 0 }}>
                    <button
                      onClick={() => eliminarItemEditable(idx)}
                      disabled={guardandoItems || itemProtegido}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--danger)', 
                        cursor: 'pointer',
                        padding: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%'
                      }}
                      title={itemProtegido ? 'El ítem Mensualidad está protegido' : 'Eliminar ítem'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
                );
              })}
              <tr>
                <td colSpan={6} className="cxc-td" style={{ padding: '0.5rem' }}>
                  <button
                    onClick={agregarItem}
                    disabled={guardandoItems}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.4rem', 
                      color: 'var(--primary)', 
                      fontWeight: 600, 
                      padding: '0.5rem', 
                      cursor: 'pointer', 
                      background: 'none',
                      border: 'none',
                      fontSize: '0.85rem'
                    }}
                  >
                    <Plus size={16} /> Agregar ítem nuevo
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : modoEdicion === 'torneos' ? (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th" style={{ width: '40%' }}>NOMBRE DEL TORNEO</th>
                <th className="cxc-th" style={{ width: '25%' }}>CONTACTO</th>
                <th className="cxc-th" style={{ width: '20%' }}>TELÉFONO</th>
                <th className="cxc-th cxc-th-center" style={{ width: '10%' }}>ESTADO</th>
                <th className="cxc-th" style={{ width: '5%' }}></th>
              </tr>
            </thead>
            <tbody>
              {torneosEditables.map((torneo, idx) => (
                <tr key={idx} className="cxc-tr">
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="text"
                      value={torneo.nombre}
                      onChange={e => actualizarTorneoEditable(idx, 'nombre', e.target.value)}
                      placeholder="Ej. Copa Oro"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit'
                      }}
                      disabled={guardandoTorneos}
                    />
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="text"
                      value={torneo.contacto || ''}
                      onChange={e => actualizarTorneoEditable(idx, 'contacto', e.target.value)}
                      placeholder="Contacto"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit'
                      }}
                      disabled={guardandoTorneos}
                    />
                  </td>
                  <td className="cxc-td" style={{ padding: 0 }}>
                    <input
                      type="text"
                      value={torneo.telefono || ''}
                      onChange={e => actualizarTorneoEditable(idx, 'telefono', e.target.value)}
                      placeholder="Teléfono"
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'transparent', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit'
                      }}
                      disabled={guardandoTorneos}
                    />
                  </td>
                  <td className="cxc-td cxc-td-center" style={{ padding: 0 }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={torneo.activo}
                        onChange={e => actualizarTorneoEditable(idx, 'activo', e.target.checked)}
                        disabled={guardandoTorneos}
                        style={{ cursor: 'pointer', transform: 'scale(1.2)' }}
                      />
                    </label>
                  </td>
                  <td className="cxc-td cxc-td-center" style={{ padding: 0 }}>
                    <button
                      onClick={() => eliminarTorneoEditable(idx)}
                      disabled={guardandoTorneos}
                      style={{ 
                        background: 'none', 
                        border: 'none', 
                        color: 'var(--danger)', 
                        cursor: 'pointer',
                        padding: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '100%'
                      }}
                      title="Eliminar torneo"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} className="cxc-td" style={{ padding: '0.5rem' }}>
                  <button
                    onClick={agregarTorneoEditable}
                    disabled={guardandoTorneos}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.4rem', 
                      color: 'var(--primary)', 
                      fontWeight: 600, 
                      padding: '0.5rem', 
                      cursor: 'pointer', 
                      background: 'none',
                      border: 'none',
                      fontSize: '0.85rem'
                    }}
                  >
                    <Plus size={16} /> Agregar torneo nuevo
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        /* Vista de Tabla */
        <>
          { (cargando || authCargando) && items.length === 0 ? (
            <div className="pc-cargando">
              <RefreshCw size={32} className="spin" />
              <p>Cargando catálogo...</p>
            </div>
          ) : itemsFiltrados.length === 0 ? (
            <div className="arbol-vacio">
              <BookOpen size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
              <p>No se encontraron ítems en esta categoría.</p>
            </div>
          ) : (
            <div className="cxc-tabla-wrapper">
              <table className="cxc-tabla">
                <thead>
                  <tr>
                    <th className="cxc-th">Nombre de Ítem</th>
                    <th className="cxc-th">Categoría</th>
                    <th className="cxc-th">Movimiento</th>
                    <th className="cxc-th cxc-th-center">Precio (Bs)</th>
                    <th className="cxc-th cxc-th-center">Costo (Bs)</th>
                    <th className="cxc-th cxc-th-center">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsFiltrados.map(item => {
                    const catInfo = getCategoriaBadge(item.categoria);
                    const movInfo = getMovimientoBadge(item.tipo_movimiento);
                    return (
                      <tr key={item.id} className="cxc-tr">
                        <td className="cxc-td" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                          {item.nombre}
                        </td>
                        <td className="cxc-td">
                          <span style={{
                            fontSize: '0.75rem',
                            padding: '0.25rem 0.6rem',
                            borderRadius: '12px',
                            background: catInfo.bg,
                            color: catInfo.color,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '0.4rem',
                            fontWeight: 600
                          }}>
                            {catInfo.icon}
                            {catInfo.label}
                          </span>
                        </td>
                        <td className="cxc-td">
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            color: movInfo.color
                          }}>
                            {movInfo.label}
                          </span>
                        </td>
                        <td className="cxc-td cxc-td-center">
                          {fmtMonto(item.precio_venta)}
                        </td>
                        <td className="cxc-td cxc-td-center" style={{ color: 'var(--text-secondary)' }}>
                          {fmtMonto(item.costo_unitario)}
                        </td>
                        <td className="cxc-td cxc-td-center">
                          <span style={{ 
                            color: item.saldo > 0 ? 'var(--success)' : item.saldo < 0 ? 'var(--danger)' : 'var(--text-tertiary)',
                            fontWeight: item.saldo !== 0 ? 700 : 400
                          }}>
                            {item.saldo}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
};

export default Cuentas;
