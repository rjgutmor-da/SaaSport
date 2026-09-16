import React, { useEffect, useMemo, useState } from 'react';
import { PackagePlus, RefreshCw, ArrowLeftRight, ClipboardCheck, Gift, History, SlidersHorizontal, X } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { useAuthSaaSport } from '../../lib/authHelper';

type Producto = { id: string; nombre: string; activo: boolean };
type Sucursal = { id: string; nombre: string };
type Saldo = { catalogo_item_id: string; cantidad_disponible: number };
type Movimiento = {
  id: string; tipo: string; cantidad: number; direccion: 'entrada' | 'salida'; saldo_resultante: number;
  observacion: string | null; referencia_tipo: string | null; referencia_id: string | null; created_at: string;
  usuarios?: { nombres?: string; apellidos?: string } | null;
};

const hoyMes = () => new Date().toISOString().slice(0, 7);
const fmtFecha = (fecha: string) => new Intl.DateTimeFormat('es-BO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(fecha));

const Modal: React.FC<{ titulo: string; onCerrar: () => void; children: React.ReactNode }> = ({ titulo, onCerrar, children }) => (
  <div className="cxc-modal-overlay" onClick={onCerrar}>
    <div className="cxc-modal" style={{ maxWidth: '620px' }} onClick={e => e.stopPropagation()}>
      <div className="cxc-modal-header"><h2>{titulo}</h2><button onClick={onCerrar}><X size={18} /></button></div>
      {children}
    </div>
  </div>
);

const InventarioProductos: React.FC = () => {
  const { perfil, escuelaId, esSuperAdmin } = useAuthSaaSport();
  const [productos, setProductos] = useState<Producto[]>([]);
  const [sucursales, setSucursales] = useState<Sucursal[]>([]);
  const [sucursalId, setSucursalId] = useState('');
  const [saldos, setSaldos] = useState<Saldo[]>([]);
  const [abierto, setAbierto] = useState(false);
  const [limite, setLimite] = useState(10);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<'apertura' | 'movimiento' | 'traslado' | 'historial' | null>(null);
  const [productoId, setProductoId] = useState('');
  const [tipoMovimiento, setTipoMovimiento] = useState<'regalo' | 'ajuste_entrada' | 'ajuste_salida'>('regalo');
  const [cantidad, setCantidad] = useState('');
  const [observacion, setObservacion] = useState('');
  const [destinoId, setDestinoId] = useState('');
  const [conteo, setConteo] = useState<Record<string, string>>({});
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [mesHistorial, setMesHistorial] = useState(hoyMes());
  const [tipoHistorial, setTipoHistorial] = useState('');
  const [pagina, setPagina] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const opIdMovimientoRef = React.useRef<string>(crypto.randomUUID());
  const opIdTrasladoRef = React.useRef<string>(crypto.randomUUID());

  const tieneSucursal = esSuperAdmin || Boolean(perfil?.sucursal_id);
  const puedeOperar = (perfil?.rol === 'Administrador' && Boolean(perfil?.sucursal_id)) || esSuperAdmin;
  const saldoPorProducto = useMemo(() => new Map(saldos.map(s => [s.catalogo_item_id, Number(s.cantidad_disponible)])), [saldos]);
  const productoSeleccionado = productos.find(p => p.id === productoId);

  const cargar = async () => {
    if (!escuelaId) return;
    setCargando(true); setError(null);
    try {
      const [{ data: escuela, error: errEscuela }, { data: productosData, error: errProductos }, { data: sucursalesData, error: errSucursales }] = await Promise.all([
        supabase.from('escuelas').select('limite_productos_inventario').eq('id', escuelaId).single(),
        supabase.from('catalogo_items').select('id,nombre,activo').eq('escuela_id', escuelaId).eq('categoria', 'producto').eq('activo', true).order('nombre'),
        supabase.from('sucursales').select('id,nombre').eq('escuela_id', escuelaId).order('nombre'),
      ]);
      if (errEscuela || errProductos || errSucursales) throw errEscuela || errProductos || errSucursales;
      setLimite(Number(escuela?.limite_productos_inventario ?? 10));
      setProductos((productosData ?? []) as Producto[]);
      const permitidas = esSuperAdmin ? (sucursalesData ?? []) : (sucursalesData ?? []).filter(s => s.id === perfil?.sucursal_id);
      setSucursales(permitidas as Sucursal[]);
      setSucursalId(prev => prev && permitidas.some(s => s.id === prev) ? prev : (permitidas[0]?.id ?? ''));
    } catch (err: any) { setError(err.message || 'No se pudo cargar el inventario.'); }
    finally { setCargando(false); }
  };

  const cargarSucursal = async () => {
    if (!escuelaId || !sucursalId) return;
    const [{ data: saldosData, error: errSaldos }, { data: apertura, error: errApertura }] = await Promise.all([
      supabase.from('inventario_saldos').select('catalogo_item_id,cantidad_disponible').eq('escuela_id', escuelaId).eq('sucursal_id', sucursalId),
      supabase.from('inventario_aperturas').select('id').eq('escuela_id', escuelaId).eq('sucursal_id', sucursalId).maybeSingle(),
    ]);
    if (errSaldos || errApertura) { setError((errSaldos || errApertura)?.message || 'No se pudo cargar la sucursal.'); return; }
    setSaldos((saldosData ?? []) as Saldo[]); setAbierto(Boolean(apertura));
  };

  useEffect(() => { void cargar(); }, [escuelaId, esSuperAdmin, perfil?.sucursal_id]);
  useEffect(() => { void cargarSucursal(); }, [escuelaId, sucursalId]);

  const abrirApertura = () => {
    setConteo(Object.fromEntries(productos.map(p => [p.id, String(saldoPorProducto.get(p.id) ?? 0)])));
    setModal('apertura');
  };
  const cerrarModal = () => {
    setModal(null);
    setProductoId('');
    setCantidad('');
    setObservacion('');
    setDestinoId('');
    setPagina(0);
    opIdMovimientoRef.current = crypto.randomUUID();
    opIdTrasladoRef.current = crypto.randomUUID();
  };
  const recargar = async () => { await cargar(); await cargarSucursal(); };

  const confirmarApertura = async () => {
    setGuardando(true); setError(null);
    const lineas = productos.map(p => ({ catalogo_item_id: p.id, cantidad: Number(conteo[p.id] ?? 0) }));
    const invalida = lineas.some(l => !Number.isInteger(l.cantidad) || l.cantidad < 0);
    if (invalida) { setError('Todas las cantidades deben ser enteros iguales o mayores a cero.'); setGuardando(false); return; }
    const { error: err } = await supabase.rpc('rpc_confirmar_apertura_inventario', { p_sucursal_id: sucursalId, p_lineas: lineas });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    cerrarModal(); await cargarSucursal();
  };

  const guardarMovimiento = async () => {
    if (guardando) return;
    const unidades = Number(cantidad);
    if (!productoId || !Number.isInteger(unidades) || unidades <= 0 || !observacion.trim()) { setError('Selecciona un producto, una cantidad entera y una observación.'); return; }
    setGuardando(true); setError(null);
    const opId = opIdMovimientoRef.current;
    const { error: err } = await supabase.rpc('rpc_registrar_movimiento_inventario', {
      p_sucursal_id: sucursalId,
      p_catalogo_item_id: productoId,
      p_tipo: tipoMovimiento,
      p_cantidad: unidades,
      p_observacion: observacion.trim(),
      p_operacion_id: opId,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    opIdMovimientoRef.current = crypto.randomUUID();
    cerrarModal(); await cargarSucursal();
  };

  const trasladar = async () => {
    if (guardando) return;
    const unidades = Number(cantidad);
    if (!productoId || !destinoId || destinoId === sucursalId || !Number.isInteger(unidades) || unidades <= 0 || !observacion.trim()) { setError('Completa producto, destino, cantidad entera y observación.'); return; }
    setGuardando(true); setError(null);
    const opId = opIdTrasladoRef.current;
    const { error: err } = await supabase.rpc('rpc_trasladar_inventario', {
      p_origen_id: sucursalId,
      p_destino_id: destinoId,
      p_catalogo_item_id: productoId,
      p_cantidad: unidades,
      p_observacion: observacion.trim(),
      p_operacion_id: opId,
    });
    setGuardando(false);
    if (err) { setError(err.message); return; }
    opIdTrasladoRef.current = crypto.randomUUID();
    cerrarModal(); await cargarSucursal();
  };

  const cargarHistorial = async (reiniciar = false, paginaSolicitada?: number) => {
    if (!escuelaId || !sucursalId) return;
    const paginaConsulta = paginaSolicitada ?? (reiniciar ? 0 : pagina);
    const inicio = `${mesHistorial}-01T00:00:00`;
    const fin = new Date(`${mesHistorial}-01T00:00:00`); fin.setMonth(fin.getMonth() + 1);
    let query = supabase.from('inventario_movimientos')
      .select('id,tipo,cantidad,direccion,saldo_resultante,observacion,referencia_tipo,referencia_id,created_at,usuarios(nombres,apellidos)')
      .eq('escuela_id', escuelaId).eq('sucursal_id', sucursalId).gte('created_at', inicio).lt('created_at', fin.toISOString())
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(paginaConsulta * 50, paginaConsulta * 50 + 49);
    if (tipoHistorial) query = query.eq('tipo', tipoHistorial);
    const { data, error: err } = await query;
    if (err) { setError(err.message); return; }
    setMovimientos((data ?? []) as Movimiento[]); if (reiniciar) setPagina(0);
  };

  useEffect(() => { if (modal === 'historial') void cargarHistorial(true); }, [modal, mesHistorial, tipoHistorial, sucursalId]);

  return <section style={{ marginTop: '1rem' }}>
    <div className="cxc-barra-control" style={{ padding: '0.75rem 1.25rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <PackagePlus size={18} color="var(--primary)" /><strong>Inventario de productos</strong>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Productos activos: {productos.length} de {limite}</span>
        <select
          value={sucursalId}
          onChange={e => setSucursalId(e.target.value)}
          disabled={!esSuperAdmin || !sucursales.length}
          style={{ cursor: esSuperAdmin ? 'pointer' : 'default' }}
        >
          {esSuperAdmin && !sucursalId && <option value="">-- Selecciona una sucursal --</option>}
          {sucursales.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
        {!abierto && sucursalId && <span style={{ color: 'var(--warning, #f59e0b)', fontSize: '0.8rem' }}>Pendiente de conteo inicial</span>}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {puedeOperar && !abierto && <button className="btn-nueva-cuenta" onClick={abrirApertura}><ClipboardCheck size={15} /> Conteo inicial</button>}
        {puedeOperar && abierto && (
          <>
            <button className="btn-nueva-cuenta" onClick={() => { setTipoMovimiento('regalo'); setModal('movimiento'); }}><Gift size={15} /> Registrar regalo</button>
            <button className="btn-nueva-cuenta" onClick={() => { setTipoMovimiento('ajuste_entrada'); setModal('movimiento'); }}><SlidersHorizontal size={15} /> Ajustar existencias</button>
          </>
        )}
        {esSuperAdmin && abierto && <button className="btn-nueva-cuenta" onClick={() => setModal('traslado')}><ArrowLeftRight size={15} /> Trasladar</button>}
        {abierto && <button className="btn-refrescar" title="Ver movimientos" onClick={() => setModal('historial')} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}><History size={16} /> Movimientos</button>}
        <button className="btn-refrescar" title="Actualizar" onClick={() => void recargar()} disabled={cargando}><RefreshCw size={16} className={cargando ? 'spin' : ''} /></button>
      </div>
    </div>
    {perfil?.rol === 'Administrador' && !perfil?.sucursal_id && (
      <div className="pc-error" style={{ margin: '0.75rem 0', background: 'rgba(245, 158, 11, 0.1)', borderColor: 'rgba(245, 158, 11, 0.3)', color: '#f59e0b' }}>
        <p>⚠️ Administrador sin sucursal asignada: puedes consultar el inventario, pero no registrar apertura, regalos ni ajustes hasta tener una sucursal asignada.</p>
      </div>
    )}
    {error && <div className="pc-error" style={{ margin: '0.75rem 0' }}><p>⚠️ {error}</p></div>}
    <div className="cxc-tabla-wrapper">
      <table className="cxc-tabla"><thead><tr><th className="cxc-th">PRODUCTO</th><th className="cxc-th cxc-th-center">EXISTENCIAS</th><th className="cxc-th cxc-th-center">ESTADO</th></tr></thead>
        <tbody>{productos.map(producto => { const saldo = saldoPorProducto.get(producto.id) ?? 0; return <tr className="cxc-tr" key={producto.id}><td className="cxc-td">{producto.nombre}</td><td className="cxc-td cxc-td-center" style={{ fontWeight: 700, color: saldo < 0 ? 'var(--danger)' : saldo === 0 ? 'var(--text-tertiary)' : 'var(--success)' }}>{saldo}</td><td className="cxc-td cxc-td-center">{saldo < 0 ? <span style={{ color: 'var(--danger)' }}>Saldo negativo</span> : saldo === 0 ? 'Sin existencias' : 'Disponible'}</td></tr>; })}
          {!cargando && productos.length === 0 && <tr><td className="cxc-td" colSpan={3}>No hay productos activos.</td></tr>}</tbody></table>
    </div>

    {modal === 'apertura' && <Modal titulo="Conteo inicial de inventario" onCerrar={cerrarModal}><div className="cxc-modal-form"><p style={{ color: 'var(--text-secondary)' }}>Confirma las unidades físicas de todos los productos en esta sucursal. Incluye cero cuando no haya existencias.</p>{productos.map(p => <div className="form-campo" key={p.id}><label>{p.nombre}</label><input type="number" min="0" step="1" value={conteo[p.id] ?? ''} onChange={e => setConteo(prev => ({ ...prev, [p.id]: e.target.value }))} disabled={guardando} /></div>)}<button className="btn-guardar-cuenta" onClick={() => void confirmarApertura()} disabled={guardando}>{guardando ? 'Guardando...' : 'Confirmar conteo'}</button></div></Modal>}
    {modal === 'movimiento' && <Modal titulo={tipoMovimiento === 'regalo' ? 'Registrar regalo' : 'Ajustar existencias'} onCerrar={cerrarModal}><div className="cxc-modal-form">{tipoMovimiento !== 'regalo' && <div className="form-campo"><label>Tipo de ajuste</label><select value={tipoMovimiento} onChange={e => setTipoMovimiento(e.target.value as typeof tipoMovimiento)}><option value="ajuste_entrada">Ajuste de entrada (+)</option><option value="ajuste_salida">Ajuste de salida (-)</option></select></div>}<div className="form-campo"><label>Producto</label><select value={productoId} onChange={e => setProductoId(e.target.value)}><option value="">Selecciona</option>{productos.map(p => <option value={p.id} key={p.id}>{p.nombre} · saldo actual {saldoPorProducto.get(p.id) ?? 0}</option>)}</select></div><div className="form-campo"><label>Cantidad</label><input type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)} /></div><div className="form-campo"><label>Observación *</label><textarea value={observacion} onChange={e => setObservacion(e.target.value)} placeholder="Motivo del movimiento..." required /></div><button className="btn-guardar-cuenta" onClick={() => void guardarMovimiento()} disabled={guardando}>{guardando ? 'Guardando...' : 'Registrar'}</button></div></Modal>}
    {modal === 'traslado' && <Modal titulo="Trasladar inventario" onCerrar={cerrarModal}><div className="cxc-modal-form"><div className="form-campo"><label>Producto</label><select value={productoId} onChange={e => setProductoId(e.target.value)}><option value="">Selecciona</option>{productos.map(p => <option value={p.id} key={p.id}>{p.nombre} · saldo {saldoPorProducto.get(p.id) ?? 0}</option>)}</select></div><div className="form-campo"><label>Sucursal destino</label><select value={destinoId} onChange={e => setDestinoId(e.target.value)}><option value="">Selecciona</option>{sucursales.filter(s => s.id !== sucursalId).map(s => <option value={s.id} key={s.id}>{s.nombre}</option>)}</select></div><div className="form-campo"><label>Cantidad</label><input type="number" min="1" step="1" value={cantidad} onChange={e => setCantidad(e.target.value)} /></div><div className="form-campo"><label>Observación *</label><textarea value={observacion} onChange={e => setObservacion(e.target.value)} placeholder="Motivo del traslado..." required /></div><button className="btn-guardar-cuenta" onClick={() => void trasladar()} disabled={guardando}>{guardando ? 'Guardando...' : 'Trasladar'}</button></div></Modal>}
    {modal === 'historial' && <Modal titulo="Historial de inventario" onCerrar={cerrarModal}><div className="cxc-modal-form"><div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}><div className="form-campo"><label>Mes</label><input type="month" value={mesHistorial} onChange={e => setMesHistorial(e.target.value)} /></div><div className="form-campo"><label>Operación</label><select value={tipoHistorial} onChange={e => setTipoHistorial(e.target.value)}><option value="">Todas</option>{['apertura','compra','venta','regalo','ajuste_entrada','ajuste_salida','traslado_entrada','traslado_salida','correccion','anulacion_compra','anulacion_venta'].map(t => <option value={t} key={t}>{t.replaceAll('_', ' ')}</option>)}</select></div></div><div className="cxc-tabla-wrapper"><table className="cxc-tabla"><thead><tr><th className="cxc-th">FECHA Y HORA</th><th className="cxc-th">OPERACIÓN</th><th className="cxc-th">ENTRADA</th><th className="cxc-th">SALIDA</th><th className="cxc-th">SALDO RESULTANTE</th><th className="cxc-th">RESPONSABLE</th><th className="cxc-th">OBSERVACIÓN</th><th className="cxc-th">REFERENCIA</th></tr></thead><tbody>{movimientos.map(m => <tr className="cxc-tr" key={m.id}><td className="cxc-td">{fmtFecha(m.created_at)}</td><td className="cxc-td">{m.tipo.replaceAll('_', ' ')}</td><td className="cxc-td">{m.direccion === 'entrada' ? m.cantidad : '—'}</td><td className="cxc-td">{m.direccion === 'salida' ? m.cantidad : '—'}</td><td className="cxc-td" style={{ color: m.saldo_resultante < 0 ? 'var(--danger)' : undefined }}>{m.saldo_resultante}</td><td className="cxc-td">{m.usuarios ? [m.usuarios.nombres, m.usuarios.apellidos].filter(Boolean).join(' ') : '—'}</td><td className="cxc-td">{m.observacion || '—'}</td><td className="cxc-td">{m.referencia_tipo ? m.referencia_tipo + (m.referencia_id ? ' · ' + m.referencia_id.slice(0, 8) : '') : '—'}</td></tr>)}{movimientos.length === 0 && <tr><td className="cxc-td" colSpan={8}>Sin movimientos en este período.</td></tr>}</tbody></table></div><div style={{ display: 'flex', justifyContent: 'space-between' }}><button className="btn-refrescar" disabled={pagina === 0} onClick={() => { const nuevaPagina = pagina - 1; setPagina(nuevaPagina); void cargarHistorial(false, nuevaPagina); }}>Anterior</button><button className="btn-refrescar" disabled={movimientos.length < 50} onClick={() => { const nuevaPagina = pagina + 1; setPagina(nuevaPagina); void cargarHistorial(false, nuevaPagina); }}>Siguiente</button></div></div></Modal>}
  </section>;
};

export default InventarioProductos;
