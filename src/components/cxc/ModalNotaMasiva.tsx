import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import type { LineaNota, AlumnoDeuda } from '../../types/cxc';
import {
  X, Plus, Trash2, Users,
} from 'lucide-react';
import {
  calcularPeriodoEstadistico,
  formatPeriodoEstadistico,
  getHoyISO,
} from '../../lib/dateUtils';

interface ModalNotaMasivaProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
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

const ModalNotaMasiva: React.FC<ModalNotaMasivaProps> = ({
  visible, onCerrar, onCreada, alumnosSeleccionados
}) => {
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [torneos, setTorneos] = useState<string[]>([]);

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

  useEffect(() => {
    if (!visible) return;
    const cargar = async () => {
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

    // Reiniciar estado del formulario
    setLineas([lineaVacia()]);
    setObservaciones('');
    setFechaEmision(getHoyISO());
    setVencimiento(getHoyISO());
    // Ciclo inicial = mes completo del día de hoy
    const cicloHoy = cicloCompletoDelMes(getHoyISO());
    if (cicloHoy) {
      setCicloInicio(cicloHoy.inicio);
      setCicloFin(cicloHoy.fin);
    } else {
      setCicloInicio(getHoyISO());
      setCicloFin(getHoyISO());
    }
    setError(null); setExito(null); setProgreso(0);
  }, [visible]);

  const total = useMemo(() => {
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas]);

  const guardarNotasMasivas = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null); setProgreso(0);

    if (alumnosSeleccionados.length === 0) {
      setError('No hay alumnos seleccionados.'); return;
    }

    // Para Mensualidad se acepta precio_unitario = 0 (viene de la ficha del alumno)
    const lineasValidas = lineas.filter(l => l.catalogo_item_id && (esLineaMensualidad(l) || l.precio_unitario > 0));
    if (lineasValidas.length === 0) { setError('Agrega ítems válidos.'); return; }

    // Validar ciclo si hay Mensualidad
    if (tieneMensualidad && (!cicloInicio || !cicloFin || cicloFin < cicloInicio || !periodoEstadistico)) {
      setError('Ingresa un rango de ciclo válido para la Mensualidad.');
      return;
    }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      const descripcionFinal = lineasValidas.map(l => l.nombre).join(', ');

      // Si hay Mensualidad, obtener mensualidad de la ficha de cada alumno
      const mensualidadesPorAlumno = new Map<string, number | null>();
      if (tieneMensualidad) {
        const { data: alumnosFicha, error: errFicha } = await supabase
          .from('alumnos')
          .select('id, mensualidad')
          .eq('escuela_id', ctx.escuela_id)
          .in('id', alumnosSeleccionados.map(a => a.alumno_id));

        if (errFicha) throw errFicha;

        (alumnosFicha ?? []).forEach((alumno: any) => {
          mensualidadesPorAlumno.set(
            alumno.id,
            alumno.mensualidad === null || alumno.mensualidad === undefined
              ? null
              : Number(alumno.mensualidad),
          );
        });

        const alumnosSinMensualidad = alumnosSeleccionados.filter(alumno => {
          const m = mensualidadesPorAlumno.get(alumno.alumno_id);
          return m === null || m === undefined || Number.isNaN(m) || m <= 0;
        });

        if (alumnosSinMensualidad.length > 0) {
          const nombres = alumnosSinMensualidad
            .slice(0, 5)
            .map(a => `${a.nombres} ${a.apellidos}`)
            .join(', ');
          const extra = alumnosSinMensualidad.length > 5 ? ` y ${alumnosSinMensualidad.length - 5} más` : '';
          throw new Error(`No se puede generar Mensualidad masiva: hay alumnos sin valor de mensualidad en su ficha (${nombres}${extra}).`);
        }
      }

      let completados = 0;
      for (const alumno of alumnosSeleccionados) {
        // Construir líneas con precio real para este alumno
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

        if (tieneMensualidad) {
          // Usar el RPC del sistema nuevo (igual que NotaServicios)
          const { error: errRpc } = await supabase.rpc('rpc_crear_nota_mensualidad', {
            p_alumno_id: alumno.alumno_id,
            p_sucursal_id: ctx.sucursal_id,
            p_monto_total: totalAlumno,
            p_descripcion: descripcionFinal,
            p_observaciones: observaciones || null,
            p_fecha_emision: fechaEmision,
            p_fecha_vencimiento: vencimiento || null,
            p_ciclo_inicio: cicloInicio,
            p_ciclo_fin: cicloFin,
            p_lineas: lineasAlumno.map(l => ({
              catalogo_item_id: l.catalogo_item_id,
              cantidad: l.cantidad,
              precio_unitario: l.precio_unitario,
              periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
              detalle_extra: l.detalle_personalizado || null,
            })),
            p_nro_recibo: null,
          });
          if (errRpc) throw errRpc;
        } else {
          // Nota sin mensualidad: inserción directa
          const { data: nueva, error: errN } = await supabase.from('cuentas_cobrar').insert({
            escuela_id: ctx.escuela_id,
            sucursal_id: ctx.sucursal_id,
            alumno_id: alumno.alumno_id,
            monto_total: totalAlumno,
            descripcion: descripcionFinal,
            observaciones: observaciones,
            fecha_emision: fechaEmision,
            fecha_vencimiento: vencimiento || null,
            es_anticipo: false,
            estado: 'pendiente',
            nro_recibo: null,
            origen_facturacion: 'manual',
          }).select('id').single();
          if (errN) throw errN;

          await supabase.from('cxc_detalle').insert(lineasAlumno.map(l => ({
            escuela_id: ctx.escuela_id,
            cuenta_cobrar_id: nueva.id,
            catalogo_item_id: l.catalogo_item_id,
            cantidad: l.cantidad,
            precio_unitario: l.precio_unitario,
            periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
            detalle_extra: l.detalle_personalizado,
          })));
        }

        completados++;
        setProgreso(completados);
      }

      setExito(`✅ Se generaron ${completados} Notas de Servicio correctamente.`);
      onCreada();
      setTimeout(() => { onCerrar(); }, 1000);
    } catch (err: any) {
      setError(err.code === '23505'
        ? 'Ya existe una mensualidad activa para uno o más alumnos en este período estadístico.'
        : `Error: ${err.message}`);
    } finally {
      setGuardando(false);
    }
  };

  if (!visible) return null;

  return (
    <div className="cxc-modal-overlay">
      <div className="cxc-modal" style={{ maxWidth: '700px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2><Users size={20} style={{ marginRight: '0.5rem' }} /> Notas de Servicio Masivas</h2>
          <button onClick={onCerrar} disabled={guardando}><X size={20} /></button>
        </div>
        <div style={{ padding: '1.5rem' }}>
          <div style={{ marginBottom: '1rem', padding: '1rem', background: 'rgba(59,130,246,0.1)', border: '1px solid #3b82f6', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 'bold', color: '#60a5fa' }}>Alumnos Seleccionados ({alumnosSeleccionados.length})</h3>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>
              Se generará una cuenta por cobrar individual para cada uno de los siguientes alumnos:
            </p>
            <div style={{ marginTop: '0.5rem', maxHeight: '80px', overflowY: 'auto', fontSize: '0.85rem' }}>
              {alumnosSeleccionados.map(a => (
                <span key={a.alumno_id} style={{ display: 'inline-block', background: 'rgba(255,255,255,0.05)', padding: '0.2rem 0.5rem', borderRadius: '4px', margin: '0.2rem', color: '#e2e8f0' }}>
                  {a.nombres} {a.apellidos}
                </span>
              ))}
            </div>
          </div>

          <form onSubmit={guardarNotasMasivas}>
            {/* Fechas de emisión y vencimiento */}
            <div className="modal-form-grid" style={{ marginBottom: '1.5rem' }}>
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
                        {catalogo.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
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

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                Total por Alumno: {tieneMensualidad ? 'según ficha del alumno' : `Bs ${fmtMonto(total)}`}
              </div>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button type="button" onClick={onCerrar} className="btn-refrescar" style={{ width: 'auto' }}>Cancelar</button>
                <button type="submit" disabled={guardando} className="btn-guardar-cuenta" style={{ width: 'auto', padding: '0 2rem' }}>
                  {guardando ? `Generando... (${progreso}/${alumnosSeleccionados.length})` : 'Confirmar Notas Masivas'}
                </button>
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
