import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  RefreshCw, Landmark, ArrowDownRight, ArrowUpRight, Search,
  CheckCircle2, ArrowRightLeft, Square, Pencil, Trash2,
  Star, GripVertical, MessageCircle, ShieldCheck, ShieldOff, LockKeyhole,
  AlertTriangle, Calendar, Copy, Check
} from 'lucide-react';
import { toBlob } from 'html-to-image';
import type { CajaBanco } from '../../types/finanzas';
import ModalTransferencia from '../../components/cajas-bancos/ModalTransferencia';
import ModalMovimientoDirecto from '../../components/cajas-bancos/ModalMovimientoDirecto';
import ModalEditarMovimiento from '../../components/cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../../components/cajas-bancos/ModalDetalleMovimiento';
import ModalNuevaCaja from '../../components/cajas-bancos/ModalNuevaCaja';
import ModalCobroRapido from '../../components/cxc/ModalCobroRapido';
import ModalPagoRapidoCxP from '../../components/cxp/ModalPagoRapidoCxP';
import NotaServicios from '../../components/cxc/NotaServicios';
import DropdownAcciones from '../../components/cajas-bancos/DropdownAcciones';
import { formatFecha, formatCicloCompleto } from '../../lib/dateUtils';
import { logActivity } from '../../lib/auditLogger';
import { can } from '../../config/roles';

import { useAuthSaaSport } from '../../lib/authHelper';
import { useCajasBancos, useMovimientos, useCxpEntidades, type MovimientoFinanciero, type RangoFecha } from '../../hooks/useFinanzas';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '../../hooks/useIsMobile';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Los movimientos directos no tienen alumno/proveedor. La API puede devolver
// un guion como valor de relleno; en pantalla debe tratarse como vacío.
const obtenerCliente = (cliente?: string | null) => {
  const valor = cliente?.trim() || '';
  return /^[—_-]+$/.test(valor) ? '' : valor;
};

const obtenerRangoFechas = (
  tipo: 'ultimos' | 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango',
  desdeStr?: string,
  hastaStr?: string
): RangoFecha | null => {
  if (tipo === 'ultimos') return null;

  const nowBolivia = new Date(Date.now() - 4 * 60 * 60 * 1000);
  const y = nowBolivia.getUTCFullYear();
  const m = nowBolivia.getUTCMonth();
  const d = nowBolivia.getUTCDate();

  let desdeBolivia = 0;
  let hastaBolivia = 0;
  // Todo rango explícito necesita su saldo de cierre. Solo "Últimos movimientos"
  // puede partir del saldo actual, porque incluye todo el historial disponible.
  const usarRpc = true;

  if (tipo === 'hoy') {
    desdeBolivia = Date.UTC(y, m, d, 0, 0, 0);
    hastaBolivia = Date.UTC(y, m, d + 1, 0, 0, 0);
  } else if (tipo === 'ayer') {
    desdeBolivia = Date.UTC(y, m, d - 1, 0, 0, 0);
    hastaBolivia = Date.UTC(y, m, d, 0, 0, 0);
  } else if (tipo === 'semana') {
    const day = nowBolivia.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    desdeBolivia = Date.UTC(y, m, d - diff, 0, 0, 0);
    hastaBolivia = Date.UTC(y, m, d + 1, 0, 0, 0);
  } else if (tipo === 'mes') {
    desdeBolivia = Date.UTC(y, m, 1, 0, 0, 0);
    hastaBolivia = Date.UTC(y, m, d + 1, 0, 0, 0);
  } else if (tipo === 'rango') {
    if (!desdeStr || !hastaStr) return null;
    const [dY, dM, dD] = desdeStr.split('-').map(Number);
    const [hY, hM, hD] = hastaStr.split('-').map(Number);

    desdeBolivia = Date.UTC(dY, dM - 1, dD, 0, 0, 0);
    hastaBolivia = Date.UTC(hY, hM - 1, hD + 1, 0, 0, 0);

  }

  return {
    desde: new Date(desdeBolivia + 4 * 60 * 60 * 1000).toISOString(),
    hasta: new Date(hastaBolivia + 4 * 60 * 60 * 1000).toISOString(),
    usarRpc
  };
};

const CajasBancos: React.FC = () => {
  const { esSuperAdmin, escuelaId, puedeEliminar, perfil } = useAuthSaaSport();
  const queryClient = useQueryClient();

  // Puede conciliar: permiso centralizado de roles.
  const puedeConciliar = !!perfil?.activo && can(perfil?.rol, 'finance.reconcile');
  const isMobile = useIsMobile();

  // Filtros
  const [filtroCuenta, setFiltroCuenta] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [busquedaCuenta, setBusquedaCuenta] = useState('');
  const [modoConciliacion, setModoConciliacion] = useState(false);
  const [conciliandoId, setConciliandoId] = useState<string | null>(null);
  const [copiadoCajaId, setCopiadoCajaId] = useState<string | null>(null);

  // Estados para Filtro de Fechas
  const [tipoFecha, setTipoFecha] = useState<'ultimos' | 'hoy' | 'ayer' | 'semana' | 'mes' | 'rango'>('ultimos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [rangoAplicado, setRangoAplicado] = useState<RangoFecha | null>(null);
  const [rangoPendiente, setRangoPendiente] = useState(false);

  const handleCambiarTipoFecha = (tipo: typeof tipoFecha) => {
    setTipoFecha(tipo);
    if (tipo === 'rango') {
      setRangoAplicado(null);
      setRangoPendiente(true);
      return;
    }
    setRangoPendiente(false);
    setRangoAplicado(obtenerRangoFechas(tipo));
  };

  const handleAplicarRangoPersonalizado = () => {
    if (!fechaDesde || !fechaHasta) {
      alert('Por favor, selecciona ambas fechas.');
      return;
    }
    if (fechaDesde > fechaHasta) {
      alert('La fecha Desde no puede ser posterior a la fecha Hasta.');
      return;
    }
    setRangoAplicado(obtenerRangoFechas('rango', fechaDesde, fechaHasta));
    setRangoPendiente(false);
  };

  // ── Hooks de datos con TanStack Query ──
  const { data: cajas = [], isLoading: cargandoCajas } = useCajasBancos(escuelaId);

  const cajasAConsultar = useMemo(() => {
    if (filtroCuenta === 'todas') {
      return cajas.map(c => ({ id: c.id, saldo_actual: Number(c.saldo_actual) || 0 }));
    }
    return cajas
      .filter(c => c.id === filtroCuenta)
      .map(c => ({ id: c.id, saldo_actual: Number(c.saldo_actual) || 0 }));
  }, [cajas, filtroCuenta]);

  const { data: resultMovs, isLoading: cargandoMovimientos, error: errorMovs } = useMovimientos(
    escuelaId,
    cajasAConsultar,
    rangoAplicado,
    !rangoPendiente
  );

  const movimientosRaw = rangoPendiente ? [] : resultMovs?.movimientos || [];
  const limiteAlcanzadoPorCaja = rangoPendiente ? {} : resultMovs?.limiteAlcanzadoPorCaja || {};
  const { data: entidades = [] } = useCxpEntidades(escuelaId, {});

  const cargando = cargandoCajas || (!rangoPendiente && cargandoMovimientos);
  const error = errorMovs ? (errorMovs instanceof Error ? errorMovs.message : 'Error al cargar datos') : null;

  // ── Drag-and-drop de tarjetas (solo super admin) ──
  const [cajasOrdenadas, setCajasOrdenadas] = useState<typeof cajas>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Sincronizar cajasOrdenadas cuando cambian los datos del servidor
  useEffect(() => {
    if (cajas.length > 0) setCajasOrdenadas(cajas);
  }, [cajas]);

  // Estados para formularios activos
  const [activeForm, setActiveForm] = useState<'ingreso' | 'salida' | 'transferencia' | 'nueva_caja' | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [cajaAEditar, setCajaAEditar] = useState<CajaBanco | null>(null);

  // Estado para edición de movimientos
  const [movEditar, setMovEditar] = useState<MovimientoFinanciero | null>(null);
  const [movDetalle, setMovDetalle] = useState<MovimientoFinanciero | null>(null);
  const [notaCxcParaEditar, setNotaCxcParaEditar] = useState<any>(null);
  const [cargandoNotaCxc, setCargandoNotaCxc] = useState(false);

  // Estados para Cobros/Pagos rápidos
  const [showCobro, setShowCobro] = useState(false);
  const [showPago, setShowPago] = useState(false);

  // Estados y refs para Recibos de WhatsApp
  const [escuelaInfo, setEscuelaInfo] = useState<{ nombre: string; logo_url: string | null } | null>(null);
  const [movimientoParaRecibo, setMovimientoParaRecibo] = useState<MovimientoFinanciero | null>(null);
  const [generandoReciboId, setGenerandoReciboId] = useState<string | null>(null);
  const refRecibo = useRef<HTMLDivElement>(null);

  // Cargar datos de la escuela para el recibo
  useEffect(() => {
    if (!escuelaId) return;
    const fetchEscuela = async () => {
      try {
        const { data, error } = await supabase
          .from('escuelas')
          .select('nombre, logo_url')
          .eq('id', escuelaId)
          .single();
        if (!error && data) {
          setEscuelaInfo(data);
        }
      } catch (err) {
        console.error('Error al cargar la escuela:', err);
      }
    };
    fetchEscuela();
  }, [escuelaId]);

  // Los movimientos ya vienen procesados con saldo_historico y ordenados
  const movimientos = movimientosRaw;



  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cajas-bancos', escuelaId] });
    queryClient.invalidateQueries({ queryKey: ['movimientos-financieros', escuelaId] });
  };

  const copiarTablaCaja = (cajaId: string, movs: MovimientoFinanciero[]) => {
    const cabecera = ['Fecha', 'Documento', 'Alumno / Proveedor', 'Cuentas', 'Ingreso', 'Salida', 'Saldo'].join('\t');
    const filas = movs.map(mov => {
      const fechaStr = formatFecha(mov.fecha);
      
      // Documento
      let doc = '';
      if (mov.nro_transaccion) {
        const nroTrim = mov.nro_transaccion.trim();
        const esMetodo = /^(efectivo|transferencia|qr|transferencia bancaria|pago qr)$/i.test(nroTrim);
        if (!esMetodo) {
          doc = nroTrim;
        }
      }
      
      // Alumno / Proveedor
      const cliente = obtenerCliente(mov.cliente);
      let desc = mov.descripcion?.trim() || '';
      desc = desc.replace(/^\[(INGRESO|EGRESO) TRF\]\s*/i, '');
      const cuentaTrim = mov.cuenta_nombre?.trim() || '';
      if (desc === cuentaTrim) desc = '';
      else if (cuentaTrim && desc.startsWith(cuentaTrim)) {
        desc = desc.substring(cuentaTrim.length).trim().replace(/^[:\-\s,]+/, '').trim();
      }
      desc = desc.replace(/\b(efectivo|transferencia|qr|transferencia bancaria|pago qr)\b/gi, '').replace(/^[:\-\s,]+/, '').trim();
      
      const concepto = cliente ? (desc ? `${cliente} - ${desc}` : cliente) : (desc || '—');
      
      const cuenta = mov.cuenta_nombre || '';
      const ingreso = mov.debe > 0 ? mov.debe.toFixed(2).replace('.', ',') : '';
      const salida = mov.haber > 0 ? mov.haber.toFixed(2).replace('.', ',') : '';
      const saldo = (mov as any).saldo_historico !== undefined ? (mov as any).saldo_historico.toFixed(2).replace('.', ',') : '0,00';
      
      return [fechaStr, doc, concepto, cuenta, ingreso, salida, saldo].join('\t');
    });
    
    const texto = [cabecera, ...filas].join('\n');
    navigator.clipboard.writeText(texto).then(() => {
      setCopiadoCajaId(cajaId);
      setTimeout(() => setCopiadoCajaId(null), 2500);
    });
  };


  // ── Guardar nuevo orden en BD ──
  const guardarOrden = useCallback(async (listaOrdenada: typeof cajas) => {
    const updates = listaOrdenada.map((c, idx) => ({ id: c.id, orden: idx }));
    for (const u of updates) {
      await supabase.from('cajas_bancos').update({ orden: u.orden }).eq('id', u.id);
    }
    manejarActualizacion();
  }, []);

  // ── Marcar caja como predeterminada ──
  const marcarPredeterminada = useCallback(async (cajaId: string) => {
    if (!escuelaId) return;
    // Quitar predeterminada de todas
    await supabase.from('cajas_bancos')
      .update({ es_predeterminada: false })
      .eq('escuela_id', escuelaId);
    // Poner en la seleccionada
    await supabase.from('cajas_bancos')
      .update({ es_predeterminada: true })
      .eq('id', cajaId);
    manejarActualizacion();
  }, [escuelaId]);

  // ── Handlers de Drag-and-drop ──
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggingId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null); setDragOverId(null);
      return;
    }
    const lista = [...cajasOrdenadas];
    const fromIdx = lista.findIndex(c => c.id === draggingId);
    const toIdx = lista.findIndex(c => c.id === targetId);
    const [movida] = lista.splice(fromIdx, 1);
    lista.splice(toIdx, 0, movida);
    setCajasOrdenadas(lista);
    setDraggingId(null); setDragOverId(null);
    guardarOrden(lista);
  };

  const handleDragEnd = () => {
    setDraggingId(null); setDragOverId(null);
  };


  const toggleForm = (type: 'ingreso' | 'salida' | 'transferencia' | 'nueva_caja') => {
    if (activeForm === type) {
      handleCerrarModal();
      return;
    }

    if (activeForm && formDirty) {
      if (!window.confirm('Tienes cambios sin guardar en el formulario actual. ¿Deseas descartarlos y cambiar de operación?')) {
        return;
      }
    }
    if (type !== 'nueva_caja') {
      setCajaAEditar(null);
    }
    setActiveForm(type);
    setFormDirty(false);
  };

  const handleCerrarModal = () => {
    if (formDirty) {
      if (!window.confirm('Tienes cambios sin guardar. ¿Deseas descartarlos y cerrar el formulario?')) {
        return;
      }
    }
    setActiveForm(null);
    setCajaAEditar(null);
    setFormDirty(false);
  };



  // Cálculos de saldo
  const saldos = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of cajas) {
      s[c.id] = Number(c.saldo_actual) || 0;
    }
    // Si en el futuro se vuelven a cargar movimientos dinámicos, se sumarían aquí
    return s;
  }, [cajas]);


  const saldoTotal = useMemo(() => {
    return Object.values(saldos).reduce((sum, val) => sum + val, 0);
  }, [saldos]);

  // Eliminar el useEffect que actualizaba el SidebarContext (líneas 195-230 aprox)
  // El saldo consolidado y el selector ahora se integran en la rejilla de tarjetas.

  // Normalizar texto: quitar acentos y pasar a minúsculas
  const normalizar = useCallback((str: string) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  , []);

  // Filtros cruzados — búsqueda inteligente por Cuentas, Alumno/Proveedor y Documentos
  const movimientosFiltrados = useMemo(() => {
    let list = movimientos;
    if (filtroCuenta !== 'todas') list = list.filter(m => m.cuenta_id === filtroCuenta);
    if (busqueda.trim()) {
      // Separar la búsqueda en tokens individuales (AND lógico)
      const tokens = normalizar(busqueda).split(/\s+/).filter(t => t.length > 0);
      
      list = list.filter(m => {
        // Campos de búsqueda en orden de prioridad: Cuentas, Alumno/Proveedor, Documentos
        const campoCuentas = normalizar(m.cuenta_nombre || '');
        const campoCliente = normalizar(m.cliente || '');
        const campoDocumento = normalizar(m.nro_transaccion || '');
        
        // Concatenar todos los campos para buscar tokens que pueden cruzar columnas
        const textoCompleto = `${campoCuentas} ${campoCliente} ${campoDocumento}`;
        
        // Cada token debe encontrarse en al menos uno de los campos
        return tokens.every(token => textoCompleto.includes(token));
      });
    }
    return list;
  }, [movimientos, filtroCuenta, busqueda, normalizar]);


  const actualizarConciliadoMovimiento = async (mov: MovimientoFinanciero, conciliado: boolean) => {
    const tabla = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
    const isGrouped = (mov as any).is_grouped;

    if (isGrouped) {
      const ids = (mov as any).original_ids || [];
      const resultados = await Promise.all(ids.map((id: string) =>
        supabase.from(tabla).update({ conciliado }).eq('id', id)
      ));
      const error = resultados.find(r => r.error)?.error;
      if (error) throw error;
      return;
    }

    const { error: errUpd } = await supabase
      .from(tabla)
      .update({ conciliado })
      .eq('id', mov.id);

    if (errUpd) throw errUpd;
  };

  const registrarConciliacion = (
    accion: 'conciliar' | 'desconciliar' | 'conciliar_hasta' | 'conciliar_visibles',
    entidadId: string,
    detalle: Record<string, any>
  ) => {
    if (!escuelaId || !perfil) return;
    logActivity({
      escuela_id: escuelaId,
      usuario_id: perfil.id,
      usuario_nombre: `${perfil.nombres || ''} ${perfil.apellidos || ''}`.trim() || perfil.email,
      accion,
      modulo: 'cajas_bancos',
      entidad_id: entidadId,
      detalle
    });
  };

  const toggleConciliar = async (mov: MovimientoFinanciero) => {
    if (!puedeConciliar || conciliandoId) return;

    try {
      const siguienteEstado = !mov.conciliado;
      let motivo: string | null = null;

      if (!siguienteEstado) {
        motivo = window.prompt('Motivo para desmarcar esta conciliacion:');
        if (!motivo?.trim()) return;
      }

      setConciliandoId(mov.id);
      await actualizarConciliadoMovimiento(mov, siguienteEstado);
      registrarConciliacion(siguienteEstado ? 'conciliar' : 'desconciliar', mov.id, {
        cuenta_id: mov.cuenta_id,
        cuenta_nombre: mov.cuenta_nombre,
        saldo_verificado: (mov as any).saldo_historico || 0,
        fecha_movimiento: mov.fecha,
        motivo: motivo?.trim() || null
      });
      manejarActualizacion();
    } catch (err: any) {
      alert("Error al actualizar estado: " + err.message);
    } finally {
      setConciliandoId(null);
    }
  };

  const conciliarHastaMovimiento = async (mov: MovimientoFinanciero) => {
    if (!puedeConciliar || conciliandoId || mov.conciliado) return;

    const movimientosCuenta = movimientos.filter(m => m.cuenta_id === mov.cuenta_id);
    const idx = movimientosCuenta.findIndex(m => m.id === mov.id);
    if (idx < 0) return;

    const pendientes = movimientosCuenta.slice(idx).filter(m => !m.conciliado);
    if (pendientes.length === 0) return;

    const saldo = Number((mov as any).saldo_historico || 0);
    const ok = window.confirm(
      `Conciliar ${pendientes.length} movimiento(s) de ${mov.cuenta_nombre} hasta este saldo verificado?\n\nSaldo verificado: Bs ${fmtMonto(saldo)}`
    );
    if (!ok) return;

    try {
      setConciliandoId(mov.id);
      await Promise.all(pendientes.map(m => actualizarConciliadoMovimiento(m, true)));
      registrarConciliacion('conciliar_hasta', mov.id, {
        cuenta_id: mov.cuenta_id,
        cuenta_nombre: mov.cuenta_nombre,
        movimientos_marcados: pendientes.length,
        saldo_verificado: saldo,
        fecha_corte: mov.fecha
      });
      manejarActualizacion();
    } catch (err: any) {
      alert("Error al conciliar bloque: " + err.message);
    } finally {
      setConciliandoId(null);
    }
  };

  const conciliarMovimientosVisibles = async (caja: CajaBanco, movsCaja: MovimientoFinanciero[]) => {
    if (!puedeConciliar || conciliandoId) return;
    const pendientes = movsCaja.filter(m => !m.conciliado);
    if (pendientes.length === 0) return;

    const ok = window.confirm(`Conciliar ${pendientes.length} movimiento(s) visibles de ${caja.nombre}?`);
    if (!ok) return;

    try {
      setConciliandoId(`visibles-${caja.id}`);
      await Promise.all(pendientes.map(m => actualizarConciliadoMovimiento(m, true)));
      registrarConciliacion('conciliar_visibles', caja.id, {
        cuenta_id: caja.id,
        cuenta_nombre: caja.nombre,
        movimientos_marcados: pendientes.length,
        filtro_busqueda: busqueda.trim() || null
      });
      manejarActualizacion();
    } catch (err: any) {
      alert("Error al conciliar visibles: " + err.message);
    } finally {
      setConciliandoId(null);
    }
  };

  const generarReciboWhatsApp = async (mov: MovimientoFinanciero) => {
    if (generandoReciboId) return;
    setGenerandoReciboId(mov.id);
    setMovimientoParaRecibo(mov);

    // Esperar a que React monte y renderice el recibo oculto en el DOM
    setTimeout(async () => {
      try {
        const element = refRecibo.current;
        if (!element) {
          throw new Error('No se pudo encontrar el contenedor del recibo.');
        }

        // 1. Generar PNG para el portapapeles (los navegadores requieren PNG para copiar de forma nativa)
        const pngBlob = await toBlob(element, { 
          type: 'image/png', 
          cacheBust: true,
          style: {
            transform: 'scale(1)',
            transformOrigin: 'top left'
          }
        });

        if (!pngBlob) throw new Error('Error al renderizar el recibo en formato PNG.');

        // Intentar copiar al portapapeles
        let copiadoExitoso = false;
        try {
          await navigator.clipboard.write([
            new ClipboardItem({
              'image/png': pngBlob
            })
          ]);
          copiadoExitoso = true;
        } catch (clipboardErr) {
          console.warn('La API Clipboard falló o el navegador tiene restricciones en HTTP/contexto seguro. Copia no disponible.', clipboardErr);
        }

        // 2. Generar JPEG comprimido y liviano para descargar en local
        const jpegBlob = await toBlob(element, { 
          type: 'image/jpeg', 
          quality: 0.85, 
          cacheBust: true 
        });

        if (jpegBlob) {
          const docId = mov.nro_transaccion || mov.id;
          const fileName = `recibo_${docId.replace(/\s+/g, '_')}.jpg`;
          
          // Forzar descarga del JPG ligero
          const link = document.createElement('a');
          link.href = URL.createObjectURL(jpegBlob);
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(link.href);
        }

        // 3. Determinar teléfono de contacto de WhatsApp
        let telFinal = '';
        if (mov.alumno_raw) {
          const al = mov.alumno_raw;
          const esPadre = al.whatsapp_preferido === 'padre';
          const telefono = esPadre ? (al.telefono_padre || al.telefono_madre) : (al.telefono_madre || al.telefono_padre);
          if (telefono) {
            telFinal = telefono.replace(/\D/g, '');
          }
        }

        // 4. Mostrar feedback al usuario
        if (copiadoExitoso) {
          alert('¡Recibo copiado al portapapeles y descargado localmente! Ya puedes ir al chat de WhatsApp y simplemente pegarlo (Ctrl+V) para enviarlo.');
        } else {
          alert('¡Recibo descargado localmente! Ve al chat de WhatsApp y arrastra la imagen descargada para enviarla.');
        }

        // 5. Redirigir/abrir WhatsApp Web o App
        const textoSaludo = `¡Hola! Aquí tienes el recibo digital de tu pago correspondiente a ${mov.cliente || 'SaaSport'}.`;
        const urlWa = telFinal 
          ? `https://wa.me/${telFinal}?text=${encodeURIComponent(textoSaludo)}`
          : `https://web.whatsapp.com/send?text=${encodeURIComponent(textoSaludo)}`;
        
        window.open(urlWa, '_blank');

      } catch (err: any) {
        console.error('Error al generar el recibo de WhatsApp:', err);
        alert('Ocurrió un error al generar el recibo: ' + (err.message || 'Error desconocido'));
      } finally {
        setGenerandoReciboId(null);
        setMovimientoParaRecibo(null);
      }
    }, 400);
  };

  const abrirEdicionNotaCxc = async (notaId: string) => {
    if (!notaId) return;
    setCargandoNotaCxc(true);
    try {
      // 1. Obtener la Nota de Servicio desde cuentas_cobrar
      const { data: nota, error: errNota } = await supabase
        .from('cuentas_cobrar')
        .select('*')
        .eq('id', notaId)
        .single();

      if (errNota) throw errNota;
      if (!nota) throw new Error('No se encontró la Nota de Servicio generadora.');

      // 2. Obtener el total cobrado de cobros_aplicados para esta nota
      const { data: cobrosDB } = await supabase
        .from('cobros_aplicados')
        .select('monto_aplicado')
        .eq('cuenta_cobrar_id', notaId);
      const totalCobrado = (cobrosDB || []).reduce((s: number, c: any) => s + Number(c.monto_aplicado), 0);

      // 3. Obtener los detalles de cxc_detalle
      const { data: detalles, error: errDetalles } = await supabase
        .from('cxc_detalle')
        .select('catalogo_item_id, cantidad, precio_unitario, periodo_meses, detalle_extra, catalogo_items(nombre)')
        .eq('cuenta_cobrar_id', notaId);

      if (errDetalles) throw errDetalles;

      // 4. Formatear la Nota para NotaServicios
      const cxcEditar = {
        ...nota,
        total_cobrado: totalCobrado,
        lineas: (detalles || []).map((l: any) => ({
          catalogo_item_id: l.catalogo_item_id,
          nombre: l.catalogo_items?.nombre || 'Concepto no especificado',
          tipo: 'servicio',
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          periodo_meses: l.periodo_meses || [],
          detalle_personalizado: l.detalle_extra || '',
          subtotal: l.cantidad * l.precio_unitario
        }))
      };

      setNotaCxcParaEditar(cxcEditar);
    } catch (e: any) {
      console.error(e);
      alert(`Error al cargar la Nota de Servicio: ${e.message}`);
    } finally {
      setCargandoNotaCxc(false);
    }
  };

  return (
    <main className="main-content cxc-main">
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
          {/* Tarjetas de Cajas/Bancos — scroll horizontal */}
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            overflowX: 'auto',
            padding: '0.75rem 0.25rem',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}>
            {cajasOrdenadas.map(c => {
              const esActiva = filtroCuenta === c.id;
              const esPred = c.es_predeterminada;
              const saldoCaja = Number(c.saldo_actual) || 0;
              return (
                <div
                  key={c.id}
                  onClick={() => setFiltroCuenta(filtroCuenta === c.id ? 'todas' : c.id)}
                  onDoubleClick={() => {
                    if (esSuperAdmin) {
                      setCajaAEditar(c);
                      setActiveForm('nueva_caja');
                    }
                  }}
                  style={{
                    flexShrink: 0,
                    minWidth: '160px',
                    maxWidth: '200px',
                    background: esActiva ? 'var(--primary-glow)' : esPred ? 'rgba(255,200,0,0.07)' : 'var(--bg-card)',
                    border: `2px solid ${esActiva ? 'var(--primary)' : esPred ? '#f59e0b' : 'var(--border)'}`,
                    borderRadius: '12px',
                    padding: '0.6rem 0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    position: 'relative',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {c.tipo === 'caja_chica' ? 'CAJA' : 'BANCO'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {esPred && <Star size={10} fill="#f59e0b" stroke="#f59e0b" />}
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.activo ? 'var(--success)' : 'var(--danger)' }} />
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2
                  }}>
                    {c.nombre}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 900, color: saldoCaja >= 0 ? 'var(--success)' : '#ef4444', marginTop: '2px' }}>
                    Bs {fmtMonto(saldoCaja)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Botones de acción: Ingresos, Egresos, Transferencia */}
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <button
              onClick={() => toggleForm('ingreso')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: 'rgba(16, 185, 129, 0.1)', color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)', cursor: 'pointer'
              }}
            >
              <ArrowDownRight size={14} /> Ingresos
            </button>
            <button
              onClick={() => toggleForm('salida')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)', cursor: 'pointer'
              }}
            >
              <ArrowUpRight size={14} /> Egresos
            </button>
            <button
              onClick={() => toggleForm('transferencia')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: activeForm === 'transferencia' ? 'var(--primary-glow)' : 'rgba(56, 189, 248, 0.1)',
                color: activeForm === 'transferencia' ? 'var(--primary)' : '#38bdf8',
                border: `1px solid ${activeForm === 'transferencia' ? 'var(--primary)' : 'rgba(56, 189, 248, 0.3)'}`,
                cursor: 'pointer'
              }}
            >
              <ArrowRightLeft size={14} /> Transf.
            </button>
          </div>

          {/* Tabla de movimientos de la caja seleccionada (inline, sin modal) */}
          {(() => {
            const cajasFiltradas = filtroCuenta === 'todas' ? cajasOrdenadas : cajasOrdenadas.filter(c => c.id === filtroCuenta);
            const movsFiltrados = filtroCuenta === 'todas' ? movimientosFiltrados : movimientosFiltrados.filter(m => m.cuenta_id === filtroCuenta);
            const cajaActiva = filtroCuenta !== 'todas' ? cajas.find(c => c.id === filtroCuenta) : null;

            return (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                {rangoPendiente ? (
                  <div style={{
                    padding: '2.5rem 1.5rem',
                    textAlign: 'center',
                    color: 'var(--text-secondary)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.6rem'
                  }}>
                    <Calendar size={32} style={{ color: 'var(--primary)', opacity: 0.8 }} />
                    <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Rango de fechas no aplicado</span>
                    <p style={{ margin: 0, fontSize: '0.8rem', lineHeight: 1.4 }}>
                      Selecciona las fechas de inicio y fin arriba, luego toca <strong>Aplicar</strong> para ver los movimientos.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Header de la tabla */}
                    {cajaActiva && (
                      <div style={{
                        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'var(--bg-table-header)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <Landmark size={16} style={{ color: 'var(--text-table-header)' }} />
                          <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-table-header)' }}>
                            {cajaActiva.nombre}
                          </span>
                        </div>
                        <span style={{ fontWeight: 900, fontSize: '0.9rem', color: (Number(cajaActiva.saldo_actual) || 0) >= 0 ? '#10b981' : '#ef4444' }}>
                          Bs {fmtMonto(Number(cajaActiva.saldo_actual) || 0)}
                        </span>
                      </div>
                    )}
                    {!cajaActiva && (
                      <div style={{
                        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
                        background: 'var(--bg-table-header)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                      }}>
                        <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-table-header)' }}>
                          Todos los movimientos
                        </span>
                        <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--primary)' }}>
                          Bs {fmtMonto(saldoTotal)}
                        </span>
                      </div>
                    )}

                    {/* Lista de movimientos tipo tarjeta */}
                    <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                      {movsFiltrados.length === 0 ? (
                        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                          {filtroCuenta === 'todas' ? 'No hay movimientos registrados.' : 'No hay movimientos en esta cuenta.'}
                        </div>
                      ) : (
                        movsFiltrados.map(mov => {
                          const esIngreso = mov.debe > 0;
                          const fechaStr = formatFecha(mov.fecha);
                          const cliente = obtenerCliente(mov.cliente);
                          const desc = mov.descripcion?.trim() || '';
                          const descLimpia = desc.replace(/^\[(INGRESO|EGRESO) TRF\]\s*/i, '');

                          return (
                            <div
                              key={mov.id}
                              onClick={() => setMovDetalle(mov)}
                              style={{
                                padding: '0.7rem 1rem',
                                borderBottom: '1px solid var(--border)',
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                gap: '0.75rem',
                                cursor: 'pointer'
                              }}
                            >
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                                    {fechaStr}
                                  </span>
                                  {mov.tipo_origen === 'cobro' && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        generarReciboWhatsApp(mov);
                                      }}
                                      disabled={generandoReciboId !== null}
                                      style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: 0,
                                        margin: 0,
                                        cursor: generandoReciboId !== null ? 'wait' : 'pointer',
                                        color: generandoReciboId === mov.id ? 'var(--success)' : '#25D366',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      title="Enviar recibo por WhatsApp"
                                    >
                                      {generandoReciboId === mov.id ? (
                                        <RefreshCw size={11} className="animate-spin" style={{ color: 'var(--success)' }} />
                                      ) : (
                                        <MessageCircle size={13} />
                                      )}
                                    </button>
                                  )}
                                </div>
                                <span style={{
                                  fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
                                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                }}>
                                  {cliente || descLimpia || 'Movimiento'}
                                </span>
                                {cliente && descLimpia && (
                                  <span style={{
                                    fontSize: '0.75rem', color: 'var(--text-tertiary)',
                                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                                  }}>
                                    {descLimpia}
                                  </span>
                                )}
                              </div>
                              <div style={{
                                fontSize: '0.9rem', fontWeight: 700,
                                color: esIngreso ? '#10b981' : '#ef4444',
                                whiteSpace: 'nowrap', flexShrink: 0
                              }}>
                                {esIngreso ? '+' : '-'} Bs {fmtMonto(esIngreso ? mov.debe : mov.haber)}
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })()}
        </div>
      ) : (
        <>
          <div className="sticky-header-container">
            {/* 1. Header Card */}
            <div className="cxc-header-bar" style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--border-light)', marginBottom: 0 }}>
              <div className="cxc-header-izq">
                <h1 className="cxc-titulo-principal" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Caja y Bancos
                </h1>
                {!isMobile && (
                  <div className="pc-busqueda" style={{ flexShrink: 0, width: '300px', marginLeft: '1.5rem', height: '36px' }}>
                    <Search size={15} className="pc-busqueda-icono" />
                    <input
                      type="text"
                      placeholder="Buscar por cuenta, alumno, proveedor..."
                      value={busqueda}
                      onChange={e => setBusqueda(e.target.value)}
                      className="pc-busqueda-input"
                      style={{ padding: '0.4rem 0.6rem' }}
                    />
                    {busqueda && (
                      <button 
                        className="cxc-limpiar-busqueda" 
                        onClick={() => setBusqueda('')}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer',
                          padding: '0 4px',
                          fontSize: '0.9rem'
                        }}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="cxc-header-acciones">
                {/* Dropdown unificado para Ingresos (Cobro e Ingreso Directo) */}
                <DropdownAcciones
                  label="Ingresos"
                  icon={<ArrowDownRight size={16} />}
                  tooltip="Opciones de ingreso de dinero"
                  opciones={[
                    {
                      label: "Cobro a Alumno (CxC)",
                      descripcion: "Registrar cobro de mensualidad o deuda",
                      icon: <ArrowDownRight size={16} />,
                      onClick: () => setShowCobro(true)
                    },
                    {
                      label: "Ingreso Directo",
                      descripcion: "Registrar otro tipo de ingreso a caja",
                      icon: <ArrowDownRight size={16} />,
                      onClick: () => toggleForm('ingreso')
                    }
                  ]}
                />

                {/* Dropdown unificado para Egresos (Pago y Gasto Directo) */}
                <DropdownAcciones
                  label="Egresos"
                  icon={<ArrowUpRight size={16} />}
                  tooltip="Opciones de egreso de dinero"
                  opciones={[
                    {
                      label: "Pago a Proveedor (CxP)",
                      descripcion: "Registrar pago de cuenta por pagar",
                      icon: <ArrowUpRight size={16} />,
                      onClick: () => setShowPago(true)
                    },
                    {
                      label: "Gasto Directo",
                      descripcion: "Registrar egreso o gasto inmediato",
                      icon: <ArrowUpRight size={16} />,
                      onClick: () => toggleForm('salida')
                    }
                  ]}
                />

                {/* 5. Transferencia */}
                <button 
                  className="cxc-accion-btn" 
                  onClick={() => toggleForm('transferencia')} 
                  title="Transferir dinero entre dos cajas/bancos"
                  style={{ 
                    fontWeight: 700, padding: '0.5rem 1rem', 
                    background: activeForm === 'transferencia' ? 'var(--primary-glow)' : '#E5E7EB', 
                    color: activeForm === 'transferencia' ? 'var(--primary)' : '#000', 
                    border: activeForm === 'transferencia' ? '1px solid var(--primary)' : 'none', 
                    borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                  }}
                >
                  <ArrowRightLeft size={16} /> {activeForm === 'transferencia' ? 'Cerrar Transf.' : 'Transferencia'}
                </button>

                {/* 6. Nueva Caja */}
                {!isMobile && (
                  <button 
                    className="cxc-accion-btn" 
                    onClick={() => toggleForm('nueva_caja')} 
                    title="Crear una nueva caja o cuenta bancaria"
                    style={{ 
                      fontWeight: 700, padding: '0.5rem 1rem', 
                      background: activeForm === 'nueva_caja' ? 'var(--primary-glow)' : '#E5E7EB', 
                      color: activeForm === 'nueva_caja' ? 'var(--primary)' : '#000', 
                      border: activeForm === 'nueva_caja' ? '1px solid var(--primary)' : 'none', 
                      borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    <Landmark size={16} /> {activeForm === 'nueva_caja' ? 'Cerrar Nueva' : 'Nueva Caja'}
                  </button>
                )}

                {puedeConciliar && !isMobile && (
                  <button
                    className="cxc-accion-btn"
                    onClick={() => setModoConciliacion(v => !v)}
                    title={modoConciliacion
                      ? 'Salir del modo conciliacion'
                      : 'Activar modo conciliacion: el check de una fila concilia esa cuenta hasta el saldo mostrado'}
                    style={{
                      width: '38px',
                      height: '34px',
                      padding: 0,
                      justifyContent: 'center',
                      background: modoConciliacion ? 'var(--success-bg)' : '#E5E7EB',
                      color: modoConciliacion ? 'var(--success)' : '#000',
                      border: modoConciliacion ? '1px solid rgba(0,210,106,0.45)' : 'none',
                      borderRadius: '8px',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                    }}
                  >
                    {modoConciliacion ? <ShieldOff size={17} /> : <ShieldCheck size={17} />}
                  </button>
                )}

                <button className="btn-refrescar" onClick={manejarActualizacion} disabled={cargando}>
                  <RefreshCw size={18} className={cargando ? 'spin' : ''} />
                </button>
              </div>
            </div>

            {/* 3. Buscador */}
            <div className="cxc-busqueda-bar" style={{ 
              borderRadius: '0 0 12px 12px', 
              marginBottom: '0.5rem', 
              background: 'var(--bg-card)', 
              padding: '0.5rem 1.5rem', 
              border: '1px solid var(--border)', 
              borderTop: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              flexWrap: 'wrap'
            }}>
              {/* Filtro de Fechas */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
                <select
                  value={tipoFecha}
                  onChange={e => handleCambiarTipoFecha(e.target.value as any)}
                  style={{
                    padding: '0.4rem 2rem 0.4rem 0.8rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    background: 'rgba(255,255,255,0.05)',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    outline: 'none',
                    fontWeight: 500,
                  }}
                >
                  <option value="ultimos">Últimos movimientos</option>
                  <option value="hoy">Hoy</option>
                  <option value="ayer">Ayer</option>
                  <option value="semana">Esta semana</option>
                  <option value="mes">Este mes</option>
                  <option value="rango">Rango de fechas</option>
                </select>
              </div>

              {/* Rango de Fechas Personalizado */}
              {tipoFecha === 'rango' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <input
                    type="date"
                    value={fechaDesde}
                    onChange={e => setFechaDesde(e.target.value)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.05)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>a</span>
                  <input
                    type="date"
                    value={fechaHasta}
                    onChange={e => setFechaHasta(e.target.value)}
                    style={{
                      padding: '0.35rem 0.6rem',
                      borderRadius: '6px',
                      border: '1px solid var(--border)',
                      background: 'rgba(255,255,255,0.05)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      outline: 'none'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleAplicarRangoPersonalizado}
                    style={{
                      padding: '0.35rem 0.8rem',
                      borderRadius: '6px',
                      border: 'none',
                      background: 'var(--primary)',
                      color: '#ffffff',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      transition: 'opacity 0.2s'
                    }}
                    onMouseOver={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseOut={e => e.currentTarget.style.opacity = '1'}
                  >
                    Aplicar
                  </button>
                </div>
              )}

              {/* Tarjetas de Cajas/Bancos — drag-and-drop (solo super admin) */}
              <div className="cajas-grid-header" style={{ 
                display: 'flex', 
                gap: '0.75rem', 
                flex: 1, 
                overflowX: 'auto', 
                padding: '0.25rem 0' 
              }}>
                {/* Tarjeta de Saldo Consolidado */}
                <div 
                  onClick={() => setFiltroCuenta('todas')}
                  style={{
                    background: filtroCuenta === 'todas' ? 'var(--primary-glow)' : 'rgba(255,255,255,0.05)',
                    border: `2px solid ${filtroCuenta === 'todas' ? 'var(--primary)' : '#E5E7EB'}`,
                    borderRadius: '10px',
                    padding: '0.4rem 1rem',
                    cursor: 'pointer',
                    minWidth: '160px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: filtroCuenta === 'todas' ? '0 0 15px var(--primary-glow)' : 'none',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Resumen
                    </span>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)' }}></div>
                  </div>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                    Saldo Consolidado
                  </span>
                  <span style={{ fontSize: '1rem', color: 'var(--primary)', fontWeight: 900, marginTop: '2px' }}>
                    Bs {fmtMonto(saldoTotal)}
                  </span>
                </div>

                {cajasOrdenadas.map(c => {
                  const esActiva = filtroCuenta === c.id;
                  const esPred   = c.es_predeterminada;
                  const esDragOver = dragOverId === c.id;
                  return (
                    <div 
                      key={c.id}
                      draggable={esSuperAdmin}
                      onDragStart={esSuperAdmin ? e => handleDragStart(e, c.id) : undefined}
                      onDragOver={esSuperAdmin ? e => handleDragOver(e, c.id) : undefined}
                      onDrop={esSuperAdmin ? e => handleDrop(e, c.id) : undefined}
                      onDragEnd={esSuperAdmin ? handleDragEnd : undefined}
                      onClick={() => setFiltroCuenta(filtroCuenta === c.id ? 'todas' : c.id)}
                      onDoubleClick={() => {
                        if (esSuperAdmin) {
                          setCajaAEditar(c);
                          setActiveForm('nueva_caja');
                        }
                      }}
                      style={{
                        background: esActiva ? 'var(--primary-glow)' : esPred ? 'rgba(255,200,0,0.07)' : 'rgba(255,255,255,0.05)',
                        border: `2px solid ${esActiva ? 'var(--primary)' : esPred ? '#f59e0b' : esDragOver ? 'var(--primary)' : '#E5E7EB'}`,
                        borderRadius: '10px',
                        padding: '0.4rem 1rem',
                        cursor: esSuperAdmin ? 'grab' : 'pointer',
                        minWidth: '160px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: esActiva ? '0 0 15px var(--primary-glow)' : esPred ? '0 0 10px rgba(245,158,11,0.25)' : 'none',
                        opacity: draggingId === c.id ? 0.5 : 1,
                        transform: esDragOver ? 'scale(1.03)' : 'scale(1)',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {esSuperAdmin && (
                            <GripVertical size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0, cursor: 'grab' }} />
                          )}
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {c.tipo === 'caja_chica' ? 'Caja' : 'Banco'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {esPred && (
                            <span title="Predeterminada" style={{ lineHeight: 1, display: 'flex' }}>
                              <Star size={11} fill="#f59e0b" stroke="#f59e0b" />
                            </span>
                          )}
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.activo ? 'var(--success)' : 'var(--danger)' }}></div>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                        {c.nombre}
                      </span>
                      <span style={{ fontSize: '1rem', color: 'var(--success)', fontWeight: 900, marginTop: '2px' }}>
                        Bs {fmtMonto(Number(c.saldo_actual) || 0)}
                      </span>
                      {esSuperAdmin && !esPred && (
                        <button
                          onClick={e => { e.stopPropagation(); marcarPredeterminada(c.id); }}
                          title="Marcar como predeterminada"
                          style={{
                            position: 'absolute', bottom: '4px', right: '6px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-tertiary)', padding: '2px', lineHeight: 1
                          }}
                        >
                          <Star size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {!isMobile && (
                <span className="cxc-conteo-resultado" style={{ marginLeft: 'auto', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  {movimientosFiltrados.length} movimientos mostrados
                </span>
              )}
            </div>
          </div>

          {/* 4. Lista de Movimientos */}
          {error && (
            <div className="pc-error" style={{ marginBottom: '1rem' }}>
              <p>⚠️ {error}</p>
            </div>
          )}



          {rangoPendiente ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '3rem 1.5rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              border: '1px dashed var(--border)',
              borderRadius: '12px',
              marginTop: '1rem',
              color: 'var(--text-secondary)'
            }}>
              <Calendar size={40} style={{ color: 'var(--primary)', marginBottom: '0.75rem', opacity: 0.8 }} />
              <h4 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700 }}>Rango de fechas no aplicado</h4>
              <p style={{ margin: 0, fontSize: '0.9rem', maxWidth: '420px', lineHeight: 1.5 }}>
                Selecciona una fecha de inicio y una de fin en el filtro de arriba, luego haz clic en <strong>Aplicar</strong> para cargar y mostrar los movimientos.
              </p>
            </div>
          ) : cargando ? (
            <div className="pc-cargando">
              <RefreshCw size={32} className="spin" />
              <p>Cargando movimientos...</p>
            </div>
          ) : cajas.length === 0 ? (
            <div className="arbol-vacio">
              <Landmark size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
              <p>No tienes Cajas ni Bancos configurados en el Plan de Cuentas.</p>
            </div>
          ) : (
            <div className="cajas-tablas-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
              {cajasOrdenadas.filter(c => filtroCuenta === 'todas' || c.id === filtroCuenta).map(caja => {
                const movsCaja = movimientosFiltrados.filter(m => m.cuenta_id === caja.id);

                // Si hay búsqueda y esta caja no tiene movimientos coincidentes, la ocultamos para limpiar la UI
                if (busqueda && movsCaja.length === 0) return null;

                return (
                  <div key={caja.id} className="caja-seccion">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center' }}>
                          <Landmark size={20} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px', color: 'var(--primary)' }} />
                          {caja.nombre}
                        </h3>
                        {limiteAlcanzadoPorCaja[caja.id] && (
                          <span style={{
                            fontSize: '0.75rem',
                            fontWeight: 500,
                            color: '#d97706',
                            backgroundColor: 'rgba(245, 158, 11, 0.08)',
                            border: '1px solid rgba(245, 158, 11, 0.2)',
                            padding: '2px 8px',
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}>
                            <AlertTriangle size={12} />
                            Mostrando los 200 movimientos más recientes
                          </span>
                        )}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {!isMobile && (
                          <button
                            type="button"
                            className={`est-tabla-copiar ${copiadoCajaId === caja.id ? 'est-tabla-copiar--ok' : ''}`}
                            onClick={() => copiarTablaCaja(caja.id, movsCaja)}
                            title="Copiar movimientos de esta cuenta para Excel (formato TSV)"
                          >
                            {copiadoCajaId === caja.id ? (
                              <>
                                <Check size={14} />
                                <span>¡Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy size={14} />
                                <span>Copiar a Excel</span>
                              </>
                            )}
                          </button>
                        )}
                        {modoConciliacion && puedeConciliar && !isMobile && movsCaja.some(m => !m.conciliado) && (
                          <button
                            type="button"
                            onClick={() => conciliarMovimientosVisibles(caja, movsCaja)}
                            disabled={!!conciliandoId}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.4rem',
                              padding: '0.42rem 0.7rem',
                              borderRadius: '8px',
                              border: '1px solid rgba(0,210,106,0.28)',
                              background: 'var(--success-bg)',
                              color: 'var(--success)',
                              fontWeight: 800,
                              fontSize: '0.78rem'
                            }}
                            title="Marcar como conciliados todos los movimientos visibles de esta cuenta"
                          >
                            <CheckCircle2 size={15} />
                            Conciliar visibles
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="cxc-tabla-wrapper" style={{ borderRadius: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <table className="cxc-tabla" style={{ minWidth: isMobile ? '600px' : 'auto' }}>
                        <thead>
                          <tr>
                            <th className="cxc-th" style={{ width: '100px' }}>Fecha</th>
                            {!isMobile && <th className="cxc-th" style={{ width: '120px' }}>Documento</th>}
                            <th className="cxc-th" style={{ maxWidth: '245px' }}>Alumno / Proveedor</th>
                            {!isMobile && <th className="cxc-th" style={{ width: '240px' }}>Cuentas</th>}
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Ingreso</th>
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Salida</th>
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Saldo</th>
                            {!isMobile && <th className="cxc-th cxc-th-center" style={{ width: '135px' }}>Acciones</th>}
                            {!isMobile && <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Conciliado</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {movsCaja.length === 0 ? (
                            <tr>
                              <td colSpan={isMobile ? 5 : 9} className="cxc-td cxc-td-center cxc-td-meta" style={{ padding: '2rem' }}>
                                {rangoPendiente
                                  ? 'Selecciona el rango de fechas y presiona Aplicar.'
                                  : busqueda ? 'No se encontraron movimientos para esta búsqueda en esta cuenta.' : 'No hay movimientos registrados en esta cuenta.'}
                              </td>
                            </tr>
                          ) : movsCaja.map(mov => {
                            const esIngreso = mov.debe > 0;
                            const fechaStr = formatFecha(mov.fecha);

                            return (
                              <tr 
                                key={mov.id} 
                                className="cxc-tr cxc-tr-clickable"
                                onClick={() => setMovDetalle(mov)}
                              >
                                <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                                  {fechaStr}
                                </td>
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-meta">
                                    {/* Mostrar nro_transaccion en Documento (Amarillo) */}
                                    {(() => {
                                      if (!mov.nro_transaccion) return null;
                                      const nroTrim = mov.nro_transaccion.trim();
                                      if (!nroTrim) return null;
                                      
                                      const esMetodo = /^(efectivo|transferencia|qr|transferencia bancaria|pago qr)$/i.test(nroTrim);
                                      if (esMetodo) return null;

                                      return <div style={{ fontWeight: 400, color: 'var(--text-primary)' }}>{nroTrim}</div>;
                                    })()}
                                  </td>
                                )}
                                <td className="cxc-td" style={{ maxWidth: '245px' }}>
                                  {(() => {
                                    const cliente = obtenerCliente(mov.cliente);
                                    let desc = mov.descripcion?.trim() || '';
                                    
                                    // Limpiar prefijo de transferencia si existe
                                    desc = desc.replace(/^\[(INGRESO|EGRESO) TRF\]\s*/i, '');

                                    const cuentaTrim = mov.cuenta_nombre?.trim() || '';
                                    
                                    if (desc === cuentaTrim) desc = '';
                                    else if (cuentaTrim && desc.startsWith(cuentaTrim)) {
                                      desc = desc.substring(cuentaTrim.length).trim().replace(/^[:\-\s,]+/, '').trim();
                                    }
                                    
                                    // Quitar métodos de pago genéricos
                                    desc = desc.replace(/\b(efectivo|transferencia|qr|transferencia bancaria|pago qr)\b/gi, '').replace(/^[:\-\s,]+/, '').trim();

                                    return (
                                      <div style={{ 
                                        color: 'var(--text-primary)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: '6px'
                                      }} title={cliente ? `${cliente}${desc ? ' - ' + desc : ''}` : desc}>
                                        {cliente && <span style={{ fontWeight: 600 }}>{cliente}</span>}
                                        {desc && (
                                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                            {cliente ? '- ' : ''}{desc}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-meta">
                                    <div style={{ fontWeight: 400, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                      {mov.cuenta_nombre}
                                    </div>
                                  </td>
                                )}
                                <td className="cxc-td cxc-td-right">
                                  {esIngreso ? (
                                    <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                      +{fmtMonto(mov.debe)}
                                    </span>
                                  ) : (
                                    <span className="cxc-td-dash">—</span>
                                  )}
                                </td>
                                <td className="cxc-td cxc-td-right">
                                  {!esIngreso ? (
                                    <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                                      -{fmtMonto(mov.haber)}
                                    </span>
                                  ) : (
                                    <span className="cxc-td-dash">—</span>
                                  )}
                                </td>
                                <td className="cxc-td cxc-td-right">
                                  <span style={{ fontWeight: 700, color: (mov as any).saldo_historico >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                                    {fmtMonto((mov as any).saldo_historico || 0)}
                                  </span>
                                </td>
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-center">
                                    <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'center', alignItems: 'center' }}>
                                      {/* Editar (Solo si no está conciliado) */}
                                      {!mov.conciliado && (
                                        <button
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            setMovEditar(mov);
                                          }}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--secondary)' }}
                                          title="Editar movimiento"
                                        >
                                          <Pencil size={15} />
                                        </button>
                                      )}

                                      {/* WhatsApp (Solo para cobros/ingresos, conciliados o no) */}
                                      {mov.tipo_origen === 'cobro' && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            generarReciboWhatsApp(mov);
                                          }}
                                          disabled={generandoReciboId !== null}
                                          style={{ 
                                            background: 'none', 
                                            border: 'none', 
                                            cursor: generandoReciboId !== null ? 'wait' : 'pointer', 
                                            color: generandoReciboId === mov.id ? 'var(--success)' : '#25D366', 
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            padding: '2px'
                                          }}
                                          title="Enviar recibo por WhatsApp"
                                        >
                                          {generandoReciboId === mov.id ? (
                                            <RefreshCw size={15} className="animate-spin" style={{ color: 'var(--success)' }} />
                                          ) : (
                                            <MessageCircle size={15} />
                                          )}
                                        </button>
                                      )}

                                      {/* Eliminar (Solo si no está conciliado y tiene permisos) */}
                                      {!mov.conciliado && puedeEliminar && (
                                        <button
                                          onClick={async (e) => { 
                                            e.stopPropagation(); 
                                            if (window.confirm("¿Eliminar esta transacción definitivamente?")) {
                                              try {
                                                const isGrouped = (mov as any).is_grouped;
                                                if (isGrouped) {
                                                  const tablaApl = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
                                                  const ids = (mov as any).original_ids || [];
                                                  for (const id of ids) {
                                                    await supabase.from(tablaApl).delete().eq('id', id);
                                                  }
                                                } else {
                                                  const tieneCliente = mov.cliente && mov.cliente !== '—';
                                                  if (mov.cuenta_maestra_id && !tieneCliente) {
                                                    const tablaMaestra = mov.tipo_origen === 'cobro' ? 'cuentas_cobrar' : 'cuentas_pagar';
                                                    const { error: errDel } = await supabase.from(tablaMaestra).delete().eq('id', mov.cuenta_maestra_id);
                                                    if (errDel) throw errDel;
                                                  } else {
                                                    const tablaApl = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
                                                    const { error: errDel } = await supabase.from(tablaApl).delete().eq('id', mov.id);
                                                    if (errDel) throw errDel;
                                                  }
                                                }
                                                manejarActualizacion();
                                              } catch (err: any) {
                                                console.error("Error al eliminar:", err);
                                                alert("No se pudo eliminar la transacción: " + (err.message || "Error desconocido"));
                                              }
                                            }
                                          }}
                                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                                          title="Eliminar movimiento"
                                        >
                                          <Trash2 size={15} />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                )}
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-center">
                                    <button 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        if (!puedeConciliar) return;
                                        if (modoConciliacion && !mov.conciliado) {
                                          conciliarHastaMovimiento(mov);
                                        } else {
                                          toggleConciliar(mov);
                                        }
                                      }}
                                      style={{ 
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        width: '34px',
                                        height: '30px',
                                        borderRadius: '8px',
                                        border: `1px solid ${mov.conciliado ? 'rgba(0,210,106,0.32)' : (modoConciliacion ? 'rgba(10,132,255,0.35)' : 'var(--border)')}`,
                                        background: mov.conciliado ? 'var(--success-bg)' : (modoConciliacion ? 'rgba(10,132,255,0.08)' : 'var(--bg-glass)'),
                                        cursor: puedeConciliar ? 'pointer' : 'default', 
                                        color: mov.conciliado ? 'var(--success)' : 'var(--text-tertiary)',
                                        opacity: puedeConciliar ? 1 : 0.6
                                      }}
                                      title={mov.conciliado
                                        ? `Conciliado. Saldo verificado: Bs ${fmtMonto(Number((mov as any).saldo_historico || 0))}. Click para desmarcar con motivo.`
                                        : (puedeConciliar
                                          ? (modoConciliacion
                                            ? `Conciliar hasta aqui. Saldo verificado: Bs ${fmtMonto(Number((mov as any).saldo_historico || 0))}`
                                            : "Marcar solo este movimiento como conciliado")
                                          : "Sin permiso para conciliar")}
                                      disabled={!puedeConciliar || conciliandoId === mov.id}
                                    >
                                      {mov.conciliado ? <LockKeyhole size={17} /> : (modoConciliacion ? <ShieldCheck size={17} /> : <Square size={17} />)}
                                    </button>
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Modales */}
      <ModalMovimientoDirecto
        visible={activeForm === 'ingreso' || activeForm === 'salida'}
        tipo={activeForm === 'ingreso' ? 'ingreso' : 'salida'}
        isDirty={formDirty}
        cajas={cajas}
        onCerrar={handleCerrarModal}
        setFormDirty={setFormDirty}
        onCreado={() => {
          setActiveForm(null);
          setFormDirty(false);
          manejarActualizacion();
        }}
      />
      
      <ModalTransferencia 
        visible={activeForm === 'transferencia'} 
        cajas={cajas} 
        onCerrar={handleCerrarModal}
        setFormDirty={setFormDirty}
        onCreado={() => {
          setActiveForm(null);
          setFormDirty(false);
          manejarActualizacion();
        }} 
      />

      <ModalNuevaCaja
        visible={activeForm === 'nueva_caja'}
        onCerrar={() => { setActiveForm(null); setCajaAEditar(null); }}
        onCreado={() => {
          setActiveForm(null);
          setCajaAEditar(null);
          manejarActualizacion();
        }}
        cajaAEditar={cajaAEditar}
      />

      {/* Modal: Editar movimiento existente */}
      <ModalEditarMovimiento
        visible={!!movEditar}
        movimiento={movEditar}
        cajas={cajas}
        onCerrar={() => setMovEditar(null)}
        onGuardado={() => { setMovEditar(null); manejarActualizacion(); }}
      />

      {/* Modal: Detalle de movimiento */}
      <ModalDetalleMovimiento
        visible={!!movDetalle}
        movimiento={movDetalle}
        onCerrar={() => setMovDetalle(null)}
      />

      {/* Nuevos modales de Cobro y Pago rápidos */}
      <ModalCobroRapido
        visible={showCobro}
        alumnoInicial={null}
        onCerrar={() => setShowCobro(false)}
        onCobrado={() => { setShowCobro(false); manejarActualizacion(); }}
      />

      <ModalPagoRapidoCxP
        visible={showPago}
        entidadInicial={null}
        entidades={entidades}
        onCerrar={() => setShowPago(false)}
        onPagado={() => { setShowPago(false); manejarActualizacion(); }}
      />

      {notaCxcParaEditar && (
        <NotaServicios
          visible={!!notaCxcParaEditar}
          onCerrar={() => setNotaCxcParaEditar(null)}
          onCreada={() => {
            setNotaCxcParaEditar(null);
            manejarActualizacion();
          }}
          cxcEditar={notaCxcParaEditar}
        />
      )}

      {/* Recibo Virtual Oculto para exportar a JPEG/PNG */}
      {movimientoParaRecibo && (
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px', zIndex: -1000, pointerEvents: 'none' }}>
          <div 
            ref={refRecibo}
            style={{
              width: '360px',
              height: '480px',
              backgroundColor: '#1A1A1A',
              color: '#e5e2e1',
              fontFamily: '"Inter", sans-serif',
              padding: '24px',
              borderRadius: '12px',
              border: '1px solid #2D2D2D',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)'
            }}
          >
            {/* Logo de la Escuela o Placeholder */}
            <div style={{
              position: 'absolute',
              top: '24px',
              right: '24px',
              zIndex: 20,
              width: '48px',
              height: '48px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden'
            }}>
              {escuelaInfo?.logo_url ? (
                <img 
                  src={escuelaInfo.logo_url} 
                  alt="Logo" 
                  crossOrigin="anonymous" 
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: 'rgba(255, 107, 53, 0.1)',
                  borderRadius: '6px'
                }}>
                  <span style={{ 
                    color: '#ff6b35', 
                    fontSize: '18px', 
                    fontWeight: 'bold', 
                    fontFamily: '"Inter", sans-serif' 
                  }}>
                    {escuelaInfo?.nombre ? escuelaInfo.nombre.charAt(0).toUpperCase() : 'S'}
                  </span>
                </div>
              )}
            </div>

            {/* Contenido principal */}
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', justifyContent: 'space-between' }}>
              <div>
                {/* Header */}
                <div style={{ paddingTop: '24px', paddingBottom: '16px', textAlign: 'center' }}>
                  <h1 style={{
                    color: '#ff6b35',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '14px',
                    fontWeight: 'bold',
                    textTransform: 'uppercase',
                    letterSpacing: '0.2em',
                    margin: 0,
                    textShadow: '0 0 20px rgba(255, 107, 53, 0.5), 0 0 40px rgba(255, 107, 53, 0.3)'
                  }}>
                    RECIBO
                  </h1>
                </div>

                <div style={{ height: '1px', width: '100%', backgroundColor: '#2D2D2D', marginBottom: '16px' }} />

                {/* Info Alumno */}
                <div style={{ marginBottom: '16px' }}>
                  <p style={{
                    color: '#A0A0A0',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em',
                    margin: '0 0 4px 0'
                  }}>
                    ALUMNO
                  </p>
                  <p style={{
                    color: '#e5e2e1',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '18px',
                    fontWeight: 'bold',
                    margin: 0
                  }}>
                    {movimientoParaRecibo.cliente || '—'}
                  </p>
                </div>

                {/* Caja de Monto Total */}
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '8px 0 16px 0',
                  padding: '16px',
                  backgroundColor: '#121212',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  position: 'relative',
                  overflow: 'hidden'
                }}>
                  <p style={{
                    color: '#A0A0A0',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em',
                    margin: '0 0 4px 0',
                    zIndex: 10
                  }}>
                    TOTAL RECIBIDO
                  </p>
                  <div style={{ display: 'flex', alignItems: 'baseline', zIndex: 10 }}>
                    <span style={{ fontSize: '16px', color: '#ff6b35', fontWeight: 'bold', marginRight: '4px', fontFamily: '"Inter", sans-serif' }}>Bs</span>
                    <h2 style={{
                      color: '#ff6b35',
                      fontFamily: '"Inter", sans-serif',
                      fontSize: '40px',
                      fontWeight: '900',
                      margin: 0,
                      lineHeight: 1,
                      textShadow: '0 0 20px rgba(255, 107, 53, 0.5)'
                    }}>
                      {fmtMonto(movimientoParaRecibo.debe)}
                    </h2>
                  </div>
                </div>

                {/* Conceptos Amortizados */}
                <div style={{ marginTop: '16px' }}>
                  <p style={{
                    color: '#A0A0A0',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '10px',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em',
                    margin: '0 0 12px 0'
                  }}>
                    CONCEPTOS AMORTIZADOS
                  </p>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {movimientoParaRecibo.detalles_cxc && movimientoParaRecibo.detalles_cxc.length > 0 ? (
                      movimientoParaRecibo.detalles_cxc.map((det: any, idx: number) => {
                        let nombreConcepto = det.catalogo_items?.nombre || 'Concepto';
                        const nombreLower = nombreConcepto.toLowerCase();
                        
                        if (nombreLower.includes('mensualidad') && Array.isArray(det.periodo_meses) && det.periodo_meses.length > 0) {
                          nombreConcepto = `${nombreConcepto} - ${det.periodo_meses.join(', ')}`;
                        } else if (nombreLower.includes('torneo') && det.detalle_extra && det.detalle_extra.trim()) {
                          nombreConcepto = `${nombreConcepto} - ${det.detalle_extra.trim()}`;
                        }

                        const totalLinea = (det.cantidad || 1) * (det.precio_unitario || 0);
                        const tieneCiclo = nombreLower.includes('mensualidad') && movimientoParaRecibo.ciclo_inicio && movimientoParaRecibo.ciclo_fin;
                        const cicloFormateado = tieneCiclo ? formatCicloCompleto(movimientoParaRecibo.ciclo_inicio, movimientoParaRecibo.ciclo_fin) : null;

                        return (
                          <li key={idx} style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff6b35' }} />
                                <span style={{ color: '#e5e2e1', fontFamily: '"Inter", sans-serif', fontSize: '13px' }}>
                                  {nombreConcepto}
                                </span>
                              </div>
                              <span style={{ color: '#e5e2e1', fontFamily: '"Inter", sans-serif', fontSize: '13px', fontWeight: '500' }}>
                                {fmtMonto(totalLinea)}
                              </span>
                            </div>
                            {cicloFormateado && (
                              <div style={{ paddingLeft: '18px', color: '#ff6b35', opacity: 0.85, fontFamily: '"Inter", sans-serif', fontSize: '11px', fontStyle: 'italic' }}>
                                Ciclo: {cicloFormateado}
                              </div>
                            )}
                          </li>
                        );
                      })
                    ) : (
                      (() => {
                        const descLower = (movimientoParaRecibo.descripcion || '').toLowerCase();
                        const tieneCicloDesc = descLower.includes('mensualidad') && movimientoParaRecibo.ciclo_inicio && movimientoParaRecibo.ciclo_fin;
                        const cicloFormateadoDesc = tieneCicloDesc ? formatCicloCompleto(movimientoParaRecibo.ciclo_inicio, movimientoParaRecibo.ciclo_fin) : null;

                        return (
                          <li style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ff6b35' }} />
                                <span style={{ color: '#e5e2e1', fontFamily: '"Inter", sans-serif', fontSize: '13px' }}>
                                  {movimientoParaRecibo.descripcion || 'Cobro registrado'}
                                </span>
                              </div>
                              <span style={{ color: '#e5e2e1', fontFamily: '"Inter", sans-serif', fontSize: '13px', fontWeight: '500' }}>
                                {fmtMonto(movimientoParaRecibo.debe)}
                              </span>
                            </div>
                            {cicloFormateadoDesc && (
                              <div style={{ paddingLeft: '18px', color: '#ff6b35', opacity: 0.85, fontFamily: '"Inter", sans-serif', fontSize: '11px', fontStyle: 'italic' }}>
                                Ciclo: {cicloFormateadoDesc}
                              </div>
                            )}
                          </li>
                        );
                      })()
                    )}
                  </ul>
                </div>
              </div>

              {/* Footer y Datos de Pago */}
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
                {/* Datos de Pago */}
                <div style={{
                  borderTop: '1px dashed #2D2D2D',
                  paddingTop: '12px',
                  paddingBottom: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-end',
                  color: '#A0A0A0',
                  fontFamily: '"Inter", sans-serif',
                  fontSize: '10px'
                }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                    <span style={{ opacity: 0.6, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>FECHA DE PAGO</span>
                    <span style={{ color: '#e5e2e1', fontSize: '12px', fontWeight: '500' }}>
                      {formatFecha(movimientoParaRecibo.fecha)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'right' }}>
                    <span style={{ opacity: 0.6, fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>NRO TRANSACCIÓN</span>
                    <span style={{ color: '#e5e2e1', fontSize: '12px', fontFamily: 'monospace' }}>
                      #{movimientoParaRecibo.nro_transaccion ? movimientoParaRecibo.nro_transaccion.trim() : movimientoParaRecibo.id.substring(0, 8).toUpperCase()}
                    </span>
                  </div>
                </div>

                {/* Barra Negra de Footer (GENERADO POR SAASPORT) */}
                <div style={{
                  backgroundColor: '#000000',
                  margin: '0 -24px -24px -24px',
                  padding: '10px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  borderTop: '1px solid #222222'
                }}>
                  <img 
                    src="/favicon.ico" 
                    alt="Favicon" 
                    style={{ width: '12px', height: '12px', objectFit: 'contain' }}
                  />
                  <span style={{
                    color: '#64748B',
                    fontFamily: '"Inter", sans-serif',
                    fontSize: '9px',
                    fontWeight: 'bold',
                    letterSpacing: '0.15em',
                    textTransform: 'uppercase'
                  }}>
                    GENERADO POR SAASPORT
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
};

export default CajasBancos;
