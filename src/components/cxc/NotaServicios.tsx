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
  CreditCard, MessageCircle, FileText, Users, RefreshCw, Info, Hash, Eye, Pencil
} from 'lucide-react';
import { getHoyISO, getHoraLocal } from '../../lib/dateUtils';

/** Props del componente */
interface NotaServiciosProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  alumnoPreseleccionado?: { id: string; nombre: string } | null;
  esAnticipo?: boolean;
  /** Modo edición: pasa los datos de la CxC existente */
  cxcEditar?: {
    id: string;
    alumno_id: string;
    alumno_nombre: string;
    observaciones: string;
    vencimiento: string;
    fecha_emision?: string;
    nro_recibo?: string;
    lineas: LineaNota[];
  } | null;
  /** Permite abrir directamente en modo 'ver', 'editar' o 'crear' */
  modoInicial?: 'ver' | 'editar' | 'crear';
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
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar, esAnticipo = false, modoInicial
}) => {
  // Estados de control
  const [modo, setModo] = useState<'ver' | 'editar' | 'crear'>('crear');
  // Datos
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cuentasCobro, setCuentasCobro] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentasIngreso, setCuentasIngreso] = useState<{ id: string; codigo: string; nombre: string }[]>([]);
  const [cuentasMaestras, setCuentasMaestras] = useState<{ id: string; codigo: string }[]>([]);

  // Formulario
  const [alumnoId, setAlumnoId] = useState('');
  const [lineas, setLineas] = useState<LineaNota[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState('');
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
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
  const [horaPago, setHoraPago] = useState(getHoraLocal());
  const [cobroOriginalAsientoId, setCobroOriginalAsientoId] = useState<string | null>(null);
  const [cobroMovimientoId, setCobroMovimientoId] = useState<string | null>(null);

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
      let escuelaId = '';

      if (user) {
        const { data: usr } = await supabase.from('usuarios')
          .select('rol, sucursal_id, escuela_id').eq('id', user.id).single();
        esAdmin = usr?.rol === 'SuperAdministrador' || usr?.rol === 'Dueño';
        userSucursal = usr?.sucursal_id || '';
        escuelaId = usr?.escuela_id || '';
      }

      let qCuentas = supabase.from('plan_cuentas').select('id, codigo, nombre')
        .eq('es_transaccional', true)
        .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%');
      
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resAlum, resCat, resCuentas, resIngresos, resMaestras] = await Promise.all([
        supabase.from('alumnos').select('id, nombres, apellidos')
          .eq('archivado', false).order('nombres', { ascending: true }),
        supabase.from('catalogo_items').select('*')
          .eq('activo', true).eq('es_ingreso', true).order('nombre'),
        qCuentas.order('codigo'),
        supabase.from('plan_cuentas').select('id, codigo, nombre')
          .eq('es_transaccional', true).in('tipo', ['ingreso', 'pasivo'])
          .or(`escuela_id.eq.${escuelaId},escuela_id.is.null`)
          .order('nombre'),
        supabase.from('plan_cuentas').select('id, codigo')
          .in('codigo', ['2.1.5', '1.1.2'])
          .or(`escuela_id.eq.${escuelaId},escuela_id.is.null`),
      ]);
      setAlumnos(resAlum.data ?? []);
      setCatalogo(resCat.data ?? []);
      setCuentasCobro(resCuentas.data ?? []);
      setCuentasIngreso(resIngresos.data ?? []);
      setCuentasMaestras(resMaestras.data ?? []);
    };
    cargar();

    // Resetear formulario
    if (cxcEditar) {
      setModo(modoInicial || 'ver');
      setAlumnoId(cxcEditar.alumno_id);
      setLineas(cxcEditar.lineas.length > 0 ? cxcEditar.lineas : [lineaVacia()]);
      setObservaciones(cxcEditar.observaciones || '');
      setVencimiento(cxcEditar.vencimiento || '');
      setFechaEmision(cxcEditar.fecha_emision || getHoyISO());
      setNroRecibo(cxcEditar.nro_recibo || '');

      // CARGAR COBRO SI EXISTE
      const cargarCobro = async () => {
        const { data: cobros } = await supabase.from('cobros_aplicados')
          .select('*, asientos_contables(*)')
          .eq('cuenta_cobrar_id', cxcEditar.id)
          .limit(1);

        if (cobros && cobros.length > 0) {
          const c = cobros[0];
          setCobroOriginalAsientoId(c.asiento_id);
          setPagarAlCrear(true);
          setMontoPago(String(c.monto_aplicado));
          setMetodoPago(c.asientos_contables?.metodo_pago || 'efectivo');
          setCobroNroDoc(c.asientos_contables?.documento_referencia || '');
          
          // Buscar la cuenta de caja/banco en ese asiento (donde hubo entrada de dinero)
          const { data: mv } = await supabase.from('movimientos_contables')
            .select('id, cuenta_contable_id')
            .eq('asiento_id', c.asiento_id)
            .gt('debe', 0)
            .limit(1);
          
          if (mv && mv.length > 0) {
            setCobroMovimientoId(mv[0].id);
            setCuentaCobroId(mv[0].cuenta_contable_id);
          }
        }
      };
      cargarCobro();
    } else {
      setModo('crear');
      setAlumnoId(alumnoPreseleccionado?.id || '');
      setLineas([lineaVacia()]);
      setObservaciones('');
      setVencimiento('');
      setFechaEmision(getHoyISO());
    }
    setHoraPago(getHoraLocal());
    setPagarAlCrear(false);
    setMetodoPago('efectivo');
    setCuentaCobroId('');
    setMontoPago('');
    setCobroNroDoc('');
    setNroRecibo('');
    setCobroOriginalAsientoId(null);
    setCobroMovimientoId(null);
    setExito(null);
    setMensajeWA(null);

    if (esAnticipo) {
      setPagarAlCrear(true);
      setObservaciones('Cobro Anticipado - Saldo a Favor Alumno');
      setLineas([{
        ...lineaVacia(),
        nombre: 'Crédito / Saldo a Favor',
        detalle_personalizado: 'Anticipo para futuras mensualidades/servicios'
      }]);
    }
  }, [visible, alumnoPreseleccionado, cxcEditar, esAnticipo]);

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
        fecha_emision: fechaEmision,
        nro_recibo: nroRecibo || null,
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


      await registrarAudit(ctx, 'editar', cxcEditar.id, {
        cliente: cxcEditar.alumno_nombre,
        descripcion: descripcionAuto,
        monto_total: montoTotal,
        items: lineasValidas.map(l => l.nombre),
      });

      // SI SE CAMBIÓ LA CAJA/BANCO DE UN PAGO EXISTENTE
      if (cobroMovimientoId && cuentaCobroId) {
        // Usamos el RPC especializado para evitar problemas de inmutabilidad y permisos
        await supabase.rpc('rpc_editar_movimiento_financiero', {
            p_payload: {
                movimiento_id: cobroMovimientoId,
                cuenta_id: cuentaCobroId,
                monto: parseFloat(montoPago),
                fecha: fechaEmision,
                descripcion: `Pago Recibo: ${descripcionAuto}`,
                nro_transaccion: cobroNroDoc || null
            }
        });
      }

      setExito('✅ Nota de Servicios actualizada.');
      setGuardando(false);
      setTimeout(() => { onCreada(); onCerrar(); }, 1200);
      return;
    }

    // ==============================
    // MODO CREACIÓN
    // ==============================

    // Buscar cuenta contable de CxC (1.1.3) o Anticipos (2.1.5)
    let codigoCta = esAnticipo ? '2.1.5' : '1.1.3';
    const { data: ctaCxc } = await supabase
      .from('plan_cuentas').select('id').eq('codigo', codigoCta).single();
    if (!ctaCxc) { setError(`No se encontró la cuenta contable ${codigoCta}.`); setGuardando(false); return; }

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
      fecha_emision: fechaEmision,
      nro_recibo: nroRecibo || null,
      estado: 'pendiente',
      es_anticipo: esAnticipo,
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

    // 2.5 Generar asiento CONSOLIDADO de la VENTA (Ingreso y Cobro Simultáneo)
    let montoPagado = 0;
    if (montoTotal > 0) {
      const movimientosVenta: { cuenta_contable_id: string; debe: number; haber: number }[] = [];
      const haberesMap = new Map<string, number>();
      const gastosMap = new Map<string, number>();
      let totalCosto = 0;
      
      const { data: ctaCostoFallback } = await supabase.from('plan_cuentas').select('id').eq('codigo', '5.6.1').or(`escuela_id.eq.${ctx.escuela_id},escuela_id.is.null`).single();
      const { data: ctaInvFallback } = await supabase.from('plan_cuentas').select('id').eq('codigo', '1.1.4').or(`escuela_id.eq.${ctx.escuela_id},escuela_id.is.null`).single();

      // 1. Calcular Ingresos y Costos de Inventario
      lineasValidas.forEach(l => {
          const dbItem = catalogo.find(c => c.id === l.catalogo_item_id);
          // Si es anticipo, el HABER va a Cobros Anticipados (2.1.5)
          const idCtaIngreso = esAnticipo 
            ? (cuentasMaestras.find(c => c.codigo === '2.1.5')?.id || '18148a18-ef57-4f37-b5cd-bf02a858f0be')
            : (dbItem?.cuenta_ingreso_id || l.cuenta_ingreso_id || (cuentasCobro.find(c => c.codigo.startsWith('4.1'))?.id || ctaCxc.id));
          
          haberesMap.set(idCtaIngreso, (haberesMap.get(idCtaIngreso) || 0) + l.subtotal);
          
          if (l.tipo === 'producto' && l.costo_unitario && l.costo_unitario > 0) {
             const costoFila = l.costo_unitario * l.cantidad;
             totalCosto += costoFila;
             // Usa la cuenta definida en el catálogo o la por defecto
             const idCtaGasto = dbItem?.cuenta_gasto_id || ctaCostoFallback?.id;
             if (idCtaGasto) {
                gastosMap.set(idCtaGasto, (gastosMap.get(idCtaGasto) || 0) + costoFila);
             }
          }
      });

      // HABER: Ingresos consolidados
      haberesMap.forEach((monto, idCta) => {
          if (monto > 0) movimientosVenta.push({ cuenta_contable_id: idCta, debe: 0, haber: monto });
      });

      // 2. Caja/Bancos (Pago Inmediato)
      if (pagarAlCrear) {
         montoPagado = parseFloat(montoPago) || 0;
         if (montoPagado > 0 && cuentaCobroId) {
            movimientosVenta.push({ cuenta_contable_id: cuentaCobroId, debe: montoPagado, haber: 0 }); // DEBE a Caja/Bancos
         }
      }

      // 3. DEBE: CxC Alumnos (Saldo Pendiente)
      const saldoPendiente = montoTotal - montoPagado;
      if (saldoPendiente > 0) {
         movimientosVenta.push({ cuenta_contable_id: ctaCxc.id, debe: saldoPendiente, haber: 0 }); // DEBE a CxC
      }

      // 4. DOBLE ASIENTO DE COSTO (Si aplica)
      if (totalCosto > 0 && ctaInvFallback) {
         gastosMap.forEach((montoCosto, idCtaCosto) => {
             if (montoCosto > 0) movimientosVenta.push({ cuenta_contable_id: idCtaCosto, debe: montoCosto, haber: 0 }); // DEBE a Costo
         });
         movimientosVenta.push({ cuenta_contable_id: ctaInvFallback.id, debe: 0, haber: totalCosto }); // HABER a Inventario (1.1.4)
      }

      const payloadVenta: any = {
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        usuario_id: ctx.id,
        descripcion: esAnticipo ? `Cobro Anticipado: ${nombreAlum}` : `Venta: ${descripcionAuto}`,
        metodo_pago: pagarAlCrear ? 
          (cuentasCobro.find(c => c.id === cuentaCobroId)?.codigo.startsWith('1.1.1') ? 'efectivo' : 'transferencia') 
          : 'efectivo', 
        fecha: `${fechaEmision}T${horaPago}:00`,
        movimientos: movimientosVenta,
        // Trazabilidad bidireccional asiento ↔ CxC
        origen_tipo: 'cxc',
        origen_id: nuevaCxc.id,
      };

      // Si hubo pago al crear, enlazar el pago a la CxC en la tabla cobros_aplicados
      if (pagarAlCrear && montoPagado > 0) {
         payloadVenta.cobros = [{
             cuenta_cobrar_id: nuevaCxc.id,
             monto_aplicado: montoPagado
         }];
         if (cobroNroDoc.trim()) {
            payloadVenta.documento_referencia = cobroNroDoc.trim();
         }
      }
      
      const { data: vAsientoId, error: errAsiento } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payloadVenta });
      if (vAsientoId) {
         await supabase.from('cuentas_cobrar').update({ asiento_id: vAsientoId }).eq('id', nuevaCxc.id);
      }
      
      if (errAsiento) {
          setError(`Error generando comprobante contable: ${errAsiento.message}`);
          setGuardando(false);
          return;
      }
      
      // Actualizar estado de CxC manual
      if (pagarAlCrear && montoPagado > 0) {
          const nuevo_estado = montoPagado >= montoTotal ? 'pagada' : 'parcial';
          await supabase.from('cuentas_cobrar').update({ estado: nuevo_estado, updated_at: new Date().toISOString() }).eq('id', nuevaCxc.id);
          
          await registrarAudit(ctx, 'cobro', nuevaCxc.id, {
            cliente: nombreAlum,
            monto: montoPagado,
            metodo_pago: metodoPago,
            nuevo_estado: nuevo_estado,
          });
      }
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
    <div className="cxc-modal-overlay">
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
              <h2 style={{ margin: 0, fontSize: '1.25rem' }}>
                {esAnticipo ? 'Registrar Cobro Anticipado (Saldo a Favor)' : (esEdicion ? 'Editar Nota de Servicio' : 'Nueva Nota de Servicio')}
              </h2>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
                {esAnticipo ? 'Carga saldo a favor del alumno para futuros pagos' : (esEdicion ? 'Modifica los ítems y condiciones de la factura' : 'Genera una nueva cuenta por cobrar para el alumno')}
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
                    disabled={guardando || !!alumnoPreseleccionado || modo === 'ver' || esEdicion}
                    style={{ fontSize: '1rem', padding: '0.8rem' }}
                  >
                    <option value="">— Seleccionar alumno —</option>
                    {alumnos.map(a => (
                      <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>
                    ))}
                  </select>
                </div>

                <div className="form-campo">
                    <label style={{ color: 'var(--primary)', fontWeight: 700 }}><Calendar size={14} /> Fecha de Emisión *</label>
                    <input 
                        type="date" 
                        value={fechaEmision}
                        onChange={e => setFechaEmision(e.target.value)}
                        required
                        disabled={guardando || modo === 'ver'}
                        style={{ borderColor: 'var(--primary)', background: 'rgba(59, 130, 246, 0.05)' }}
                    />
                </div>

                <div className="form-campo">
                  <label><Calendar size={14} /> Fecha de vencimiento (Opcional)</label>
                  <input
                    type="date" value={vencimiento}
                    onChange={e => setVencimiento(e.target.value)}
                    disabled={guardando || modo === 'ver'}
                  />
                </div>

                <div className="form-campo">
                    <label><FileText size={14} /> Referencia / Observación Corta</label>
                    <input 
                        type="text" 
                        placeholder="Ej: Mensualidad Abril..." 
                        value={observaciones}
                        onChange={e => setObservaciones(e.target.value)}
                        disabled={guardando || modo === 'ver'}
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
                              disabled={guardando || modo === 'ver'}
                              style={{ border: 'none', background: 'transparent', padding: '0.5rem 0', fontWeight: 600, fontSize: '1rem', color: 'var(--text-primary)', width: '100%' }}
                            >
                              <option value="" style={{ background: '#1e293b' }}>— Seleccionar ítem —</option>
                              {catalogo.map(c => (
                                <option key={c.id} value={c.id} style={{ background: '#1e293b' }}>{c.nombre}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-campo" style={{ marginBottom: 0 }}>
                            <input
                              type="number" min="1" max="99"
                               value={linea.cantidad}
                              onChange={e => actualizarLinea(idx, { cantidad: parseInt(e.target.value) || 1 })}
                              disabled={guardando || esMensualidad || modo === 'ver'}
                              style={{ 
                                textAlign: 'center', 
                                border: '1px solid var(--border)', 
                                background: 'var(--bg-input)', 
                                borderRadius: '8px',
                                padding: '0.6rem',
                                width: '100%',
                                fontSize: '1.1rem',
                                fontWeight: 600,
                                color: 'var(--text-primary)'
                              }}
                            />
                          </div>

                          <div className="form-campo" style={{ marginBottom: 0 }}>
                            <input
                              type="number" step="0.10" min="0"
                               value={linea.precio_unitario || ''}
                              onChange={e => actualizarLinea(idx, { precio_unitario: parseFloat(e.target.value) || 0 })}
                              disabled={guardando || modo === 'ver'}
                              placeholder="0.00"
                              style={{ 
                                textAlign: 'right', 
                                border: '1px solid var(--border)', 
                                background: 'var(--bg-input)', 
                                borderRadius: '10px', 
                                fontWeight: 700,
                                padding: '0.6rem',
                                width: '100%',
                                fontSize: '1.1rem',
                                color: 'var(--primary)',
                                outline: 'none',
                                transition: 'all 0.2s'
                              }}
                              className="input-precio-unitario"
                            />
                          </div>

                          <div style={{ textAlign: 'right', fontWeight: 800, color: 'var(--text-primary)', fontSize: '1.1rem' }}>
                             {fmtMonto(linea.subtotal)}
                          </div>

                          <button
                             type="button"
                            onClick={() => eliminarLinea(idx)}
                            disabled={guardando || lineas.length <= 1 || modo === 'ver'}
                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', opacity: (guardando || modo === 'ver') ? 0.5 : 1 }}
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
                                          color: activo ? 'var(--bg-card)' : 'var(--text-tertiary)',
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
                                  <AlertCircle size={12} /> {esTorneo ? 'Seleccionar Torneo' : 'Periodo Especifico'}
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
              <div style={{ border: 'none', background: 'transparent', padding: 0 }}>
                <label style={{ 
                  border: '1px solid var(--border)', 
                  padding: '0.75rem 1rem', 
                  borderRadius: '10px', 
                  display: 'inline-flex', 
                  alignItems: 'center', 
                  gap: '0.5rem', 
                  cursor: cobroOriginalAsientoId ? 'default' : 'pointer',
                  opacity: cobroOriginalAsientoId ? 0.8 : 1
                }}>
                  <input
                    type="checkbox"
                    checked={pagarAlCrear}
                    onChange={e => !cobroOriginalAsientoId && setPagarAlCrear(true)} // Siempre true si es anticipo
                    disabled={guardando || !!cobroOriginalAsientoId || esAnticipo}
                  />
                  <CreditCard size={16} />
                  <span style={{ fontWeight: 700 }}>
                    {esAnticipo ? 'Cobro Obligatorio (Anticipo)' : (cobroOriginalAsientoId ? 'Información del Pago Registrado' : '¿Registrar pago inmediato?')}
                  </span>
                </label>

                                {pagarAlCrear && (
                                    <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                         <div className="form-campo">
                                            <label>Monto</label>
                                            <input type="number" step="0.01" value={montoPago} onChange={e => setMontoPago(e.target.value)} disabled={modo === 'ver'} />
                                        </div>
                                        <div className="form-campo">
                                            <label><Hash size={14} /> Nro. Transacción</label>
                                            <input type="text" value={cobroNroDoc} onChange={e => setCobroNroDoc(e.target.value)} placeholder="Ej: 00123..." disabled={modo === 'ver'} />
                                        </div>
                                        <div className="form-campo">
                                            <label><Calendar size={14} /> Hora del Pago</label>
                                            <input type="time" value={horaPago} onChange={e => setHoraPago(e.target.value)} disabled={modo === 'ver'} />
                                        </div>
                                        <div className="form-campo">
                                            <label>Caja o Banco de Ingreso</label>
                                            <select value={cuentaCobroId} onChange={e => setCuentaCobroId(e.target.value)} required disabled={modo === 'ver'}>
                                                <option value="">— Seleccionar Destino —</option>
                                                {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                            </select>
                                        </div>
                                    </div>
                                )}
                            </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                        <span style={{ display: 'block', fontSize: '0.75rem', color: 'var(--text-tertiary)', fontWeight: 800, textTransform: 'uppercase', marginBottom: '0.5rem' }}>Total a Facturar</span>
                        <div style={{ fontSize: '2.5rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>
                            <span style={{ fontSize: '1rem', color: 'var(--text-tertiary)', marginRight: '0.2rem' }}>Bs</span>
                            {fmtMonto(total)}
                        </div>
                    </div>
                </div>

                {error && <div className="form-msg form-msg--error" style={{ marginTop: '1.5rem' }}><AlertCircle size={18} /> {error}</div>}
                
                <div className="cxc-modal-footer" style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
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
