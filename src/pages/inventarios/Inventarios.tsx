/**
 * Inventarios.tsx
 * Módulo de Inventarios: gestión de catálogo de ítems (productos/servicios).
 * Estructura rediseñada alineada al patrón de Cuentas por Pagar.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/inventarios';
import {
  ChevronLeft, RefreshCw, Plus, Check, X, Trash2,
  Edit2, Save, ArrowUpCircle, ArrowDownCircle, Package
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
  tipo: 'producto' | 'servicio';
  precio_venta: number | null;
  saldo: number;
  ventasMesPresente: number;
  ventasMesPasado: number;
  ventasTotales: number; // Nueva columna
  stock_id?: string;
  costo_unitario?: number | null;
  cuenta_ingreso_id?: string | null;
  cuenta_gasto_id?: string | null;
  es_ingreso?: boolean;
  es_gasto?: boolean;
}

const Inventarios: React.FC = () => {
  const navigate = useNavigate();

  // Datos
  const [items, setItems] = useState<ItemConsolidado[]>([]);
  const [cargando, setCargando] = useState(() => !localStorage.getItem('saasport_inventario_cache'));
  const [error, setError] = useState<string | null>(null);

  const [cuentasIngreso, setCuentasIngreso] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentasGasto, setCuentasGasto] = useState<{ id: string; codigo: string; nombre: string }[]>([]);

  // Filtro
  const [filtroTipo, setFiltroTipo] = useState('');

  // Edición de catálogo
  const [editando, setEditando] = useState(false);
  const [itemsEditables, setItemsEditables] = useState<{
    id?: string;
    nombre: string;
    tipo: 'producto' | 'servicio';
    precio_venta: string;
    costo_unitario: string;
    cuenta_ingreso_id: string;
    cuenta_gasto_id: string;
    es_ingreso: boolean;
    es_gasto: boolean;
    esNuevo: boolean;
  }[]>([]);
  const [guardandoItems, setGuardandoItems] = useState(false);

  // Movimiento de stock
  const [movItemId, setMovItemId] = useState<string | null>(null);
  const [movTipo, setMovTipo] = useState<'entrada' | 'salida'>('entrada');
  const [movCantidad, setMovCantidad] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [guardandoMov, setGuardandoMov] = useState(false);
  const [msgMov, setMsgMov] = useState<string | null>(null);

  const { escuelaId } = useAuthSaaSport();

  // Cargar datos con Estrategia Caché (Instantánea)
  const cargarDatos = async (usarCache = true) => {
    // Si hay caché, lo mostramos de inmediato para que sea instantáneo
    if (usarCache) {
      const cache = localStorage.getItem('saasport_inventario_cache');
      if (cache) {
        try {
          setItems(JSON.parse(cache));
          // No ponemos cargando en true si ya tenemos datos, para no mostrar el spinner
        } catch (e) {
          console.error("Error al leer caché", e);
        }
      } else {
        setCargando(true);
      }
    } else {
      setCargando(true);
    }
    
    setError(null);

    if (!escuelaId) {
      setError('Error de contexto. Por favor reinicia sesión.');
      setCargando(false);
      return;
    }

    try {
      // Solo cargamos el inventario, ya no necesitamos plan_cuentas (mucho más rápido)
      const { data: invData, error: invErr } = await supabase
        .from('v_inventario')
        .select('*')
        .eq('escuela_id', escuelaId)
        .order('nombre');

      if (invErr) throw invErr;

      const itemsProcesados: ItemConsolidado[] = (invData || []).map((item: any) => ({
        id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        precio_venta: item.precio_venta,
        costo_unitario: item.costo_unitario,
        saldo: item.saldo || 0,
        stock_id: item.stock_id,
        cuenta_ingreso_id: item.cuenta_ingreso_id,
        cuenta_gasto_id: item.cuenta_gasto_id,
        es_ingreso: item.es_ingreso,
        es_gasto: item.es_gasto,
        ventasMesPresente: item.ventas_mes_actual || 0,
        ventasMesPasado: item.ventas_mes_anterior || 0,
        ventasTotales: item.ventas_totales || 0,
      }));

      // Guardamos en estado y en caché
      setItems(itemsProcesados);
      localStorage.setItem('saasport_inventario_cache', JSON.stringify(itemsProcesados));
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
    if (filtroTipo) {
      list = list.filter(i => i.tipo === filtroTipo);
    }
    return list;
  }, [items, filtroTipo]);

  // Edición
  const iniciarEdicion = () => {
    setItemsEditables(
      items.map(i => ({
        id: i.id,
        nombre: i.nombre,
        tipo: i.tipo,
        precio_venta: i.precio_venta != null ? String(i.precio_venta) : '',
        costo_unitario: i.costo_unitario != null ? String(i.costo_unitario) : '',
        cuenta_ingreso_id: i.cuenta_ingreso_id || '',
        cuenta_gasto_id: i.cuenta_gasto_id || '',
        es_ingreso: i.es_ingreso ?? true,
        es_gasto: i.es_gasto ?? false,
        esNuevo: false,
      }))
    );
    setEditando(true);
  };

  const agregarItem = () => {
    setItemsEditables(prev => [...prev, {
      nombre: '',
      tipo: 'servicio',
      precio_venta: '',
      costo_unitario: '',
      cuenta_ingreso_id: '',
      cuenta_gasto_id: '',
      es_ingreso: true,
      es_gasto: false,
      esNuevo: true,
    }]);
  };

  const eliminarItemEditable = (idx: number) => {
    setItemsEditables(prev => prev.filter((_, i) => i !== idx));
  };

  const actualizarItemEditable = (idx: number, campo: string, valor: string) => {
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
          tipo: item.tipo,
          precio_venta: item.precio_venta ? parseFloat(item.precio_venta) : null,
          costo_unitario: item.costo_unitario ? parseFloat(item.costo_unitario) : null,
          cuenta_ingreso_id: item.cuenta_ingreso_id || null,
          cuenta_gasto_id: item.cuenta_gasto_id || null,
          es_ingreso: !!item.es_ingreso,
          es_gasto: !!item.es_gasto,
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
          tipo: i.tipo,
          precio_venta: i.precio_venta ? parseFloat(i.precio_venta) : null,
          costo_unitario: i.costo_unitario ? parseFloat(i.costo_unitario) : null,
          cuenta_ingreso_id: i.cuenta_ingreso_id || null,
          cuenta_gasto_id: i.cuenta_gasto_id || null,
          es_ingreso: !!i.es_ingreso,
          es_gasto: !!i.es_gasto,
        }));

        const { data: insertados, error: errIns } = await supabase
          .from('catalogo_items').insert(inserts).select('id, tipo');

        if (errIns) {
          console.error("Error insertando ítems:", errIns);
          errorOcurrido = true;
        } else if (insertados) {
          const productosNuevos = insertados.filter(i => i.tipo === 'producto');
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
        cargarDatos();
      }
    } catch (err) {
      console.error("Falla crítica al guardar:", err);
      alert('Error inesperado al conectar con el servidor.');
    } finally {
      setGuardandoItems(false);
    }
  };

  const registrarMovimiento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movItemId) return;

    const cant = parseInt(movCantidad);
    if (!cant || cant <= 0) { setMsgMov('Cantidad inválida.'); return; }

    setGuardandoMov(true);
    const ctx = await obtenerCtx();
    if (!ctx) { setMsgMov('Error de contexto.'); setGuardandoMov(false); return; }

    const { error: errMov } = await supabase.from('movimientos_stock').insert({
      escuela_id: ctx.escuela_id,
      catalogo_item_id: movItemId,
      tipo: movTipo,
      cantidad: cant,
      motivo: movMotivo || (movTipo === 'entrada' ? 'Ingreso de stock' : 'Salida de stock'),
    });

    if (errMov) { setMsgMov(`Error: ${errMov.message}`); setGuardandoMov(false); return; }

    const itemObj = items.find(s => s.id === movItemId);
    if (itemObj) {
      const nuevaCant = movTipo === 'entrada'
        ? itemObj.saldo + cant
        : itemObj.saldo - cant;
        
      if (itemObj.stock_id) {
        await supabase.from('stock_productos').update({
          cantidad_disponible: nuevaCant,
          updated_at: new Date().toISOString(),
        }).eq('id', itemObj.stock_id);
      } else {
        await supabase.from('stock_productos').insert({
          escuela_id: ctx.escuela_id,
          catalogo_item_id: movItemId,
          cantidad_disponible: nuevaCant
        });
      }
    }

    setGuardandoMov(false);
    setMovItemId(null);
    setMovCantidad('');
    setMovMotivo('');
    cargarDatos();
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
      {/* ─── Barra de Control Simplificada ─── */}
      <div className="cxc-barra-control" style={{ margin: 0, padding: '0.5rem 1.25rem' }}>
        <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <select
              className="cxc-filtro-select"
              value={filtroTipo}
              onChange={e => setFiltroTipo(e.target.value)}
              style={{ margin: 0 }}
            >
              <option value="">Todos los Tipos</option>
              <option value="producto">Producto</option>
              <option value="servicio">Servicio</option>
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

      {/* Edición de Catálogo in-line (se reemplaza si estamos editando) */}
      {editando ? (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th" style={{ width: '40%' }}>Nombre del Ítem</th>
                <th className="cxc-th" style={{ width: '15%' }}>Tipo</th>
                <th className="cxc-th cxc-th-center" style={{ width: '15%' }}>P. Venta (Bs)</th>
                <th className="cxc-th cxc-th-center" style={{ width: '15%' }}>Costo U. (Bs)</th>
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
                      placeholder="Ej. Polera"
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
                      value={item.tipo}
                      onChange={e => actualizarItemEditable(idx, 'tipo', e.target.value)}
                      style={{ 
                        width: '100%', 
                        height: '100%', 
                        background: 'rgba(255,255,255,0.03)', 
                        border: 'none', 
                        padding: '0.75rem', 
                        color: 'var(--text-primary)',
                        fontSize: 'inherit',
                        cursor: 'pointer',
                        appearance: 'none', // Quita la flecha nativa para un look más limpio
                        textAlign: 'center'
                      }}
                      disabled={guardandoItems}
                    >
                      <option value="servicio" style={{ background: '#1a1a1a', color: '#fff' }}>Servicio</option>
                      <option value="producto" style={{ background: '#1a1a1a', color: '#fff' }}>Producto</option>
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
                <td colSpan={5} className="cxc-td" style={{ padding: '0.5rem' }}>
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
          <div style={{ padding: '0.75rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', background: 'var(--bg-main)' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
              {itemsEditables.length} ítems en catálogo
            </span>
          </div>
        </div>
      ) : (
        /* Tarjeta 3: Tabla Correspondiente */
        <>
          {cargando ? (
            <div className="pc-cargando">
              <RefreshCw size={32} className="spin" />
              <p>Cargando inventarios...</p>
            </div>
          ) : itemsFiltrados.length === 0 ? (
            <div className="arbol-vacio">
              <Package size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
              <p>No se encontraron ítems con los filtros vigentes.</p>
            </div>
          ) : (
            <div className="cxc-tabla-wrapper">
              <table className="cxc-tabla">
                <thead>
                  <tr>
                    <th className="cxc-th">Nombre de Ítem</th>
                    <th className="cxc-th">Tipo</th>
                    <th className="cxc-th cxc-th-center">Precio (Bs)</th>
                    <th className="cxc-th cxc-th-right">Ventas Mes (Actual)</th>
                    <th className="cxc-th cxc-th-right">Ventas Mes (Pasado)</th>
                    <th className="cxc-th cxc-th-right">Ventas Totales</th>
                  </tr>
                </thead>
                <tbody>
                  {itemsFiltrados.map(item => (
                    <tr key={item.id} className="cxc-tr">
                      <td className="cxc-td" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {item.nombre}
                      </td>
                      <td className="cxc-td">
                        <span style={{
                          fontSize: '0.78rem',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '12px',
                          background: item.tipo === 'producto' ? 'rgba(10, 132, 255, 0.1)' : 'rgba(0, 210, 106, 0.1)',
                          color: item.tipo === 'producto' ? 'var(--secondary)' : 'var(--success)',
                          whiteSpace: 'nowrap'
                        }}>
                          {item.tipo.toUpperCase()}
                        </span>
                      </td>
                      <td className="cxc-td cxc-td-center">
                        {fmtMonto(item.precio_venta)}
                      </td>
                      <td className="cxc-td cxc-td-right">
                        Bs {fmtMonto(item.ventasMesPresente)}
                      </td>
                      <td className="cxc-td cxc-td-right">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Bs {fmtMonto(item.ventasMesPasado)}
                        </span>
                      </td>
                      <td className="cxc-td cxc-td-right" style={{ fontWeight: 600, color: 'var(--primary)' }}>
                        Bs {fmtMonto(item.ventasTotales)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modal Envío Movimiento */}
      {movItemId && (
        <div className="cxc-modal-overlay" onClick={() => { if(!guardandoMov) setMovItemId(null); }}>
          <div className="cxc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="cxc-modal-header">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-primary)' }}>
                {movTipo === 'entrada' ? <ArrowUpCircle color="#10b981" /> : <ArrowDownCircle color="#ef4444" />}
                {movTipo === 'entrada' ? 'Ingreso de Stock' : 'Salida de Stock'}
              </h2>
              <button onClick={() => setMovItemId(null)} disabled={guardandoMov}><X size={20} /></button>
            </div>
            <form onSubmit={registrarMovimiento} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem 0 0 0' }}>
              <div className="form-campo">
                <label>Producto</label>
                <input type="text" value={items.find(i => i.id === movItemId)?.nombre || ''} disabled style={{ background: '#f8fafc', color: '#64748b' }} />
              </div>
              <div className="form-campo">
                <label>Cantidad</label>
                <input
                  type="number" min="1"
                  value={movCantidad} onChange={e => setMovCantidad(e.target.value)}
                  required disabled={guardandoMov} placeholder="Ej: 5"
                />
              </div>
              <div className="form-campo">
                <label>Motivo</label>
                <input
                  type="text" value={movMotivo} onChange={e => setMovMotivo(e.target.value)}
                  disabled={guardandoMov} placeholder={movTipo === 'entrada' ? 'Ej: Compra a proveedor' : 'Ej: Venta'}
                />
              </div>
              {msgMov && (
                <div style={{ color: '#ef4444', fontSize: '0.85rem' }}>{msgMov}</div>
              )}
              <button type="submit" className="btn-guardar-cuenta" style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }} disabled={guardandoMov}>
                <Check size={16} /> {guardandoMov ? 'Procesando...' : 'Confirmar'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
};

export default Inventarios;
