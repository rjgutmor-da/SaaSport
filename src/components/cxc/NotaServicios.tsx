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
  detalle_personalizado: '', // Para guardar nombre de torneo o periodo custom
  subtotal: 0,
  cuenta_ingreso_id: null,
});


const NotaServicios: React.FC<NotaServiciosProps> = ({
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar
}) => {
  // Datos
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cuentasCobro, setCuentasCobro] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentasIngreso, setCuentasIngreso] = useState<{ id: string; codigo: string; nombre: string }[]>([]);

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
        .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%');
      
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resAlum, resCat, resCuentas, resIngresos] = await Promise.all([
        supabase.from('alumnos').select('id, nombres, apellidos')
          .eq('archivado', false).order('nombres', { ascending: true }),
        supabase.from('catalogo_items').select('*')
          .eq('activo', true).eq('es_ingreso', true).order('nombre'),
        qCuentas.order('codigo'),
        supabase.from('plan_cuentas').select('id, codigo, nombre').eq('es_transaccional', true).in('tipo', ['ingreso', 'pasivo']).order('nombre'),
      ]);
      setAlumnos(resAlum.data ?? []);
      setCatalogo(resCat.data ?? []);
      setCuentasCobro(resCuentas.data ?? []);
      setCuentasIngreso(resIngresos.data ?? []);
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
      const esMensualidad = item.nombre.toLowerCase().includes('mensualidad');
      const esTorneo = item.nombre.toLowerCase().includes('torneo') || item.nombre.toLowerCase().includes('inscripción');
      
      actualizarLinea(idx, {
        catalogo_item_id: item.id,
        nombre: item.nombre,
        tipo: item.tipo,
        precio_unitario: Number(item.precio_venta) || 0,
        costo_unitario: Number(item.costo_unitario) || 0,
        cantidad: 1,
        periodo_meses: [],
        detalle_personalizado: '',
        cuenta_ingreso_id: item.cuenta_ingreso_id || null,
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
      if (nuevas[idx].nombre.toLowerCase().includes('mensualidad')) {
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
      const nom = l.nombre.toLowerCase();
      if (nom.includes('mensualidad')) {
        const meses = l.periodo_meses.length > 0 ? l.periodo_meses.join(', ') : (l.detalle_personalizado || '');
        return `Mensualidad ${meses}`;
      }
      if (nom.includes('torneo') || nom.includes('inscripción')) {
        return `${l.nombre}${l.detalle_personalizado ? ': ' + l.detalle_personalizado : ''}`;
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
    
    // Verificamos que todos los ítems tengan su cuenta (ya sea preasignada en el catálogo o seleccionada manualmente)
    const faltaCuenta = lineasValidas.find(l => {
      const dbItem = catalogo.find(c => c.id === l.catalogo_item_id);
      return !dbItem?.cuenta_ingreso_id && !l.cuenta_ingreso_id;
    });
    if (faltaCuenta) { setError('Todos los ítems deben tener una cuenta aplicable.'); return; }

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
        detalle_extra: l.detalle_personalizado || null
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
      detalle_extra: l.detalle_personalizado || null
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

    // 2.5 Generar asiento de la VENTA (Reconocimiento del Ingreso)
    if (montoTotal > 0) {
      const movimientosVenta = [
        { cuenta_contable_id: ctaCxc.id, debe: montoTotal, haber: 0 } // DEBE a 1.1.3 (CxC)
      ];
      
      const haberesMap = new Map<string, number>();
      lineasValidas.forEach(l => {
          const dbItem = catalogo.find(c => c.id === l.catalogo_item_id);
          const idCta = dbItem?.cuenta_ingreso_id || l.cuenta_ingreso_id || (cuentasCobro.find(c => c.codigo.startsWith('4.1'))?.id || ctaCxc.id);
          haberesMap.set(idCta, (haberesMap.get(idCta) || 0) + l.subtotal);
      });

      haberesMap.forEach((monto, idCta) => {
          movimientosVenta.push({ cuenta_contable_id: idCta, debe: 0, haber: monto }); // HABER a Ingresos
      });

      // Añadir movimiento de Costo de Ventas e Inventario si hay productos
      const { data: ctaCosto } = await supabase.from('plan_cuentas').select('id').eq('codigo', '5.6.1').or(`escuela_id.eq.${ctx.escuela_id},escuela_id.is.null`).single();
      const { data: ctaInv } = await supabase.from('plan_cuentas').select('id').eq('codigo', '1.1.4').or(`escuela_id.eq.${ctx.escuela_id},escuela_id.is.null`).single();

      if (ctaCosto && ctaInv) {
        let totalCosto = 0;
        lineasValidas.forEach(l => {
          if (l.tipo === 'producto' && l.costo_unitario && l.costo_unitario > 0) {
            totalCosto += (l.costo_unitario * l.cantidad);
          }
        });
        
        if (totalCosto > 0) {
           movimientosVenta.push({ cuenta_contable_id: ctaCosto.id, debe: totalCosto, haber: 0 }); // DEBE a Costos (5.6.1)
           movimientosVenta.push({ cuenta_contable_id: ctaInv.id, debe: 0, haber: totalCosto });   // HABER a Inventarios (1.1.4)
        }
      }

      const payloadVenta = {
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        usuario_id: ctx.id,
        descripcion: `Venta: ${descripcionAuto}`,
        metodo_pago: 'efectivo', 
        movimientos: movimientosVenta
      };
      
      await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payloadVenta });
    }

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

            {/* Vencimiento */}
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
              <span>Descripción Ítem</span>
              <span style={{ textAlign: 'center' }}>Cant.</span>
              <span style={{ textAlign: 'center' }}>Precio Unit.</span>
              <span style={{ textAlign: 'right' }}>Subtotal</span>
              <span></span>
            </div>

            {lineas.map((linea, idx) => {
              const nomL = linea.nombre.toLowerCase();
              const esMensualidad = nomL.includes('mensualidad');
              const esTorneo = nomL.includes('torneo') || nomL.includes('inscripción');

              return (
                <div key={idx} className="nota-linea-grupo" style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <div className="nota-linea">
                    <select
                      value={linea.catalogo_item_id}
                      onChange={e => seleccionarItem(idx, e.target.value)}
                      disabled={guardando}
                      className="nota-select-item"
                    >
                      <option value="">— Seleccionar ítem —</option>
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
                      disabled={guardando || esMensualidad}
                      className="nota-input-cant"
                      style={{ textAlign: 'center' }}
                    />

                    <input
                      type="number" step="0.10" min="0"
                      value={linea.precio_unitario || ''}
                      onChange={e => actualizarLinea(idx, { precio_unitario: parseFloat(e.target.value) || 0 })}
                      disabled={guardando}
                      placeholder="0.00"
                      className="nota-input-precio"
                      style={{ textAlign: 'center' }}
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
                      <Trash2 size={18} />
                    </button>
                  </div>

                  {/* Selector manual de cuenta de ingreso si el item original no tiene una cuenta vinculada */}
                  {linea.catalogo_item_id && catalogo.find(c => c.id === linea.catalogo_item_id) && !catalogo.find(c => c.id === linea.catalogo_item_id)?.cuenta_ingreso_id && (
                    <div className="nota-cuenta-manual" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.2rem', paddingLeft: '0.5rem' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>Cuenta Aplicable:</label>
                      <select
                        value={linea.cuenta_ingreso_id || ''}
                        onChange={e => actualizarLinea(idx, { cuenta_ingreso_id: e.target.value })}
                        disabled={guardando}
                        className="nota-select-item"
                        style={{ padding: '0.2rem 0.5rem', fontSize: '0.8rem', flex: 1, maxWidth: '280px', background: 'rgba(0,0,0,0.1)' }}
                        required
                      >
                        <option value="">— Seleccione cuenta de ingreso —</option>
                        {cuentasIngreso.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Selector de meses - solo para Mensualidad */}
                  {esMensualidad && (
                    <div className="nota-meses-container" style={{ 
                      marginTop: '0.25rem', 
                      padding: '1rem', 
                      background: 'rgba(56, 189, 248, 0.03)', 
                      borderRadius: '8px',
                      border: '1px solid rgba(56, 189, 248, 0.15)' 
                    }}>
                      <div className="nota-meses-header" style={{ marginBottom: '0.75rem', border: 'none', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <Calendar size={16} style={{ color: 'var(--secondary)' }} />
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--secondary)' }}>Marcar meses a cobrar:</span>
                      </div>
                      <div className="nota-meses-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem' }}>
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
                      <div className="nota-periodo-custom" style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.75rem' }}>
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.8rem', color: 'var(--text-tertiary)', fontWeight: 600 }}>
                          O registrar periodo específico:
                        </label>
                        <input
                          type="text"
                          placeholder="Ej: Septiembre - Diciembre 2026"
                          className="nota-input-periodo"
                          value={linea.detalle_personalizado || ''}
                          onChange={e => actualizarLinea(idx, { detalle_personalizado: e.target.value })}
                          disabled={guardando}
                          style={{ width: '100%', background: 'rgba(0,0,0,0.2)', fontSize: '0.85rem' }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Campo para Torneo */}
                  {esTorneo && (
                    <div className="nota-torneo-container" style={{ 
                      marginTop: '0.25rem', 
                      padding: '1rem', 
                      background: 'rgba(255, 107, 53, 0.03)', 
                      borderRadius: '8px',
                      border: '1px solid rgba(255, 107, 53, 0.15)' 
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                        <AlertCircle size={16} style={{ color: 'var(--primary)' }} />
                        <span style={{ fontWeight: 700, fontSize: '0.85rem', color: 'var(--primary)' }}>Nombre del Torneo / Evento:</span>
                      </div>
                      <input
                        type="text"
                        placeholder="Escriba el nombre del torneo..."
                        className="nota-input-torneo"
                        value={linea.detalle_personalizado || ''}
                        onChange={e => actualizarLinea(idx, { detalle_personalizado: e.target.value })}
                        disabled={guardando}
                        style={{ width: '100%', padding: '0.6rem', background: 'rgba(0,0,0,0.2)', border: '1px solid var(--border)' }}
                      />
                    </div>
                  )}
                </div>
              );
            })}

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
            <div className="form-campo">
              <label htmlFor="nota-obs">Observaciones generales</label>
              <textarea
                id="nota-obs"
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Notas adicionales para esta nota de servicio..."
                rows={2}
                disabled={guardando}
                className="nota-textarea"
                style={{ background: 'var(--bg-input)', fontSize: '0.9rem' }}
              />
            </div>

            {/* Total */}
            <div className="nota-total">
              <span>TOTAL FINAL</span>
              <strong>Bs {fmtMonto(total)}</strong>
            </div>


            {/* Sección de pago inmediato */}
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
                  <span>¿Deseas registrar el pago ahora mismo?</span>
                </label>

                {pagarAlCrear && (
                  <div className="nota-pago-campos">
                    <div className="form-campo">
                      <label>Monto a pagar</label>
                      <input
                        type="number" step="0.01" min="0.01"
                        value={montoPago}
                        onChange={e => setMontoPago(e.target.value)}
                        placeholder="Monto"
                        className="nota-pago-input"
                        disabled={guardando}
                      />
                    </div>
                    <div className="form-campo">
                      <label>Metodo</label>
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
                    </div>
                    <div className="form-campo">
                      <label>Cuenta Destino</label>
                      <select
                        value={cuentaCobroId}
                        onChange={e => setCuentaCobroId(e.target.value)}
                        required={pagarAlCrear}
                        disabled={guardando}
                        className="nota-pago-select"
                      >
                        <option value="">— Seleccionar Caja/Banco —</option>
                        {cuentasCobro.map(c => (
                          <option key={c.id} value={c.id}>{c.nombre}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-campo">
                      <label>Referencia / Comprobante</label>
                      <input
                        type="text"
                        value={cobroNroDoc}
                        onChange={e => setCobroNroDoc(e.target.value)}
                        placeholder="Opcional"
                        className="nota-pago-input"
                        disabled={guardando}
                      />
                    </div>
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
              style={{ width: '100%', justifyContent: 'center', marginTop: '1rem', padding: '1rem' }}
              disabled={guardando}
            >
              <Check size={18} /> {guardando
                ? (esEdicion ? 'Guardando...' : 'Creando...')
                : (esEdicion ? 'Guardar cambios' : (pagarAlCrear ? 'Crear Nota y Cobrar' : 'Crear Nota de Servicios'))
              }
            </button>
          </form>

        )}
      </div>
    </div>
  );
};

export default NotaServicios;
