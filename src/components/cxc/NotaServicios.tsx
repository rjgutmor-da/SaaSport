/**
 * NotaServicios.tsx
 * Modal flotante para crear/editar una "Nota de Servicios" (cuenta por cobrar).
 * Permite hasta 4 ítems del catálogo, con selector de meses para mensualidades.
 * Soporta pago inmediato al crear y genera mensaje WhatsApp de recibo.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem, LineaNota } from '../../types/cxc';
import { MESES_ANIO } from '../../types/cxc';
import {
  X, Plus, Check, Trash2, Calendar, AlertCircle,
  CreditCard, MessageCircle
} from 'lucide-react';

/** Props del componente */
interface NotaServiciosProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  alumnoPreseleccionado?: { id: string; nombre: string } | null;
  /** Modo edición: pasa los datos de la CxC existente */
  cxcEditar?: {
    id: string;
    alumno_id: string;
    alumno_nombre: string;
    observaciones: string;
    vencimiento: string;
    lineas: LineaNota[];
  } | null;
}

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Crea una línea vacía */
const lineaVacia = (): LineaNota => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  periodo_meses: [],
  subtotal: 0,
});

const NotaServicios: React.FC<NotaServiciosProps> = ({
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar
}) => {
  // Datos
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cuentasCobro, setCuentasCobro] = useState<{ id: string; codigo: string; nombre: string }[]>([]);

  // Formulario
  const [alumnoId, setAlumnoId] = useState('');
  const [lineas, setLineas] = useState<LineaNota[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  // Pago inmediato
  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [metodoPago, setMetodoPago] = useState('efectivo');
  const [cuentaCobroId, setCuentaCobroId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [cobroNroDoc, setCobroNroDoc] = useState('');

  // Mensaje WhatsApp de recibo (se muestra tras crear/pagar exitosamente)
  const [mensajeWA, setMensajeWA] = useState<{ texto: string; telefono: string } | null>(null);

  const anioMeses = new Date().getFullYear();

  // Modo edición
  const esEdicion = !!cxcEditar;

  // Cargar datos al abrir
  useEffect(() => {
    if (!visible) return;

    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      let esAdmin = false;
      let userSucursal = '';
      if (user) {
        const { data: usr } = await supabase.from('usuarios')
          .select('rol, sucursal_id').eq('id', user.id).single();
        esAdmin = usr?.rol === 'SuperAdministrador' || usr?.rol === 'Dueño';
        userSucursal = usr?.sucursal_id || '';
      }

      let qCuentas = supabase.from('plan_cuentas').select('id, codigo, nombre')
        .eq('es_transaccional', true)
        .like('codigo', '1.1.1%');
      
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resAlum, resCat, resCuentas] = await Promise.all([
        supabase.from('alumnos').select('id, nombres, apellidos')
          .eq('archivado', false).order('nombres', { ascending: true }),
        supabase.from('catalogo_items').select('*')
          .eq('activo', true).order('nombre'),
        qCuentas.order('codigo'),
      ]);
      setAlumnos(resAlum.data ?? []);
      setCatalogo(resCat.data ?? []);
      setCuentasCobro(resCuentas.data ?? []);
    };
    cargar();

    // Resetear formulario
    if (cxcEditar) {
      setAlumnoId(cxcEditar.alumno_id);
      setLineas(cxcEditar.lineas.length > 0 ? cxcEditar.lineas : [lineaVacia()]);
      setObservaciones(cxcEditar.observaciones || '');
      setVencimiento(cxcEditar.vencimiento || '');
    } else {
      setAlumnoId(alumnoPreseleccionado?.id || '');
      setLineas([lineaVacia()]);
      setObservaciones('');
      setVencimiento('');
    }
    setPagarAlCrear(false);
    setMetodoPago('efectivo');
    setCuentaCobroId('');
    setMontoPago('');
    setCobroNroDoc('');
    setError(null);
    setExito(null);
    setMensajeWA(null);
  }, [visible, alumnoPreseleccionado, cxcEditar]);

  // Total calculado
  const total = useMemo(() =>
    lineas.reduce((s, l) => s + l.subtotal, 0),
    [lineas]
  );

  // Autorellenar monto de pago cuando se activa "pagar al crear"
  useEffect(() => {
    if (pagarAlCrear && !montoPago) {
      setMontoPago(String(total));
    }
  }, [pagarAlCrear, total]);

  // Actualizar una línea
  const actualizarLinea = (idx: number, cambio: Partial<LineaNota>) => {
    setLineas(prev => {
      const nuevas = [...prev];
      nuevas[idx] = { ...nuevas[idx], ...cambio };
      // Recalcular subtotal
      nuevas[idx].subtotal = nuevas[idx].cantidad * nuevas[idx].precio_unitario;
      return nuevas;
    });
  };

  // Seleccionar ítem del catálogo
  const seleccionarItem = (idx: number, itemId: string) => {
    const item = catalogo.find(c => c.id === itemId);
    if (item) {
      actualizarLinea(idx, {
        catalogo_item_id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        precio_unitario: Number(item.precio_venta) || 0,
        cantidad: 1,
        periodo_meses: [],
      });
    } else {
      actualizarLinea(idx, lineaVacia());
    }
  };

  // Toggle mes en selector de meses
  const toggleMes = (idx: number, mes: string) => {
    setLineas(prev => {
      const nuevas = [...prev];
      const actual = nuevas[idx].periodo_meses || [];
      if (actual.includes(mes)) {
        nuevas[idx] = { ...nuevas[idx], periodo_meses: actual.filter(m => m !== mes) };
      } else {
        nuevas[idx] = { ...nuevas[idx], periodo_meses: [...actual, mes] };
      }
      // Si es mensualidad, la cantidad es el nro de meses
      if (nuevas[idx].nombre.toLowerCase() === 'mensualidad') {
        nuevas[idx].cantidad = nuevas[idx].periodo_meses.length || 1;
        nuevas[idx].subtotal = nuevas[idx].cantidad * nuevas[idx].precio_unitario;
      }
      return nuevas;
    });
  };

  // Agregar línea (máx 4)
  const agregarLinea = () => {
    if (lineas.length < 4) setLineas(prev => [...prev, lineaVacia()]);
  };

  // Eliminar línea
  const eliminarLinea = (idx: number) => {
    if (lineas.length > 1) {
      setLineas(prev => prev.filter((_, i) => i !== idx));
    }
  };

  // Obtener contexto del usuario
  const obtenerCtx = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id, nombres, apellidos, rol')
      .eq('id', user.id).single();
    return data;
  };

  /** Genera la descripción legible de ítems para WhatsApp */
  const generarDescItems = (lineasValidas: LineaNota[]): string => {
    return lineasValidas.map(l => {
      if (l.nombre.toLowerCase() === 'mensualidad' && l.periodo_meses.length > 0) {
        return `Mensualidad ${l.periodo_meses.join(', ')}`;
      }
      return l.cantidad > 1 ? `${l.nombre} x${l.cantidad}` : l.nombre;
    }).join(', ');
  };

  /** Registra en audit_log */
  const registrarAudit = async (
    ctx: any, accion: string, entidadId: string, detalle: any
  ) => {
    await supabase.from('audit_log').insert({
      escuela_id: ctx.escuela_id,
      usuario_id: ctx.id,
      usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
      accion,
      modulo: 'cxc',
      entidad_id: entidadId,
      detalle,
    });
  };

  // Crear o editar la nota de servicios
  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null); setMensajeWA(null);

    if (!alumnoId) { setError('Selecciona un alumno.'); return; }
    const lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario > 0);
    if (lineasValidas.length === 0) { setError('Agrega al menos un ítem con precio.'); return; }

    // Validar pago si está activado
    if (pagarAlCrear) {
      const mp = parseFloat(montoPago);
      if (!mp || mp <= 0) { setError('Monto de pago inválido.'); return; }
      if (!cuentaCobroId) { setError('Selecciona una caja/banco para el pago.'); return; }
    }

    setGuardando(true);
    const ctx = await obtenerCtx();
    if (!ctx) { setError('Error de contexto de usuario.'); setGuardando(false); return; }

    const montoTotal = lineasValidas.reduce((s, l) => s + l.subtotal, 0);
    const descripcionAuto = generarDescItems(lineasValidas);

    // ==============================
    // MODO EDICIÓN
    // ==============================
    if (esEdicion && cxcEditar) {
      // Actualizar la CxC
      const { error: errUpd } = await supabase.from('cuentas_cobrar').update({
        monto_total: montoTotal,
        descripcion: descripcionAuto,
        observaciones: observaciones || null,
        fecha_vencimiento: vencimiento || null,
        editado: true,
        editado_por: ctx.id,
        editado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', cxcEditar.id);

      if (errUpd) { setError(`Error al editar: ${errUpd.message}`); setGuardando(false); return; }

      // Reemplazar detalle: eliminar antiguo e insertar nuevo
      await supabase.from('cxc_detalle').delete().eq('cuenta_cobrar_id', cxcEditar.id);
      const detalles = lineasValidas.map(l => ({
        escuela_id: ctx.escuela_id,
        cuenta_cobrar_id: cxcEditar.id,
        catalogo_item_id: l.catalogo_item_id,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
      }));
      await supabase.from('cxc_detalle').insert(detalles);

      // Registrar auditoría
      await registrarAudit(ctx, 'editar', cxcEditar.id, {
        descripcion: descripcionAuto,
        monto_total: montoTotal,
        items: lineasValidas.map(l => l.nombre),
      });

      setExito('✅ Nota de Servicios actualizada.');
      setGuardando(false);
      setTimeout(() => { onCreada(); onCerrar(); }, 1200);
      return;
    }

    // ==============================
    // MODO CREACIÓN
    // ==============================

    // Buscar cuenta contable de CxC (1.1.3)
    const { data: ctaCxc } = await supabase
      .from('plan_cuentas').select('id').eq('codigo', '1.1.3').single();
    if (!ctaCxc) { setError('No se encontró la cuenta contable 1.1.3 (CxC).'); setGuardando(false); return; }

    // 1. Crear la cuenta por cobrar
    const { data: nuevaCxc, error: errCxc } = await supabase.from('cuentas_cobrar').insert({
      escuela_id: ctx.escuela_id,
      sucursal_id: ctx.sucursal_id,
      alumno_id: alumnoId,
      cuenta_contable_id: ctaCxc.id,
      monto_total: montoTotal,
      descripcion: descripcionAuto,
      observaciones: observaciones || null,
      fecha_vencimiento: vencimiento || null,
      estado: 'pendiente',
    }).select('id').single();

    if (errCxc || !nuevaCxc) {
      setError(`Error al crear CxC: ${errCxc?.message || 'desconocido'}`);
      setGuardando(false);
      return;
    }

    // 2. Crear las líneas de detalle
    const detalles = lineasValidas.map(l => ({
      escuela_id: ctx.escuela_id,
      cuenta_cobrar_id: nuevaCxc.id,
      catalogo_item_id: l.catalogo_item_id,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
    }));

    const { error: errDet } = await supabase.from('cxc_detalle').insert(detalles);
    if (errDet) {
      setError(`Error en detalle: ${errDet.message}`);
      setGuardando(false);
      return;
    }

    // Registrar auditoría de creación
    await registrarAudit(ctx, 'crear', nuevaCxc.id, {
      alumno_id: alumnoId,
      descripcion: descripcionAuto,
      monto_total: montoTotal,
      items: lineasValidas.map(l => l.nombre),
    });

    // 3. Si el usuario eligió pagar al crear
    let montoPagado = 0;
    if (pagarAlCrear) {
      const mp = parseFloat(montoPago);
      const { data: rpcResult, error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
        p_payload: {
          cuenta_cobrar_id: nuevaCxc.id,
          monto: mp,
          metodo_pago: metodoPago,
          cuenta_cobro_id: cuentaCobroId,
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          usuario_id: ctx.id,
          descripcion: `Pago al crear: ${descripcionAuto}`,
          nro_comprobante: cobroNroDoc.trim() || null,
        }
      });

      if (rpcErr) {
        setError(`Nota creada pero error en cobro: ${rpcErr.message}`);
        setGuardando(false);
        return;
      }

      montoPagado = mp;

      // Registrar auditoría del cobro
      await registrarAudit(ctx, 'cobro', nuevaCxc.id, {
        monto: mp,
        metodo_pago: metodoPago,
        nuevo_estado: rpcResult?.nuevo_estado,
      });
    }

    // 4. Preparar mensaje WhatsApp de recibo
    const alumno = alumnos.find(a => a.id === alumnoId);
    if (montoPagado > 0 && alumno) {
      // Buscar teléfono del alumno
      const { data: alumnoInfo } = await supabase.from('alumnos')
        .select('telefono_padre, telefono_madre, nombre_padre, nombre_madre, whatsapp_preferido')
        .eq('id', alumnoId).single();

      if (alumnoInfo) {
        const esPadre = alumnoInfo.whatsapp_preferido === 'padre';
        const telefono = esPadre
          ? (alumnoInfo.telefono_padre || alumnoInfo.telefono_madre)
          : (alumnoInfo.telefono_madre || alumnoInfo.telefono_padre);

        if (telefono) {
          const tipoPago = montoPagado >= montoTotal ? 'pago total' : 'pago parcial';
          const texto = `Gracias por el pago de Bs ${fmtMonto(montoPagado)}, que corresponde al ${tipoPago} de ${descripcionAuto}.`;
          const telLimpio = telefono.replace(/\D/g, '');
          const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
          setMensajeWA({ texto, telefono: telFinal });
        }
      }
    }

    setExito(montoPagado > 0
      ? `✅ Nota creada y cobro de Bs ${fmtMonto(montoPagado)} registrado.`
      : '✅ Nota de Servicios creada correctamente.'
    );
    setGuardando(false);

    // Si no hay mensaje WA, cerrar después de 1.5s
    if (montoPagado <= 0) {
      setTimeout(() => { onCreada(); onCerrar(); }, 1500);
    }
  };

  /** Enviar recibo por WhatsApp y cerrar */
  const enviarReciboWA = () => {
    if (mensajeWA) {
      window.open(`https://wa.me/${mensajeWA.telefono}?text=${encodeURIComponent(mensajeWA.texto)}`, '_blank');
    }
    onCreada();
    onCerrar();
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={() => { if (!guardando && !mensajeWA) onCerrar(); }}>
      <div className="cxc-modal cxc-modal--nota" onClick={e => e.stopPropagation()}>
        {/* Cabecera */}
        <div className="cxc-modal-header">
          <h2>📝 {esEdicion ? 'Editar Nota de Servicios' : 'Nueva Nota de Servicios'}</h2>
          <button onClick={() => { if (mensajeWA) { onCreada(); } onCerrar(); }} disabled={guardando}><X size={20} /></button>
        </div>

        {/* Panel de mensaje WhatsApp (después de crear con pago) */}
        {mensajeWA ? (
          <div className="nota-wa-recibo">
            <div className="nota-wa-exito">{exito}</div>
            <p className="nota-wa-mensaje">{mensajeWA.texto}</p>
            <div className="nota-wa-acciones">
              <button className="nota-wa-btn-enviar" onClick={enviarReciboWA}>
                <MessageCircle size={16} /> Enviar recibo por WhatsApp
              </button>
              <button className="nota-wa-btn-omitir" onClick={() => { onCreada(); onCerrar(); }}>
                Omitir
              </button>
            </div>
          </div>
        ) : (
          <form className="cxc-modal-form" onSubmit={guardarNota}>
            {/* Alumno */}
            <div className="form-campo">
              <label htmlFor="nota-alumno">Alumno</label>
              <select
                id="nota-alumno"
                value={alumnoId}
                onChange={e => setAlumnoId(e.target.value)}
                required
                disabled={guardando || !!alumnoPreseleccionado || esEdicion}
              >
                <option value="">— Seleccionar alumno —</option>
                {alumnos.map(a => (
                  <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>
                ))}
              </select>
            </div>

            {/* Vencimiento (sin campo "Periodo" inútil) */}
            <div className="form-campo">
              <label htmlFor="nota-venc">Fecha de vencimiento (opcional)</label>
              <input
                id="nota-venc" type="date" value={vencimiento}
                onChange={e => setVencimiento(e.target.value)}
                disabled={guardando}
              />
            </div>

            {/* Líneas de ítems */}
            <div className="nota-lineas-header">
              <span>Ítem</span>
              <span>Cant.</span>
              <span>Precio</span>
              <span>Subtotal</span>
              <span></span>
            </div>

            {lineas.map((linea, idx) => (
              <div key={idx} className="nota-linea-grupo">
                <div className="nota-linea">
                  <select
                    value={linea.catalogo_item_id}
                    onChange={e => seleccionarItem(idx, e.target.value)}
                    disabled={guardando}
                    className="nota-select-item"
                  >
                    <option value="">— Ítem —</option>
                    {catalogo.map(c => (
                      <option key={c.id} value={c.id}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number" min="1" max="99"
                    value={linea.cantidad}
                    onChange={e => actualizarLinea(idx, { cantidad: parseInt(e.target.value) || 1 })}
                    disabled={guardando || linea.nombre.toLowerCase() === 'mensualidad'}
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

                  <span className="nota-subtotal">
                    Bs {fmtMonto(linea.subtotal)}
                  </span>

                  <button
                    type="button"
                    className="nota-btn-eliminar"
                    onClick={() => eliminarLinea(idx)}
                    disabled={guardando || lineas.length <= 1}
                    title="Eliminar línea"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Selector de meses - solo para Mensualidad */}
                {linea.nombre.toLowerCase() === 'mensualidad' && (
                  <div className="nota-meses-container">
                    <div className="nota-meses-header">
                      <Calendar size={14} />
                      <span>Meses a cobrar:</span>
                    </div>
                    <div className="nota-meses-grid">
                      {MESES_ANIO.map(mes => {
                        const clave = `${mes}-${anioMeses}`;
                        const activo = linea.periodo_meses.includes(clave);
                        return (
                          <button
                            key={clave}
                            type="button"
                            className={`nota-mes-btn ${activo ? 'nota-mes-btn--activo' : ''}`}
                            onClick={() => toggleMes(idx, clave)}
                            disabled={guardando}
                          >
                            {mes}
                          </button>
                        );
                      })}
                    </div>
                    {/* Periodo personalizado */}
                    <div className="nota-periodo-custom">
                      <label>Periodo específico (opcional):</label>
                      <input
                        type="text"
                        placeholder="Ej: Mar-Jun 2026"
                        className="nota-input-periodo"
                        onChange={e => {
                          if (e.target.value.trim()) {
                            // Agregar como período personalizado
                            const periodos = [...linea.periodo_meses.filter(p => !p.startsWith('custom:')), `custom:${e.target.value.trim()}`];
                            setLineas(prev => {
                              const nuevas = [...prev];
                              nuevas[idx] = { ...nuevas[idx], periodo_meses: periodos };
                              return nuevas;
                            });
                          }
                        }}
                        disabled={guardando}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Agregar línea */}
            {lineas.length < 4 && (
              <button
                type="button"
                className="nota-btn-agregar"
                onClick={agregarLinea}
                disabled={guardando}
              >
                <Plus size={14} /> Agregar ítem
              </button>
            )}

            {/* Observaciones */}
            <div className="form-campo" style={{ marginTop: '0.75rem' }}>
              <label htmlFor="nota-obs">Observaciones</label>
              <textarea
                id="nota-obs"
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Observaciones opcionales..."
                rows={2}
                disabled={guardando}
                className="nota-textarea"
              />
            </div>

            {/* Total */}
            <div className="nota-total">
              <span>TOTAL:</span>
              <strong>Bs {fmtMonto(total)}</strong>
            </div>

            {/* Sección de pago inmediato (solo al crear, no al editar) */}
            {!esEdicion && (
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
                      placeholder="Monto"
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
                      value={cuentaCobroId}
                      onChange={e => setCuentaCobroId(e.target.value)}
                      required={pagarAlCrear}
                      disabled={guardando}
                      className="nota-pago-select"
                    >
                      <option value="">Caja/Banco</option>
                      {cuentasCobro.map(c => (
                        <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={cobroNroDoc}
                      onChange={e => setCobroNroDoc(e.target.value)}
                      placeholder="Nro. Comprobante (opc)"
                      className="nota-pago-input"
                      disabled={guardando}
                      style={{ fontSize: '0.85rem' }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Mensajes */}
            {error && <div className="form-msg form-msg--error"><AlertCircle size={14} /> {error}</div>}
            {exito && <div className="form-msg form-msg--exito"><Check size={14} /> {exito}</div>}

            {/* Botón crear/editar */}
            <button
              type="submit"
              className="btn-guardar-cuenta"
              style={{ width: '100%', justifyContent: 'center', marginTop: '0.5rem' }}
              disabled={guardando}
            >
              <Check size={16} /> {guardando
                ? (esEdicion ? 'Guardando...' : 'Creando...')
                : (esEdicion ? 'Guardar cambios' : (pagarAlCrear ? 'Crear y Cobrar' : 'Crear Nota de Servicios'))
              }
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default NotaServicios;
