/**
 * NotaServicios.tsx
 * Modal flotante para crear/editar una "Nota de Servicios" (cuenta por cobrar).
 * Versión simplificada sin campos contables.
 */
import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import type { LineaNota } from '../../types/cxc';
import { MESES_ANIO } from '../../types/cxc';
import {
  X, Plus, Trash2, FileText, Lock, DollarSign
} from 'lucide-react';
import {
  calcularPeriodoEstadistico,
  formatPeriodoEstadistico,
  getHoyISO,
  getHoraLocal,
  FECHA_MINIMA_MOVIMIENTO_FINANCIERO,
  validarFechaMovimientoFinanciero,
  diferenciaEnMeses,
} from '../../lib/dateUtils';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useConfiguracionFacturacion } from '../../hooks/useConfiguracionFacturacion';
import { esObservacionAnticipoAutomatica } from '../../lib/cxcUtils';

type CatalogoNota = Pick<
  CatalogoItem,
  'id' | 'nombre' | 'tipo' | 'precio_venta' | 'cuenta_ingreso_id' | 'tipo_movimiento'
>;

interface NotaServiciosProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  alumnoPreseleccionado?: { id: string; nombre: string } | null;
  esAnticipo?: boolean;
  cxcEditar?: any | null;
  modoInicial?: 'ver' | 'editar' | 'crear';
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const periodoMesLegacy = (periodo: string): string => {
  const [year, month] = periodo.split('-');
  const index = Number(month) - 1;
  return index >= 0 && index < MESES_ANIO.length ? `${MESES_ANIO[index]}-${year}` : '';
};

const finDeCicloMensual = (inicio: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inicio);
  if (!match) return '';

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const fechaValidacion = new Date(year, month - 1, day);
  if (
    month < 1 || month > 12
    || fechaValidacion.getFullYear() !== year
    || fechaValidacion.getMonth() !== month - 1
    || fechaValidacion.getDate() !== day
  ) return '';

  const primerDiaMesSiguiente = new Date(year, month, 1);
  const ultimoDiaMesSiguiente = new Date(year, month + 1, 0).getDate();
  const mismoDiaMesSiguiente = new Date(
    primerDiaMesSiguiente.getFullYear(),
    primerDiaMesSiguiente.getMonth(),
    Math.min(day, ultimoDiaMesSiguiente),
  );
  mismoDiaMesSiguiente.setDate(mismoDiaMesSiguiente.getDate() - 1);

  return `${mismoDiaMesSiguiente.getFullYear()}-${String(mismoDiaMesSiguiente.getMonth() + 1).padStart(2, '0')}-${String(mismoDiaMesSiguiente.getDate()).padStart(2, '0')}`;
};

const cicloCompletoDelMes = (fecha: string): { inicio: string; fin: string } | null => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(fecha);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;

  const inicio = `${match[1]}-${match[2]}-01`;
  return {
    inicio,
    fin: finDeCicloMensual(inicio),
  };
};

const diaSiguiente = (fecha: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!match) return '';
  const siguiente = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + 1);
  return `${siguiente.getFullYear()}-${String(siguiente.getMonth() + 1).padStart(2, '0')}-${String(siguiente.getDate()).padStart(2, '0')}`;
};

const lineaVacia = (): LineaNota => ({
  catalogo_item_id: '',
  nombre: '',
  tipo: 'servicio',
  cantidad: 1,
  precio_unitario: 0,
  periodo_meses: [],
  detalle_personalizado: '',
  subtotal: 0,
  cuenta_ingreso_id: null,
});

// Una mensualidad en Bs 0 registra el ciclo como atendido (p. ej. baja médica),
// pero no convierte otros conceptos sin importe en notas válidas.
const esLineaRegistrable = (linea: LineaNota): boolean => Boolean(linea.catalogo_item_id)
  && (linea.precio_unitario > 0
    || (linea.nombre === 'Mensualidad' && linea.precio_unitario === 0));

interface LineaNotaUI extends LineaNota {
  torneo_select_value?: string;
  resumen_asistencia?: string | null;
}

interface CalculoAsistenciaResult {
  estado: 'completo' | 'parcial' | 'sin_cobro' | 'sin_asistencia';
  registros: number;
  presentes: number;
  monto: number | null;
  mensualidad_base: number;
  porcentaje_parcial?: number;
}

const NotaServicios: React.FC<NotaServiciosProps> = ({
  visible, onCerrar, onCreada, alumnoPreseleccionado, cxcEditar, esAnticipo = false, modoInicial
}) => {
  const { perfil, escuelaId } = useAuthSaaSport();
  const configuracionFacturacion = useConfiguracionFacturacion(escuelaId, visible);
  const [alumnos, setAlumnos] = useState<{ id: string; nombres: string; apellidos: string; mensualidad?: number | null }[]>([]);
  const [catalogo, setCatalogo] = useState<CatalogoNota[]>([]);
  const [cajasBancos, setCajasBancos] = useState<{ id: string; nombre: string; saldo_actual: number }[]>([]);
  const [torneos, setTorneos] = useState<string[]>([]);

  const [alumnoId, setAlumnoId] = useState('');
  const [lineas, setLineas] = useState<LineaNotaUI[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState(getHoyISO());
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());
  const [calculandoAsistenciaIdx, setCalculandoAsistenciaIdx] = useState<number | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);

  const [pagarAlCrear, setPagarAlCrear] = useState(false);
  const [cuentaCobroId, setCuentaCobroId] = useState('');
  const [montoPago, setMontoPago] = useState('');
  const [cobroNroDoc, setCobroNroDoc] = useState('');
  const [fechaPago, setFechaPago] = useState(getHoyISO());
  const [horaPago, setHoraPago] = useState(getHoraLocal());
  const [montoAnticipo, setMontoAnticipo] = useState('');
  const [cuentaAnticipoId, setCuentaAnticipoId] = useState('');

  // Cobros existentes al editar una nota
  interface CobroExistente {
    id: string;
    monto_aplicado: number;
    monto_editado: number;
    fecha: string;
    fecha_editada: string;
    documento_referencia?: string;
    referencia_editada: string;
    caja_id?: string;
    conciliado: boolean;
    modificado: boolean;
  }
  const [cobrosExistentes, setCobrosExistentes] = useState<CobroExistente[]>([]);

  // Ref para detectar si el modal ya fue inicializado en esta apertura.
  // Evita que al navegar hacia otra pantalla y volver se reseteen los campos.
  const yaInicializado = useRef(false);
  // Bloquea reenvíos antes de que React alcance a deshabilitar el botón.
  const guardandoRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      // Al cerrar el modal, marcamos que la próxima apertura debe reinicializar.
      yaInicializado.current = false;
      return;
    }

    const cargar = async () => {
      if (!perfil || !escuelaId) return;

      const [resAlum, resCat, resCajas] = await Promise.all([
        supabase.from('alumnos').select('id, nombres, apellidos, mensualidad').eq('archivado', false).order('nombres'),
        supabase.from('catalogo_items').select('id, nombre, tipo, precio_venta, cuenta_ingreso_id, tipo_movimiento').eq('activo', true).or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos').order('nombre'),
        supabase.from('cajas_bancos').select('id, nombre, saldo_actual, es_predeterminada').eq('activo', true).eq('escuela_id', escuelaId).order('nombre'),
      ]);
      setAlumnos(resAlum.data ?? []);
      
      const catalogoData = resCat.data ?? [];
      const orderPriorities: Record<string, number> = {
        'Mensualidad': 1,
        'Inscripción a Torneos': 2,
        'Uniformes': 3
      };
      
      catalogoData.sort((a, b) => {
        const priorityA = orderPriorities[a.nombre] || 99;
        const priorityB = orderPriorities[b.nombre] || 99;
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        return a.nombre.localeCompare(b.nombre);
      });
      
      setCatalogo(catalogoData);
      
      const listaCajas = resCajas.data ?? [];
      setCajasBancos(listaCajas);
      // Preseleccionar caja predeterminada solo si no hay una ya seleccionada
      if (!cuentaCobroId) {
        const pred = (listaCajas as any[]).find((c: any) => c.es_predeterminada);
        if (pred) setCuentaCobroId(pred.id);
        else if (listaCajas.length > 0) setCuentaCobroId(listaCajas[0].id);
      }

      // Cargar torneos con fallback y autoseed
      try {
        const { data: dbTorneos, error: tErr } = await supabase
          .from('torneos')
          .select('nombre')
          .eq('escuela_id', escuelaId)
          .eq('activo', true)
          .order('nombre');

        if (tErr) {
          console.warn("No se pudo cargar torneos de la BD:", tErr.message);
          setTorneos([]);
        } else {
          setTorneos(dbTorneos.map((t: any) => t.nombre));
        }
      } catch (e) {
        console.error("Error al obtener torneos:", e);
        setTorneos([]);
      }
    };
    cargar();

    // Solo reinicializar los campos del formulario en la primera apertura del modal.
    // Si el usuario navega a otra pantalla y vuelve (visible sigue true),
    // no se borran los datos ya ingresados (preservación de estado de formulario).
    if (!yaInicializado.current) {
      yaInicializado.current = true;
      if (cxcEditar) {
        setAlumnoId(cxcEditar.alumno_id);
        // Normalizar periodo_meses de mensualidades para eliminar sufijos como "-2026"
        const lineasNormalizadas = (cxcEditar.lineas || []).map((l: any) => {
          if (l.nombre === 'Mensualidad' && Array.isArray(l.periodo_meses)) {
            const inicio = l.ciclo_inicio || cxcEditar.ciclo_inicio || cxcEditar.fecha_emision || getHoyISO();
            return {
              ...l,
              periodo_meses: l.periodo_meses,
              ciclo_inicio: inicio,
              ciclo_fin: l.ciclo_fin || cxcEditar.ciclo_fin || finDeCicloMensual(inicio),
              periodo_estadistico: l.periodo_estadistico || calcularPeriodoEstadistico(inicio),
            };
          }
          return l;
        });
        setLineas(lineasNormalizadas.length > 0 ? lineasNormalizadas : [lineaVacia()]);
        setObservaciones(
          cxcEditar.es_anticipo && esObservacionAnticipoAutomatica(cxcEditar.observaciones)
            ? ''
            : cxcEditar.observaciones || '',
        );
        setVencimiento(cxcEditar.fecha_vencimiento || cxcEditar.vencimiento || getHoyISO());
        setFechaEmision(cxcEditar.fecha_emision || getHoyISO());
        setPagarAlCrear(false);
        setCobrosExistentes([]);
        // Cargar cobros existentes y detalle de ítems de forma asíncrona siempre que estemos editando
        (async () => {
          const [{ data: cobros }, { data: periodoNota }, { data: detallesBD }] = await Promise.all([
            supabase
              .from('cobros_aplicados')
              .select('id, monto_aplicado, fecha, documento_referencia, caja_id, conciliado')
              .eq('cuenta_cobrar_id', cxcEditar.id)
              .order('fecha', { ascending: true }),
            supabase
              .from('cuentas_cobrar')
              .select('ciclo_inicio, ciclo_fin')
              .eq('id', cxcEditar.id)
              .maybeSingle(),
            supabase
              .from('cxc_detalle')
              .select('id, catalogo_item_id, cantidad, precio_unitario, periodo_meses, detalle_extra, subtotal, ciclo_inicio, ciclo_fin, periodo_estadistico, catalogo_items(id, nombre, tipo)')
              .eq('cuenta_cobrar_id', cxcEditar.id),
          ]);

          if (detallesBD && detallesBD.length > 0) {
            const lineasCargadas: LineaNotaUI[] = detallesBD.map((d: any) => {
              const itemNombre = d.catalogo_items?.nombre || '';
              let pMeses: string[] = [];
              if (Array.isArray(d.periodo_meses)) {
                pMeses = d.periodo_meses.map((m: string) => (m.includes('-') ? m.split('-')[0] : m));
              }
              const cant = Number(d.cantidad) || 1;
              const precio = Number(d.precio_unitario) || 0;
              return {
                catalogo_item_id: d.catalogo_item_id || '',
                nombre: itemNombre,
                tipo: d.catalogo_items?.tipo || 'servicio',
                cantidad: cant,
                precio_unitario: precio,
                periodo_meses: pMeses,
                ciclo_inicio: itemNombre === 'Mensualidad'
                  ? (d.ciclo_inicio || periodoNota?.ciclo_inicio || cxcEditar.fecha_emision || getHoyISO())
                  : undefined,
                ciclo_fin: itemNombre === 'Mensualidad'
                  ? (d.ciclo_fin || periodoNota?.ciclo_fin || finDeCicloMensual(d.ciclo_inicio || periodoNota?.ciclo_inicio || cxcEditar.fecha_emision || getHoyISO()))
                  : undefined,
                periodo_estadistico: itemNombre === 'Mensualidad'
                  ? (d.periodo_estadistico || calcularPeriodoEstadistico(d.ciclo_inicio || periodoNota?.ciclo_inicio || cxcEditar.fecha_emision || getHoyISO()))
                  : undefined,
                detalle_personalizado: d.detalle_extra || '',
                subtotal: Number(d.subtotal) || (cant * precio),
                cuenta_ingreso_id: null,
              };
            });
            setLineas(lineasCargadas);
          }

          if (cobros && cobros.length > 0) {
            setCobrosExistentes(cobros.map((c: any) => ({
              id: c.id,
              monto_aplicado: Number(c.monto_aplicado),
              monto_editado: Number(c.monto_aplicado),
              fecha: c.fecha,
              fecha_editada: c.fecha ? c.fecha.split('T')[0] : getHoyISO(),
              documento_referencia: c.documento_referencia || '',
              referencia_editada: c.documento_referencia || '',
              caja_id: c.caja_id || '',
              conciliado: c.conciliado || false,
              modificado: false,
            })));
          }
        })();
      } else {
        setAlumnoId(alumnoPreseleccionado?.id || '');
        setLineas([lineaVacia()]);
        setObservaciones('');
        setVencimiento(getHoyISO());
        setFechaPago(getHoyISO());
        setPagarAlCrear(esAnticipo);
        setMontoPago('');
        setCobroNroDoc('');
        setCobrosExistentes([]);
      }
      setError(null); setExito(null);
    }
  }, [visible, cxcEditar, alumnoPreseleccionado, esAnticipo, perfil, escuelaId]);

  const tieneMensualidad = useMemo(
    () => !esAnticipo && lineas.some(l => l.nombre === 'Mensualidad' && !!l.catalogo_item_id),
    [lineas, esAnticipo],
  );
  const total = useMemo(() => {
    if (esAnticipo) return parseFloat(montoAnticipo) || 0;
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas, esAnticipo, montoAnticipo]);

  useEffect(() => {
    if (esAnticipo) {
      setMontoPago(String(total));
      setPagarAlCrear(true);
    } else if (pagarAlCrear && !montoPago) {
      setMontoPago(String(total));
    }
  }, [pagarAlCrear, total, esAnticipo]);

  const calcularMontoPorAsistencia = async (idx: number) => {
    const linea = lineas[idx];
    const cicloInicio = linea?.ciclo_inicio || '';
    const cicloFin = linea?.ciclo_fin || '';
    if (!alumnoId || !cicloInicio || !cicloFin || cicloFin < cicloInicio) {
      setError('Selecciona un alumno y un ciclo válido antes de calcular.');
      return;
    }

    try {
      setCalculandoAsistenciaIdx(idx);
      setError(null);
      const { data, error: rpcError } = await supabase.rpc('rpc_calcular_mensualidad_alumno', {
        p_alumno_id: alumnoId,
        p_ciclo_inicio: cicloInicio,
        p_ciclo_fin: cicloFin,
      });
      if (rpcError) throw rpcError;

      const calculo = data as CalculoAsistenciaResult;
      if (calculo.estado === 'sin_asistencia' || calculo.monto === null) {
        setLineas(actuales => actuales.map((actual, actualIdx) => actualIdx === idx
          ? { ...actual, resumen_asistencia: 'Sin registros de asistencia: el alumno debe revisarse manualmente.' }
          : actual));
        return;
      }

      const resumen = `${calculo.presentes} presentes de ${calculo.registros} registros · ${calculo.estado === 'completo' ? '100%' : calculo.estado === 'parcial' ? `${calculo.porcentaje_parcial}%` : '0%'} · Bs ${fmtMonto(Number(calculo.monto))}`;
      setLineas(actuales => actuales.map((actual, actualIdx) => actualIdx === idx
        ? {
            ...actual,
            precio_unitario: Number(calculo.monto),
            cantidad: 1,
            subtotal: Number(calculo.monto),
            resumen_asistencia: resumen,
          }
        : actual));
    } catch (err: any) {
      setError(err.message || 'No se pudo calcular la mensualidad por asistencia.');
    } finally {
      setCalculandoAsistenciaIdx(null);
    }
  };

  const guardarNota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (guardandoRef.current) return;
    setError(null); setExito(null);
    if (esAnticipo) {
      if (!montoAnticipo || parseFloat(montoAnticipo) <= 0) { setError('Ingresa un monto válido.'); return; }
      if (!cuentaCobroId) { setError('Selecciona la caja de ingreso.'); return; }
    } else {
      const lineasValidas = lineas.filter(esLineaRegistrable);
      if (lineasValidas.length === 0) { setError('Agrega ítems válidos.'); return; }

      const periodosMensualidad = new Set<string>();
      for (const l of lineasValidas) {
        if (l.nombre === 'Mensualidad') {
          const periodo = calcularPeriodoEstadistico(l.ciclo_inicio || '');
          if (!l.ciclo_inicio || !l.ciclo_fin || l.ciclo_fin < l.ciclo_inicio || !periodo) {
            setError('Cada mensualidad debe tener un rango de ciclo válido.');
            return;
          }
          if (periodosMensualidad.has(periodo)) {
            setError(`Las mensualidades deben corresponder a ciclos distintos. El período ${formatPeriodoEstadistico(periodo)} está repetido.`);
            return;
          }
          periodosMensualidad.add(periodo);
        }
      }
    }

    // Validar que los montos editados de cobros existentes no excedan el total de la nota
    if (cxcEditar && cobrosExistentes.length > 0) {
      const totalCobrosEditados = cobrosExistentes.reduce((s, c) => s + c.monto_editado, 0);
      const nuevoPago = pagarAlCrear ? (parseFloat(montoPago) || 0) : 0;
      if ((totalCobrosEditados + nuevoPago) > total) {
        setError(`El total de los pagos (Bs ${fmtMonto(totalCobrosEditados + nuevoPago)}) excede el total de la nota (Bs ${fmtMonto(total)}).`);
        return;
      }
    }

    // Validar que la fecha del pago no sea menor a la de emisión de la nota de servicio
    if (pagarAlCrear) {
      const errorFechaPago = validarFechaMovimientoFinanciero(fechaPago);
      if (errorFechaPago) { setError(errorFechaPago); return; }
    }

    if (pagarAlCrear && fechaPago < fechaEmision) {
      setError('La fecha de pago no puede ser anterior a la fecha de emisión de la Nota de Servicio.');
      return;
    }

    // Validar fechas de cobros existentes
    if (cobrosExistentes.length > 0) {
      for (const cobro of cobrosExistentes) {
        const fCobro = cobro.fecha_editada;
        if (fechaEmision > fCobro) {
          setError(`La fecha de emisión de la Nota de Servicio no puede ser posterior a la fecha del pago registrado (Bs ${fmtMonto(cobro.monto_aplicado)} el ${fCobro}).`);
          return;
        }
        if (fCobro < fechaEmision) {
          setError(`La fecha del pago registrado (Bs ${fmtMonto(cobro.monto_editado || cobro.monto_aplicado)}) no puede ser anterior a la fecha de emisión de la Nota de Servicio (${fechaEmision}).`);
          return;
        }
      }
    }

    // El estado de React se actualiza de forma asíncrona; el ref evita que dos
    // clics rápidos ejecuten simultáneamente el reemplazo de los detalles.
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    try {
      if (!perfil) throw new Error('Sesión expirada.');
      const ctx = perfil;

      // 1. Guardar/Actualizar Nota
      let notaId = '';
      let detalleGuardadoEnRpc = false;
      const descripcionFinal = esAnticipo ? 'Anticipo' : lineas.filter(esLineaRegistrable).map(l => l.nombre).join(', ');
      const lineasValidasGuardar = lineas.filter(esLineaRegistrable);
      const mensualidadesGuardar = lineasValidasGuardar.filter(l => l.nombre === 'Mensualidad');
      const mensualidadUnica = mensualidadesGuardar.length === 1 ? mensualidadesGuardar[0] : null;
      const periodoMensualidadUnica = mensualidadUnica
        ? calcularPeriodoEstadistico(mensualidadUnica.ciclo_inicio || '')
        : '';

      if (cxcEditar?.id) {
        notaId = cxcEditar.id;

        // Recalcular el estado correcto en base a los cobros y el nuevo monto_total
        // Si hay cobros con montos editados, usar esos montos; de lo contrario, consultar la BD
        let totalCobrado = 0;
        if (cobrosExistentes.length > 0) {
          totalCobrado = cobrosExistentes.reduce((s, c) => s + c.monto_editado, 0);
        } else {
          const { data: cobrosDB } = await supabase
            .from('cobros_aplicados')
            .select('monto_aplicado')
            .eq('cuenta_cobrar_id', notaId);
          totalCobrado = (cobrosDB || []).reduce((s: number, c: any) => s + Number(c.monto_aplicado), 0);
        }
        // Sumar nuevo pago si se registra uno adicional
        if (pagarAlCrear) {
          totalCobrado += parseFloat(montoPago) || 0;
        }
        let nuevoEstado = 'pendiente';
        if (totalCobrado >= total) nuevoEstado = 'pagada';
        else if (totalCobrado > 0) nuevoEstado = 'parcial';

        const { error: errU } = await supabase.from('cuentas_cobrar').update({
          monto_total: total,
          descripcion: descripcionFinal,
          observaciones,
          fecha_emision: fechaEmision,
          fecha_vencimiento: vencimiento || null,
          estado: nuevoEstado,
          editado: true,
          editado_por: ctx.id,
          updated_at: new Date().toISOString(),
          periodo: periodoMensualidadUnica ? periodoMensualidadUnica.slice(0, 7) : null,
          periodo_estadistico: periodoMensualidadUnica || null,
          ciclo_inicio: mensualidadUnica?.ciclo_inicio || null,
          ciclo_fin: mensualidadUnica?.ciclo_fin || null,
          origen_facturacion: 'manual',
          ejecucion_facturacion_id: null,
        }).eq('id', notaId);
        if (errU) throw errU;

        // Reemplazar detalle previo. Nunca continuar si el borrado no fue
        // autorizado o falló: insertar después de un fallo genera duplicados.
        const { error: errEliminarDetalle } = await supabase
          .from('cxc_detalle')
          .delete()
          .eq('cuenta_cobrar_id', notaId)
          .eq('escuela_id', ctx.escuela_id);
        if (errEliminarDetalle) {
          throw new Error(`No se pudieron reemplazar los detalles de la nota: ${errEliminarDetalle.message}`);
        }
      } else if (tieneMensualidad) {
        const { data: nuevaId, error: errRpc } = await supabase.rpc('rpc_crear_nota_mensualidad', {
          p_alumno_id: alumnoId,
          p_sucursal_id: ctx.sucursal_id,
          p_monto_total: total,
          p_descripcion: descripcionFinal,
          p_observaciones: observaciones || null,
          p_fecha_emision: fechaEmision,
          p_fecha_vencimiento: vencimiento || null,
          p_ciclo_inicio: mensualidadesGuardar[0]?.ciclo_inicio,
          p_ciclo_fin: mensualidadesGuardar[0]?.ciclo_fin,
          p_lineas: lineasValidasGuardar.map(l => ({
            catalogo_item_id: l.catalogo_item_id,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
            detalle_extra: l.detalle_personalizado || null,
            ciclo_inicio: l.nombre === 'Mensualidad' ? l.ciclo_inicio : null,
            ciclo_fin: l.nombre === 'Mensualidad' ? l.ciclo_fin : null,
          })),
          p_nro_recibo: cobroNroDoc || null,
        });
        if (errRpc || !nuevaId) throw errRpc || new Error('No se pudo crear la mensualidad.');
        notaId = nuevaId as string;
        detalleGuardadoEnRpc = true;
      } else {
        const { data: nueva, error: errN } = await supabase.from('cuentas_cobrar').insert({
          escuela_id: ctx.escuela_id,
          sucursal_id: ctx.sucursal_id,
          alumno_id: alumnoId,
          monto_total: total,
          descripcion: descripcionFinal,
          observaciones,
          fecha_emision: fechaEmision,
          fecha_vencimiento: vencimiento || null,
          es_anticipo: esAnticipo,
          estado: 'pendiente',
          nro_recibo: cobroNroDoc || null,
          periodo: periodoMensualidadUnica ? periodoMensualidadUnica.slice(0, 7) : null,
          periodo_estadistico: periodoMensualidadUnica || null,
          ciclo_inicio: mensualidadUnica?.ciclo_inicio || null,
          ciclo_fin: mensualidadUnica?.ciclo_fin || null,
          origen_facturacion: 'manual',
        }).select('id').single();
        if (errN) throw errN;
        notaId = nueva.id;
      }

      // 2. Detalle
      if (esAnticipo) {
        let itemAnticipoId = '';
        const itemAnticipo = catalogo.find(c => c.nombre?.trim().toLowerCase() === 'anticipo');
        if (!itemAnticipo) {
          const { data: nuevoItem, error: errC } = await supabase.from('catalogo_items').insert({
            escuela_id: ctx.escuela_id,
            nombre: 'Anticipo',
            tipo: 'servicio',
            categoria: 'servicio',
            tipo_movimiento: 'ingreso',
            precio_venta: 0,
            activo: true,
            es_ingreso: true,
            es_gasto: false
          }).select('id').single();
          if (errC || !nuevoItem) throw new Error('Error al inicializar el concepto "Anticipo" en el catálogo.');
          itemAnticipoId = nuevoItem.id;
        } else {
          itemAnticipoId = itemAnticipo.id;
        }

        const { error: errDetalleAnticipo } = await supabase.from('cxc_detalle').insert({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaId,
          catalogo_item_id: itemAnticipoId,
          cantidad: 1,
          precio_unitario: total,
          detalle_extra: 'Anticipo'
        });
        if (errDetalleAnticipo) throw errDetalleAnticipo;
      } else if (!detalleGuardadoEnRpc) {
        const { error: errInsertarDetalles } = await supabase.from('cxc_detalle').insert(lineasValidasGuardar.map(l => ({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaId,
          catalogo_item_id: l.catalogo_item_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
          detalle_extra: l.detalle_personalizado,
          ciclo_inicio: l.nombre === 'Mensualidad' ? l.ciclo_inicio : null,
          ciclo_fin: l.nombre === 'Mensualidad' ? l.ciclo_fin : null,
          periodo_estadistico: l.nombre === 'Mensualidad'
            ? calcularPeriodoEstadistico(l.ciclo_inicio || '')
            : null,
        })));
        if (errInsertarDetalles) throw errInsertarDetalles;
      }

      // 3. Actualizar cobros existentes modificados (solo en edición)
      if (cxcEditar?.id && cobrosExistentes.length > 0) {
        for (const cobro of cobrosExistentes.filter(c => c.modificado && !c.conciliado)) {
          const errorFechaCobro = validarFechaMovimientoFinanciero(cobro.fecha_editada);
          if (errorFechaCobro) throw new Error(errorFechaCobro);
          const horaOriginal = cobro.fecha.includes('T') ? cobro.fecha.split('T')[1] : '12:00:00';
          const { data: rpcData, error: rpcEditErr } = await supabase.rpc('rpc_editar_movimiento_simple', {
            p_payload: {
              movimiento_id: cobro.id,
              tipo_origen: 'cobro',
              cuenta_id: cobro.caja_id || null,
              monto: cobro.monto_editado,
              fecha: `${cobro.fecha_editada}T${horaOriginal}`,
              descripcion: descripcionFinal,
              nro_transaccion: cobro.referencia_editada || null,
            }
          });
          if (rpcEditErr) throw new Error(`Error al actualizar cobro: ${rpcEditErr.message}`);
          if (rpcData && rpcData.success === false) throw new Error(rpcData.message || 'Error al actualizar cobro');
        }
      }

      // 4. Pago (Solo si es nueva nota o si explícitamente se pidió pagar algo adicional)
      if (pagarAlCrear || esAnticipo) {
        const mp = esAnticipo ? parseFloat(montoAnticipo) : parseFloat(montoPago);
        if (mp > 0 && cuentaCobroId) {
          const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
            p_payload: {
              cuenta_cobrar_id: notaId,
              escuela_id: ctx.escuela_id,
              sucursal_id: ctx.sucursal_id,
              usuario_id: ctx.id,
              monto: mp,
              cuenta_cobro_id: cuentaCobroId,
              nro_comprobante: cobroNroDoc || null,
              fecha: `${fechaPago}T${horaPago}:00`
            }
          });

          if (rpcErr) throw rpcErr;
        }
      }

      setExito(`✅ ${cxcEditar ? 'Cambios guardados' : 'Registrado'} correctamente.`);
      
      // LOG DE ACTIVIDAD
      try {
        const { logActivity } = await import('../../lib/auditLogger');
        const alumnoNombre = alumnos.find(a => a.id === alumnoId);
        logActivity({
          escuela_id: ctx.escuela_id,
          usuario_id: ctx.id,
          usuario_nombre: `${ctx.nombres} ${ctx.apellidos}`,
          accion: cxcEditar ? 'Nota Actualizada' : (esAnticipo ? 'Anticipo Registrado' : 'Nueva Nota'),
          modulo: 'Finanzas',
          entidad_id: notaId,
          detalle: {
            alumno: alumnoNombre ? `${alumnoNombre.nombres} ${alumnoNombre.apellidos}` : 'N/A',
            monto: total,
            descripcion: `${cxcEditar ? 'Factura Actualizada' : (esAnticipo ? 'Anticipo' : 'Factura')} por Bs ${total} para ${alumnoNombre ? alumnoNombre.nombres : 'alumno'}.`
          }
        });
      } catch (e) { console.error(e); }

      onCreada();
      setTimeout(() => { onCerrar(); }, 600);
    } catch (err: any) {
      setError(err.code === '23505'
        ? 'Ya existe una mensualidad activa para este alumno y periodo estadístico.'
        : `Error: ${err.message}`);
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
          <h2><FileText size={20} style={{ marginRight: '0.5rem' }} /> {esAnticipo ? 'Cobro Anticipado' : (cxcEditar ? 'Editar Nota de Servicio' : 'Nueva Nota de Servicio')}</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <form onSubmit={guardarNota}>
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
              <div className="form-campo full-width">
                <label>Alumno / Deportista *</label>
                <select 
                  value={alumnoId} 
                  onChange={e => {
                    const newAlumnoId = e.target.value;
                    setAlumnoId(newAlumnoId);
                    
                    // Sincronizar el precio de la mensualidad si cambia el alumno
                    const alum = alumnos.find(a => a.id === newAlumnoId);
                    if (alum) {
                      const nuevasLineas = lineas.map(l => {
                        if (l.nombre === 'Mensualidad') {
                          // Si el alumno tiene una mensualidad configurada, la usamos
                          const precio = alum.mensualidad !== null && alum.mensualidad !== undefined
                            ? Number(alum.mensualidad)
                            : l.precio_unitario;
                          return {
                            ...l,
                            precio_unitario: precio,
                            subtotal: precio * l.cantidad
                          };
                        }
                        return l;
                      });
                      setLineas(nuevasLineas);
                    }
                  }} 
                  disabled={guardando || !!cxcEditar} 
                  required
                >
                  <option value="">— Seleccionar —</option>
                  {alumnos.map(a => <option key={a.id} value={a.id}>{a.nombres} {a.apellidos}</option>)}
                </select>
              </div>
              <div className="form-campo">
                <label>Fecha Emisión</label>
                <input 
                  type="date" 
                  value={fechaEmision} 
                  onChange={e => {
                    const f = e.target.value;
                    setFechaEmision(f);
                    setVencimiento(f);
                    if (tieneMensualidad) {
                      const ciclo = cicloCompletoDelMes(f);
                      if (ciclo) {
                        let siguienteInicio = ciclo.inicio;
                        setLineas(actuales => actuales.map(lineaActual => {
                          if (lineaActual.nombre !== 'Mensualidad') return lineaActual;
                          const siguienteFin = finDeCicloMensual(siguienteInicio);
                          const siguientePeriodo = calcularPeriodoEstadistico(siguienteInicio);
                          const siguienteMes = periodoMesLegacy(siguientePeriodo);
                          const actualizada = {
                            ...lineaActual,
                            ciclo_inicio: siguienteInicio,
                            ciclo_fin: siguienteFin,
                            periodo_estadistico: siguientePeriodo,
                            periodo_meses: siguienteMes ? [siguienteMes] : [],
                            resumen_asistencia: null,
                          };
                          siguienteInicio = diaSiguiente(siguienteFin);
                          return actualizada;
                        }));
                      }
                    }
                  }}
                  required 
                />
              </div>
              {!esAnticipo && (
                <div className="form-campo">
                  <label>Vencimiento</label>
                  <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
                </div>
              )}
            </div>

            {!esAnticipo ? (
              <div style={{ marginBottom: '1.5rem' }}>
                {lineas.map((linea, idx) => {
                  const esMensualidad = linea.nombre === 'Mensualidad';
                  const esTorneo = linea.nombre === 'Inscripción a Torneos';

                  return (
                    <div key={idx} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                        <select value={linea.catalogo_item_id} onChange={async e => {
                          const itemId = e.target.value;
                          const it = catalogo.find(c => c.id === itemId);
                          if (it) {
                            const nuevas = [...lineas];
                            const esMensualidad = it.nombre === 'Mensualidad';
                            const cantidadInicial = esMensualidad ? 1 : nuevas[idx].cantidad;
                            const ciclosExistentes = nuevas
                              .filter((lineaExistente, lineaIdx) => lineaIdx !== idx
                                && lineaExistente.nombre === 'Mensualidad'
                                && lineaExistente.ciclo_inicio)
                              .sort((a, b) => String(a.ciclo_inicio).localeCompare(String(b.ciclo_inicio)));
                            const ultimoCicloEnNota = ciclosExistentes.at(-1);

                            let inicioPredeterminado: string;

                            if (ultimoCicloEnNota?.ciclo_fin) {
                              inicioPredeterminado = diaSiguiente(ultimoCicloEnNota.ciclo_fin);
                            } else if (esMensualidad && alumnoId) {
                              const hoy = getHoyISO();
                              
                              const [resDetalle, resCuenta] = await Promise.all([
                                supabase
                                  .from('cxc_detalle')
                                  .select('ciclo_fin, cuentas_cobrar!inner(alumno_id, anulada)')
                                  .eq('cuentas_cobrar.alumno_id', alumnoId)
                                  .eq('cuentas_cobrar.anulada', false)
                                  .not('ciclo_fin', 'is', null)
                                  .order('ciclo_fin', { ascending: false })
                                  .limit(1)
                                  .maybeSingle(),
                                supabase
                                  .from('cuentas_cobrar')
                                  .select('ciclo_fin')
                                  .eq('alumno_id', alumnoId)
                                  .eq('anulada', false)
                                  .not('ciclo_fin', 'is', null)
                                  .order('ciclo_fin', { ascending: false })
                                  .limit(1)
                                  .maybeSingle(),
                              ]);

                              const ultimoDetalle = resDetalle.data;
                              const ultimaCuenta = resCuenta.data;

                              let ultimoFinBD: string | null = null;
                              if (ultimoDetalle?.ciclo_fin && ultimaCuenta?.ciclo_fin) {
                                ultimoFinBD = ultimoDetalle.ciclo_fin > ultimaCuenta.ciclo_fin ? ultimoDetalle.ciclo_fin : ultimaCuenta.ciclo_fin;
                              } else {
                                ultimoFinBD = ultimoDetalle?.ciclo_fin || ultimaCuenta?.ciclo_fin || null;
                              }

                              if (ultimoFinBD && diferenciaEnMeses(ultimoFinBD, hoy) <= 3) {
                                inicioPredeterminado = diaSiguiente(ultimoFinBD);
                              } else {
                                const cicloMesActual = cicloCompletoDelMes(hoy);
                                inicioPredeterminado = cicloMesActual?.inicio || hoy;
                              }
                            } else {
                              const cicloMesActual = cicloCompletoDelMes(getHoyISO());
                              inicioPredeterminado = cicloMesActual?.inicio || getHoyISO();
                            }

                            const finPredeterminado = finDeCicloMensual(inicioPredeterminado);
                            const periodoPredeterminado = calcularPeriodoEstadistico(inicioPredeterminado);
                            const mesPredeterminado = periodoMesLegacy(periodoPredeterminado);

                            // Precargar mensualidad del alumno si el concepto es 'Mensualidad'
                            let precioUnitario = Number(it.precio_venta) || 0;
                            if (esMensualidad && alumnoId) {
                              const alum = alumnos.find(a => a.id === alumnoId);
                              if (alum && alum.mensualidad !== null && alum.mensualidad !== undefined) {
                                precioUnitario = Number(alum.mensualidad);
                              }
                            }

                            nuevas[idx] = {
                              ...nuevas[idx], 
                              catalogo_item_id: it.id, 
                              nombre: it.nombre, 
                              precio_unitario: precioUnitario, 
                              cantidad: cantidadInicial,
                              subtotal: precioUnitario * cantidadInicial,
                              periodo_meses: esMensualidad && mesPredeterminado ? [mesPredeterminado] : [],
                              ciclo_inicio: esMensualidad ? inicioPredeterminado : undefined,
                              ciclo_fin: esMensualidad ? finPredeterminado : undefined,
                              periodo_estadistico: esMensualidad ? periodoPredeterminado : undefined,
                              resumen_asistencia: null,
                              detalle_personalizado: ''
                            };
                            setLineas(nuevas);
                          }
                        }} required disabled={guardando}>
                          <option value="">— Seleccionar Ítem —</option>
                          {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                        <input type="number" value={linea.cantidad} onChange={e => {
                          const cant = parseInt(e.target.value) || 1;
                          const nuevas = [...lineas];
                          nuevas[idx] = { ...nuevas[idx], cantidad: cant, subtotal: cant * nuevas[idx].precio_unitario };
                          setLineas(nuevas);
                        }} min="1" disabled={guardando || esMensualidad} title="Cantidad" />
                        <input type="number" step="0.01" value={linea.precio_unitario} onChange={e => {
                          const prec = parseFloat(e.target.value) || 0;
                          const nuevas = [...lineas];
                          nuevas[idx] = { ...nuevas[idx], precio_unitario: prec, subtotal: prec * nuevas[idx].cantidad };
                          setLineas(nuevas);
                        }} disabled={guardando} title="Precio Unitario" />
                        <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>Bs {fmtMonto(linea.subtotal)}</div>
                        <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                      </div>

                      {esMensualidad && (
                        <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                          <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Ciclo y periodo estadístico</p>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: '0.65rem', marginBottom: '0.75rem' }}>
                            <div className="form-campo">
                              <label>Inicio del ciclo</label>
                              <input
                                 type="date"
                                 value={linea.ciclo_inicio || ''}
                                 onChange={e => {
                                   const nuevoInicio = e.target.value;
                                   const nuevoFin = finDeCicloMensual(nuevoInicio);
                                   const nuevoPeriodo = calcularPeriodoEstadistico(nuevoInicio);
                                   const nuevoMes = periodoMesLegacy(nuevoPeriodo);
                                   const nuevas = [...lineas];
                                   nuevas[idx] = {
                                     ...nuevas[idx],
                                     ciclo_inicio: nuevoInicio,
                                     ciclo_fin: nuevoFin || nuevas[idx].ciclo_fin,
                                     periodo_estadistico: nuevoPeriodo,
                                     periodo_meses: nuevoMes ? [nuevoMes] : [],
                                     resumen_asistencia: null,
                                   };
                                   setLineas(nuevas);
                                 }}
                                disabled={guardando}
                                required
                              />
                            </div>
                            <div className="form-campo">
                              <label>Fin del ciclo</label>
                              <input
                                type="date"
                                 value={linea.ciclo_fin || ''}
                                 min={linea.ciclo_inicio}
                                 onChange={e => {
                                   const nuevoFin = e.target.value;
                                   if (!nuevoFin || !linea.ciclo_inicio || nuevoFin >= linea.ciclo_inicio) {
                                     const nuevas = [...lineas];
                                     nuevas[idx] = { ...nuevas[idx], ciclo_fin: nuevoFin, resumen_asistencia: null };
                                     setLineas(nuevas);
                                   }
                                 }}
                                disabled={guardando}
                                required
                              />
                            </div>
                            <div className="form-campo">
                              <label>Mes estadístico</label>
                              <input
                                type="text"
                                value={formatPeriodoEstadistico(calcularPeriodoEstadistico(linea.ciclo_inicio || ''))}
                                readOnly
                                aria-readonly="true"
                                style={{ cursor: 'not-allowed', opacity: 0.85 }}
                              />
                            </div>
                          </div>
                          {configuracionFacturacion.data && (
                            <p style={{ margin: '0 0 0.75rem', color: 'var(--text-tertiary)', fontSize: '0.72rem' }}>
                              Plan de la escuela: {configuracionFacturacion.data.plan_momento_emision} · {configuracionFacturacion.data.plan_calculo_monto}
                            </p>
                          )}
                          {configuracionFacturacion.data?.plan_calculo_monto === 'asistencia' && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                              <button
                                type="button"
                                className="btn-volver"
                                onClick={() => calcularMontoPorAsistencia(idx)}
                                disabled={guardando || calculandoAsistenciaIdx !== null || !alumnoId}
                                style={{ height: '34px', padding: '0 0.85rem', fontSize: '0.75rem' }}
                              >
                                {calculandoAsistenciaIdx === idx ? 'Calculando...' : 'Calcular por asistencia'}
                              </button>
                              {linea.resumen_asistencia && (
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                                  {linea.resumen_asistencia}
                                </span>
                              )}
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                            <div style={{ flex: 1 }}>
                              <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>PERIODO ESPECÍFICO / DETALLE</label>
                              <input 
                                type="text" 
                                value={linea.detalle_personalizado} 
                                onChange={e => {
                                  const nuevas = [...lineas];
                                  nuevas[idx].detalle_personalizado = e.target.value;
                                  setLineas(nuevas);
                                }}
                                placeholder="Ej: Curso de Verano, Enero-Febrero, etc."
                                style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                              />
                            </div>
                          </div>
                        </div>
                      )}

                      {esTorneo && (() => {
                        const selectVal = linea.torneo_select_value !== undefined
                          ? linea.torneo_select_value
                          : (linea.detalle_personalizado
                              ? (torneos.includes(linea.detalle_personalizado) ? linea.detalle_personalizado : 'Otro')
                              : '');

                        return (
                          <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: selectVal === 'Otro' ? '1fr 1fr' : '1fr', gap: '1rem' }}>
                              <div>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>SELECCIONAR TORNEO</label>
                                <select 
                                  value={selectVal}
                                  onChange={e => {
                                    const val = e.target.value;
                                    const nuevas = [...lineas];
                                    nuevas[idx] = {
                                      ...nuevas[idx],
                                      torneo_select_value: val,
                                      detalle_personalizado: val === 'Otro'
                                        ? (nuevas[idx].detalle_personalizado && !torneos.includes(nuevas[idx].detalle_personalizado)
                                            ? nuevas[idx].detalle_personalizado
                                            : '')
                                        : val
                                    };
                                    setLineas(nuevas);
                                  }}
                                  style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                                >
                                  <option value="">— Seleccionar —</option>
                                  {torneos.map(t => <option key={t} value={t}>{t}</option>)}
                                  <option value="Otro">Otro</option>
                                </select>
                              </div>
                              {selectVal === 'Otro' && (
                                <div>
                                  <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>NOMBRE DEL TORNEO</label>
                                  <input 
                                    type="text" 
                                    value={linea.detalle_personalizado || ''} 
                                    onChange={e => {
                                      const nuevas = [...lineas];
                                      nuevas[idx] = { ...nuevas[idx], detalle_personalizado: e.target.value };
                                      setLineas(nuevas);
                                    }}
                                    placeholder="Escriba el torneo..."
                                    style={{ width: '100%', padding: '0.4rem', fontSize: '0.8rem', background: 'rgba(0,0,0,0.2)' }}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
                <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.3rem' }}><Plus size={14} /> Agregar otro ítem</button>
              </div>
            ) : null}

            {/* El selector de cuenta/concepto de anticipo fue removido por políticas contables simplificadas */}

            {/* Observaciones generales */}
            <div className="form-campo full-width" style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.3rem' }}>
                📝 Observaciones Generales
              </label>
              <textarea
                value={observaciones}
                onChange={e => setObservaciones(e.target.value)}
                placeholder="Notas internas, aclaraciones, condiciones especiales..."
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

              {/* Cobros existentes (solo en modo edición) */}
              {cxcEditar && cobrosExistentes.length > 0 && (
                <div style={{ marginBottom: '1rem' }}>
                  <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.75rem', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <DollarSign size={14} /> Pagos Registrados
                  </p>
                  {cobrosExistentes.map((cobro, idx) => (
                    <div key={cobro.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.75rem',
                      padding: '0.6rem 0.75rem', marginBottom: '0.5rem',
                      background: cobro.conciliado ? 'rgba(100,100,100,0.1)' : 'rgba(74,222,128,0.05)',
                      borderRadius: '8px',
                      border: `1px solid ${cobro.conciliado ? 'rgba(100,100,100,0.2)' : 'rgba(74,222,128,0.15)'}`,
                    }}>
                      {cobro.conciliado ? (
                        /* Pago conciliado: solo lectura */
                        <>
                          <Lock size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: '0.85rem', color: '#94a3b8' }}>
                            Bs {fmtMonto(cobro.monto_aplicado)}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#94a3b8', marginRight: '0.5rem' }}>
                            ({cobro.fecha ? cobro.fecha.split('T')[0] : ''})
                          </span>
                          <span style={{
                            fontSize: '0.7rem', padding: '0.15rem 0.5rem',
                            background: 'rgba(148,163,184,0.15)', borderRadius: '4px',
                            color: '#94a3b8', fontWeight: 600
                          }}>
                            🔒 Conciliado
                          </span>
                        </>
                      ) : (
                        /* Pago no conciliado: monto, fecha y referencia editables */
                        <>
                          <DollarSign size={14} style={{ color: '#4ade80', flexShrink: 0 }} />
                          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1.6fr auto', gap: '0.5rem', alignItems: 'flex-end' }}>
                            <div>
                              <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                                Monto (Bs)
                              </label>
                              <input
                                type="number" step="0.01" min="0.01"
                                value={cobro.monto_editado}
                                onChange={e => {
                                  const val = parseFloat(e.target.value) || 0;
                                  const nuevos = [...cobrosExistentes];
                                  const mod = val !== cobro.monto_aplicado || cobro.fecha_editada !== cobro.fecha.split('T')[0] || cobro.referencia_editada !== (cobro.documento_referencia || '');
                                  nuevos[idx] = { ...nuevos[idx], monto_editado: val, modificado: mod };
                                  setCobrosExistentes(nuevos);
                                }}
                                disabled={guardando}
                                style={{ width: '100%', fontWeight: 700 }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                                Fecha Pago
                              </label>
                              <input
                                type="date"
                                value={cobro.fecha_editada}
                                min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO}
                                onChange={e => {
                                  const val = e.target.value;
                                  const nuevos = [...cobrosExistentes];
                                  const mod = cobro.monto_editado !== cobro.monto_aplicado || val !== cobro.fecha.split('T')[0] || cobro.referencia_editada !== (cobro.documento_referencia || '');
                                  nuevos[idx] = { ...nuevos[idx], fecha_editada: val, modificado: mod };
                                  setCobrosExistentes(nuevos);
                                }}
                                disabled={guardando}
                                style={{ width: '100%', fontSize: '0.8rem' }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: '0.7rem', color: '#94a3b8', display: 'block', marginBottom: '0.2rem', textTransform: 'uppercase' }}>
                                Referencia / Trans.
                              </label>
                              <input
                                type="text"
                                value={cobro.referencia_editada}
                                onChange={e => {
                                  const val = e.target.value;
                                  const nuevos = [...cobrosExistentes];
                                  const mod = cobro.monto_editado !== cobro.monto_aplicado || cobro.fecha_editada !== cobro.fecha.split('T')[0] || val !== (cobro.documento_referencia || '');
                                  nuevos[idx] = { ...nuevos[idx], referencia_editada: val, modificado: mod };
                                  setCobrosExistentes(nuevos);
                                }}
                                disabled={guardando}
                                style={{ width: '100%', fontSize: '0.8rem' }}
                                placeholder="Ej: Transf..."
                              />
                            </div>
                            <div style={{ paddingBottom: '0.25rem' }}>
                              {cobro.modificado && (
                                <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, whiteSpace: 'nowrap' }} title="Modificado">
                                  ✏️
                                </span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Checkbox para nuevo pago (solo al crear) */}
              {!cxcEditar && (
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', marginBottom: pagarAlCrear ? '1rem' : 0 }}>
                  <input 
                    type="checkbox" 
                    checked={pagarAlCrear} 
                    onChange={e => {
                      const val = e.target.checked;
                      setPagarAlCrear(val);
                      if (val) setFechaPago(getHoyISO());
                    }} 
                    disabled={esAnticipo} 
                  />
                  <span style={{ fontWeight: 700 }}>
                    {esAnticipo ? 'Registro de Ingreso de Dinero' : '¿Registrar pago ahora?'}
                  </span>
                </label>
              )}

              {pagarAlCrear && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
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
                    <label>Caja/Banco</label>
                    <select value={cuentaCobroId} onChange={e => setCuentaCobroId(e.target.value)} required>
                      <option value="">— Seleccionar —</option>
                      {cajasBancos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                    </select>
                  </div>
                  <div className="form-campo">
                    <label>Referencia / Nro. Transacción</label>
                    <input 
                      type="text" 
                      value={cobroNroDoc} 
                      onChange={e => setCobroNroDoc(e.target.value)} 
                      placeholder="Ej: Transf-123, Recibo-456..." 
                    />
                  </div>
                  <div className="form-campo">
                    <label>Fecha de Pago</label>
                    <input type="date" value={fechaPago} min={FECHA_MINIMA_MOVIMIENTO_FINANCIERO} onChange={e => setFechaPago(e.target.value)} required />
                  </div>
                </div>
              )}
            </div>

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.5rem', fontWeight: 800 }}>Total: Bs {fmtMonto(total)}</div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem' }}>{guardando ? '...' : (cxcEditar ? 'Guardar Cambios' : 'Confirmar')}</button>
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

export default NotaServicios;
