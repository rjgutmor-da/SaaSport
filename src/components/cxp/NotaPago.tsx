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
  X, Plus, Check, Trash2, AlertCircle, CreditCard, Package,
  Users, FileText, Calendar, RefreshCw, Info, Hash
} from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';

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
  esAnticipo?: boolean;
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

const NotaPago: React.FC<Props> = ({ visible, tipoInicial, esAnticipo = false, onCerrar, onCreada }) => {
  // Datos del formulario
  const [tipoGasto, setTipoGasto] = useState(tipoInicial);
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
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
        supabase.from('plan_cuentas').select('id, codigo, nombre, cuenta_contable_id:id')
          .eq('es_transaccional', true).eq('tipo', 'activo')
          .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%')
          .or(`escuela_id.eq.${usr.escuela_id},escuela_id.is.null`)
          .order('codigo'),
        supabase.from('plan_cuentas').select('id, codigo, nombre')
          .eq('es_transaccional', true).in('tipo', ['gasto', 'activo', 'pasivo'])
          .or(`escuela_id.eq.${usr.escuela_id},escuela_id.is.null`)
          .order('nombre'),
        supabase.from('plan_cuentas').select('id, codigo')
          .in('codigo', ['2.1.1', '2.1.2', '1.1.4', '1.1.5', '1.1.6', '1.1.7'])
          .or(`escuela_id.eq.${usr.escuela_id},escuela_id.is.null`),
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
    setFechaEmision(getHoyISO());
    setVencimiento('');
    setObservaciones('');
    setLineas([lineaVacia()]);
    setPagarAlCrear(false);
    setMetodoPago('efectivo');
    setMontoPago('');
    setNroComprobante('');
    setError(null);
    setExito(null);

    // Ajustes para anticipo
    if (esAnticipo) {
      setPagarAlCrear(true);
      setDescripcion('Anticipo a Proveedor/Personal');
    }
  }, [visible, esAnticipo]);

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

    // Identificar sujeto para la glosa
    let nombreSujeto = '';
    if (tipoGasto === 'personal' && personalId) {
      const p = personal.find(x => x.id === personalId);
      if (p) nombreSujeto = `${p.nombres} ${p.apellidos}`;
    } else if (tipoGasto === 'proveedor' && proveedorId) {
      const p = proveedores.find(x => x.id === proveedorId);
      if (p) nombreSujeto = p.nombre;
    }

    // Clasificación de cuenta de pasivo (deuda)
    let cuentaPasivoId = lineasValidas[0]?.cuenta_gasto_id || '';
    if (tipoGasto === 'proveedor') {
      cuentaPasivoId = cuentasMaestras.find(c => c.codigo === '2.1.1')?.id || cuentaPasivoId;
    } else if (tipoGasto === 'personal') {
      cuentaPasivoId = cuentasMaestras.find(c => c.codigo === '2.1.2')?.id || cuentaPasivoId;
    }

    // 1. Crear la Nota de Pago (CxP) en la base de datos
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
      fecha_emision: fechaEmision,
      fecha_vencimiento: vencimiento || null,
      estado: 'pendiente',
      es_anticipo: esAnticipo,
    }).select('id').single();

    if (errCxP || !nuevaCxP) {
      setError(`Error al crear nota: ${errCxP?.message || 'desconocido'}`);
      setGuardando(false);
      return;
    }

    // 2. Insertar detalle de ítems
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

    // 2.5 Construir Asiento Contable (Único asiento compuesto si hay pago)
    const movs = [];
    const agrupado = new Map<string, number>();
    lineasValidas.forEach(l => {
      if (l.cuenta_gasto_id) {
        agrupado.set(l.cuenta_gasto_id, (agrupado.get(l.cuenta_gasto_id) || 0) + l.subtotal);
      }
    });

    // DEBITOS: Gastos o Activos
    agrupado.forEach((monto, idCta) => {
      let ctaDebitoId = idCta;
      if (esAnticipo) {
        ctaDebitoId = tipoGasto === 'proveedor' 
          ? (cuentasMaestras.find(c => c.codigo === '1.1.6')?.id || ctaDebitoId)
          : (cuentasMaestras.find(c => c.codigo === '1.1.7')?.id || ctaDebitoId);
      }
      movs.push({ cuenta_contable_id: ctaDebitoId, debe: monto, haber: 0 });
    });
    
    // HABERES: Caja/Banco y/o Pasivo
    const mp = pagarAlCrear ? parseFloat(montoPago) : 0;
    const saldoRestante = montoTotal - mp;

    if (mp > 0) {
      const ctaPagoContableId = cajasBancos.find(c => c.id === cuentaPagoId)?.cuenta_contable_id;
      if (ctaPagoContableId) {
        movs.push({ cuenta_contable_id: ctaPagoContableId, debe: 0, haber: mp });
      }
    }

    if (saldoRestante > 0.009) {
      movs.push({ cuenta_contable_id: cuentaPasivoId, debe: 0, haber: saldoRestante });
    }

    // Generar Glosa adaptada al requerimiento para Bonos
    const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const fechaPartes = fechaEmision.split('-');
    const mes = MESES[parseInt(fechaPartes[1]) - 1];
    
    let glosaFinal = descripcion || descAuto;
    const esBono = lineasValidas.some(l => l.nombre.toLowerCase().includes('bono'));
    
    if (esBono && tipoGasto === 'personal') {
      const sufijo = mp >= montoTotal ? 'Pago total' : 'Pago parcial';
      const concepto = descripcion || 'bono';
      glosaFinal = `${sufijo} de ${concepto} correspondiente al mes de ${mes} - ${nombreSujeto}`;
    } else if (pagarAlCrear) {
      glosaFinal = `Pago al crear: ${glosaFinal} - ${nombreSujeto}`;
    }

    // 3. Procesar Transacción Contable Unificada
    const payloadContable = {
      escuela_id: ctx.escuela_id,
      sucursal_id: ctx.sucursal_id,
      usuario_id: ctx.id,
      descripcion: glosaFinal,
      metodo_pago: metodoPago,
      nro_transaccion: nroComprobante.trim() || null,
      fecha: fechaEmision,
      movimientos: movs,
      // Vincular el pago si existe
      pagos: mp > 0 ? [{ 
        cuenta_pagar_id: nuevaCxP.id, 
        monto_aplicado: mp 
      }] : []
    };
    
    const { data: vAsientoId, error: errAsiento } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payloadContable });
    
    if (errAsiento) {
      console.error('Error al generar asiento:', errAsiento.message);
      setError(`Nota creada pero error contable: ${errAsiento.message}`);
      setGuardando(false);
      return;
    }

    // 4. Actualizar estado de la CxP según el pago
    const nuevoEstado = mp >= (montoTotal - 0.009) ? 'pagada' : (mp > 0 ? 'parcial' : 'pendiente');
    await supabase.from('cuentas_pagar').update({ 
      asiento_id: vAsientoId,
      monto_pagado: mp,
      estado: nuevoEstado
    }).eq('id', nuevaCxP.id);

    setExito(mp > 0 
      ? `✅ Nota creada y pago de Bs ${fmtMonto(mp)} registrado con éxito.` 
      : '✅ Nota de Deuda creada correctamente.'
    );

    setGuardando(false);
    setTimeout(() => { onCreada(); }, 1500);
  };

  if (!visible) return null;

  const hayProductos = lineas.some(l => l.tipo === 'producto' && l.catalogo_item_id);

  return (
    <div className="cxc-modal-overlay" onClick={() => { if (!guardando && !exito) onCerrar(); }}>
      <div className="cxc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '850px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: 'rgba(245, 158, 11, 0.15)',
              color: '#f59e0b'
            }}>
              <Package size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {esAnticipo ? 'Registrar Anticipo (Saldo a Favor)' : 'Nueva Nota de Deuda'}
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {esAnticipo ? 'Registra un pago adelantado para futuras deudas' : 'Registra una compra o compromiso de pago'}
              </p>
            </div>
          </div>
          <button onClick={() => { if (exito) onCreada(); onCerrar(); }} className="btn-cerrar-modal" disabled={guardando}>
            <X size={20} />
          </button>
        </div>

        <div className="cxc-modal-form" style={{ padding: '1.5rem 2rem' }}>
          <form onSubmit={guardarNota}>
            {/* Beneficiario y Tipo */}
            <div className="modal-form-grid" style={{ marginBottom: '2rem' }}>
              <div className="form-campo full-width">
                <label><Users size={14} /> Tipo de Egreso</label>
                <div style={{ display: 'flex', gap: '0.5rem', background: 'rgba(255,255,255,0.03)', padding: '4px', borderRadius: '12px', border: '1px solid var(--border)' }}>
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
                      style={{ 
                        flex: 1, 
                        padding: '0.6rem', 
                        fontSize: '0.85rem', 
                        borderRadius: '8px',
                        background: tipoGasto === opt.val ? 'var(--primary)' : 'transparent',
                        border: 'none',
                        color: tipoGasto === opt.val ? 'white' : 'var(--text-secondary)',
                        fontWeight: tipoGasto === opt.val ? 700 : 500,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {tipoGasto === 'proveedor' ? (
                <div className="form-campo full-width">
                  <label><Users size={14} /> Proveedor *</label>
                  <select 
                    value={proveedorId} 
                    onChange={e => setProveedorId(e.target.value)} 
                    disabled={guardando} 
                    required
                    style={{ fontSize: '1rem', padding: '0.8rem' }}
                  >
                    <option value="">— Seleccionar Proveedor —</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                </div>
              ) : (
                <div className="form-campo full-width">
                  <label><Users size={14} /> Trabajador *</label>
                  <select 
                    value={personalId} 
                    onChange={e => setPersonalId(e.target.value)} 
                    disabled={guardando} 
                    required
                    style={{ fontSize: '1rem', padding: '0.8rem' }}
                  >
                    <option value="">— Seleccionar Personal —</option>
                    {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                  </select>
                </div>
              )}

              <div className="form-campo">
                <label style={{ color: 'var(--primary)', fontWeight: 700 }}><Calendar size={14} /> Fecha de Emisión *</label>
                <input 
                  type="date" 
                  value={fechaEmision} 
                  onChange={e => setFechaEmision(e.target.value)} 
                  disabled={guardando} 
                  required 
                  style={{ borderColor: 'var(--primary)', background: 'rgba(245, 158, 11, 0.05)' }}
                />
              </div>

              <div className="form-campo">
                <label><Calendar size={14} /> Vencimiento (Opcional)</label>
                <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} disabled={guardando} />
              </div>

              <div className="form-campo full-width">
                <label><FileText size={14} /> Concepto / Referencia *</label>
                <input
                  type="text"
                  value={descripcion}
                  onChange={e => setDescripcion(e.target.value)}
                  placeholder="Ej: Material de oficina, Uniformes..."
                  required
                  disabled={guardando}
                  style={{ padding: '0.8rem' }}
                />
              </div>
            </div>

            {/* Detalle de Items */}
            <div style={{ marginBottom: '2rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Módulos de Gasto / Ítems</h3>
                  {lineas.length < 8 && (
                      <button type="button" onClick={() => setLineas(prev => [...prev, lineaVacia()])} disabled={guardando} className="btn-refrescar" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', width: 'auto' }}>
                          <Plus size={14} /> Agregar ítem
                      </button>
                  )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {lineas.map((linea, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-glass)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem' }}>
                    {idx === 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) 80px 140px 140px 40px', gap: '1rem', marginBottom: '0.5rem' }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Ítem</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'center' }}>Cant.</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right' }}>P. Unitario</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right' }}>Subtotal</span>
                        <span></span>
                      </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) 80px 140px 140px 40px', gap: '1rem', alignItems: 'center' }}>
                      <div className="form-campo" style={{ marginBottom: 0 }}>
                        <select
                          value={linea.catalogo_item_id}
                          onChange={e => seleccionarItem(idx, e.target.value)}
                          disabled={guardando}
                          style={{ border: 'none', background: 'transparent', fontWeight: 600, fontSize: '1rem', color: '#fff', width: '100%' }}
                        >
                          <option value="">— Buscar en catálogo —</option>
                          {catalogo.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.tipo === 'producto' ? '📦' : '🔧'} {c.nombre}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="form-campo" style={{ marginBottom: 0 }}>
                        <input
                          type="number" min="1"
                          value={linea.cantidad}
                          onChange={e => actualizarLinea(idx, { cantidad: parseInt(e.target.value) || 1 })}
                          disabled={guardando}
                          style={{ textAlign: 'center', border: 'none', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', padding: '0.6rem 0', color: 'white' }}
                        />
                      </div>

                      <div className="form-campo" style={{ marginBottom: 0 }}>
                        <input
                          type="number" step="0.01" min="0"
                          value={linea.precio_unitario || ''}
                          onChange={e => actualizarLinea(idx, { precio_unitario: parseFloat(e.target.value) || 0 })}
                          disabled={guardando}
                          placeholder="0.00"
                          style={{ textAlign: 'right', border: 'none', background: 'rgba(255,255,255,0.03)', borderRadius: '10px', fontWeight: 700, padding: '0.6rem 0.8rem', color: 'white' }}
                        />
                      </div>

                      <div style={{ textAlign: 'right', fontWeight: 800, color: '#f59e0b', fontSize: '1.1rem', whiteSpace: 'nowrap' }}>
                         <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginRight: '4px' }}>Bs</span>
                         {fmtMonto(linea.subtotal)}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <button
                          type="button"
                          onClick={() => { if (lineas.length > 1) setLineas(prev => prev.filter((_, i) => i !== idx)); }}
                          disabled={guardando || lineas.length <= 1}
                          style={{ background: 'rgba(239, 68, 68, 0.1)', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '0.5rem', borderRadius: '8px' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>

                    {/* Cuenta de Gasto Manual */}
                    {linea.catalogo_item_id && !catalogo.find(c => c.id === linea.catalogo_item_id)?.cuenta_gasto_id && (
                      <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dotted var(--border)', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <label style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 800, textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                          <Info size={12} /> Clasificación Contable *
                        </label>
                        <select
                          value={linea.cuenta_gasto_id || ''}
                          onChange={e => actualizarLinea(idx, { cuenta_gasto_id: e.target.value })}
                          required
                          style={{ flex: 1, padding: '0.4rem', fontSize: '0.85rem', background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)', borderRadius: '8px' }}
                        >
                          <option value="">— Seleccionar Cuenta de Gasto / Activo —</option>
                          {cuentasGasto.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nombre}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Resumen y Pago */}
            <div style={{ background: 'var(--bg-glass)', borderRadius: '20px', border: '1px solid var(--border)', padding: '1.75rem', marginTop: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 240px', gap: '2rem', alignItems: 'center' }}>
                    <div>
                        <div style={{ border: 'none', background: 'transparent', padding: 0 }}>
                            <label style={{ 
                              background: pagarAlCrear ? 'rgba(245, 158, 11, 0.1)' : 'rgba(255,255,255,0.03)',
                              border: pagarAlCrear ? '1px solid var(--primary)' : '1px solid var(--border)',
                              padding: '1rem', 
                              borderRadius: '12px', 
                              display: 'inline-flex', 
                              alignItems: 'center', 
                              gap: '0.75rem', 
                              cursor: 'pointer',
                              transition: 'all 0.3s ease'
                            }}>
                                <input
                                    type="checkbox"
                                    checked={pagarAlCrear}
                                    onChange={e => setPagarAlCrear(true)} // Si es anticipo, siempre true
                                    disabled={guardando || esAnticipo}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <CreditCard size={18} color={pagarAlCrear ? 'var(--primary)' : 'var(--text-tertiary)'} />
                                <span style={{ fontWeight: 700, fontSize: '0.95rem', color: pagarAlCrear ? 'white' : 'var(--text-secondary)' }}>
                                  {esAnticipo ? 'Pago Obligatorio (Anticipo)' : '¿Efectuar pago ahora?'}
                                </span>
                            </label>

                            {pagarAlCrear && (
                                <div style={{ marginTop: '1.25rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                    <div className="form-campo">
                                        <label>Monto a Pagar</label>
                                        <input 
                                          type="number" 
                                          step="0.01" 
                                          value={montoPago} 
                                          onChange={e => setMontoPago(e.target.value)} 
                                          style={{ fontWeight: 800, color: '#f59e0b', fontSize: '1.1rem', padding: '0.7rem' }} 
                                        />
                                    </div>
                                    <div className="form-campo">
                                        <label><Hash size={14} /> Nro. Transacción / Comprobante</label>
                                        <input 
                                          type="text" 
                                          value={nroComprobante} 
                                          onChange={e => setNroComprobante(e.target.value)} 
                                          placeholder="Ej: 00123, REC-001..." 
                                          style={{ padding: '0.7rem' }}
                                        />
                                    </div>
                                    <div className="form-campo full-width">
                                        <label>Caja o Banco de Origen</label>
                                        <select 
                                          value={cuentaPagoId} 
                                          onChange={e => setCuentaPagoId(e.target.value)} 
                                          required
                                          style={{ padding: '0.7rem' }}
                                        >
                                            <option value="">— Seleccionar Caja/Banco —</option>
                                            {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem', letterSpacing: '0.05em' }}>Total Obligación</span>
                        <div style={{ fontSize: '2.85rem', fontWeight: 900, color: 'white', lineHeight: 1, letterSpacing: '-0.02em' }}>
                            <span style={{ fontSize: '1.25rem', color: 'var(--text-tertiary)', marginRight: '0.3rem' }}>Bs</span>
                            {fmtMonto(total)}
                        </div>
                        {hayProductos && (
                            <div style={{ margin: '0.75rem 0 0 0', fontSize: '0.75rem', color: '#a5b4fc', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem', fontWeight: 600 }}>
                                <Package size={14} /> Actualizará inventario automático
                            </div>
                        )}
                    </div>
                </div>

                {error && <div className="form-msg form-msg--error" style={{ marginTop: '1.5rem', borderRadius: '10px' }}><AlertCircle size={18} /> {error}</div>}
                {exito && <div className="form-msg form-msg--exito" style={{ marginTop: '1.5rem', borderRadius: '10px' }}><Check size={18} /> {exito}</div>}
                
                <div className="cxc-modal-footer" style={{ marginTop: '1.75rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando} style={{ borderRadius: '10px', padding: '0 1.8rem', width: 'auto', fontWeight: 600 }}>
                        Cancelar
                    </button>
                    <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !!exito} style={{ 
                      background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)', 
                      borderColor: 'transparent', 
                      padding: '0.9rem 3rem',
                      borderRadius: '12px',
                      fontWeight: 800,
                      boxShadow: '0 10px 15px -3px rgba(245, 158, 11, 0.3)'
                    }}>
                        {guardando ? (
                            <> <RefreshCw size={18} className="spin" /> Procesando... </>
                        ) : (
                            <> <Check size={20} /> {pagarAlCrear ? 'Confirmar y Pagar' : 'Confirmar Deuda'} </>
                        )}
                    </button>
                </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default NotaPago;
