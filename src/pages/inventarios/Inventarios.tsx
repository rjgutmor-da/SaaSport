/**
 * Inventarios.tsx
 * Módulo de Inventarios: gestión de catálogo de ítems (productos/servicios).
 * Permite crear hasta 10 ítems, definir precios, y controlar stock de productos.
 * 
 * Funcionalidades:
 * - Formulario de ítems (nombre, tipo, precio)
 * - Vista de stock solo para productos
 * - Entradas/salidas de stock sencillas
 * - Saldo inicial configurable
 * - Permite ventas sin saldo (stock negativo)
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/inventarios';
import {
  ChevronLeft, RefreshCw, Plus, Check, X, Trash2,
  Package, Tag, Edit2, ArrowUpCircle, ArrowDownCircle,
  Save
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number | null): string =>
  n != null ? n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

/** Datos de stock enriquecidos */
interface StockEnriquecido {
  catalogo_item_id: string;
  item_nombre: string;
  cantidad_disponible: number;
  stock_id: string;
}

const Inventarios: React.FC = () => {
  const navigate = useNavigate();

  // Datos
  const [items, setItems] = useState<CatalogoItem[]>([]);
  const [stock, setStock] = useState<StockEnriquecido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
  const [msgItems, setMsgItems] = useState<string | null>(null);

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
    const { data } = await supabase.from('usuarios').select('id, escuela_id, sucursal_id').eq('id', user.id).single();
    return data;
  };

  // Cargar datos
  const cargarDatos = async () => {
    setCargando(true);
    setError(null);

    const [resItems, resStock] = await Promise.all([
      supabase.from('catalogo_items').select('*').eq('activo', true).order('nombre'),
      supabase.from('stock_productos').select('id, escuela_id, catalogo_item_id, cantidad_disponible, catalogo_items!inner(nombre)')
        .order('catalogo_items(nombre)'),
    ]);

    if (resItems.error) { setError(resItems.error.message); setCargando(false); return; }

    setItems(resItems.data ?? []);
    setStock((resStock.data ?? []).map((s: any) => ({
      catalogo_item_id: s.catalogo_item_id,
      item_nombre: s.catalogo_items?.nombre || '',
      cantidad_disponible: s.cantidad_disponible,
      stock_id: s.id,
    })));
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

  // Iniciar edición del catálogo
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
    setMsgItems(null);
  };

  // Agregar ítem nuevo (máx 10)
  const agregarItem = () => {
    if (itemsEditables.length >= 10) return;
    setItemsEditables(prev => [...prev, {
      nombre: '',
      tipo: 'servicio',
      precio_venta: '',
      esNuevo: true,
    }]);
  };

  // Eliminar ítem editable
  const eliminarItemEditable = (idx: number) => {
    setItemsEditables(prev => prev.filter((_, i) => i !== idx));
  };

  // Actualizar campo de ítem editable
  const actualizarItemEditable = (idx: number, campo: string, valor: string) => {
    setItemsEditables(prev => {
      const nuevos = [...prev];
      (nuevos[idx] as any)[campo] = valor;
      return nuevos;
    });
  };

  // Guardar catálogo
  const guardarCatalogo = async () => {
    setMsgItems(null);
    const validos = itemsEditables.filter(i => i.nombre.trim());
    if (validos.length === 0) { setMsgItems('Agrega al menos un ítem.'); return; }

    setGuardandoItems(true);
    const ctx = await obtenerCtx();
    if (!ctx) { setMsgItems('Error de contexto.'); setGuardandoItems(false); return; }

    // Actualizar existentes
    for (const item of validos.filter(i => !i.esNuevo && i.id)) {
      await supabase.from('catalogo_items').update({
        nombre: item.nombre,
        tipo: item.tipo,
        precio_venta: item.precio_venta ? parseFloat(item.precio_venta) : null,
      }).eq('id', item.id!);
    }

    // Insertar nuevos
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

      if (errIns) { setMsgItems(`Error: ${errIns.message}`); setGuardandoItems(false); return; }

      // Crear stock para los nuevos productos
      if (insertados) {
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
    setMsgItems('✅ Catálogo guardado.');
    cargarDatos();
    setTimeout(() => setMsgItems(null), 2000);
  };

  // Registrar movimiento de stock
  const registrarMovimiento = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movItemId) return;
    setMsgMov(null);

    const cant = parseInt(movCantidad);
    if (!cant || cant <= 0) { setMsgMov('Cantidad inválida.'); return; }

    setGuardandoMov(true);
    const ctx = await obtenerCtx();
    if (!ctx) { setMsgMov('Error de contexto.'); setGuardandoMov(false); return; }

    // Registrar movimiento
    const { error: errMov } = await supabase.from('movimientos_stock').insert({
      escuela_id: ctx.escuela_id,
      catalogo_item_id: movItemId,
      tipo: movTipo,
      cantidad: cant,
      motivo: movMotivo || (movTipo === 'entrada' ? 'Ingreso de stock' : 'Salida de stock'),
    });

    if (errMov) { setMsgMov(`Error: ${errMov.message}`); setGuardandoMov(false); return; }

    // Actualizar stock
    const stockActual = stock.find(s => s.catalogo_item_id === movItemId);
    if (stockActual) {
      const nuevaCant = movTipo === 'entrada'
        ? stockActual.cantidad_disponible + cant
        : stockActual.cantidad_disponible - cant; // Puede quedar negativo

      await supabase.from('stock_productos').update({
        cantidad_disponible: nuevaCant,
        updated_at: new Date().toISOString(),
      }).eq('id', stockActual.stock_id);
    }

    setGuardandoMov(false);
    setMovItemId(null);
    setMovCantidad('');
    setMovMotivo('');
    setMsgMov('✅ Movimiento registrado.');
    cargarDatos();
    setTimeout(() => setMsgMov(null), 2000);
  };



  // Separar por tipo
  const productos = items.filter(i => i.tipo === 'producto');
  const servicios = items.filter(i => i.tipo === 'servicio');

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <Package size={28} style={{ marginRight: '0.5rem' }} />
              Inventarios
            </h1>
            <p className="pc-subtitulo">
              {productos.length} productos — {servicios.length} servicios — {items.length} ítems en catálogo
            </p>
          </div>
        </div>
        <div className="pc-header-acciones">
          {!editando ? (
            <button className="btn-nueva-cuenta" onClick={iniciarEdicion}>
              <Edit2 size={18} /> Editar Catálogo
            </button>
          ) : (
            <>
              <button className="btn-guardar-cuenta" onClick={guardarCatalogo} disabled={guardandoItems}>
                <Save size={18} /> {guardandoItems ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn-refrescar" onClick={() => setEditando(false)}>
                <X size={18} />
              </button>
            </>
          )}
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {error && (
        <div className="form-msg form-msg--error" style={{ margin: '0.5rem 0' }}>
          ⚠️ {error}
        </div>
      )}

      {msgItems && (
        <div className={`form-msg ${msgItems.startsWith('✅') ? 'form-msg--exito' : 'form-msg--error'}`}
          style={{ margin: '0.5rem 0' }}>
          {msgItems}
        </div>
      )}

      {/* Modo edición del catálogo */}
      {editando && (
        <div className="inv-edicion">
          <h3 className="inv-edicion-titulo">📋 Editar Catálogo de Ítems ({itemsEditables.length}/10)</h3>
          <div className="inv-items-header">
            <span>Nombre</span>
            <span>Tipo</span>
            <span>Precio (Bs)</span>
            <span></span>
          </div>
          {itemsEditables.map((item, idx) => (
            <div key={idx} className="inv-item-row">
              <input
                type="text"
                value={item.nombre}
                onChange={e => actualizarItemEditable(idx, 'nombre', e.target.value)}
                placeholder="Nombre del ítem"
                className="inv-input"
                disabled={guardandoItems}
              />
              <select
                value={item.tipo}
                onChange={e => actualizarItemEditable(idx, 'tipo', e.target.value)}
                className="inv-select"
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
                placeholder="Opcional"
                className="inv-input inv-input--precio"
                disabled={guardandoItems}
              />
              <button
                className="nota-btn-eliminar"
                onClick={() => eliminarItemEditable(idx)}
                disabled={guardandoItems}
                title="Eliminar ítem"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {itemsEditables.length < 10 && (
            <button className="nota-btn-agregar" onClick={agregarItem} disabled={guardandoItems}>
              <Plus size={14} /> Agregar ítem
            </button>
          )}
        </div>
      )}

      {/* Vista del catálogo + stock (modo lectura) */}
      {!editando && !cargando && (
        <>
          {/* Sección de Productos con Stock */}
          <div className="inv-seccion">
            <h3 className="inv-seccion-titulo">
              <Package size={18} /> Productos (con control de stock)
            </h3>
            {productos.length === 0 ? (
              <p className="inv-vacio">No hay productos registrados.</p>
            ) : (
              <div className="inv-stock-grid">
                <div className="inv-stock-header">
                  <span>Producto</span>
                  <span>Precio</span>
                  <span>Stock</span>
                  <span>Acciones</span>
                </div>
                {productos.map(prod => {
                  const s = stock.find(st => st.catalogo_item_id === prod.id);
                  const cant = s?.cantidad_disponible ?? 0;
                  return (
                    <div key={prod.id} className="inv-stock-row">
                      <span className="inv-stock-nombre">{prod.nombre}</span>
                      <span className="inv-stock-precio">
                        {prod.precio_venta ? `Bs ${fmtMonto(Number(prod.precio_venta))}` : '—'}
                      </span>
                      <span className={`inv-stock-cant ${cant <= 0 ? 'inv-stock-cant--bajo' : ''}`}>
                        {cant}
                      </span>
                      <span className="inv-stock-acciones">
                        <button
                          className="inv-btn-mov inv-btn-mov--entrada"
                          onClick={() => { setMovItemId(prod.id); setMovTipo('entrada'); }}
                          title="Registrar entrada"
                        >
                          <ArrowUpCircle size={16} /> Entrada
                        </button>
                        <button
                          className="inv-btn-mov inv-btn-mov--salida"
                          onClick={() => { setMovItemId(prod.id); setMovTipo('salida'); }}
                          title="Registrar salida"
                        >
                          <ArrowDownCircle size={16} /> Salida
                        </button>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sección de Servicios */}
          <div className="inv-seccion">
            <h3 className="inv-seccion-titulo">
              <Tag size={18} /> Servicios
            </h3>
            {servicios.length === 0 ? (
              <p className="inv-vacio">No hay servicios registrados.</p>
            ) : (
              <div className="inv-stock-grid">
                <div className="inv-stock-header">
                  <span>Servicio</span>
                  <span>Precio</span>
                </div>
                {servicios.map(serv => (
                  <div key={serv.id} className="inv-stock-row">
                    <span className="inv-stock-nombre">{serv.nombre}</span>
                    <span className="inv-stock-precio">
                      {serv.precio_venta ? `Bs ${fmtMonto(Number(serv.precio_venta))}` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Modal de movimiento de stock */}
      {movItemId && (
        <div className="cxc-modal-overlay" onClick={() => { if (!guardandoMov) setMovItemId(null); }}>
          <div className="cxc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="cxc-modal-header">
              <h2>{movTipo === 'entrada' ? '📥 Entrada' : '📤 Salida'} de Stock</h2>
              <button onClick={() => setMovItemId(null)} disabled={guardandoMov}><X size={20} /></button>
            </div>
            <form className="cxc-modal-form" onSubmit={registrarMovimiento}>
              <div className="form-campo">
                <label>Producto</label>
                <input type="text" value={items.find(i => i.id === movItemId)?.nombre || ''} disabled />
              </div>
              <div className="form-campo">
                <label htmlFor="mov-cant">Cantidad</label>
                <input
                  id="mov-cant" type="number" min="1"
                  value={movCantidad}
                  onChange={e => setMovCantidad(e.target.value)}
                  required disabled={guardandoMov}
                  placeholder="Ej: 10"
                />
              </div>
              <div className="form-campo">
                <label htmlFor="mov-motivo">Motivo (opcional)</label>
                <input
                  id="mov-motivo" type="text"
                  value={movMotivo}
                  onChange={e => setMovMotivo(e.target.value)}
                  disabled={guardandoMov}
                  placeholder="Ej: Compra a proveedor"
                />
              </div>
              {msgMov && (
                <div className={`form-msg ${msgMov.startsWith('✅') ? 'form-msg--exito' : 'form-msg--error'}`}>
                  {msgMov}
                </div>
              )}
              <button type="submit" className="btn-guardar-cuenta" style={{ width: '100%', justifyContent: 'center' }} disabled={guardandoMov}>
                <Check size={16} /> {guardandoMov ? 'Registrando...' : 'Registrar'}
              </button>
            </form>
          </div>
        </div>
      )}

      {cargando && (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando inventarios...</p>
        </div>
      )}
    </main>
  );
};

export default Inventarios;
