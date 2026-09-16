import React, { useEffect, useState, useMemo, useRef } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import type { LineaNota, AlumnoDeuda } from '../../types/cxc';
import {
  X, Plus, Trash2, Users, CheckCircle2, AlertCircle, RefreshCw,
} from 'lucide-react';
import {
  calcularPeriodoEstadistico,
  formatPeriodoEstadistico,
  getHoyISO,
} from '../../lib/dateUtils';
import { obtenerSaldosPorSucursal, validarAperturaInventario } from '../../lib/inventario';
import {
  esRespuestaIncierta,
  guardarOperacionIncierta,
  obtenerOperacionIncierta,
  removerOperacionIncierta,
  resolverOperacionIncierta,
} from '../../lib/idempotenciaNotas';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useSucursales } from '../../hooks/useMasterData';

interface ModalNotaMasivaProps {
  visible: boolean;
  onCerrar: () => void;
  onActualizar?: () => void;
  onCreada?: () => void;
  alumnosSeleccionados: AlumnoDeuda[];
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- helpers de ciclo (idénticos a NotaServicios) ----------
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
  const ultimoDiaMesSiguiente = new Date(year, month + 1, 0).getDate();
  const mismoDiaMesSiguiente = new Date(
    year, month, Math.min(day, ultimoDiaMesSiguiente),
  );
  mismoDiaMesSiguiente.setDate(mismoDiaMesSiguiente.getDate() - 1);
  return `${mismoDiaMesSiguiente.getFullYear()}-${String(mismoDiaMesSiguiente.getMonth() + 1).padStart(2, '0')}-${String(mismoDiaMesSiguiente.getDate()).padStart(2, '0')}`;
};

const cicloCompletoDelMes = (fecha: string): { inicio: string; fin: string } | null => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(fecha);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const inicio = `${match[1]}-${match[2]}-01`;
  return { inicio, fin: finDeCicloMensual(inicio) };
};
// ----------------------------------------------------------------

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

interface LineaNotaUI extends LineaNota {
  torneo_select_value?: string;
}

const esLineaMensualidad = (linea: Pick<LineaNota, 'nombre'>): boolean =>
  linea.nombre.toLowerCase().includes('mensualidad');

interface OperacionSnapshot {
  operacionId: string;
  payloadOriginal: any;
}

interface AlumnoFallo {
  alumno_id: string;
  nombres: string;
  apellidos: string;
  error: string;
}

const esProductoItem = (it?: CatalogoItem | null): boolean => {
  if (!it) return false;
  return it.categoria === 'producto';
};

const ModalNotaMasiva: React.FC<ModalNotaMasivaProps> = ({
  visible, onCerrar, onActualizar, onCreada, alumnosSeleccionados
}) => {
  const { perfil, escuelaId } = useAuthSaaSport();
  const { data: sucursales = [] } = useSucursales();
  const [sucursalId, setSucursalId] = useState('');
  const [saldosInventario, setSaldosInventario] = useState<Map<string, number>>(new Map());

  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [torneos, setTorneos] = useState<string[]>([]);

  useEffect(() => {
    if (!sucursalId && perfil?.rol !== 'SuperAdministrador' && perfil?.sucursal_id) {
      setSucursalId(perfil.sucursal_id);
    }
  }, [perfil, sucursalId]);

  useEffect(() => {
    const escId = escuelaId || perfil?.escuela_id;
    if (visible && escId && sucursalId) {
      obtenerSaldosPorSucursal(escId, sucursalId)
        .then(setSaldosInventario)
        .catch(console.error);
    } else if (!sucursalId) {
      setSaldosInventario(new Map());
    }
  }, [visible, escuelaId, perfil, sucursalId]);

  const [lineas, setLineas] = useState<LineaNotaUI[]>([lineaVacia()]);
  const [observaciones, setObservaciones] = useState('');
  const [vencimiento, setVencimiento] = useState(getHoyISO());
  const [fechaEmision, setFechaEmision] = useState(getHoyISO());

  // Ciclo (nuevo sistema de facturación)
  const [cicloInicio, setCicloInicio] = useState(getHoyISO());
  const [cicloFin, setCicloFin] = useState(getHoyISO());

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<number>(0);

  const [alumnosPendientes, setAlumnosPendientes] = useState<AlumnoDeuda[]>([]);
  const [fallidos, setFallidos] = useState<AlumnoFallo[]>([]);
  const [completados, setCompletados] = useState<AlumnoDeuda[]>([]);

  const operacionSnapshotsRef = useRef<Map<string, OperacionSnapshot>>(new Map());
  const guardandoRef = useRef(false);
  const visibleAnteriorRef = useRef(false);

  // ¿Alguna línea es Mensualidad?
  const tieneMensualidad = useMemo(
    () => lineas.some(l => l.catalogo_item_id && esLineaMensualidad(l)),
    [lineas],
  );

  // Período estadístico calculado automáticamente (igual que NotaServicios)
  const periodoEstadistico = useMemo(
    () => calcularPeriodoEstadistico(cicloInicio),
    [cicloInicio],
  );

  const cargarCatalogoYTorneos = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    if (!usr) return;

    const { data: resCat } = await supabase
      .from('catalogo_items')
      .select('*')
      .eq('activo', true)
      .or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos')
      .order('nombre');

    const catalogoData = resCat ?? [];
    const orderPriorities: Record<string, number> = {
      'Mensualidad': 1,
      'Inscripción a Torneos': 2,
      'Uniformes': 3,
    };
    catalogoData.sort((a: any, b: any) => {
      const pA = orderPriorities[a.nombre] || 99;
      const pB = orderPriorities[b.nombre] || 99;
      return pA !== pB ? pA - pB : a.nombre.localeCompare(b.nombre);
    });
    setCatalogo(catalogoData);

    try {
      const { data: dbTorneos, error: tErr } = await supabase
        .from('torneos')
        .select('nombre')
        .eq('escuela_id', usr.escuela_id)
        .eq('activo', true)
        .order('nombre');

      if (tErr) {
        console.warn('No se pudo cargar torneos de la BD:', tErr.message);
        setTorneos([]);
      } else {
        setTorneos(dbTorneos.map((t: any) => t.nombre));
      }
    } catch (e) {
      console.error('Error al obtener torneos:', e);
      setTorneos([]);
    }
  };

  useEffect(() => {
    const acabaDeAbrir = visible && !visibleAnteriorRef.current;
    visibleAnteriorRef.current = visible;

    if (!visible) {
      operacionSnapshotsRef.current.clear();
      guardandoRef.current = false;
      setGuardando(false);
      setFallidos([]);
      setCompletados([]);
      setAlumnosPendientes([]);
      setProgreso(0);
      setError(null);
      setExito(null);
      return;
    }

    if (acabaDeAbrir) {
      cargarCatalogoYTorneos();
      const escId = escuelaId || perfil?.escuela_id;
      setSucursalId(perfil?.rol === 'SuperAdministrador' ? '' : (perfil?.sucursal_id || ''));
      setLineas([lineaVacia()]);
      setObservaciones('');
      setFechaEmision(getHoyISO());
      setVencimiento(getHoyISO());
      const cicloHoy = cicloCompletoDelMes(getHoyISO());
      if (cicloHoy) {
        setCicloInicio(cicloHoy.inicio);
        setCicloFin(cicloHoy.fin);
      } else {
        setCicloInicio(getHoyISO());
        setCicloFin(getHoyISO());
      }
      setError(null);
      setExito(null);
      setProgreso(0);

      // Requisito 1: Conservar recuperación al cerrar y reabrir.
      // Si el servidor guardó la nota pero el cliente perdió la respuesta, resolvemos la operación.
      if (escId) {
        (async () => {
          const usrId = perfil?.id || (await supabase.auth.getUser()).data.user?.id;
          if (!usrId) {
            setAlumnosPendientes([...alumnosSeleccionados]);
            setFallidos([]);
            setCompletados([]);
            return;
          }

          const yaCompletados: AlumnoDeuda[] = [];
          const aunPendientes: AlumnoDeuda[] = [];

          for (const alumno of alumnosSeleccionados) {
            const opIncierta = obtenerOperacionIncierta('cxc_masiva', escId, usrId, alumno.alumno_id);
            if (opIncierta) {
              const res = await resolverOperacionIncierta('cxc_masiva', escId, opIncierta.operacionId);
              if (res.estado === 'guardada') {
                yaCompletados.push(alumno);
              } else {
                operacionSnapshotsRef.current.set(alumno.alumno_id, {
                  operacionId: opIncierta.operacionId,
                  payloadOriginal: opIncierta.payloadOriginal,
                });
                aunPendientes.push(alumno);
              }
            } else {
              aunPendientes.push(alumno);
            }
          }

          setCompletados(yaCompletados);
          setAlumnosPendientes(aunPendientes);
          setFallidos([]);
          if (yaCompletados.length > 0) {
            onActualizar?.();
            onCreada?.();
          }
        })();
      } else {
        setAlumnosPendientes([...alumnosSeleccionados]);
        setFallidos([]);
        setCompletados([]);
      }
    }
  }, [visible]);

  const total = useMemo(() => {
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas]);

  const ejecutarGuardadoMasivo = async (listaAProcesar: AlumnoDeuda[]) => {
    if (listaAProcesar.length === 0) {
      setError('No hay alumnos pendientes para procesar.');
      return;
    }

    // Para Mensualidad se acepta precio_unitario = 0 (viene de la ficha del alumno)
    const lineasValidas = lineas.filter(l => l.catalogo_item_id && (esLineaMensualidad(l) || l.precio_unitario > 0));
    if (lineasValidas.length === 0) {
      setError('Agrega ítems válidos.');
      return;
    }

    // Validar ciclo si hay Mensualidad
    if (tieneMensualidad && (!cicloInicio || !cicloFin || cicloFin < cicloInicio || !periodoEstadistico)) {
      setError('Ingresa un rango de ciclo válido para la Mensualidad.');
      return;
    }

    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setError(null);
    setExito(null);
    setProgreso(0);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Sesión expirada.');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();
      if (!ctx) throw new Error('No se encontró el perfil de la sesión.');

      const targetSucursalId = perfil?.rol === 'SuperAdministrador'
        ? (sucursalId || null)
        : (sucursalId || perfil?.sucursal_id || ctx.sucursal_id || null);

      const tieneProductos = lineasValidas.some(l => {
        const it = catalogo.find(c => c.id === l.catalogo_item_id);
        return esProductoItem(it);
      });

      if (tieneProductos && !targetSucursalId) {
        if (ctx.rol === 'SuperAdministrador' || perfil?.rol === 'SuperAdministrador') {
          setError('Debes seleccionar una sucursal para emitir notas masivas con productos.');
        } else {
          setError('Tu usuario no tiene una sucursal asignada para emitir notas con productos.');
        }
        guardandoRef.current = false;
        setGuardando(false);
        return;
      }

      await validarAperturaInventario(
        ctx.escuela_id,
        targetSucursalId,
        lineasValidas.map(l => l.catalogo_item_id),
      );

      const descripcionFinal = lineasValidas.map(l => l.nombre).join(', ');

      // Si hay Mensualidad, obtener mensualidad de la ficha de cada alumno en la lista
      const mensualidadesPorAlumno = new Map<string, number | null>();
      if (tieneMensualidad) {
        const { data: alumnosFicha, error: errFicha } = await supabase
          .from('alumnos')
          .select('id, mensualidad')
          .eq('escuela_id', ctx.escuela_id)
          .in('id', listaAProcesar.map(a => a.alumno_id));

        if (errFicha) throw errFicha;

        (alumnosFicha ?? []).forEach((alumno: any) => {
          mensualidadesPorAlumno.set(
            alumno.id,
            alumno.mensualidad === null || alumno.mensualidad === undefined
              ? null
              : Number(alumno.mensualidad),
          );
        });
      }

      let exitososEnEstaTanda = 0;
      const nuevosFallidos: AlumnoFallo[] = [];
      const nuevosCompletados: AlumnoDeuda[] = [];

      for (let i = 0; i < listaAProcesar.length; i++) {
        const alumno = listaAProcesar[i];

        // Requisito 7: Si un alumno no tiene mensualidad válida, registrarlo como fallido individual y continuar
        if (tieneMensualidad) {
          const m = mensualidadesPorAlumno.get(alumno.alumno_id);
          if (m === null || m === undefined || Number.isNaN(m) || m <= 0) {
            nuevosFallidos.push({
              alumno_id: alumno.alumno_id,
              nombres: alumno.nombres,
              apellidos: alumno.apellidos,
              error: 'El alumno no tiene un monto de mensualidad válido asignado en su ficha.',
            });
            continue;
          }
        }

        const lineasAlumno = lineasValidas.map(l => {
          if (!esLineaMensualidad(l)) return l;
          const precioUnitario = Number(mensualidadesPorAlumno.get(alumno.alumno_id));
          return {
            ...l,
            cantidad: 1,
            precio_unitario: precioUnitario,
            subtotal: precioUnitario,
          };
        });
        const totalAlumno = lineasAlumno.reduce((s, l) => s + l.subtotal, 0);

        // Requisito 1: Ante una respuesta incierta, conserva el identificador y el payload original
        // hasta resolver si la nota se guardó. No generes otro UUID solo porque cambió el formulario.
        let snapshot = operacionSnapshotsRef.current.get(alumno.alumno_id);
        if (!snapshot) {
          const opIncierta = obtenerOperacionIncierta('cxc_masiva', ctx.escuela_id, ctx.id, alumno.alumno_id);
          if (opIncierta) {
            snapshot = {
              operacionId: opIncierta.operacionId,
              payloadOriginal: opIncierta.payloadOriginal,
            };
            operacionSnapshotsRef.current.set(alumno.alumno_id, snapshot);
          }
        }

        // Si existe un identificador previo, verificar primero si la nota ya se guardó en el servidor
        if (snapshot) {
          const resolucion = await resolverOperacionIncierta('cxc_masiva', ctx.escuela_id, snapshot.operacionId);
          if (resolucion.estado === 'guardada') {
            // El servidor sí la guardó
            operacionSnapshotsRef.current.delete(alumno.alumno_id);
            removerOperacionIncierta(snapshot.operacionId);
            nuevosCompletados.push(alumno);
            exitososEnEstaTanda++;
            setProgreso(exitososEnEstaTanda);
            continue;
          } else if (resolucion.estado === 'error_consulta') {
            // Un fallo de red o consulta no demuestra que la nota no exista.
            // Conservar el pendiente y advertir al usuario sin llamar a la RPC.
            nuevosFallidos.push({
              alumno_id: alumno.alumno_id,
              nombres: alumno.nombres,
              apellidos: alumno.apellidos,
              error: `No se pudo verificar el estado en el servidor (${resolucion.mensaje}). La operación se conserva para evitar duplicados. Reintenta al recuperar conexión.`,
            });
            continue;
          }
        }

        // Si no se guardó, conservamos el identificador original (o creamos uno si es el primer intento).
        // Si hay snapshot previo no guardado, reenviamos exactamente su payloadOriginal para no cambiar la operación en tránsito.
        const operacionId = snapshot ? snapshot.operacionId : crypto.randomUUID();

        const rpcPayload = snapshot ? snapshot.payloadOriginal : {
          p_nota_id: null,
          p_alumno_id: alumno.alumno_id,
          p_sucursal_id: targetSucursalId,
          p_monto_total: totalAlumno,
          p_descripcion: descripcionFinal,
          p_observaciones: observaciones || null,
          p_fecha_emision: fechaEmision,
          p_fecha_vencimiento: vencimiento || null,
          p_es_anticipo: false,
          p_lineas: lineasAlumno.map(l => ({
            catalogo_item_id: l.catalogo_item_id,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
            detalle_extra: l.detalle_personalizado || null,
            ciclo_inicio: esLineaMensualidad(l) ? cicloInicio : null,
            ciclo_fin: esLineaMensualidad(l) ? cicloFin : null,
          })),
          p_nro_recibo: null,
          p_ciclo_inicio: tieneMensualidad ? cicloInicio : null,
          p_ciclo_fin: tieneMensualidad ? cicloFin : null,
          p_operacion_id: operacionId,
        };

        // Conservar identificador y payload original tanto en memoria como en almacenamiento local
        operacionSnapshotsRef.current.set(alumno.alumno_id, {
          operacionId,
          payloadOriginal: rpcPayload,
        });

        guardarOperacionIncierta({
          operacionId,
          tipo: 'cxc_masiva',
          escuelaId: ctx.escuela_id,
          usuarioId: ctx.id,
          claveEntidad: alumno.alumno_id,
          payloadOriginal: rpcPayload,
          timestamp: Date.now(),
          estado: 'incierto',
        });

        try {
          const { error: errRpc } = await supabase.rpc('rpc_guardar_nota_cxc', rpcPayload);

          if (errRpc) throw errRpc;

          // Éxito confirmado: remover de operaciones pendientes
          removerOperacionIncierta(operacionId);
          operacionSnapshotsRef.current.delete(alumno.alumno_id);
          nuevosCompletados.push(alumno);
          exitososEnEstaTanda++;
          setProgreso(exitososEnEstaTanda);
        } catch (errAlum: any) {
          if (esRespuestaIncierta(errAlum)) {
            // Respuesta incierta: conservar identificador y payload original
            nuevosFallidos.push({
              alumno_id: alumno.alumno_id,
              nombres: alumno.nombres,
              apellidos: alumno.apellidos,
              error: 'Respuesta no confirmada del servidor. Se conservó la operación para resolver si fue guardada antes de reintentar.',
            });
          } else {
            // Error concluyente de PostgreSQL (código '23505', 'P0001', etc.): ROLLBACK confirmado
            removerOperacionIncierta(operacionId);
            operacionSnapshotsRef.current.delete(alumno.alumno_id);
            const motivo = errAlum?.code === '23505'
              ? 'Ya existe una mensualidad activa para este período estadístico.'
              : (errAlum?.message || 'Error al guardar la nota de servicio');
            nuevosFallidos.push({
              alumno_id: alumno.alumno_id,
              nombres: alumno.nombres,
              apellidos: alumno.apellidos,
              error: motivo,
            });
          }
        }
      }

      setCompletados(prev => [...prev, ...nuevosCompletados]);
      setFallidos(nuevosFallidos);
      const pendientesRestantes = listaAProcesar.filter(a => nuevosFallidos.some(f => f.alumno_id === a.alumno_id));
      setAlumnosPendientes(pendientesRestantes);

      if (exitososEnEstaTanda > 0) {
        onActualizar?.();
        onCreada?.();
      }

      if (nuevosFallidos.length === 0) {
        operacionSnapshotsRef.current.clear();
        setExito(`✅ Se generaron todas las notas de servicio (${listaAProcesar.length}) correctamente.`);
        // NUNCA cerrar automáticamente con setTimeout. El modal queda abierto con los resultados visibles.
      } else {
        setError(`Se completaron ${exitososEnEstaTanda} notas correctamente y fallaron ${nuevosFallidos.length}. Puedes revisar los detalles y reintentar a continuación.`);
      }
    } catch (err: any) {
      setError(`Error general: ${err.message}`);
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const manejarCerrar = () => {
    if (guardando) return;
    onCerrar();
  };

  const guardarNotasMasivas = async (e: React.FormEvent) => {
    e.preventDefault();
    await ejecutarGuardadoMasivo(alumnosPendientes);
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay" onClick={manejarCerrar}>
      <div className="cxc-modal" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2><Users size={20} style={{ marginRight: '0.5rem' }} /> Notas de Servicio Masivas</h2>
          <button onClick={manejarCerrar} disabled={guardando} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', borderRadius: '8px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#60a5fa' }}>Alumnos Seleccionados ({alumnosSeleccionados.length})</h3>
              {(completados.length > 0 || fallidos.length > 0) && (
                <span style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>
                  Completados: <strong style={{ color: '#34d399' }}>{completados.length}</strong> | Pendientes: <strong style={{ color: alumnosPendientes.length > 0 ? '#f59e0b' : '#94a3b8' }}>{alumnosPendientes.length}</strong>
                </span>
              )}
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
              Se generará una cuenta por cobrar individual para cada alumno seleccionado:
            </p>
            <div style={{ marginTop: '0.5rem', maxHeight: '80px', overflowY: 'auto', fontSize: '0.85rem' }}>
              {alumnosSeleccionados.map(a => {
                const esComp = completados.some(c => c.alumno_id === a.alumno_id);
                const esFall = fallidos.some(f => f.alumno_id === a.alumno_id);
                let bg = 'rgba(255,255,255,0.05)';
                let border = 'transparent';
                let col = '#e2e8f0';
                if (esComp) {
                  bg = 'rgba(16, 185, 129, 0.2)';
                  border = '1px solid rgba(16, 185, 129, 0.4)';
                  col = '#a7f3d0';
                } else if (esFall) {
                  bg = 'rgba(239, 68, 68, 0.2)';
                  border = '1px solid rgba(239, 68, 68, 0.4)';
                  col = '#fca5a5';
                }
                return (
                  <span
                    key={a.alumno_id}
                    style={{
                      display: 'inline-block',
                      background: bg,
                      border,
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      margin: '0.2rem',
                      color: col,
                      fontSize: '0.8rem',
                    }}
                  >
                    {a.nombres} {a.apellidos} {esComp ? '✓' : esFall ? '⚠️' : ''}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Panel de Alumnos Completados */}
          {completados.length > 0 && (
            <div
              style={{
                marginBottom: '1rem',
                padding: '0.85rem 1rem',
                background: 'rgba(16, 185, 129, 0.1)',
                border: '1px solid rgba(16, 185, 129, 0.3)',
                borderRadius: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                <CheckCircle2 size={18} style={{ color: '#34d399' }} />
                <span style={{ fontWeight: 700, color: '#34d399', fontSize: '0.85rem' }}>
                  Notas generadas exitosamente ({completados.length})
                </span>
              </div>
              <div style={{ maxHeight: '75px', overflowY: 'auto', fontSize: '0.8rem' }}>
                {completados.map(c => (
                  <span
                    key={c.alumno_id}
                    style={{
                      display: 'inline-block',
                      background: 'rgba(16, 185, 129, 0.15)',
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      margin: '0.15rem',
                      color: '#a7f3d0',
                    }}
                  >
                    {c.nombres} {c.apellidos}
                  </span>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={guardarNotasMasivas}>
            {/* Fechas de emisión y vencimiento */}
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
              {perfil?.rol === 'SuperAdministrador' && (
                <div className="form-campo full-width">
                  <label>Sucursal *</label>
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
                </div>
              )}
              <div className="form-campo">
                <label>Fecha Emisión</label>
                <input
                  type="date"
                  value={fechaEmision}
                  onChange={e => {
                    const f = e.target.value;
                    setFechaEmision(f);
                    setVencimiento(f);
                    // Actualizar ciclo si hay mensualidad
                    if (tieneMensualidad) {
                      const ciclo = cicloCompletoDelMes(f);
                      if (ciclo) { setCicloInicio(ciclo.inicio); setCicloFin(ciclo.fin); }
                    }
                  }}
                  required
                />
              </div>
              <div className="form-campo">
                <label>Vencimiento</label>
                <input type="date" value={vencimiento} onChange={e => setVencimiento(e.target.value)} />
              </div>
            </div>

            {/* Ítems */}
            <div style={{ marginBottom: '1.5rem' }}>
              {lineas.map((linea, idx) => {
                const esMensualidad = linea.nombre === 'Mensualidad';
                const esTorneo = linea.nombre === 'Inscripción a Torneos';

                return (
                  <div key={idx} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                      {/* Selector de ítem */}
                      <select value={linea.catalogo_item_id} onChange={e => {
                        const it = catalogo.find(c => c.id === e.target.value);
                        if (it) {
                          const nuevas = [...lineas];
                          const esMens = it.nombre === 'Mensualidad';
                          nuevas[idx] = {
                            ...nuevas[idx],
                            catalogo_item_id: it.id,
                            nombre: it.nombre,
                            precio_unitario: Number(it.precio_venta) || 0,
                            cantidad: 1,
                            subtotal: (Number(it.precio_venta) || 0) * 1,
                            periodo_meses: [],
                            detalle_personalizado: '',
                          };
                          setLineas(nuevas);
                          // Al seleccionar Mensualidad, actualizar ciclo
                          if (esMens) {
                            const ciclo = cicloCompletoDelMes(fechaEmision);
                            if (ciclo) { setCicloInicio(ciclo.inicio); setCicloFin(ciclo.fin); }
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

                      {/* Cantidad */}
                      <input type="number" value={linea.cantidad} onChange={e => {
                        const cant = parseInt(e.target.value) || 1;
                        const nuevas = [...lineas];
                        nuevas[idx] = { ...nuevas[idx], cantidad: cant, subtotal: cant * nuevas[idx].precio_unitario };
                        setLineas(nuevas);
                      }} min="1" disabled={guardando || esMensualidad} title="Cantidad" />

                      {/* Precio unitario */}
                      <input type="number" step="0.01" value={linea.precio_unitario} onChange={e => {
                        const prec = parseFloat(e.target.value) || 0;
                        const nuevas = [...lineas];
                        nuevas[idx] = { ...nuevas[idx], precio_unitario: prec, subtotal: prec * nuevas[idx].cantidad };
                        setLineas(nuevas);
                      }} disabled={guardando || esMensualidad} title={esMensualidad ? 'Se usará la mensualidad de la ficha de cada alumno' : 'Precio Unitario'} />

                      {/* Subtotal */}
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>
                        {esMensualidad ? 'Ficha' : `Bs ${fmtMonto(linea.subtotal)}`}
                      </div>

                      {/* Eliminar */}
                      <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}>
                        ✕
                      </button>
                    </div>

                    {catalogo.find(c => c.id === linea.catalogo_item_id)?.categoria === 'producto' && linea.catalogo_item_id && (
                      <div style={{ fontSize: '0.75rem', marginTop: '0.25rem', color: (saldosInventario.get(linea.catalogo_item_id) ?? 0) <= 0 ? '#f59e0b' : '#34d399' }}>
                        📦 Existencias en sucursal: <strong>{saldosInventario.get(linea.catalogo_item_id) ?? 0} unid.</strong>
                        {(saldosInventario.get(linea.catalogo_item_id) ?? 0) <= 0 && ' (Permite venta con saldo negativo)'}
                      </div>
                    )}

                    {/* Panel de ciclo para Mensualidad (NUEVO SISTEMA) */}
                    {esMensualidad && (
                      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}>
                          Ciclo y período estadístico
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.15fr', gap: '0.65rem', marginBottom: '0.75rem' }}>
                          <div className="form-campo">
                            <label>Inicio del ciclo</label>
                            <input
                              type="date"
                              value={cicloInicio}
                              onChange={e => {
                                const nuevoInicio = e.target.value;
                                setCicloInicio(nuevoInicio);
                                const nuevoFin = finDeCicloMensual(nuevoInicio);
                                if (nuevoFin) setCicloFin(nuevoFin);
                              }}
                              disabled={guardando}
                              required
                            />
                          </div>
                          <div className="form-campo">
                            <label>Fin del ciclo</label>
                            <input
                              type="date"
                              value={cicloFin}
                              min={cicloInicio}
                              onChange={e => {
                                const nuevoFin = e.target.value;
                                if (!nuevoFin || !cicloInicio || nuevoFin >= cicloInicio) {
                                  setCicloFin(nuevoFin);
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
                              value={formatPeriodoEstadistico(periodoEstadistico)}
                              readOnly
                              aria-readonly="true"
                              style={{ cursor: 'not-allowed', opacity: 0.85 }}
                            />
                          </div>
                        </div>
                        {/* Campo detalle personalizado */}
                        <div>
                          <label style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', display: 'block', marginBottom: '0.2rem' }}>
                            PERIODO ESPECÍFICO / DETALLE
                          </label>
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
                    )}

                    {/* Panel de torneo */}
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
                                      : val,
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
              <button type="button" onClick={() => setLineas([...lineas, lineaVacia()])} style={{ fontSize: '0.8rem', color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <Plus size={14} /> Agregar otro ítem
              </button>
            </div>

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
                  borderRadius: '8px', color: 'inherit', resize: 'vertical', minHeight: '50px',
                }}
                disabled={guardando}
              />
            </div>

            {fallidos.length > 0 && (
              <div style={{
                marginTop: '1.5rem',
                padding: '1rem',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '8px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <AlertCircle size={18} style={{ color: '#f87171' }} />
                    <span style={{ fontWeight: 700, color: '#f87171', fontSize: '0.9rem' }}>
                      Alumnos no procesados ({fallidos.length})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => ejecutarGuardadoMasivo(alumnosPendientes)}
                    disabled={guardando}
                    className="btn-guardar-cuenta"
                    style={{
                      width: 'auto',
                      padding: '0.35rem 0.85rem',
                      fontSize: '0.8rem',
                      background: '#ef4444',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                    }}
                  >
                    <RefreshCw size={14} className={guardando ? 'animate-spin' : ''} />
                    {guardando ? 'Reintentando...' : `Reintentar solo estos ${fallidos.length} alumnos`}
                  </button>
                </div>
                <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '0.8rem' }}>
                  {fallidos.map(f => (
                    <div
                      key={f.alumno_id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        padding: '0.35rem 0',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                      }}
                    >
                      <span style={{ fontWeight: 600, color: '#e2e8f0' }}>{f.nombres} {f.apellidos}</span>
                      <span style={{ color: '#fca5a5', fontSize: '0.75rem', maxWidth: '65%', textAlign: 'right' }}>{f.error}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                Total por Alumno: {tieneMensualidad ? 'según ficha del alumno' : `Bs ${fmtMonto(total)}`}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={manejarCerrar}
                  disabled={guardando}
                  className="btn-refrescar"
                  style={{ width: 'auto' }}
                >
                  {alumnosPendientes.length === 0 && completados.length > 0 ? 'Cerrar' : 'Cancelar'}
                </button>
                {alumnosPendientes.length > 0 ? (
                  <button
                    type="submit"
                    disabled={guardando || alumnosPendientes.length === 0}
                    className="btn-guardar-cuenta"
                    style={{ width: 'auto', padding: '0 2rem' }}
                  >
                    {guardando
                      ? `Generando... (${progreso}/${alumnosPendientes.length})`
                      : fallidos.length > 0
                        ? `Reintentar pendientes (${alumnosPendientes.length})`
                        : `Confirmar Notas Masivas (${alumnosPendientes.length})`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={manejarCerrar}
                    disabled={guardando}
                    className="btn-guardar-cuenta"
                    style={{ width: 'auto', padding: '0 2rem', background: '#10b981' }}
                  >
                    Finalizar y Cerrar
                  </button>
                )}
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

export default ModalNotaMasiva;
