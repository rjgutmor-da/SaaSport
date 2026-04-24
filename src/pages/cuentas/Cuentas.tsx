/**
 * Cuentas.tsx
 * Módulo de Cuentas (ex-Inventarios): gestión de catálogo de ítems (productos, servicios, gastos, otros).
 * Permite definir si un ítem es de Ingreso, Egreso o Ambos.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import {
  ChevronLeft, RefreshCw, Plus, Check, X, Trash2,
  Edit2, Save, CircleArrowUp, CircleArrowDown, BookOpen, Package, 
  ShoppingBag, Wrench, Receipt, Layers
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuthSaaSport } from '../../lib/authHelper';

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

  // Datos
  const [items, setItems] = useState<ItemConsolidado[]>(() => {
    const cache = localStorage.getItem('saasport_cuentas_cache');
    if (cache) {
      try {
        return JSON.parse(cache);
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  // Si tenemos items en el caché, no mostramos el spinner de pantalla completa, pero igual refrescamos
  const [cargando, setCargando] = useState(items.length === 0);
  const [error, setError] = useState<string | null>(null);

  // Filtro
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroMovimiento, setFiltroMovimiento] = useState('');

  // Edición de catálogo
  const [editando, setEditando] = useState(false);
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
  const [guardandoItems, setGuardandoItems] = useState(false);

  const { escuelaId, cargando: authCargando } = useAuthSaaSport();

  // Cargar datos con Estrategia Caché
  const cargarDatos = async (usarCache = true) => {
    setError(null);

    if (!escuelaId) {
      if (authCargando) return;
      setError('No se pudo cargar el contexto de la escuela. Por favor, asegúrate de tener una sesión activa.');
      setCargando(false);
      return;
    }

    try {
      // Usamos la vista v_inventario que debe estar actualizada o la tabla directamente
      // Para este refactor, usaremos la tabla catalogo_items directamente para asegurar que traemos los nuevos campos
      const { data: invData, error: invErr } = await supabase
        .from('catalogo_items')
        .select(`
          *,
          stock:stock_productos(id, cantidad_disponible)
        `)
        .eq('escuela_id', escuelaId)
        .order('nombre');

      if (invErr) throw invErr;

      const itemsProcesados: ItemConsolidado[] = (invData || []).map((item: any) => ({
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
        ventasMesPresente: 0, // Estos campos requerirían joins más complejos o RPC, los dejamos en 0 por ahora para simplificar el refactor visual
        ventasMesPasado: 0,
        ventasTotales: 0,
      }));

      setItems(itemsProcesados);
      localStorage.setItem('saasport_cuentas_cache', JSON.stringify(itemsProcesados));
    } catch (e: any) {
      console.error(e);
      if (!items.length) setError(e.message);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (escuelaId) {
      cargarDatos();
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
    return list;
  }, [items, filtroCategoria, filtroMovimiento]);

  // Edición
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
    setEditando(true);
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

      // 1. Actualizar ítems existentes
      for (const item of validos.filter(i => !i.esNuevo && i.id)) {
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

      // 2. Insertar ítems nuevos
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
        setEditando(false);
        cargarDatos(false);
      }
    } catch (err) {
      console.error("Falla crítica al guardar:", err);
      alert('Error inesperado al conectar con el servidor.');
    } finally {
      setGuardandoItems(false);
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
        <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              className="cxc-filtro-select"
              value={filtroCategoria}
              onChange={e => setFiltroCategoria(e.target.value)}
              style={{ margin: 0 }}
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
              style={{ margin: 0 }}
            >
              <option value="">Cualquier Movimiento</option>
              <option value="ingreso">Ingresos</option>
              <option value="egreso">Egresos</option>
              <option value="ambos">Ambos</option>
            </select>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {!editando ? (
              <button className="btn-nueva-cuenta" onClick={iniciarEdicion} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                <Edit2 size={14} /> Editar Catálogo
              </button>
            ) : (
              <>
                <button className="btn-guardar-cuenta" onClick={guardarCatalogo} disabled={guardandoItems} style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  <Save size={14} /> {guardandoItems ? '...' : 'Guardar'}
                </button>
                <button className="btn-refrescar" onClick={() => setEditando(false)} title="Cancelar">
                  <X size={14} />
                </button>
              </>
            )}
            <button className="btn-refrescar" onClick={() => cargarDatos(false)} disabled={cargando}>
              <RefreshCw size={16} className={cargando ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="pc-error" style={{ marginBottom: '1rem' }}>
          <p>⚠️ {error}</p>
        </div>
      )}

      {/* Edición de Catálogo in-line */}
      {editando ? (
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
              {itemsEditables.map((item, idx) => (
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
                      disabled={guardandoItems}
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
                      disabled={guardandoItems}
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
                      disabled={guardandoItems}
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
                      disabled={guardandoItems}
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
                      disabled={guardandoItems}
                    />
                  </td>
                  <td className="cxc-td cxc-td-center" style={{ padding: 0 }}>
                    <button
                      onClick={() => eliminarItemEditable(idx)}
                      disabled={guardandoItems}
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
                      title="Eliminar ítem"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
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
