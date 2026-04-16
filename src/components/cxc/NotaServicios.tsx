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
  CreditCard, MessageCircle, FileText, Users, RefreshCw, Info, Hash
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

/** Lista de torneos predefinidos */
const TORNEOS_PREDEFINIDOS = [
  'Torito Garcia',
  'Taquito',
  'Super Campeones',
  'Leones',
  'Atletico Junior',
  'Cañito',
  'Planeta',
  'Semillero',
  'JMP',
  'Milton Melgar',
  'Blooming Cup'
];

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
  const [nroRecibo, setNroRecibo] = useState('');

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
    setNroRecibo('');
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
        cliente: cxcEditar.alumno_nombre,
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
    const alumObj = alumnos.find(a => a.id === alumnoId);
    const nombreAlum = alumObj ? `${alumObj.nombres} ${alumObj.apellidos}` : 'N/A';

    await registrarAudit(ctx, 'crear', nuevaCxc.id, {
      cliente: nombreAlum,
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
        cliente: nombreAlum,
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
      <div className="cxc-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: '850px' }}>
        <div className="cxc-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="cxc-header-icon-circle" style={{ 
              background: 'rgba(59, 130, 246, 0.15)',
              color: '#3b82f6'
            }}>
              <FileText size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>{esEdicion ? 'Editar Nota de Servicio' : 'Nueva Nota de Servicio'}</h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {esEdicion ? 'Modifica los ítems y condiciones de la factura' : 'Genera una nueva cuenta por cobrar para el alumno'}
              </p>
            </div>
          </div>
          <button onClick={() => { if (mensajeWA) { onCreada(); } onCerrar(); }} className="btn-cerrar-modal" disabled={guardando}><X size={20} /></button>
        </div>

        <div className="cxc-modal-form" style={{ padding: '1.5rem 2rem' }}>
          {mensajeWA ? (
            <div className="nota-wa-recibo">
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.5rem' }}>
                <div className="form-msg form-msg--exito" style={{ width: '100%', justifyContent: 'center' }}>
                    <Check size={20} /> {exito}
                </div>
                <div style={{ padding: '1.5rem', background: 'var(--bg-glass)', borderRadius: '12px', width: '100%', border: '1px solid var(--border)' }}>
                  <p style={{ margin: 0, fontSize: '1rem', lineHeight: '1.6', color: 'var(--text-secondary)' }}>{mensajeWA.texto}</p>
                </div>
                <div style={{ display: 'flex', gap: '1rem', width: '100%', justifyContent: 'center' }}>
                  <button type="button" className="nota-wa-btn-enviar" onClick={enviarReciboWA} style={{ padding: '0.8rem 2rem' }}>
                    <MessageCircle size={18} /> Enviar por WhatsApp
                  </button>
                  <button type="button" className="nota-wa-btn-omitir" onClick={() => { onCreada(); onCerrar(); }} style={{ padding: '0.8rem 2rem' }}>
                    Omitir y cerrar
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <form onSubmit={guardarNota}>
              <div className="modal-form-grid" style={{ marginBottom: '2rem' }}>
                <div className="form-campo full-width">
                  <label><Users size={14} /> Alumno / Cliente *</label>
                  <select
                    value={alumnoId}
                    onChange={e => setAlumnoId(e.target.value)}
                    required
                    disabled={guardando || !!alumnoPreseleccionado || esEdicion}
                    style={{ fontSize: '1rem', padding: '0.8rem' }}
                  >
                    <option value="">— Seleccionar alumno —</option>
                    {alumnos.map(a => (
                      <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>
                    ))}
                  </select>
                </div>

                <div className="form-campo">
                  <label><Calendar size={14} /> Fecha de vencimiento (Opcional)</label>
                  <input
                    type="date" value={vencimiento}
                    onChange={e => setVencimiento(e.target.value)}
                    disabled={guardando}
                  />
                </div>

                <div className="form-campo">
                    <label><FileText size={14} /> Referencia / Observación Corta</label>
                    <input 
                        type="text" 
                        placeholder="Ej: Mensualidad Abril..." 
                        value={observaciones}
                        onChange={e => setObservaciones(e.target.value)}
                        disabled={guardando}
                    />
                </div>

                <div className="form-campo">
                    <label><Hash size={14} /> Nro. Transacción / Recibo</label>
                    <input 
                        type="text" 
                        placeholder="Ej: REC-001, 00123..." 
                        value={nroRecibo}
                        onChange={e => setNroRecibo(e.target.value)}
                        disabled={guardando}
                    />
                </div>
              </div>

              {/* Detalle de Items */}
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                    <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>Detalle de Cobro</h3>
                    {lineas.length < 4 && (
                        <button type="button" onClick={agregarLinea} disabled={guardando} className="btn-refrescar" style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', width: 'auto' }}>
                            <Plus size={14} /> Agregar ítem
                        </button>
                    )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {lineas.map((linea, idx) => {
                    const nomL = linea.nombre.toLowerCase();
                    const esMensualidad = nomL.includes('mensualidad');
                    const esTorneo = nomL.includes('torneo') || nomL.includes('inscripción');

                    return (
                      <div key={idx} style={{ background: 'var(--bg-glass)', borderRadius: '12px', border: '1px solid var(--border)', padding: '1rem', overflow: 'hidden' }}>
                        {/* Labels de columnas solo en la primera línea */}
                        {idx === 0 && (
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 40px', gap: '1rem', marginBottom: '0.5rem' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Ítem</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'center' }}>Cant.</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right' }}>P. Unitario</span>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', textAlign: 'right' }}>Subtotal</span>
                            <span></span>
                          </div>
                        )}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 120px 120px 40px', gap: '1rem', alignItems: 'center' }}>
                          <div className="form-campo" style={{ marginBottom: 0 }}>
                            <select
                              value={linea.catalogo_item_id}
                              onChange={e => seleccionarItem(idx, e.target.value)}
                              disabled={guardando}
                              style={{ border: 'none', background: 'transparent', padding: '0.5rem 0', fontWeight: 600, fontSize: '1rem' }}
                            >
                              <option value="">— Seleccionar ítem —</option>
                              {catalogo.map(c => (
                                <option key={c.id} value={c.id}>{c.nombre}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-campo" style={{ marginBottom: 0 }}>
                            <input
                              type="number" min="1" max="99"
                              value={linea.cantidad}
                              onChange={e => actualizarLinea(idx, { cantidad: parseInt(e.target.value) || 1 })}
                              disabled={guardando || esMensualidad}
                              style={{ 
                                textAlign: 'center', 
                                border: '1px solid var(--border)', 
                                background: 'rgba(255,255,255,0.07)', 
                                borderRadius: '8px',
                                padding: '0.6rem',
                                width: '100%',
                                fontSize: '1rem',
                                color: 'var(--text-primary)'
                              }}
                            />
                          </div>

                          <div className="form-campo" style={{ marginBottom: 0 }}>
                            <input
                              type="number" step="0.10" min="0"
                              value={linea.precio_unitario || ''}
                              onChange={e => actualizarLinea(idx, { precio_unitario: parseFloat(e.target.value) || 0 })}
                              disabled={guardando}
                              placeholder="0.00"
                              style={{ 
                                textAlign: 'right', 
                                border: '1px solid var(--border)', 
                                background: 'rgba(255,255,255,0.07)', 
                                borderRadius: '8px', 
                                fontWeight: 700,
                                padding: '0.6rem',
                                width: '100%',
                                fontSize: '1rem',
                                color: 'var(--text-primary)',
                                outline: 'none',
                                transition: 'all 0.2s'
                              }}
                              className="input-precio-unitario"
                            />
                          </div>

                          <div style={{ textAlign: 'right', fontWeight: 800, color: 'var(--success)', fontSize: '1.1rem' }}>
                             Bs {fmtMonto(linea.subtotal)}
                          </div>

                          <button
                            type="button"
                            onClick={() => eliminarLinea(idx)}
                            disabled={guardando || lineas.length <= 1}
                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', opacity: guardando ? 0.5 : 1 }}
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>

                        {(esMensualidad || esTorneo || (!linea.cuenta_ingreso_id && linea.catalogo_item_id)) && (
                          <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dotted var(--border)', display: 'flex', flexWrap: 'wrap', gap: '1rem' }}>
                            {esMensualidad && (
                              <div style={{ flex: 1, minWidth: '300px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--secondary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  <Calendar size={12} /> Meses a Cobrar ({anioMeses})
                                </label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem' }}>
                                  {MESES_ANIO.map(mes => {
                                    const clave = `${mes}-${anioMeses}`;
                                    const activo = linea.periodo_meses.includes(clave);
                                    return (
                                      <button
                                        key={clave}
                                        type="button"
                                        onClick={() => toggleMes(idx, clave)}
                                        disabled={guardando}
                                        style={{
                                          padding: '0.3rem',
                                          fontSize: '0.7rem',
                                          borderRadius: '4px',
                                          border: '1px solid',
                                          borderColor: activo ? 'var(--secondary)' : 'var(--border)',
                                          background: activo ? 'var(--secondary)' : 'transparent',
                                          color: activo ? 'white' : 'var(--text-tertiary)',
                                          cursor: 'pointer',
                                          fontWeight: activo ? 700 : 500,
                                          transition: 'all 0.2s'
                                        }}
                                      >
                                        {mes.substring(0, 3)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}

                            {(esTorneo || esMensualidad) && (
                              <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  <AlertCircle size={12} /> {esTorneo ? 'Seleccionar Torneo' : 'Periodo Custom'}
                                </label>
                                
                                {esTorneo ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <select
                                      value={TORNEOS_PREDEFINIDOS.includes(linea.detalle_personalizado || '') ? linea.detalle_personalizado : (linea.detalle_personalizado ? 'Otros' : '')}
                                      onChange={e => {
                                        const val = e.target.value;
                                        if (val === 'Otros') {
                                          actualizarLinea(idx, { detalle_personalizado: '' });
                                        } else {
                                          actualizarLinea(idx, { detalle_personalizado: val });
                                        }
                                      }}
                                      disabled={guardando}
                                      style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-primary)', outline: 'none' }}
                                    >
                                      <option value="" style={{ background: '#0A0A0A' }}>— Seleccionar Torneo —</option>
                                      {TORNEOS_PREDEFINIDOS.map(t => <option key={t} value={t} style={{ background: '#0A0A0A' }}>{t}</option>)}
                                      <option value="Otros" style={{ background: '#0A0A0A' }}>Otro (Especificar...)</option>
                                    </select>
                                    
                                    {(linea.detalle_personalizado === '' || !TORNEOS_PREDEFINIDOS.includes(linea.detalle_personalizado || '')) && (
                                      <input
                                        type="text"
                                        placeholder="Escribe el nombre del torneo..."
                                        value={linea.detalle_personalizado || ''}
                                        onChange={e => actualizarLinea(idx, { detalle_personalizado: e.target.value })}
                                        disabled={guardando}
                                        style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border)', borderRadius: '6px' }}
                                      />
                                    )}
                                  </div>
                                ) : (
                                  <input
                                    type="text"
                                    placeholder="Ej: Verano 2026"
                                    value={linea.detalle_personalizado || ''}
                                    onChange={e => actualizarLinea(idx, { detalle_personalizado: e.target.value })}
                                    disabled={guardando}
                                    style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)', border: '1px solid var(--border)', borderRadius: '6px' }}
                                  />
                                )}
                              </div>
                            )}

                            {linea.catalogo_item_id && !catalogo.find(c => c.id === linea.catalogo_item_id)?.cuenta_ingreso_id && (
                              <div style={{ flex: 1, minWidth: '200px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.75rem', fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', marginBottom: '0.5rem' }}>
                                  <CreditCard size={12} /> Cuenta de Ingreso *
                                </label>
                                <select
                                  value={linea.cuenta_ingreso_id || ''}
                                  onChange={e => actualizarLinea(idx, { cuenta_ingreso_id: e.target.value })}
                                  required
                                  style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(245, 158, 11, 0.05)', borderColor: 'rgba(245, 158, 11, 0.2)' }}
                                >
                                  <option value="">— Seleccionar —</option>
                                  {cuentasIngreso.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                </select>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div style={{ background: 'var(--bg-glass)', borderRadius: '16px', border: '1px solid var(--border)', padding: '1.5rem', marginTop: '2rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px', gap: '2rem', alignItems: 'center' }}>
                    <div>
                        {!esEdicion && (
                            <div style={{ border: 'none', background: 'transparent', padding: 0 }}>
                                <label style={{ border: '1px solid var(--border)', padding: '0.75rem 1rem', borderRadius: '10px', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                    <input
                                        type="checkbox"
                                        checked={pagarAlCrear}
                                        onChange={e => setPagarAlCrear(e.target.checked)}
                                        disabled={guardando}
                                    />
                                    <CreditCard size={16} />
                                    <span style={{ fontWeight: 700 }}>¿Registrar pago inmediato?</span>
                                </label>

                                {pagarAlCrear && (
                                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                        <div className="form-campo">
                                            <label>Monto</label>
                                            <input type="number" step="0.01" value={montoPago} onChange={e => setMontoPago(e.target.value)} />
                                        </div>
                                        <div className="form-campo">
                                            <label><Hash size={14} /> Nro. Transacción</label>
                                            <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Ej: 00123..." />
                                        </div>
                                        <div className="form-campo full-width">
                                            <label>Caja o Banco de Ingreso</label>
                                            <select value={cuentaCobroId} onChange={e => setCuentaCobroId(e.target.value)} required>
                                                <option value="">— Seleccionar Destino —</option>
                                                {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total a Facturar</span>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'white', lineHeight: 1 }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-tertiary)', marginRight: '0.2rem' }}>Bs</span>
                            {fmtMonto(total)}
                        </div>
                    </div>
                </div>

                {error && <div className="form-msg form-msg--error" style={{ marginTop: '1.5rem' }}><AlertCircle size={18} /> {error}</div>}
                
                <div className="cxc-modal-footer" style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
                    <button type="button" className="btn-refrescar" onClick={onCerrar} disabled={guardando} style={{ borderRadius: '8px', padding: '0 1.5rem', width: 'auto' }}>
                        Cancelar
                    </button>
                    <button type="submit" className="btn-guardar-cuenta" disabled={guardando} style={{ padding: '0.8rem 2.5rem' }}>
                        {guardando ? (
                            <> <RefreshCw size={18} className="spin" /> Guardando... </>
                        ) : (
                            <> <Check size={20} /> {esEdicion ? 'Actualizar Nota' : (pagarAlCrear ? 'Crear y Cobrar' : 'Confirmar Registro')} </>
                        )}
                    </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default NotaServicios;
