/**
 * NotaPago.tsx
 * Modal para crear una Nota de Pago (CxP).
 *
 * Permite registrar:
 *  - Beneficiario: Proveedor o Personal
 *  - Ítems del catálogo (con ingreso automático al inventario si son "productos")
 *  - Pago inmediato contra una Caja/Banco (opcional)
 *  - Cuenta de gasto del plan de cuentas (categorización contable)
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  X, Plus, Check, Trash2, AlertCircle, CreditCard, Package
} from 'lucide-react';

interface LineaNotaPago {
  catalogo_item_id: string;
  nombre: string;
  tipo: string;       // 'producto' | 'servicio'
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string;
  cuenta_gasto_id?: string | null;
}

interface Props {
  visible: boolean;
  tipoInicial: 'proveedor' | 'personal';
  onCerrar: () => void;
  onCreada: () => void;
}

const lineaVacia = (): LineaNotaPago => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  subtotal: 0,
  descripcion: '',
  cuenta_gasto_id: null,
});

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const NotaPago: React.FC<Props> = ({ visible, tipoInicial, onCerrar, onCreada }) => {
  // Datos del formulario
  const [tipoGasto, setTipoGasto] = useState(tipoInicial);
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [vencimiento, setVencimiento] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<LineaNotaPago[]>([lineaVacia()]);

  // Pago inmediato
  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');

  // Datos maestros
  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [personal, setPersonal] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<{ id: string; nombre: string; tipo: string; precio_venta: number; cuenta_gasto_id?: string }[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; cuenta_contable_id: string }[]>([]);
  const [cuentasGasto, setCuentasGasto] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentasMaestras, setCuentasMaestras] = useState<{ id: string; codigo: string }[]>([]);

  // Estado de control
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  /** Sincronizar tipo cuando el prop cambia */
  useEffect(() => { setTipoGasto(tipoInicial); }, [tipoInicial]);

  /** Cargar datos maestros al abrir */
  useEffect(() => {
    if (!visible) return;
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios')
        .select('escuela_id, sucursal_id').eq('id', user.id).single();
      if (!usr) return;

      const [resProv, persProv, resCat, resCajas, resGastos, resMaestras] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('personal').select('id, nombres, apellidos').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombres'),
        supabase.from('catalogo_items').select('id, nombre, tipo, precio_venta, cuenta_gasto_id').eq('activo', true).eq('es_gasto', true).order('nombre'),
        supabase.from('cajas_bancos').select('id, nombre, cuenta_contable_id').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('plan_cuentas').select('id, codigo, nombre')
          .eq('es_transaccional', true).in('tipo', ['gasto', 'activo', 'pasivo'])
          .or(`escuela_id.eq.${usr.escuela_id},escuela_id.is.null`)
          .order('nombre'),
        supabase.from('plan_cuentas').select('id, codigo')
          .in('codigo', ['2.1.1', '2.1.2', '1.1.4', '1.1.5'])
          .is('escuela_id', null),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(persProv.data ?? []);
      setCatalogo(resCat.data ?? []);
      setCajasBancos(resCajas.data ?? []);
      setCuentasGasto(resGastos.data ?? []);
      setCuentasMaestras(resMaestras?.data ?? []);
    };
    cargar();

    // Reset formulario
    setProveedorId('');
    setPersonalId('');
    setDescripcion('');
    setVencimiento('');
    setObservaciones('');
    setLineas([lineaVacia()]);
    setPagarAlCrear(false);
    setMetodoPago('efectivo');
    setCuentaPagoId('');
    setMontoPago('');
    setNroComprobante('');
    setError(null);
    setExito(null);
  }, [visible]);

  /** Total calculado */
  const total = useMemo(() => lineas.reduce((s, l) => s + l.subtotal, 0), [lineas]);

  /** Autorellenar monto cuando se activa pago inmediato */
  useEffect(() => {
    if (pagarAlCrear && !montoPago) setMontoPago(String(total));
  }, [pagarAlCrear, total]);

  /** Actualizar línea */
  const actualizarLinea = (idx: number, cambio: Partial<LineaNotaPago>) => {
    setLineas(prev => {
      const nuevas = [...prev];
      nuevas[idx] = { ...nuevas[idx], ...cambio };
      nuevas[idx].subtotal = nuevas[idx].cantidad * nuevas[idx].precio_unitario;
      return nuevas;
    });
  };

  /** Seleccionar ítem del catálogo */
  const seleccionarItem = (idx: number, itemId: string) => {
    const item = catalogo.find(c => c.id === itemId);
    if (item) {
      actualizarLinea(idx, {
        catalogo_item_id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        precio_unitario: Number(item.precio_venta) || 0,
        cantidad: 1,
        descripcion: '',
        cuenta_gasto_id: item.cuenta_gasto_id || null,
      });
    } else {
      actualizarLinea(idx, lineaVacia());
    }
  };

  /** Guardar Nota de Pago */
  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null);

    const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
    if (lineasValidas.length === 0) { setError('Agrega al menos un ítem válido.'); return; }
    if (lineasValidas.some(l => !l.cuenta_gasto_id)) { setError('Todos los ítems deben tener asignada una cuenta.'); return; }

    if (pagarAlCrear) {
      const mp = parseFloat(montoPago);
      if (!mp || mp <= 0) { setError('Monto de pago inválido.'); return; }
      if (!cuentaPagoId) { setError('Selecciona la caja/banco desde donde se pagará.'); return; }
    }

    setGuardando(true);

    // Obtener contexto usuario
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Error de autenticación.'); setGuardando(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id').eq('id', user.id).single();
    if (!ctx) { setError('Error al obtener contexto de usuario.'); setGuardando(false); return; }

    const montoTotal = lineasValidas.reduce((s, l) => s + l.subtotal, 0);
    const descAuto = lineasValidas.map(l => l.nombre).join(', ');

    let cuentaPasivoId = lineasValidas[0]?.cuenta_gasto_id || '';
    if (tipoGasto === 'proveedor') {
      cuentaPasivoId = cuentasMaestras.find(c => c.codigo === '2.1.1')?.id || cuentaPasivoId;
    } else if (tipoGasto === 'personal') {
      cuentaPasivoId = cuentasMaestras.find(c => c.codigo === '2.1.2')?.id || cuentaPasivoId;
    }

    // 1. Crear la Nota de Pago (CxP)
    const { data: nuevaCxP, error: errCxP } = await supabase.from('cuentas_pagar').insert({
      escuela_id: ctx.escuela_id,
      sucursal_id: ctx.sucursal_id || null,
      proveedor_id: tipoGasto === 'proveedor' && proveedorId ? proveedorId : null,
      personal_id: tipoGasto === 'personal' && personalId ? personalId : null,
      cuenta_contable_id: cuentaPasivoId,
      monto_total: montoTotal,
      tipo_gasto: tipoGasto,
      descripcion: descripcion || descAuto,
      observaciones: observaciones || null,
      fecha_vencimiento: vencimiento || null,
      estado: 'pendiente',
    }).select('id').single();

    if (errCxP || !nuevaCxP) {
      setError(`Error al crear nota: ${errCxP?.message || 'desconocido'}`);
      setGuardando(false);
      return;
    }

    // 2. Insertar detalle de ítems (los triggers de stock se activarán automáticamente)
    const detalles = lineasValidas.map(l => ({
      escuela_id: ctx.escuela_id,
      cuenta_pagar_id: nuevaCxP.id,
      catalogo_item_id: l.catalogo_item_id,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      descripcion: l.descripcion || null,
    }));

    const { error: errDet } = await supabase.from('cxp_detalle').insert(detalles);
    if (errDet) {
      setError(`Error en detalle: ${errDet.message}`);
      setGuardando(false);
      return;
    }

    // 2.5 Generar Asiento Contable por la Adquisición del Gasto/Inventario y la Deuda
    const movs = [];
    const agrupado = new Map<string, number>();
    lineasValidas.forEach(l => {
      if (l.cuenta_gasto_id) {
        agrupado.set(l.cuenta_gasto_id, (agrupado.get(l.cuenta_gasto_id) || 0) + l.subtotal);
      }
    });

    agrupado.forEach((monto, idCta) => {
      movs.push({ cuenta_contable_id: idCta, debe: monto, haber: 0 }); // DEBE
    });
    
    movs.push({ cuenta_contable_id: cuentaPasivoId, debe: 0, haber: montoTotal }); // HABER

    const payloadCompra = {
      escuela_id: ctx.escuela_id,
      sucursal_id: ctx.sucursal_id,
      usuario_id: ctx.id,
      descripcion: `Obligación por: ${descripcion || descAuto}`,
      metodo_pago: 'efectivo', // Metodo genérico para la obligación
      movimientos: movs
    };
    
    const { error: errAsientoBase } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payloadCompra });
    if (errAsientoBase) {
      console.warn('Asiento base de compra no pudo ser generado:', errAsientoBase.message);
    }

    // 3. Si se eligió pagar al crear, ejecutar RPC de pago
    if (pagarAlCrear) {
      const mp = parseFloat(montoPago);
      const { error: rpcErr } = await supabase.rpc('rpc_registrar_pago_cxp', {
        p_payload: {
          cuenta_pagar_id: nuevaCxP.id,
          monto: mp,
          metodo_pago: metodoPago,
          cuenta_pago_id: cuentaPagoId, // caja/banco que paga
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          descripcion: `Pago al crear: ${descAuto}`,
          nro_comprobante: nroComprobante.trim() || null,
        }
      });

      if (rpcErr) {
        setError(`Nota creada pero error al registrar pago: ${rpcErr.message}`);
        setGuardando(false);
        return;
      }

      setExito(`✅ Nota de Pago creada y pago de Bs ${fmtMonto(mp)} registrado correctamente.`);
    } else {
      setExito('✅ Nota de Pago creada correctamente.');
    }

    setGuardando(false);
    setTimeout(() => { onCreada(); }, 1500);
  };

  if (!visible) return null;

  const hayProductos = lineas.some(l => l.tipo === 'producto' && l.catalogo_item_id);

  return (
    <div className="cxc-modal-overlay" onClick={() => { if (!guardando && !exito) onCerrar(); }}>
      <div className="cxc-modal cxc-modal--nota" onClick={e => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="cxc-modal-header">
          <h2>💸 Nueva Nota de Deuda</h2>
          <button onClick={() => { if (exito) onCreada(); onCerrar(); }} disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <form className="cxc-modal-form" onSubmit={guardarNota}>
          {/* Tipo de gasto */}
          <div className="form-campo">
            <label>Tipo de egreso</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {[
                { val: 'proveedor', label: '🏭 Proveedor' },
                { val: 'personal', label: '👤 Personal' },
              ].map(opt => (
                <button
                  key={opt.val}
                  type="button"
                  className={`nota-mes-btn ${tipoGasto === opt.val ? 'nota-mes-btn--activo' : ''}`}
                  onClick={() => setTipoGasto(opt.val as any)}
                  disabled={guardando}
                  style={{ flex: 1 }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Selector de beneficiario */}
          {tipoGasto === 'proveedor' && (
            <div className="form-campo">
              <label>Proveedor</label>
              <select value={proveedorId} onChange={e => setProveedorId(e.target.value)} disabled={guardando}>
                <option value="">— Sin asignar / Genérico —</option>
                {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
          )}
          {tipoGasto === 'personal' && (
            <div className="form-campo">
              <label>Trabajador</label>
              <select value={personalId} onChange={e => setPersonalId(e.target.value)} disabled={guardando}>
                <option value="">— Sin asignar —</option>
                {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
              </select>
            </div>
          )}

          {/* Concepto libre */}
          <div className="form-campo">
            <label>Concepto / Descripción</label>
            <input
              type="text"
              value={descripcion}
              onChange={e => setDescripcion(e.target.value)}
              placeholder="Ej: Compra uniformes equipo Sub-12..."
              disabled={guardando}
            />
          </div>

          {/* Fecha de vencimiento */}
          <div className="form-campo">
            <label>Fecha de vencimiento (opcional)</label>
            <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} disabled={guardando} />
          </div>

          {/* Líneas de ítems */}
          <div className="nota-lineas-header">
            <span>Ítem / Concepto</span>
            <span>Cant.</span>
            <span>Precio</span>
            <span>Subtotal</span>
            <span></span>
          </div>

          {lineas.map((linea, idx) => (
            <React.Fragment key={idx}>
            <div className="nota-linea">
              <select
                value={linea.catalogo_item_id}
                onChange={e => seleccionarItem(idx, e.target.value)}
                disabled={guardando}
                className="nota-select-item"
              >
                <option value="">— Ítem o dejar vacío —</option>
                {catalogo.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.tipo === 'producto' ? '📦' : '🔧'} {c.nombre}
                  </option>
                ))}
              </select>

              <input
                type="number" min="1" max="9999"
                value={linea.cantidad}
                onChange={e => actualizarLinea(idx, { cantidad: parseInt(e.target.value) || 1 })}
                disabled={guardando}
                className="nota-input-cant"
              />

              <input
                type="number" step="0.01" min="0"
                value={linea.precio_unitario || ''}
                onChange={e => actualizarLinea(idx, { precio_unitario: parseFloat(e.target.value) || 0 })}
                disabled={guardando}
                placeholder="0.00"
                className="nota-input-precio"
              />

              <span className="nota-subtotal">Bs {fmtMonto(linea.subtotal)}</span>

              <button
                type="button"
                className="nota-btn-eliminar"
                onClick={() => { if (lineas.length > 1) setLineas(prev => prev.filter((_, i) => i !== idx)); }}
                disabled={guardando || lineas.length <= 1}
                title="Eliminar línea"
              >
                <Trash2 size={14} />
              </button>
            </div>
            {/* Seleccion de cuenta manual */}
            {linea.catalogo_item_id && catalogo.find(c => c.id === linea.catalogo_item_id) && !catalogo.find(c => c.id === linea.catalogo_item_id)?.cuenta_gasto_id && (
              <div className="nota-cuenta-manual" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem', paddingLeft: '0.5rem', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Cuenta Aplicable:</label>
                <select
                  value={linea.cuenta_gasto_id || ''}
                  onChange={e => actualizarLinea(idx, { cuenta_gasto_id: e.target.value })}
                  disabled={guardando}
                  className="nota-select-item"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', flex: 1, maxWidth: '280px', background: 'rgba(0,0,0,0.1)' }}
                  required
                >
                  <option value="">— Seleccione cuenta de gasto —</option>
                  {cuentasGasto.map(c => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
                </select>
              </div>
            )}
            </React.Fragment>
          ))}

          {/* Nota informativa de inventario */}
          {hayProductos && (
            <div className="form-msg" style={{ background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.4)', color: '#a5b4fc', fontSize: '0.82rem' }}>
              <Package size={13} style={{ marginRight: '0.35rem', flexShrink: 0 }} />
              Los ítems marcados como <strong>"producto"</strong> ingresarán automáticamente al inventario al guardar esta nota.
            </div>
          )}

          {/* Agregar línea */}
          {lineas.length < 8 && (
            <button
              type="button"
              className="nota-btn-agregar"
              onClick={() => setLineas(prev => [...prev, lineaVacia()])}
              disabled={guardando}
            >
              <Plus size={14} /> Agregar ítem
            </button>
          )}


          {/* Observaciones */}
          <div className="form-campo">
            <label>Observaciones (opcional)</label>
            <textarea
              value={observaciones}
              onChange={e => setObservaciones(e.target.value)}
              rows={2}
              disabled={guardando}
              placeholder="Notas internas..."
              className="nota-textarea"
            />
          </div>

          {/* Total */}
          <div className="nota-total">
            <span>TOTAL:</span>
            <strong>Bs {fmtMonto(total)}</strong>
          </div>

          {/* Pago inmediato */}
          <div className="nota-pago-section">
            <label className="nota-pago-toggle">
              <input
                type="checkbox"
                checked={pagarAlCrear}
                onChange={e => setPagarAlCrear(e.target.checked)}
                disabled={guardando}
              />
              <CreditCard size={14} />
              <span>Registrar pago al crear</span>
            </label>

            {pagarAlCrear && (
              <div className="nota-pago-campos">
                <input
                  type="number" step="0.01" min="0.01"
                  value={montoPago}
                  onChange={e => setMontoPago(e.target.value)}
                  placeholder="Monto a pagar"
                  className="nota-pago-input"
                  disabled={guardando}
                />
                <select
                  value={metodoPago}
                  onChange={e => setMetodoPago(e.target.value)}
                  disabled={guardando}
                  className="nota-pago-select"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="transferencia">Transferencia</option>
                  <option value="qr">QR</option>
                </select>
                <select
                  value={cuentaPagoId}
                  onChange={e => setCuentaPagoId(e.target.value)}
                  required={pagarAlCrear}
                  disabled={guardando}
                  className="nota-pago-select"
                >
                  <option value="">Caja / Banco de pago</option>
                  {cajasBancos.map(c => (
                    <option key={c.id} value={c.cuenta_contable_id}>{c.nombre}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={nroComprobante}
                  onChange={e => setNroComprobante(e.target.value)}
                  placeholder="Nro. Comprobante (opc)"
                  className="nota-pago-input"
                  disabled={guardando}
                  style={{ fontSize: '0.85rem' }}
                />
              </div>
            )}
          </div>

          {/* Mensajes */}
          {error && <div className="form-msg form-msg--error"><AlertCircle size={14} /> {error}</div>}
          {exito && <div className="form-msg form-msg--exito"><Check size={14} /> {exito}</div>}

          {/* Botón guardar */}
          <button
            type="submit"
            className="btn-guardar-cuenta"
            style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
            disabled={guardando}
          >
            <Check size={16} />
            {guardando ? 'Guardando...' : (pagarAlCrear ? 'Crear y Pagar' : 'Crear Nota de Pago')}
          </button>
        </form>
      </div>
    </div>
  );
};

export default NotaPago;
