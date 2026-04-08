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
  stock_id?: string;
}

const Inventarios: React.FC = () => {
  const navigate = useNavigate();

  // Datos
  const [items, setItems] = useState<ItemConsolidado[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtro
  const [filtroTipo, setFiltroTipo] = useState('');

  // Edición de catálogo
  const [editando, setEditando] = useState(false);
  const [itemsEditables, setItemsEditables] = useState<{
    id?: string;
    nombre: string;
    tipo: 'producto' | 'servicio';
    precio_venta: string;
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

  // Obtener contexto
  const obtenerCtx = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('usuarios').select('id, escuela_id').eq('id', user.id).single();
    return data;
  };

  // Cargar datos
  const cargarDatos = async () => {
    setCargando(true);
    setError(null);

    const ctx = await obtenerCtx();
    if (!ctx) {
      setError('Error de contexto. Por favor reinicia sesión.');
      setCargando(false);
      return;
    }

    const [resItems, resStock, resMovs] = await Promise.all([
      supabase.from('catalogo_items').select('*').eq('activo', true).eq('escuela_id', ctx.escuela_id).order('nombre'),
      supabase.from('stock_productos').select('id, catalogo_item_id, cantidad_disponible').eq('escuela_id', ctx.escuela_id),
      supabase.from('movimientos_stock').select('catalogo_item_id, cantidad, tipo, created_at').eq('escuela_id', ctx.escuela_id)
    ]);

    if (resItems.error) {
      setError(resItems.error.message);
      setCargando(false);
      return;
    }

    const catalogItems = resItems.data as CatalogoItem[];
    const allStock = resStock.data || [];
    const movimientos = resMovs.data || [];

    const hoy = new Date();
    const mesPresInicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString();
    const mesPasInicio = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1).toISOString();
    const mesPasFin = new Date(hoy.getFullYear(), hoy.getMonth(), 0, 23, 59, 59, 999).toISOString();

    const mapVentasPres = new Map<string, number>();
    const mapVentasPas = new Map<string, number>();

    // Para "ventas", consideramos la salida de productos, multiplicada por precio de venta
    // Si son servicios, quizás no se facturan a través de movimientos de stock actualmente.
    // Usaremos salidas de stock para productos.
    for (const mov of movimientos) {
      if (mov.tipo === 'salida') {
        const item = catalogItems.find(i => i.id === mov.catalogo_item_id);
        const monto = mov.cantidad * (item?.precio_venta || 0);

        if (mov.created_at >= mesPresInicio) {
          mapVentasPres.set(mov.catalogo_item_id, (mapVentasPres.get(mov.catalogo_item_id) || 0) + monto);
        } else if (mov.created_at >= mesPasInicio && mov.created_at <= mesPasFin) {
          mapVentasPas.set(mov.catalogo_item_id, (mapVentasPas.get(mov.catalogo_item_id) || 0) + monto);
        }
      }
    }

    const itemsProcesados: ItemConsolidado[] = catalogItems.map(item => {
      const st = allStock.find((s: any) => s.catalogo_item_id === item.id);
      return {
        id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        precio_venta: item.precio_venta,
        saldo: st?.cantidad_disponible || 0,
        stock_id: st?.id,
        ventasMesPresente: mapVentasPres.get(item.id) || 0,
        ventasMesPasado: mapVentasPas.get(item.id) || 0,
      };
    });

    setItems(itemsProcesados);
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

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
        esNuevo: false,
      }))
    );
    setEditando(true);
  };

  const agregarItem = () => {
    if (itemsEditables.length >= 10) return;
    setItemsEditables(prev => [...prev, {
      nombre: '',
      tipo: 'servicio',
      precio_venta: '',
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
    const ctx = await obtenerCtx();
    if (!ctx) { setGuardandoItems(false); return; }

    for (const item of validos.filter(i => !i.esNuevo && i.id)) {
      await supabase.from('catalogo_items').update({
        nombre: item.nombre,
        tipo: item.tipo,
        precio_venta: item.precio_venta ? parseFloat(item.precio_venta) : null,
      }).eq('id', item.id!);
    }

    const nuevos = validos.filter(i => i.esNuevo);
    if (nuevos.length > 0) {
      const inserts = nuevos.map(i => ({
        escuela_id: ctx.escuela_id,
        nombre: i.nombre,
        tipo: i.tipo,
        precio_venta: i.precio_venta ? parseFloat(i.precio_venta) : null,
      }));
      const { data: insertados, error: errIns } = await supabase
        .from('catalogo_items').insert(inserts).select('id, tipo');

      if (!errIns && insertados) {
        const productosNuevos = insertados.filter(i => i.tipo === 'producto');
        if (productosNuevos.length > 0) {
          await supabase.from('stock_productos').insert(
            productosNuevos.map(p => ({
              escuela_id: ctx.escuela_id,
              catalogo_item_id: p.id,
              cantidad_disponible: 0,
            }))
          );
        }
      }
    }

    setGuardandoItems(false);
    setEditando(false);
    cargarDatos();
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
    if (itemObj && itemObj.stock_id) {
      const nuevaCant = movTipo === 'entrada'
        ? itemObj.saldo + cant
        : itemObj.saldo - cant;
      await supabase.from('stock_productos').update({
        cantidad_disponible: nuevaCant,
        updated_at: new Date().toISOString(),
      }).eq('id', itemObj.stock_id);
    }

    setGuardandoMov(false);
    setMovItemId(null);
    setMovCantidad('');
    setMovMotivo('');
    cargarDatos();
  };

  return (
    <main className="main-content cxc-main">
      {/* ─── Header: Tarjeta de Arriba ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Inventario</h1>
          </div>
        </div>
        <div className="cxc-header-acciones">
          {!editando ? (
            <button className="btn-nueva-cuenta" onClick={iniciarEdicion}>
              <Edit2 size={16} /> Editar Catálogo
            </button>
          ) : (
            <>
              <button className="btn-guardar-cuenta" onClick={guardarCatalogo} disabled={guardandoItems}>
                <Save size={16} /> {guardandoItems ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn-refrescar" onClick={() => setEditando(false)} title="Cancelar">
                <X size={16} />
              </button>
            </>
          )}
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Tarjeta 2: Filtros ─── */}
      <div className="cxc-barra-control">
        <div className="cxc-filtros-inline" style={{ width: '100%' }}>
          <select
            className="cxc-filtro-select"
            value={filtroTipo}
            onChange={e => setFiltroTipo(e.target.value)}
          >
            <option value="">Todos los Tipos</option>
            <option value="producto">Producto</option>
            <option value="servicio">Servicio</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="pc-error" style={{ marginBottom: '1rem' }}>
          <p>⚠️ {error}</p>
        </div>
      )}

      {/* Edición de Catálogo in-line (se reemplaza si estamos editando) */}
      {editando ? (
        <div className="cxc-tabla-wrapper" style={{ padding: '1rem', background: '#fff', borderRadius: '12px' }}>
          <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '1rem' }}>
            📋 Editar Catálogo ({itemsEditables.length}/10)
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {itemsEditables.map((item, idx) => (
              <div key={idx} style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <input
                  type="text"
                  value={item.nombre}
                  onChange={e => actualizarItemEditable(idx, 'nombre', e.target.value)}
                  placeholder="Nombre del ítem"
                  style={{ flex: 1, padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem' }}
                  disabled={guardandoItems}
                />
                <select
                  value={item.tipo}
                  onChange={e => actualizarItemEditable(idx, 'tipo', e.target.value)}
                  style={{ padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem' }}
                  disabled={guardandoItems}
                >
                  <option value="servicio">Servicio</option>
                  <option value="producto">Producto</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.precio_venta}
                  onChange={e => actualizarItemEditable(idx, 'precio_venta', e.target.value)}
                  placeholder="Opc. Bs"
                  style={{ width: '100px', padding: '0.5rem 0.75rem', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.9rem' }}
                  disabled={guardandoItems}
                />
                <button
                  onClick={() => eliminarItemEditable(idx)}
                  disabled={guardandoItems}
                  style={{ background: '#fee2e2', color: '#ef4444', padding: '0.5rem 0.75rem', borderRadius: '8px' }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {itemsEditables.length < 10 && (
              <button
                onClick={agregarItem}
                disabled={guardandoItems}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--primary)', fontWeight: 600, padding: '0.5rem', marginTop: '0.5rem' }}
              >
                <Plus size={16} /> Agregar ítem
              </button>
            )}
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
                    <th className="cxc-th cxc-th-center">Saldo</th>
                    <th className="cxc-th cxc-th-right">Ventas Mes (Actual)</th>
                    <th className="cxc-th cxc-th-right">Ventas Mes (Pasado)</th>
                    <th className="cxc-th cxc-th-center">Acciones</th>
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
                          background: item.tipo === 'producto' ? 'rgba(56,189,248,0.1)' : 'rgba(167,139,250,0.1)',
                          color: item.tipo === 'producto' ? '#0ea5e9' : '#8b5cf6',
                          whiteSpace: 'nowrap'
                        }}>
                          {item.tipo.toUpperCase()}
                        </span>
                      </td>
                      <td className="cxc-td cxc-td-center">
                        {fmtMonto(item.precio_venta)}
                      </td>
                      <td className="cxc-td cxc-td-center">
                        {item.tipo === 'producto' ? (
                          <span style={{ fontWeight: 600, color: item.saldo <= 0 ? '#ef4444' : 'var(--text-primary)' }}>
                            {item.saldo}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                        )}
                      </td>
                      <td className="cxc-td cxc-td-right">
                        Bs {fmtMonto(item.ventasMesPresente)}
                      </td>
                      <td className="cxc-td cxc-td-right">
                        <span style={{ color: 'var(--text-secondary)' }}>
                          Bs {fmtMonto(item.ventasMesPasado)}
                        </span>
                      </td>
                      <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                        {item.tipo === 'producto' ? (
                          <>
                            <button
                              className="cxc-accion-btn"
                              style={{ color: '#10b981', background: 'rgba(16,185,129,0.1)' }}
                              onClick={() => { setMovItemId(item.id); setMovTipo('entrada'); }}
                              title="Registrar Entrada"
                            >
                              <ArrowUpCircle size={14} /> Entrada
                            </button>
                            <button
                              className="cxc-accion-btn"
                              style={{ color: '#ef4444', background: 'rgba(239,68,68,0.1)' }}
                              onClick={() => { setMovItemId(item.id); setMovTipo('salida'); }}
                              title="Registrar Salida"
                            >
                              <ArrowDownCircle size={14} /> Salida
                            </button>
                          </>
                        ) : (
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>Sin acciones</span>
                        )}
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
