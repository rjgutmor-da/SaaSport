/**
 * DetalleAlumnoCxc.tsx
 * Modal flotante que muestra todas las deudas de un alumno.
 * Permite registrar cobros, editar/anular notas, y enviar mensajes
 * de cobranza o recibo de pago por WhatsApp.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { AlumnoDeuda, CuentaCobrar, CxcDetalle, LineaNota } from '../../types/cxc';
// Componente DetalleAlumnoCxc
import type { CuentaContable } from '../../types/finanzas';
import { AlertCircle, Check, CreditCard, Pencil, Ban, MessageCircle, X, Calendar } from 'lucide-react';
import NotaServicios from './NotaServicios';
import { LEGACY_DATA } from '../../lib/legacyData';

/** Props del componente */
interface DetalleAlumnoProps {
  alumno: AlumnoDeuda | null;
  visible: boolean;
  onCerrar: () => void;
  onActualizar: () => void;
}

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formatea fecha legible */
const fmtFecha = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const DetalleAlumnoCxc: React.FC<DetalleAlumnoProps> = ({
  alumno, visible, onCerrar, onActualizar
}) => {
  const [cxcs, setCxcs] = useState<CuentaCobrar[]>([]);
  const [detalles, setDetalles] = useState<Record<string, CxcDetalle[]>>({});
  const [cargando, setCargando] = useState(false);
  const [expandida, setExpandida] = useState<string | null>(null);
  const [cuentasCobro, setCuentasCobro] = useState<CuentaContable[]>([]);

  // Rol del usuario (para controlar edición/anulación)
  const [userRol, setUserRol] = useState('');

  // Modal de cobro inline
  const [cobroCxcId, setCobroCxcId] = useState<string | null>(null);
  const [cobroMonto, setCobroMonto] = useState('');
  const [cobroMetodo, setCobroMetodo] = useState('efectivo');
  const [cobroCuentaId, setCobroCuentaId] = useState('');
  const [cobroBancoOrigen, setCobroBancoOrigen] = useState('');
  const [cobroHora, setCobroHora] = useState('');
  const [guardandoCobro, setGuardandoCobro] = useState(false);
  const [cobroError, setCobroError] = useState<string | null>(null);
  const [cobroExito, setCobroExito] = useState<string | null>(null);

  // Mensaje WhatsApp de recibo de pago
  const [mensajePagoWA, setMensajePagoWA] = useState<{ texto: string; telefono: string } | null>(null);

  // Modal de edición
  const [cxcParaEditar, setCxcParaEditar] = useState<any>(null);

  // Historial de cobros por CxC
  const [historialCobros, setHistorialCobros] = useState<Record<string, any[]>>({});

  // Datos adicionales solicitados
  const [datosAdicionales, setDatosAdicionales] = useState({
    fechaInicio: '—',
    cantidadMeses: 0,
    totalHistorico: 0,
    fechaNacimiento: ''
  });
  
  // Edición de un cobro específico
  const [cobroEditandoId, setCobroEditandoId] = useState<string | null>(null);
  const [cobroEditCuentaId, setCobroEditCuentaId] = useState('');
  const [cobroEditDoc, setCobroEditDoc] = useState('');
  const [guardandoEdicionCobro, setGuardandoEdicionCobro] = useState(false);
  const [cobroNroDoc, setCobroNroDoc] = useState('');



  // Cargar CxC del alumno
  useEffect(() => {
    if (!visible || !alumno) return;

    const cargar = async () => {
      setCargando(true);

      // Obtener rol y sucursal del usuario
      const { data: { user } } = await supabase.auth.getUser();
      let esAdmin = false;
      let userSucursal = '';
      if (user) {
        const { data: usr } = await supabase.from('usuarios')
          .select('rol, sucursal_id').eq('id', user.id).single();
        setUserRol(usr?.rol || '');
        esAdmin = usr?.rol === 'SuperAdministrador' || usr?.rol === 'Dueño';
        userSucursal = usr?.sucursal_id || '';
      }

      let qCuentas = supabase.from('plan_cuentas').select('*')
        .eq('es_transaccional', true)
        .like('codigo', '1.1.1%');
      
      // Filtrar por sucursal si no es admin global
      if (!esAdmin && userSucursal) {
        qCuentas = qCuentas.or(`sucursal_id.eq.${userSucursal},sucursal_id.is.null`);
      }

      const [resCxc, resCuentas] = await Promise.all([
        supabase.from('v_cuentas_cobrar').select('*')
          .eq('alumno_id', alumno.alumno_id)
          .order('created_at', { ascending: false }),
        qCuentas.order('codigo'),
      ]);

      const dataCxc = (resCxc.data as unknown as CuentaCobrar[]) ?? [];
      setCxcs(dataCxc);
      setCuentasCobro(resCuentas.data ?? []);
      
      // Obtener todos los cobros del alumno para mostrar últimas fechas de pago en la tabla
      if (dataCxc.length > 0) {
        const cxcIds = dataCxc.map(c => c.id);
        const { data: todosCobros } = await supabase
          .from('cobros_aplicados')
          .select('*, asientos_contables(*)')
          .in('cuenta_cobrar_id', cxcIds)
          .order('fecha', { ascending: false });

        const historyMap: Record<string, any[]> = {};
        if (todosCobros) {
          todosCobros.forEach(cobro => {
            if (!historyMap[cobro.cuenta_cobrar_id]) historyMap[cobro.cuenta_cobrar_id] = [];
            historyMap[cobro.cuenta_cobrar_id].push(cobro);
          });
        }
        setHistorialCobros(historyMap);
      }

      setCargando(false);

      // Cargar datos adicionales (Primera mensualidad, cantidad de meses, total ingresos)
      const cargarAdicionales = async () => {
        // Total histórico de ingresos
        const { data: resIngresos } = await supabase
          .from('cobros_aplicados')
          .select('monto_aplicado')
          .in('cuenta_cobrar_id', dataCxc.map(c => c.id));

        const totalHistoricoSaaSport = (resIngresos ?? []).reduce((acc, curr) => acc + Number(curr.monto_aplicado), 0);

        // Obtener datos base del alumno de la DB
        const { data: alumBase } = await supabase.from('alumnos')
          .select('fecha_inicio, created_at, ingresos_iniciales, meses_permanencia_inicial, fecha_nacimiento')
          .eq('id', alumno.alumno_id)
          .single();

        // Buscar en datos Legacy (Manuales pasados por el usuario)
        const nombreCompleto = `${alumno.nombres} ${alumno.apellidos}`.toLowerCase().trim();
        const dataLegacy = LEGACY_DATA[nombreCompleto];

        // Primera mensualidad y cantidad de meses en SaaSport
        const { data: detMensualidades } = await supabase
          .from('cxc_detalle')
          .select(`
            periodo_meses, 
            cuenta_cobrar!inner(fecha_emision),
            catalogo_items!inner(nombre)
          `)
          .in('cuenta_cobrar_id', dataCxc.map(c => c.id))
          .ilike('catalogo_items.nombre', '%mensualidad%');

        let primeraFechaSaaSport: Date | null = null;
        let mesesUnicosSaaSport = new Set<string>();

        (detMensualidades ?? []).forEach((d: any) => {
          const fecha = new Date(d.cuenta_cobrar.fecha_emision);
          if (!primeraFechaSaaSport || fecha < primeraFechaSaaSport) primeraFechaSaaSport = fecha;
          
          if (d.periodo_meses && Array.isArray(d.periodo_meses)) {
            d.periodo_meses.forEach((m: string) => mesesUnicosSaaSport.add(m));
          }
        });

        // Lógica de Prioridad para Fecha de Inicio:
        // 1. Datos Legacy proporcionados por el usuario.
        // 2. Campo fecha_inicio manual en la ficha del alumno.
        // 3. Fecha de creación en AsiSport (created_at).
        // 4. Primera mensualidad registrada en SaaSport.
        let fInicioFinal = '—';
        if (dataLegacy?.fechaInicio) {
          fInicioFinal = fmtFecha(dataLegacy.fechaInicio);
        } else if (alumBase?.fecha_inicio) {
          fInicioFinal = fmtFecha(alumBase.fecha_inicio);
        } else if (alumBase?.created_at) {
          fInicioFinal = fmtFecha(alumBase.created_at);
        } else if (primeraFechaSaaSport) {
          fInicioFinal = fmtFecha((primeraFechaSaaSport as any).toISOString());
        }

        // Lógica para Meses de Actividad:
        // Legacy + lo que tenga en DB (permanencia inicial) + meses únicos en SaaSport
        const mesesLegacy = dataLegacy?.mesesActividad || 0;
        const mesesPermanenciaDB = Number(alumBase?.meses_permanencia_inicial) || 0;
        const mesesSaaSport = mesesUnicosSaaSport.size;

        // Lógica para Total Ingresos:
        // Legacy (si existe, asumo que ya incluye ingresos_iniciales de la DB) + ingresos registrados en SaaSport
        const ingresosLegacy = dataLegacy?.totalIngresos || Number(alumBase?.ingresos_iniciales) || 0;
        
        setDatosAdicionales({
          fechaInicio: fInicioFinal,
          cantidadMeses: mesesLegacy + mesesPermanenciaDB + mesesSaaSport,
          totalHistorico: ingresosLegacy + totalHistoricoSaaSport,
          fechaNacimiento: alumBase?.fecha_nacimiento || alumno.fecha_nacimiento || ''
        });
      };

      cargarAdicionales();
    };
    cargar();

    // Reset estados
    setCobroBancoOrigen('');
    setCobroHora('');
    setCobroNroDoc('');
    setCobroCxcId(null);
    setExpandida(null);
    setMensajePagoWA(null);
    setCxcParaEditar(null);
  }, [visible, alumno]);

  // ¿Puede editar/anular?
  const puedeEditar = (cxc: CuentaCobrar) => {
    // Según requerimiento: Edición de nota en su integridad solo por SuperAdministrador
    if (userRol !== 'SuperAdministrador' && userRol !== 'Dueño') return false;
    // Solo se puede editar una vez (si no ha sido editada antes)
    return !cxc.editado && cxc.estado !== 'pagada' && !cxc.anulada;
  };

  const puedeAnular = () => {
    return userRol === 'SuperAdministrador' || userRol === 'Dueño';
  };

  const puedeReEditar = () => {
    return userRol === 'SuperAdministrador' || userRol === 'Dueño';
  };

  // Cargar detalle y cobros de una CxC específica
  const cargarDetalle = async (cxcId: string) => {
    if (expandida === cxcId) {
      setExpandida(null); // Colapsar
      return;
    }

    const { data: detData } = await supabase
      .from('cxc_detalle')
      .select('*, catalogo_items!inner(nombre, tipo)')
      .eq('cuenta_cobrar_id', cxcId);

    const items = (detData ?? []).map((d: any) => ({
      ...d,
      item_nombre: d.catalogo_items?.nombre,
      item_tipo: d.catalogo_items?.tipo,
    }));

    // Cargar historial de cobros
    const { data: cobrosData } = await supabase
      .from('cobros_aplicados')
      .select('*, asientos_contables(*)')
      .eq('cuenta_cobrar_id', cxcId)
      .order('fecha', { ascending: false });

    setDetalles(prev => ({ ...prev, [cxcId]: items }));
    setHistorialCobros(prev => ({ ...prev, [cxcId]: cobrosData ?? [] }));
    setExpandida(cxcId);
    setCobroEditandoId(null);
  };

  /** Genera descripción de ítems de un CxC para WhatsApp */
  const generarDescItems = (cxcId: string, cxc: CuentaCobrar): string => {
    const dets = detalles[cxcId];
    if (!dets || dets.length === 0) return cxc.descripcion || 'servicios';
    return dets.map(d => {
      if (d.item_nombre?.toLowerCase() === 'mensualidad' && d.periodo_meses && d.periodo_meses.length > 0) {
        const mesesLimpios = d.periodo_meses
          .filter((m: string) => !m.startsWith('custom:'))
          .join(', ');
        const custom = d.periodo_meses
          .filter((m: string) => m.startsWith('custom:'))
          .map((m: string) => m.replace('custom:', ''));
        const desc = [mesesLimpios, ...custom].filter(Boolean).join(', ');
        return `Mensualidad ${desc}`;
      }
      return d.cantidad > 1 ? `${d.item_nombre} x${d.cantidad}` : d.item_nombre;
    }).join(', ');
  };

  // Registrar cobro
  const registrarCobro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cobroCxcId || !alumno) return;
    setCobroError(null); setCobroExito(null); setMensajePagoWA(null);

    const monto = parseFloat(cobroMonto);
    if (!monto || monto <= 0) { setCobroError('Monto inválido.'); return; }
    if (!cobroCuentaId) { setCobroError('Selecciona la caja/banco destino.'); return; }

    setGuardandoCobro(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setCobroError('Error de autenticación.'); setGuardandoCobro(false); return; }
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, sucursal_id, nombres, apellidos')
      .eq('id', user.id).single();
    if (!ctx) { setCobroError('Error de contexto.'); setGuardandoCobro(false); return; }

    // Buscar la CxC para generar descripción
    const cxcActual = cxcs.find(c => c.id === cobroCxcId);

    // Construir comprobante dinámico ("Banco | Hora | Doc")
    const partesRef = [];
    if (cobroBancoOrigen.trim()) partesRef.push(`Banco: ${cobroBancoOrigen.trim()}`);
    if (cobroHora.trim()) partesRef.push(`He: ${cobroHora.trim()}`);
    if (cobroNroDoc.trim()) partesRef.push(`Nro: ${cobroNroDoc.trim()}`);
    const concatDoc = partesRef.join(' | ');

    const { data, error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
      p_payload: {
        cuenta_cobrar_id: cobroCxcId,
        monto,
        metodo_pago: cobroMetodo,
        cuenta_cobro_id: cobroCuentaId,
        escuela_id: ctx.escuela_id,
        sucursal_id: ctx.sucursal_id,
        usuario_id: ctx.id,
        nro_comprobante: concatDoc || null,
      }
    });

    if (rpcErr) { setCobroError(`Error: ${rpcErr.message}`); setGuardandoCobro(false); return; }

    // Registrar auditoría
    await supabase.from('audit_log').insert({
      escuela_id: ctx.escuela_id,
      usuario_id: ctx.id,
      usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
      accion: 'cobro',
      modulo: 'cxc',
      entidad_id: cobroCxcId,
      detalle: { monto, metodo_pago: cobroMetodo, nuevo_estado: data?.nuevo_estado },
    });

    // Generar mensaje WhatsApp de recibo de pago
    const tipoPago = data?.nuevo_estado === 'pagada' ? 'pago total' : 'pago parcial';
    // Cargar detalle si no tenemos
    if (!detalles[cobroCxcId]) {
      const { data: detData } = await supabase
        .from('cxc_detalle')
        .select('*, catalogo_items!inner(nombre, tipo)')
        .eq('cuenta_cobrar_id', cobroCxcId);
      const items = (detData ?? []).map((d: any) => ({
        ...d,
        item_nombre: d.catalogo_items?.nombre,
        item_tipo: d.catalogo_items?.tipo,
      }));
      setDetalles(prev => ({ ...prev, [cobroCxcId]: items }));
    }

    const descItems = cxcActual ? generarDescItems(cobroCxcId, cxcActual) : 'servicios';
    const textoWA = `Gracias por el pago de Bs ${fmtMonto(monto)}, que corresponde al ${tipoPago} de ${descItems}.`;

    // Obtener teléfono
    const esPadre = alumno.whatsapp_preferido === 'padre';
    const telefono = esPadre
      ? (alumno.telefono_padre || alumno.telefono_madre)
      : (alumno.telefono_madre || alumno.telefono_padre);

    if (telefono) {
      const telLimpio = telefono.replace(/\D/g, '');
      const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
      setMensajePagoWA({ texto: textoWA, telefono: telFinal });
    }

    setCobroExito(`✅ Cobro registrado. ${data?.nuevo_estado === 'pagada' ? 'CxC pagada.' : `Saldo: Bs ${fmtMonto(data?.saldo_pendiente || 0)}`}`);
    setGuardandoCobro(false);
    setCobroMonto('');

    // Recargar datos
    setTimeout(() => {
      setCobroCxcId(null);
      setCobroExito(null);
      setCobroNroDoc(''); // resetear
      setCobroBancoOrigen('');
      setCobroHora('');
      onActualizar();
      supabase.from('v_cuentas_cobrar').select('*')
        .eq('alumno_id', alumno.alumno_id)
        .order('created_at', { ascending: false })
        .then(({ data }) => setCxcs((data as unknown as CuentaCobrar[]) ?? []));
    }, 2500);
  };

  // Guardar edición de cobro aplicado
  const guardarEdicionCobro = async (cobro: any) => {
    if (!cobroEditCuentaId) {
      alert('Seleccione una cuenta/caja válida');
      return;
    }
    setGuardandoEdicionCobro(true);
    const { data: { user } } = await supabase.auth.getUser();

    const { error: rpcErr } = await supabase.rpc('rpc_editar_cuenta_cobro', {
      p_payload: {
        cobro_id: cobro.id,
        nueva_cuenta_id: cobroEditCuentaId,
        usuario_id: user?.id,
        nro_comprobante: cobroEditDoc.trim() || null,
      }
    });

    if (rpcErr) {
      alert(`Error al editar cobro: ${rpcErr.message}`);
      setGuardandoEdicionCobro(false);
      return;
    }

    // Refresh history
    const cxcId = cobro.cuenta_cobrar_id;
    const { data: cobrosData } = await supabase
      .from('cobros_aplicados')
      .select('*, asientos_contables(*)')
      .eq('cuenta_cobrar_id', cxcId)
      .order('fecha', { ascending: false });
    setHistorialCobros(prev => ({ ...prev, [cxcId]: cobrosData ?? [] }));
    
    setGuardandoEdicionCobro(false);
    setCobroEditandoId(null);
  };

  // Anular una nota de servicios
  const anularNota = async (cxcId: string) => {
    if (!confirm('¿Estás seguro de anular esta nota de servicios? Esta acción no se puede deshacer.')) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: ctx } = await supabase.from('usuarios')
      .select('id, escuela_id, nombres, apellidos')
      .eq('id', user.id).single();
    if (!ctx) return;

    const { error: err } = await supabase.from('cuentas_cobrar').update({
      anulada: true,
      anulada_por: ctx.id,
      anulada_at: new Date().toISOString(),
      estado: 'pagada', // Se marca como resuelta
      updated_at: new Date().toISOString(),
    }).eq('id', cxcId);

    if (err) { alert(`Error al anular: ${err.message}`); return; }

    // Registrar auditoría
    await supabase.from('audit_log').insert({
      escuela_id: ctx.escuela_id,
      usuario_id: ctx.id,
      usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
      accion: 'anular',
      modulo: 'cxc',
      entidad_id: cxcId,
      detalle: { motivo: 'Anulación manual' },
    });

    onActualizar();
    // Recargar
    const { data } = await supabase.from('v_cuentas_cobrar').select('*')
      .eq('alumno_id', alumno?.alumno_id)
      .order('created_at', { ascending: false });
    setCxcs((data as unknown as CuentaCobrar[]) ?? []);
  };

  // Preparar edición de una CxC
  const prepararEdicion = async (cxc: CuentaCobrar) => {
    // Cargar detalle para pre-llenar
    const { data } = await supabase
      .from('cxc_detalle')
      .select('*, catalogo_items!inner(nombre, tipo)')
      .eq('cuenta_cobrar_id', cxc.id);

    const lineas: LineaNota[] = (data ?? []).map((d: any) => ({
      catalogo_item_id: d.catalogo_item_id,
      nombre: d.catalogo_items?.nombre || '',
      tipo: d.catalogo_items?.tipo || 'servicio',
      cantidad: d.cantidad,
      precio_unitario: Number(d.precio_unitario),
      periodo_meses: d.periodo_meses || [],
      subtotal: d.cantidad * Number(d.precio_unitario),
    }));

    setCxcParaEditar({
      id: cxc.id,
      alumno_id: cxc.alumno_id,
      alumno_nombre: `${cxc.alumno_nombres} ${cxc.alumno_apellidos}`,
      observaciones: cxc.observaciones || '',
      vencimiento: cxc.fecha_vencimiento || '',
      lineas,
    });
  };

  // Enviar WhatsApp cobranza
  const enviarWhatsApp = () => {
    if (!alumno) return;
    const esPadre = alumno.whatsapp_preferido === 'padre';
    const nombre = esPadre
      ? (alumno.nombre_padre || 'Padre/Madre')
      : (alumno.nombre_madre || alumno.nombre_padre || 'Padre/Madre');
    const telefono = esPadre
      ? (alumno.telefono_padre || alumno.telefono_madre)
      : (alumno.telefono_madre || alumno.telefono_padre);

    if (!telefono) {
      alert('No se encontró un número de teléfono registrado para este alumno.');
      return;
    }

    const telLimpio = telefono.replace(/\D/g, '');
    const telFinal = telLimpio.startsWith('591') ? telLimpio : `591${telLimpio}`;
    const mensaje = `Estimado ${nombre}, le recordamos que tiene una deuda de ${fmtMonto(alumno.saldo_pendiente)} bolivianos, por favor le pedimos regularizar el pago lo antes posible, Gracias.`;
    window.open(`https://wa.me/${telFinal}?text=${encodeURIComponent(mensaje)}`, '_blank');
  };

  // Enviar recibo de pago por WhatsApp
  const enviarReciboPagoWA = () => {
    if (mensajePagoWA) {
      window.open(`https://wa.me/${mensajePagoWA.telefono}?text=${encodeURIComponent(mensajePagoWA.texto)}`, '_blank');
      setMensajePagoWA(null);
    }
  };

  if (!visible || !alumno) return null;

  return (
    <>
      <div className="cxc-modal-overlay" onClick={() => { if (!guardandoCobro) onCerrar(); }}>
        <div className="cxc-modal cxc-modal--detalle cxc-modal--wide" onClick={e => e.stopPropagation()}>
          {/* Cabecera */}
          <div className="cxc-modal-header" style={{ borderLeft: '8px solid var(--primary)', paddingLeft: '1.5rem' }}>
            <div className="cxc-modal-header-info" style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', overflow: 'hidden' }}>
              <div className="cxc-alumno-avatar" style={{ width: '56px', height: '56px', fontSize: '1.3rem', borderRadius: '14px', flexShrink: 0 }}>
                {alumno.nombres[0]}{alumno.apellidos[0]}
              </div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ fontSize: '1.2rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {alumno.nombres} {alumno.apellidos}
                </h2>
                <div className="cxc-modal-meta-line">
                  {alumno.sucursal_nombre && <span>📍 {alumno.sucursal_nombre}</span>}
                  {alumno.entrenador_nombre && <span>👨‍🏫 {alumno.entrenador_nombre}</span>}
                  {datosAdicionales.fechaNacimiento && (
                    <span>🏆 Sub {new Date().getFullYear() - parseInt(datosAdicionales.fechaNacimiento.split('-')[0])}</span>
                  )}
                  {alumno.horario_hora && <span>🕐 {alumno.horario_hora}</span>}
                </div>
              </div>
            </div>
            <button onClick={onCerrar} disabled={guardandoCobro}><X size={20} /></button>
          </div>

          {/* Resumen Estadístico Premium - AHORA 4 FICHAS */}
          <div className="detalle-resumen-premium" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div className="resumen-card">
              <span className="resumen-label">Total Deuda</span>
              <span className="resumen-valor color-deuda">
                Bs {fmtMonto(Number(alumno.saldo_pendiente))}
              </span>
              <div className="resumen-footer">
                <AlertCircle size={12} /> {alumno.cxc_pendientes} pendientes
              </div>
            </div>

            <div className="resumen-card">
              <span className="resumen-label">Total Ingresos</span>
              <span className="resumen-valor color-ingreso">
                Bs {fmtMonto(datosAdicionales.totalHistorico)}
              </span>
              <div className="resumen-footer">
                <Check size={12} /> Histórico recaudado
              </div>
            </div>

            <div className="resumen-card">
              <span className="resumen-label">Fecha de Inicio</span>
              <span className="resumen-valor color-meses" style={{ fontSize: '1.25rem' }}>
                {datosAdicionales.fechaInicio}
              </span>
              <div className="resumen-footer">
                <Calendar size={12} /> Inicio actividad
              </div>
            </div>

            <div className="resumen-card">
              <span className="resumen-label">Meses de Actividad</span>
              <span className="resumen-valor color-meses">
                {datosAdicionales.cantidadMeses} <small>Meses</small>
              </span>
              <div className="resumen-footer">
                <Check size={12} /> Financiera
              </div>
            </div>

            {/* WhatsApp cobranza flotante en el resumen */}
            {alumno.saldo_pendiente > 0 && (
              <button className="resumen-btn-wa" onClick={enviarWhatsApp} title="Enviar cobranza por WhatsApp">
                <MessageCircle size={20} />
                <span>Cobrar</span>
              </button>
            )}
          </div>

          {/* Mensaje de recibo de pago (después de cobrar) */}
          {mensajePagoWA && (
            <div className="detalle-wa-recibo">
              <p className="detalle-wa-texto">{mensajePagoWA.texto}</p>
              <div className="detalle-wa-acciones">
                <button className="nota-wa-btn-enviar" onClick={enviarReciboPagoWA}>
                  <MessageCircle size={14} /> Enviar recibo por WhatsApp
                </button>
                <button className="nota-wa-btn-omitir" onClick={() => setMensajePagoWA(null)}>
                  Cerrar
                </button>
              </div>
            </div>
          )}

          {/* Lista de CxC (Formato Tabla / Estado de Cuenta) */}
          <div className="detalle-cxc-lista" style={{ overflowX: 'auto', paddingBottom: '1rem' }}>
            {cargando ? (
              <p className="detalle-cargando">Cargando...</p>
            ) : cxcs.length === 0 ? (
              <p className="detalle-vacio">No tiene estado de cuentas registrado.</p>
            ) : (
                <table style={{width: '100%', borderCollapse: 'collapse', marginTop: '1rem', textAlign: 'left', minWidth: '800px', fontSize: '0.9rem'}}>
                  <thead style={{background: 'var(--card-bg)', color: 'var(--text-muted)'}}>
                    <tr style={{borderBottom: '1px solid var(--border-color)'}}>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Fecha</th>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Detalle</th>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Monto</th>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Fecha Pago</th>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Monto Pago</th>
                      <th style={{padding: '0.75rem', fontWeight: 600}}>Saldo</th>
                      <th style={{padding: '0.75rem', fontWeight: 600, textAlign: 'center'}}>Editar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cxcs.map(cxc => {
                      const isExp = expandida === cxc.id;
                      const isCobro = cobroCxcId === cxc.id;
                      const cobros = historialCobros[cxc.id] || [];
                      
                      const montoPago = cobros.reduce((acc, c) => acc + Number(c.monto_aplicado), 0);
                      const fechaPago = cobros.length > 0 ? fmtFecha(cobros[0].fecha) : '';
                      const opacity = cxc.anulada ? 0.4 : 1;

                      return (
                        <React.Fragment key={cxc.id}>
                          <tr style={{borderBottom: '1px solid var(--border-color)', opacity, cursor: cxc.anulada ? 'default' : 'pointer', background: isExp ? 'var(--input-bg)' : 'transparent'}} onClick={() => !cxc.anulada && cargarDetalle(cxc.id)}>
                            <td style={{padding: '0.75rem', whiteSpace: 'nowrap'}}>{fmtFecha(cxc.fecha_emision)}</td>
                            <td style={{padding: '0.75rem', color: cxc.anulada ? 'var(--danger)' : 'var(--text-color)'}}>
                              {cxc.descripcion || (cxc.anulada ? 'Anulada' : 'Sin Descripción')} 
                              {cxc.anulada && ' (Anulada)'}
                            </td>
                            <td style={{padding: '0.75rem'}}>Bs {fmtMonto(Number(cxc.monto_total))}</td>
                            <td style={{padding: '0.75rem', whiteSpace: 'nowrap'}}>{fechaPago}</td>
                            <td style={{padding: '0.75rem', color: montoPago > 0 ? 'var(--success)' : 'inherit'}}>
                              Bs {fmtMonto(montoPago)}
                            </td>
                            <td style={{padding: '0.75rem', color: Number(cxc.saldo_pendiente) > 0 ? 'var(--warning)' : 'var(--success)', fontWeight: 600}}>
                               Bs {fmtMonto(Number(cxc.saldo_pendiente))}
                            </td>
                            <td style={{padding: '0.6rem 0.75rem', textAlign: 'center', verticalAlign: 'middle'}} onClick={e => e.stopPropagation()}>
                              {cxc.anulada ? (
                                <span className="cxc-estado-badge cxc-estado-badge--anulada">Anulada</span>
                              ) : (
                                <button
                                  className={`cxc-btn-editar-visible ${cxc.estado === 'pagada' ? 'cxc-btn-editar-visible--dim' : ''}`}
                                  onClick={() => prepararEdicion(cxc)}
                                  title={
                                    cxc.estado === 'pagada'
                                      ? 'Esta nota ya está pagada'
                                      : (puedeEditar(cxc) || puedeReEditar())
                                        ? 'Editar nota de servicio'
                                        : 'Sin permisos para editar'
                                  }
                                >
                                  <Pencil size={13} />
                                  Editar
                                </button>
                              )}
                            </td>
                          </tr>

                          {/* Fila colapsable de pago inline */}
                          {isCobro && (
                            <tr>
                              <td colSpan={7} style={{padding: 0, borderBottom: '1px solid var(--border-color)'}}>
                                <div style={{padding: '1rem', background: 'var(--input-bg)'}}>
                                  <form className="detalle-cobro-form" onSubmit={registrarCobro} onClick={e => e.stopPropagation()}>
                                    <div className="detalle-cobro-campos">
                                      <input
                                        type="number" step="0.01" min="0.01"
                                        max={Number(cxc.saldo_pendiente)}
                                        value={cobroMonto}
                                        onChange={e => setCobroMonto(e.target.value)}
                                        placeholder="Monto"
                                        required disabled={guardandoCobro}
                                        className="detalle-cobro-input"
                                      />
                                      <select
                                        value={cobroMetodo}
                                        onChange={e => setCobroMetodo(e.target.value)}
                                        disabled={guardandoCobro}
                                        className="detalle-cobro-select"
                                      >
                                        <option value="efectivo">Efectivo</option>
                                        <option value="transferencia">Transferencia</option>
                                        <option value="qr">QR</option>
                                      </select>
                                      <select
                                        value={cobroCuentaId}
                                        onChange={e => setCobroCuentaId(e.target.value)}
                                        required disabled={guardandoCobro}
                                        className="detalle-cobro-select"
                                      >
                                        <option value="">Caja/Banco</option>
                                        {cuentasCobro.map(c => (
                                          <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                                        ))}
                                      </select>
                                      <div style={{display: 'flex', gap: '0.25rem'}}>
                                        {(cobroMetodo === 'transferencia' || cobroMetodo === 'qr') && (
                                          <>
                                            <input
                                              type="text"
                                              placeholder="Banco Origen"
                                              value={cobroBancoOrigen}
                                              onChange={e => setCobroBancoOrigen(e.target.value)}
                                              disabled={guardandoCobro}
                                              className="detalle-cobro-input"
                                              style={{ flex: 1 }}
                                            />
                                            <input
                                              type="time"
                                              value={cobroHora}
                                              onChange={e => setCobroHora(e.target.value)}
                                              disabled={guardandoCobro}
                                              className="detalle-cobro-input"
                                              style={{ width: '90px' }}
                                            />
                                          </>
                                        )}
                                        <input
                                          type="text"
                                          placeholder="Nro. Comprobante"
                                          value={cobroNroDoc}
                                          onChange={e => setCobroNroDoc(e.target.value)}
                                          disabled={guardandoCobro}
                                          className="detalle-cobro-input"
                                          style={{ flex: 1 }}
                                        />
                                      </div>
                                      <button type="submit" className="detalle-cobro-btn" disabled={guardandoCobro}>
                                        <Check size={14} /> {guardandoCobro ? '...' : 'Registrar'}
                                      </button>
                                    </div>
                                    {cobroError && <div className="form-msg form-msg--error"><AlertCircle size={14} /> {cobroError}</div>}
                                    {cobroExito && <div className="form-msg form-msg--exito"><Check size={14} /> {cobroExito}</div>}
                                  </form>
                                </div>
                              </td>
                            </tr>
                          )}

                          {/* Detalle de items de la CxC y pagos adicionales */}
                          {isExp && !isCobro && detalles[cxc.id] && (
                            <tr>
                              <td colSpan={7} style={{padding: 0, borderBottom: '1px solid var(--border-color)'}}>
                                <div style={{padding: '1rem', background: 'var(--hover-bg)'}}>
                                  {detalles[cxc.id].length > 0 ? (
                                    <table className="detalle-items-tabla" style={{background:'var(--card-bg)'}}>
                                      <thead>
                                        <tr><th>Ítem</th><th>Cant.</th><th>Precio</th><th>Subtotal</th></tr>
                                      </thead>
                                      <tbody>
                                        {detalles[cxc.id].map(d => (
                                          <tr key={d.id}>
                                            <td>
                                              {d.item_nombre}
                                              {d.periodo_meses && d.periodo_meses.length > 0 && (
                                                <small style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                                                  {d.periodo_meses.filter((m: string) => !m.startsWith('custom:')).join(', ')}
                                                  {d.periodo_meses.filter((m: string) => m.startsWith('custom:')).map((m: string) => m.replace('custom:', '')).join(', ')}
                                                </small>
                                              )}
                                            </td>
                                            <td>{d.cantidad}</td>
                                            <td>Bs {fmtMonto(Number(d.precio_unitario))}</td>
                                            <td>Bs {fmtMonto(Number(d.subtotal))}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <p className="detalle-sin-items">Nota sin detalle de ítems.</p>
                                  )}

                                  {/* Historial de Pagos con edición de admin */}
                                  {cobros && cobros.length > 0 && (
                                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                                      <h4 style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Historial de Pagos</h4>
                                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                        {cobros.map(cobro => {
                                          const isEditing = cobroEditandoId === cobro.id;
                                          return (
                                            <div key={cobro.id} style={{ background: 'var(--input-bg)', padding: '0.75rem', borderRadius: '6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                                              {isEditing ? (
                                                <div style={{ display: 'flex', gap: '0.5rem', flex: 1, alignItems: 'center' }}>
                                                  <select
                                                    value={cobroEditCuentaId}
                                                    onChange={e => setCobroEditCuentaId(e.target.value)}
                                                    disabled={guardandoEdicionCobro}
                                                    className="detalle-cobro-select"
                                                    style={{ flex: 1 }}
                                                  >
                                                    <option value="">Caja/Banco</option>
                                                    {cuentasCobro.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                                                  </select>
                                                  <input
                                                    type="text"
                                                    placeholder="Nro. Comprobante"
                                                    value={cobroEditDoc}
                                                    onChange={e => setCobroEditDoc(e.target.value)}
                                                    disabled={guardandoEdicionCobro}
                                                    className="detalle-cobro-input"
                                                    style={{ flex: 1 }}
                                                  />
                                                  <button className="btn-guardar-cuenta" onClick={() => guardarEdicionCobro(cobro)} disabled={guardandoEdicionCobro} style={{ padding: '0.4rem 0.6rem'}}>
                                                    {guardandoEdicionCobro ? '...' : 'Guardar'}
                                                  </button>
                                                  <button onClick={() => setCobroEditandoId(null)} disabled={guardandoEdicionCobro} style={{ background: 'var(--border-color)', color: 'var(--text-color)', padding: '0.4rem 0.6rem', borderRadius: '4px', border: 'none', cursor: 'pointer' }}>
                                                    Cancelar
                                                  </button>
                                                </div>
                                              ) : (
                                                <>
                                                  <div style={{flex: 1}}>
                                                    <strong style={{ display: 'block', fontSize: '0.85rem' }}>Bs {fmtMonto(Number(cobro.monto_aplicado))}</strong>
                                                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                      {fmtFecha(cobro.fecha)} — {cobro.asientos_contables?.metodo_pago}
                                                      {cobro.asientos_contables?.documento_referencia ? ` | ${cobro.asientos_contables.documento_referencia}` : ''}
                                                    </span>
                                                  </div>
                                                  {(userRol === 'SuperAdministrador' || userRol === 'Dueño' || userRol === 'Administrador' || userRol === 'admin') && (
                                                    <button
                                                      onClick={() => {
                                                        setCobroEditandoId(cobro.id);
                                                        setCobroEditDoc(cobro.asientos_contables?.documento_referencia || '');
                                                        setCobroEditCuentaId(''); 
                                                      }}
                                                      style={{ background: 'none', border: 'none', color: 'var(--secondary)', cursor: 'pointer', padding: '0.25rem' }}
                                                      title="Editar forma de pago"
                                                    >
                                                      <Pencil size={14} />
                                                    </button>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}

                                  {cxc.observaciones && (
                                    <p className="detalle-obs" style={{ marginTop: '0.75rem' }}>📝 {cxc.observaciones}</p>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      )
                    })}
                  </tbody>
                </table>
            )}
          </div>
        </div>
      </div>

      {/* Modal de edición de Nota */}
      <NotaServicios
        visible={!!cxcParaEditar}
        onCerrar={() => setCxcParaEditar(null)}
        onCreada={() => {
          onActualizar();
          // Recargar CxC de este alumno
          supabase.from('v_cuentas_cobrar').select('*')
            .eq('alumno_id', alumno.alumno_id)
            .order('created_at', { ascending: false })
            .then(({ data }) => {
              setCxcs((data as unknown as CuentaCobrar[]) ?? []);
              setDetalles({}); // Limpiar cache de detalles
            });
        }}
        cxcEditar={cxcParaEditar}
      />
    </>
  );
};

export default DetalleAlumnoCxc;
