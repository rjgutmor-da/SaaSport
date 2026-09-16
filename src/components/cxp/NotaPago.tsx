/**
 * NotaPago.tsx
 * Modal para crear una Nota de Pago (CxP).
 * Versión simplificada sin campos contables.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import {
  X, Plus, Check, Trash2, AlertCircle, CreditCard, Package,
  Users, FileText, Calendar, RefreshCw, Hash
} from 'lucide-react';
import { getHoyISO, FECHA_MINIMA_MOVIMIENTO_FINANCIERO, validarFechaMovimientoFinanciero } from '../../lib/dateUtils';
import { logActivity } from '../../lib/auditLogger';
import { obtenerSaldosPorSucursal, validarAperturaInventario } from '../../lib/inventario';
import {
  esRespuestaIncierta,
  guardarOperacionIncierta,
  obtenerOperacionIncierta,
  removerOperacionIncierta,
  resolverOperacionIncierta,
  type OperacionIncierta,
} from '../../lib/idempotenciaNotas';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useSucursales } from '../../hooks/useMasterData';

interface LineaNotaPago {
  catalogo_item_id: string;
  nombre: string;
  tipo: string;
  cantidad: number;
  precio_unitario: number;
  subtotal: number;
  descripcion: string;
}

interface Props {
  visible: boolean;
  tipoInicial: 'proveedor' | 'personal';
  esAnticipo?: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  cxpEditar?: any;
  /** ID del proveedor a preseleccionar (viene de la tarjeta de detalle) */
  proveedorIdInicial?: string;
  /** ID del personal a preseleccionar (viene de la tarjeta de detalle) */
  personalIdInicial?: string;
}

const lineaVacia = (): LineaNotaPago => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  subtotal: 0,
  descripcion: '',
});

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esConceptoSueldos = (nombre: string) =>
  nombre.trim().toLocaleLowerCase('es-BO') === 'sueldos y salarios';

const NotaPago: React.FC<Props> = ({ visible, tipoInicial, esAnticipo = false, onCerrar, onCreada, cxpEditar, proveedorIdInicial, personalIdInicial }) => {
  const { perfil, escuelaId } = useAuthSaaSport();
  const { data: sucursales = [] } = useSucursales();
  const [sucursalId, setSucursalId] = useState('');

  const [tipoGasto, setTipoGasto] = useState(tipoInicial);
  const [proveedorId, setProveedorId] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
  const [vencimiento, setVencimiento] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [lineas, setLineas] = useState<LineaNotaPago[]>([lineaVacia()]);

  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [fechaPago, setFechaPago] = useState(getHoyISO());
  const [cuentaPagoId, setCuentaPagoId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [nroComprobante, setNroComprobante] = useState('');
  const [montoAnticipo, setMontoAnticipo] = useState('');
  /** Cuenta/concepto del catálogo a la que se imputa el anticipo */
  const [cuentaAnticipoId, setCuentaAnticipoId] = useState('');

  const [proveedores, setProveedores] = useState<{ id: string; nombre: string }[]>([]);
  const [personal, setPersonal] = useState<{ id: string; nombres: string; apellidos: string; salario_base: number | null }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);

  const [saldosInventario, setSaldosInventario] = useState<Map<string, number>>(new Map());
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [operacionPendiente, setOperacionPendiente] = useState<OperacionIncierta | null>(null);
  const [avisoRecuperacion, setAvisoRecuperacion] = useState<string | null>(null);
  const operacionIdRef = React.useRef<string>(crypto.randomUUID());
  const guardandoRef = React.useRef(false);

  const verificarOperacionPendiente = (tipo: 'proveedor' | 'personal', idEntidad?: string) => {
    const escId = escuelaId || perfil?.escuela_id;
    const usrId = perfil?.id;
    if (!escId || !usrId) return;

    const clave = tipo === 'proveedor' && idEntidad ? `prov_${idEntidad}` : (tipo === 'personal' && idEntidad ? `pers_${idEntidad}` : undefined);
    const op = obtenerOperacionIncierta<any>(
      'cxp_individual',
      escId,
      usrId,
      clave,
      cxpEditar?.id || null,
    );

    if (op) {
      operacionIdRef.current = op.operacionId;
      setOperacionPendiente(op);
      setAvisoRecuperacion(
        `Se detectó un intento anterior pendiente de confirmación (ID: ${op.operacionId.slice(0, 8)}...). Al procesar se verificará primero si ya fue registrada en el servidor o se reintentará con sus datos originales sin duplicar.`
      );
      if (!idEntidad) {
        if (op.payloadOriginal?.rpcParams?.p_proveedor_id) {
          setTipoGasto('proveedor');
          setProveedorId(op.payloadOriginal.rpcParams.p_proveedor_id);
        } else if (op.payloadOriginal?.rpcParams?.p_personal_id) {
          setTipoGasto('personal');
          setPersonalId(op.payloadOriginal.rpcParams.p_personal_id);
        }
      }
    } else {
      setOperacionPendiente(null);
      setAvisoRecuperacion(null);
    }
  };

  const sucursalEfectiva = cxpEditar?.sucursal_id || (perfil?.rol === 'SuperAdministrador' ? (sucursalId || null) : (sucursalId || perfil?.sucursal_id));

  useEffect(() => {
    const escId = escuelaId || perfil?.escuela_id;
    if (visible && escId && sucursalEfectiva) {
      obtenerSaldosPorSucursal(escId, sucursalEfectiva)
        .then(setSaldosInventario)
        .catch(console.error);
    } else if (!sucursalEfectiva) {
      setSaldosInventario(new Map());
    }
  }, [visible, escuelaId, perfil, sucursalEfectiva]);

  useEffect(() => {
    if (!sucursalId && perfil?.rol !== 'SuperAdministrador' && perfil?.sucursal_id) {
      setSucursalId(perfil.sucursal_id);
    }
  }, [perfil, sucursalId]);

  useEffect(() => { 
    if (!cxpEditar) setTipoGasto(tipoInicial); 
  }, [tipoInicial, cxpEditar]);

  useEffect(() => {
    if (!visible) {
      const escId = escuelaId || perfil?.escuela_id;
      const usrId = perfil?.id;
      const clave = tipoGasto === 'proveedor' && proveedorId ? `prov_${proveedorId}` : (tipoGasto === 'personal' && personalId ? `pers_${personalId}` : undefined);
      const opIncierta = (escId && usrId) ? obtenerOperacionIncierta('cxp_individual', escId, usrId, clave, cxpEditar?.id || null) : null;
      if (!opIncierta) {
        operacionIdRef.current = crypto.randomUUID();
        setOperacionPendiente(null);
        setAvisoRecuperacion(null);
      }
      return;
    }
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const [resProv, persProv, resCat, resCajas] = await Promise.all([
        supabase.from('proveedores').select('id, nombre').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombre'),
        supabase.from('personal').select('id, nombres, apellidos, salario_base').eq('escuela_id', usr.escuela_id).eq('activo', true).order('nombres'),
        supabase.from('catalogo_items').select('*').eq('activo', true).or('tipo_movimiento.eq.egreso,tipo_movimiento.eq.ambos').order('nombre'),
        supabase.from('cajas_bancos').select('id, nombre, saldo_actual, es_predeterminada').eq('activo', true).eq('escuela_id', usr.escuela_id).order('orden'),
      ]);

      setProveedores(resProv.data ?? []);
      setPersonal(persProv.data ?? []);
      const catData = resCat.data ?? [];
      setCatalogo(catData);
      const listaCajas = resCajas.data ?? [];
      setCajasBancos(listaCajas);
      // Preseleccionar caja predeterminada
      if (!cuentaPagoId) {
        const pred = (listaCajas as any[]).find((c: any) => c.es_predeterminada);
        if (pred) setCuentaPagoId(pred.id);
        else if (listaCajas.length > 0) setCuentaPagoId(listaCajas[0].id);
      }

      if (cxpEditar) {
        setTipoGasto(cxpEditar.tipo_gasto || 'proveedor');
        setSucursalId(cxpEditar.sucursal_id || perfil?.sucursal_id || '');
        setProveedorId(cxpEditar.proveedor_id || '');
        setPersonalId(cxpEditar.personal_id || '');
        setFechaEmision(cxpEditar.fecha_emision ? cxpEditar.fecha_emision.split('T')[0] : getHoyISO());
        setVencimiento(cxpEditar.fecha_vencimiento ? cxpEditar.fecha_vencimiento.split('T')[0] : '');
        setObservaciones(cxpEditar.observaciones || '');
        setPeriodo(cxpEditar.periodo || '');
        
        const { data: detItems } = await supabase.from('cxp_detalle').select('*').eq('cuenta_pagar_id', cxpEditar.id);
        if (detItems && detItems.length > 0) {
          setLineas(detItems.map(d => {
            const it = (catData || []).find(c => c.id === d.catalogo_item_id);
            return {
              catalogo_item_id: d.catalogo_item_id || '',
              nombre: it?.nombre || d.descripcion || '',
              tipo: it?.categoria === 'producto' ? 'producto' : 'servicio',
              cantidad: d.cantidad || 1,
              precio_unitario: Number(d.precio_unitario),
              subtotal: (d.cantidad || 1) * Number(d.precio_unitario),
              descripcion: d.descripcion || ''
            };
          }));
        } else {
          setLineas([lineaVacia()]);
        }
      } else {
        // Precargar proveedor/personal si viene de la tarjeta de detalle
        setProveedorId(proveedorIdInicial || '');
        setPersonalId(personalIdInicial || '');
        setSucursalId(perfil?.rol === 'SuperAdministrador' ? '' : (perfil?.sucursal_id || ''));
        setFechaEmision(getHoyISO()); setVencimiento(getHoyISO()); setObservaciones(''); setPeriodo('');
        setLineas([lineaVacia()]); setPagarAlCrear(esAnticipo);
        setFechaPago(getHoyISO()); setMontoPago(''); setNroComprobante('');
        setCuentaAnticipoId('');

        verificarOperacionPendiente(tipoGasto, proveedorIdInicial || personalIdInicial);
      }
      if (cxpEditar) {
        verificarOperacionPendiente(cxpEditar.tipo_gasto || 'proveedor', cxpEditar.proveedor_id || cxpEditar.personal_id);
      }
      setError(null); setExito(null);
    };
    cargar();
  }, [visible, esAnticipo, cxpEditar]);

  const total = useMemo(() => {
    if (esAnticipo) return parseFloat(montoAnticipo) || 0;
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas, esAnticipo, montoAnticipo]);

  const esNotaSueldo = !esAnticipo && lineas.some(linea => esConceptoSueldos(linea.nombre));

  const actualizarMontoSueldo = (idPersonal: string, lineasActuales = lineas) => {
    const persona = personal.find(p => p.id === idPersonal);
    if (!persona) return;
    const nuevas = lineasActuales.map(linea => {
      if (!esConceptoSueldos(linea.nombre)) return linea;
      const monto = Number(persona.salario_base) || 0;
      return { ...linea, cantidad: 1, precio_unitario: monto, subtotal: monto };
    });
    setLineas(nuevas);
  };

  useEffect(() => {
    if (esAnticipo) {
      setMontoPago(String(total));
      setPagarAlCrear(true);
    } else if (pagarAlCrear && !montoPago) {
      setMontoPago(String(total));
    }
  }, [pagarAlCrear, total, esAnticipo]);

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null);

    let lineasValidas: LineaNotaPago[] = [];
    if (esAnticipo) {
      if (!montoAnticipo || parseFloat(montoAnticipo) <= 0) { setError('Ingresa un monto válido.'); return; }
      if (!cuentaPagoId) { setError('Selecciona la caja de salida.'); return; }
    } else {
      lineasValidas = lineas.filter(l => l.catalogo_item_id && l.precio_unitario >= 0 && l.cantidad > 0);
      if (lineasValidas.length === 0) { setError('Agrega al menos un ítem válido.'); return; }
      const lineaSueldo = lineasValidas.find(l => esConceptoSueldos(l.nombre));
      if (lineaSueldo) {
        if (tipoGasto !== 'personal' || !personalId) { setError('Selecciona al personal para registrar Sueldos y Salarios.'); return; }
        if (!/^\d{4}-\d{2}$/.test(periodo)) { setError('Selecciona el mes completo del sueldo.'); return; }
        if (lineasValidas.length !== 1 || lineaSueldo.precio_unitario <= 0) { setError('La nota de Sueldos y Salarios debe tener un único concepto con monto mayor a cero.'); return; }
      }
      if (pagarAlCrear && (!montoPago || !cuentaPagoId)) { setError('Completa los datos del pago.'); return; }
    }

    if (pagarAlCrear) {
      const errorFechaPago = validarFechaMovimientoFinanciero(fechaPago);
      if (errorFechaPago) { setError(errorFechaPago); return; }
    }

    if (pagarAlCrear && fechaPago < fechaEmision) {
      setError('La fecha de pago no puede ser anterior a la fecha de emisión de la Nota de Servicio.');
      return;
    }

    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      if (!ctx) throw new Error('No se encontró el perfil de la sesión.');
      const esSuperAdmin = ctx.rol === 'SuperAdministrador';
      const targetSucursalId = cxpEditar?.sucursal_id || (esSuperAdmin ? (sucursalId || null) : (sucursalId || ctx.sucursal_id));

      const tieneProductos = lineasValidas.some(l => {
        const it = catalogo.find(c => c.id === l.catalogo_item_id);
        return it?.categoria === 'producto';
      });

      if (tieneProductos && (!targetSucursalId || !String(targetSucursalId).trim())) {
        if (esSuperAdmin) {
          setError('Debes seleccionar una sucursal para los productos incluidos en la nota de compra.');
        } else {
          setError('Tu usuario no tiene una sucursal asignada para registrar compras de productos.');
        }
        return;
      }

      if (!esAnticipo && !cxpEditar) {
        await validarAperturaInventario(
          ctx.escuela_id,
          targetSucursalId,
          lineasValidas.map(l => l.catalogo_item_id),
        );
      }

      // 1. Guardar o Actualizar Nota de forma atómica
      let notaId = cxpEditar?.id;
      const descripcionFinal = esAnticipo ? 'Anticipo' : lineasValidas.map(l => l.nombre).join(', ');
      const itemAnticipo = esAnticipo ? (cuentaAnticipoId || catalogo[0]?.id) : null;
      const lineasPayload = esAnticipo
        ? [{
            catalogo_item_id: itemAnticipo,
            cantidad: 1,
            precio_unitario: total,
            descripcion: 'Anticipo',
          }]
        : lineasValidas.map(l => ({
            catalogo_item_id: l.catalogo_item_id,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            descripcion: l.descripcion || null,
          }));

      const operacionId = operacionIdRef.current;
      const escId = ctx.escuela_id;
      const usrId = ctx.id;
      const claveEntidad = tipoGasto === 'proveedor' && proveedorId ? `prov_${proveedorId}` : (tipoGasto === 'personal' && personalId ? `pers_${personalId}` : 'general');

      // 1. Si existe una operación previa pendiente para este beneficiario/usuario, resolverla estrictamente:
      if (operacionPendiente) {
        setAvisoRecuperacion('Consultando al servidor si la operación previa pendiente ya fue registrada...');
        const verif = await resolverOperacionIncierta('cxp_individual', escId, operacionPendiente.operacionId);

        if (verif.estado === 'error_consulta') {
          // Un fallo al consultar no demuestra que la nota no exista: conserva el pendiente
          setError(`No fue posible comprobar si la nota pendiente ya fue procesada por el servidor (${verif.mensaje}). Se conserva el intento anterior para no duplicar registros ni compras. Por favor, reintenta en unos momentos.`);
          return;
        }

        if (verif.estado === 'guardada' && verif.notaId) {
          // Si existe, recupera esa nota sin llamar a la RPC
          // No confundas la recuperación de una nota con la confirmación de su cobro o pago.
          setOperacionPendiente(null);
          setAvisoRecuperacion(null);
          operacionIdRef.current = crypto.randomUUID();
          setExito(`✅ Se recuperó la nota de pago previamente guardada en el servidor (ID: ${verif.notaId}). La nota ya existe y no se duplicó.`);
          onCreada();
          setTimeout(() => { onCerrar(); }, 1600);
          return;
        }

        // Si verif.estado === 'no_guardada':
        // Corresponde reintentar enviando EXACTAMENTE el payloadOriginal sin sobreescribirlo ni generar otro UUID por cambios del formulario.
        setAvisoRecuperacion(`Reintentando el envío de la operación original (ID: ${operacionPendiente.operacionId.slice(0, 8)}...)...`);
        const rpcPayload = operacionPendiente.payloadOriginal.rpcParams;

        const { data: notaIdResp, error: errRpcGuardar } = await supabase.rpc('rpc_guardar_nota_cxp', rpcPayload);
        if (errRpcGuardar) throw errRpcGuardar;

        const notaId = notaIdResp as string;
        removerOperacionIncierta(operacionPendiente.operacionId);
        setOperacionPendiente(null);
        setAvisoRecuperacion(null);
        operacionIdRef.current = crypto.randomUUID();

        // Pago si correspondía según el payload original
        const pagoOriginal = operacionPendiente.payloadOriginal.pago;
        let pagoExitoso = true;
        let errorPagoMsg: string | null = null;

        if (pagoOriginal && pagoOriginal.monto > 0 && pagoOriginal.cuentaPagoId) {
          try {
            const { error: errPago } = await supabase.rpc('rpc_registrar_pago_cxp', {
              p_payload: {
                escuela_id: escId,
                sucursal_id: rpcPayload.p_sucursal_id,
                usuario_id: usrId,
                cuenta_pagar_id: notaId,
                monto: pagoOriginal.monto,
                cuenta_pago_id: pagoOriginal.cuentaPagoId,
                fecha: pagoOriginal.fechaPago,
                nro_comprobante: pagoOriginal.nroComprobante || null,
                metodo_pago: 'efectivo',
                descripcion: rpcPayload.p_es_anticipo ? `Anticipo: ${rpcPayload.p_observaciones || 'Sin observaciones'}` : undefined
              }
            });
            if (errPago) {
              pagoExitoso = false;
              errorPagoMsg = errPago.message;
              console.error('Error al registrar pago tras reintento de nota CxP:', errPago);
            }
          } catch (e: any) {
            pagoExitoso = false;
            errorPagoMsg = e?.message || 'Error inesperado de conexión al registrar pago';
            console.error('Excepción al registrar pago tras reintento de nota CxP:', e);
          }
        }

        if (pagoOriginal && pagoOriginal.monto > 0 && !pagoExitoso) {
          setError(`⚠️ La nota de pago fue guardada y conservada correctamente (ID: ${notaId}), pero el movimiento financiero no pudo confirmarse: ${errorPagoMsg}. Puedes registrar el pago manualmente desde la lista.`);
          onCreada();
          return;
        }

        setExito(pagoOriginal && pagoOriginal.monto > 0
          ? '✅ Nota guardada y pago confirmado correctamente tras el reintento de la operación original.'
          : '✅ Nota guardada correctamente tras el reintento de la operación original.');
        onCreada();
        setTimeout(() => { onCerrar(); }, 1400);
        return;
      }

      // 2. Si NO existe operación pendiente previa, es una operación nueva:
      const rpcParams = {
        p_nota_id: cxpEditar?.id || null,
        p_proveedor_id: tipoGasto === 'proveedor' ? proveedorId : null,
        p_personal_id: tipoGasto === 'personal' ? personalId : null,
        p_sucursal_id: targetSucursalId,
        p_monto_total: total,
        p_descripcion: descripcionFinal,
        p_observaciones: observaciones || null,
        p_fecha_emision: fechaEmision,
        p_fecha_vencimiento: vencimiento || null,
        p_es_anticipo: esAnticipo,
        p_lineas: lineasPayload,
        p_nro_factura: nroComprobante || null,
        p_tipo_gasto: tipoGasto,
        p_periodo: esNotaSueldo ? periodo : null,
        p_operacion_id: operacionId,
      };

      const mp = esAnticipo ? parseFloat(montoAnticipo) : parseFloat(montoPago);
      const payloadOriginal = {
        rpcParams,
        pago: (!cxpEditar && (pagarAlCrear || esAnticipo)) ? {
          monto: mp,
          cuentaPagoId,
          fechaPago,
          nroComprobante,
        } : null,
        resumen: {
          tipoGasto,
          proveedorId,
          personalId,
          total,
          descripcionFinal,
        }
      };

      guardarOperacionIncierta({
        operacionId,
        tipo: 'cxp_individual',
        escuelaId: escId,
        usuarioId: usrId,
        claveEntidad,
        documentoId: cxpEditar?.id || null,
        payloadOriginal,
        timestamp: Date.now(),
        estado: 'incierto'
      });

      const { data: notaIdResp, error: errRpcGuardar } = await supabase.rpc('rpc_guardar_nota_cxp', rpcParams);

      if (errRpcGuardar) throw errRpcGuardar;
      notaId = notaIdResp as string;
      removerOperacionIncierta(operacionId);

      // 3. Pago (solo si es nuevo, la edición de pagos va por otro lado)
      let pagoExitoso = true;
      let errorPagoMsg: string | null = null;

      if (!cxpEditar && (pagarAlCrear || esAnticipo)) {
        if (mp > 0 && cuentaPagoId) {
          try {
            const { error: errRpc } = await supabase.rpc('rpc_registrar_pago_cxp', {
              p_payload: {
                escuela_id: ctx.escuela_id,
                sucursal_id: targetSucursalId,
                usuario_id: ctx.id,
                cuenta_pagar_id: notaId,
                monto: mp,
                cuenta_pago_id: cuentaPagoId,
                fecha: fechaPago,
                nro_comprobante: nroComprobante || null,
                metodo_pago: 'efectivo',
                descripcion: esAnticipo ? `Anticipo: ${observaciones || 'Sin observaciones'}` : undefined
              }
            });
            
            if (errRpc) {
              pagoExitoso = false;
              errorPagoMsg = errRpc.message;
            }
          } catch (e: any) {
            pagoExitoso = false;
            errorPagoMsg = e?.message || 'Error inesperado al registrar pago';
          }
        }
      }

      if (!cxpEditar && (pagarAlCrear || esAnticipo) && mp > 0 && !pagoExitoso) {
        removerOperacionIncierta(operacionId);
        operacionIdRef.current = crypto.randomUUID();
        setError(`⚠️ La nota de pago fue guardada y conservada correctamente (ID: ${notaId}), pero el movimiento financiero no pudo confirmarse: ${errorPagoMsg}. Puedes registrar el pago manualmente desde la lista.`);
        onCreada();
        return;
      }

      setExito('✅ Registrado correctamente.');

      // 4. Auditoría
      try {
        const beneficiario = tipoGasto === 'proveedor' 
          ? proveedores.find(p => p.id === proveedorId)?.nombre 
          : personal.find(p => p.id === personalId)?.nombres;
          
        logActivity({
          escuela_id: ctx.escuela_id,
          usuario_id: ctx.id,
          usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
          accion: esAnticipo ? 'anticipo' : (cxpEditar ? 'edición nota' : 'nueva nota'),
          modulo: 'cxp',
          entidad_id: notaId,
          detalle: {
            proveedor: beneficiario,
            monto: total,
            descripcion: esAnticipo ? `Anticipo de Bs ${total}` : `Nota de CxP por Bs ${total} (${descripcionFinal})`
          }
        });

        if (!cxpEditar && (pagarAlCrear || esAnticipo)) {
          logActivity({
            escuela_id: ctx.escuela_id,
            usuario_id: ctx.id,
            usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
            accion: 'pago',
            modulo: 'cxp',
            entidad_id: notaId,
            detalle: {
              proveedor: beneficiario,
              monto: esAnticipo ? parseFloat(montoAnticipo) : parseFloat(montoPago),
              descripcion: `Pago de Bs ${esAnticipo ? montoAnticipo : montoPago} para ${beneficiario}.`
            }
          });
        }
      } catch (e) { console.error('Audit Error:', e); }

      removerOperacionIncierta(operacionId);
      operacionIdRef.current = crypto.randomUUID();
      setTimeout(() => { onCreada(); onCerrar(); }, 1200);
    } catch (err: any) {
      if (esRespuestaIncierta(err)) {
        const escId = perfil?.escuela_id;
        const usrId = perfil?.id;
        if (escId && usrId) {
          const clave = tipoGasto === 'proveedor' && proveedorId ? `prov_${proveedorId}` : (tipoGasto === 'personal' && personalId ? `pers_${personalId}` : undefined);
          const op = obtenerOperacionIncierta('cxp_individual', escId, usrId, clave, cxpEditar?.id || null);
          if (op) {
            setOperacionPendiente(op);
            setAvisoRecuperacion(
              `Respuesta no confirmada del servidor. Se conservó la operación original (ID: ${op.operacionId.slice(0, 8)}...) para verificar antes de volver a intentar.`
            );
          }
        }
        setError('Respuesta no confirmada del servidor. Se conservó el identificador de la operación para verificar si fue guardada antes de reintentar.');
      } else {
        removerOperacionIncierta(operacionIdRef.current);
        operacionIdRef.current = crypto.randomUUID();
        setOperacionPendiente(null);
        setAvisoRecuperacion(null);
        if (err?.code === '23505' && esNotaSueldo) {
          setError('Ya existe una nota activa de Sueldos y Salarios para esta persona y mes. Edita o anula la nota existente.');
        } else {
          setError(`Error: ${err.message}`);
        }
      }
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2><Package size={20} style={{ marginRight: '0.5rem' }} /> {esAnticipo ? 'Registrar Anticipo' : 'Nueva Nota de Deuda'}</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <form onSubmit={guardarNota}>
            {avisoRecuperacion && (
              <div style={{
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: '8px',
                padding: '0.75rem 1rem',
                marginBottom: '1.25rem',
                fontSize: '0.82rem',
                color: '#fbbf24',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}>
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{avisoRecuperacion}</span>
              </div>
            )}
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
              {perfil?.rol === 'SuperAdministrador' && (
                <div className="form-campo full-width">
                  <label>Sucursal {!cxpEditar && '*'}</label>
                  {cxpEditar ? (
                    <input
                      type="text"
                      value={(sucursales as any[]).find((s: any) => s.id === sucursalId)?.nombre || 'Sucursal de la compra'}
                      disabled
                      style={{ opacity: 0.7, cursor: 'not-allowed' }}
                    />
                  ) : (
                    <select
                      value={sucursalId}
                      onChange={e => setSucursalId(e.target.value)}
                      disabled={guardando}
                      required
                    >
                      <option value="">— Seleccionar Sucursal —</option>
                      {(sucursales as any[]).map((s: any) => (
                        <option key={s.id} value={s.id}>{s.nombre}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className="form-campo full-width">
                <label>Tipo de Beneficiario</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button type="button" onClick={() => { setTipoGasto('proveedor'); verificarOperacionPendiente('proveedor', proveedorId); }} className={`nota-mes-btn ${tipoGasto === 'proveedor' ? 'nota-mes-btn--activo' : ''}`} style={{ flex: 1 }} disabled={!!(proveedorIdInicial || personalIdInicial)}>🏭 Proveedor</button>
                  <button type="button" onClick={() => { setTipoGasto('personal'); verificarOperacionPendiente('personal', personalId); }} className={`nota-mes-btn ${tipoGasto === 'personal' ? 'nota-mes-btn--activo' : ''}`} style={{ flex: 1 }} disabled={!!(proveedorIdInicial || personalIdInicial)}>👤 Personal</button>
                </div>
              </div>
              <div className="form-campo full-width">
                <label>{tipoGasto === 'proveedor' ? 'Proveedor' : 'Personal'} *</label>
                {tipoGasto === 'proveedor' ? (
                  <select value={proveedorId} onChange={e => { setProveedorId(e.target.value); verificarOperacionPendiente('proveedor', e.target.value); }} required disabled={!!proveedorIdInicial}>
                    <option value="">— Seleccionar —</option>
                    {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                  </select>
                ) : (
                  <select value={personalId} onChange={e => { setPersonalId(e.target.value); if (esNotaSueldo) actualizarMontoSueldo(e.target.value); verificarOperacionPendiente('personal', e.target.value); }} required disabled={!!personalIdInicial}>
                    <option value="">— Seleccionar —</option>
                    {personal.map(p => <option key={p.id} value={p.id}>{p.nombres} {p.apellidos}</option>)}
                  </select>
                )}
              </div>
              {esNotaSueldo && (
                <div className="form-campo full-width">
                  <label>Mes del sueldo *</label>
                  <input type="month" value={periodo} onChange={e => setPeriodo(e.target.value)} required />
                  <small style={{ color: 'var(--text-tertiary)' }}>Se registrará el ciclo completo del mes seleccionado.</small>
                </div>
              )}
              <div className="form-campo">
                <label>Fecha Emisión</label>
                <input type="date" value={fechaEmision} onChange={e => setFechaEmision(e.target.value)} required />
              </div>
              {!esAnticipo && (
                <div className="form-campo">
                  <label>Vencimiento</label>
                  <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
                </div>
              )}

              {/* Cuenta / Concepto — visible solo para anticipos */}
              {esAnticipo && (
                <div className="form-campo full-width">
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    📂 Cuenta / Concepto <span style={{ color: '#a855f7', fontSize: '0.75rem' }}>(a qué cuenta se aplica este anticipo)</span>
                  </label>
                  <select
                    value={cuentaAnticipoId}
                    onChange={e => setCuentaAnticipoId(e.target.value)}
                    disabled={guardando}
                    style={{ borderColor: cuentaAnticipoId ? '#a855f7' : undefined }}
                  >
                    <option value="">— Seleccionar cuenta —</option>
                    {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </div>
              )}

            </div>

            {!esAnticipo ? (
              <div style={{ marginBottom: '1.5rem' }}>
                <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem' }}>ÍTÉMS / GASTOS</p>
                {lineas.map((linea, idx) => (
                  <div key={idx} style={{ marginBottom: '0.75rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                      <select value={linea.catalogo_item_id} onChange={e => {
                        const it = catalogo.find(c => c.id === e.target.value);
                        if (it) {
                          const nuevas = [...lineas];
                          const esSueldo = esConceptoSueldos(it.nombre);
                          const sueldoBase = Number(personal.find(p => p.id === personalId)?.salario_base) || 0;
                          const costoUnitario = esSueldo ? sueldoBase : (Number(it.costo_unitario) || 0);
                          const tipoItem = it.categoria === 'producto' ? 'producto' : 'servicio';
                          nuevas[idx] = { ...nuevas[idx], catalogo_item_id: it.id, nombre: it.nombre, tipo: tipoItem, cantidad: esSueldo ? 1 : nuevas[idx].cantidad, precio_unitario: costoUnitario, subtotal: costoUnitario * (esSueldo ? 1 : nuevas[idx].cantidad) };
                          setLineas(nuevas);
                          if (esSueldo) {
                            setTipoGasto('personal');
                            setProveedorId('');
                          } else if (lineas.some(l => esConceptoSueldos(l.nombre))) {
                            setPeriodo('');
                          }
                        }
                      }} required disabled={guardando}>
                        <option value="">— Seleccionar Ítem —</option>
                        {catalogo.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.nombre}{c.categoria === 'producto' ? ` (Stock: ${saldosInventario.get(c.id) ?? 0})` : ''}
                          </option>
                        ))}
                      </select>
                      <input type="number" value={linea.cantidad} onChange={e => {
                        const cant = parseInt(e.target.value) || 1;
                        const nuevas = [...lineas];
                        nuevas[idx] = { ...nuevas[idx], cantidad: cant, subtotal: cant * nuevas[idx].precio_unitario };
                        setLineas(nuevas);
                      }} min="1" disabled={guardando || esConceptoSueldos(linea.nombre)} title="Cantidad" />
                      <input type="number" step="0.01" value={linea.precio_unitario} onChange={e => {
                        const prec = parseFloat(e.target.value) || 0;
                        const nuevas = [...lineas];
                        nuevas[idx] = { ...nuevas[idx], precio_unitario: prec, subtotal: prec * nuevas[idx].cantidad };
                        setLineas(nuevas);
                      }} disabled={guardando} title="Costo Unitario" />
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>Bs {fmtMonto(linea.subtotal)}</div>
                      <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1 || esConceptoSueldos(linea.nombre)} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                    </div>
                    {catalogo.find(c => c.id === linea.catalogo_item_id)?.categoria === 'producto' && linea.catalogo_item_id && (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: (saldosInventario.get(linea.catalogo_item_id) ?? 0) <= 0 ? '#f59e0b' : '#34d399' }}>
                        📦 Existencias actuales en sucursal: <strong>{saldosInventario.get(linea.catalogo_item_id) ?? 0} unid.</strong>
                      </div>
                    )}
                  </div>
                ))}
                {!esNotaSueldo && <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Agregar ítem</button>}
              </div>
            ) : null}

            {/* Observaciones generales */}
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                📝 Observaciones Generales
              </label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Notas internas, aclaraciones, condiciones de pago..."
                rows={2}
                style={{
                  width: '100%', padding: '0.6rem 0.75rem', fontSize: '0.85rem',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: '8px', color: 'inherit', resize: 'vertical', minHeight: '50px'
                }}
                disabled={guardando}
              />
            </div>

            <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: '1rem' }}>
                <input type="checkbox" checked={pagarAlCrear} onChange={e => setPagarAlCrear(e.target.checked)} disabled={esAnticipo} />
                <span style={{ fontWeight: 700 }}>{esAnticipo ? 'Registro de Salida de Dinero' : '¿Registrar pago ahora?'}</span>
              </label>

              {pagarAlCrear && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
                  <div className="form-campo">
                    <label>Fecha Pago</label>
                    <input type="date" value={fechaPago} min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO} onChange={e => setFechaPago(e.target.value)} required />
                  </div>
                  <div className="form-campo">
                    <label>Monto</label>
                    <input 
                      type="number" step="0.01" 
                      value={esAnticipo ? montoAnticipo : montoPago} 
                      onChange={e => esAnticipo ? setMontoAnticipo(e.target.value) : setMontoPago(e.target.value)} 
                      required 
                    />
                  </div>
                  <div className="form-campo">
                    <label>Caja/Banco de Salida</label>
                    <select value={cuentaPagoId} onChange={e => setCuentaPagoId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-campo full-width">
                    <label>Nro. Documento / Comprobante</label>
                    <input 
                      type="text" 
                      value={nroComprobante} 
                      onChange={e => setNroComprobante(e.target.value)} 
                      placeholder="Ej: Transf-123, Recibo-456..." 
                    />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Total: Bs {fmtMonto(total)}</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem', background: '#f59e0b', borderColor: '#f59e0b' }}>{guardando ? '...' : 'Confirmar'}</button>
              </div>
            </div>
            {error && <p style={{ color: '#f87171', marginTop: '1rem' }}>{error}</p>}
            {exito && <p style={{ color: '#4ade80', marginTop: '1rem' }}>{exito}</p>}
          </form>
        </div>
      </div>
    </div>
  );
};

export default NotaPago;
