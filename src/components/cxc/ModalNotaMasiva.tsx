import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CatalogoItem } from '../../types/cuentas';
import type { LineaNota, AlumnoDeuda } from '../../types/cxc';
import { MESES_ANIO } from '../../types/cxc';
import {
  X, Plus, Check, Trash2, Calendar, AlertCircle,
  CreditCard, FileText, Users, RefreshCw, Hash
} from 'lucide-react';
import { getHoyISO } from '../../lib/dateUtils';

interface ModalNotaMasivaProps {
  visible: boolean;
  onCerrar: () => void;
  onCreada: () => void;
  alumnosSeleccionados: AlumnoDeuda[];
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<number>(0);

  useEffect(() => {
    if (!visible) return;
    const cargar = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: usr } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
      if (!usr) return;

      const { data: resCat } = await supabase.from('catalogo_items').select('*').eq('activo', true).or('tipo_movimiento.eq.ingreso,tipo_movimiento.eq.ambos').order('nombre');
      setCatalogo(resCat ?? []);

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

    setLineas([lineaVacia()]);
    setObservaciones('');
    setFechaEmision(getHoyISO());
    setVencimiento(getHoyISO());
    setError(null); setExito(null); setProgreso(0);
  }, [visible]);

  const total = useMemo(() => {
    return lineas.reduce((s, l) => s + l.subtotal, 0);
  }, [lineas]);

  const usaMensualidadPorFicha = useMemo(() => {
    return lineas.some(l => l.catalogo_item_id && esLineaMensualidad(l));
  }, [lineas]);

  const guardarNotasMasivas = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setExito(null); setProgreso(0);
    
    if (alumnosSeleccionados.length === 0) {
      setError('No hay alumnos seleccionados.'); return;
    }
    
    const lineasValidas = lineas.filter(l => l.catalogo_item_id && (esLineaMensualidad(l) || l.precio_unitario > 0));
    if (lineasValidas.length === 0) { setError('Agrega ítems válidos.'); return; }

    for (const l of lineasValidas) {
      if (esLineaMensualidad(l) && l.periodo_meses.length === 0) {
        setError('Debe seleccionar al menos un mes para el item Mensualidad.');
        return;
      }
    }

    setGuardando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Auth error');
      const { data: ctx } = await supabase.from('usuarios').select('*').eq('id', user.id).single();

      const descripcionFinal = lineasValidas.map(l => l.nombre).join(', ');
      const tieneMensualidad = lineasValidas.some(esLineaMensualidad);
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
              : Number(alumno.mensualidad)
          );
        });

        const alumnosSinMensualidad = alumnosSeleccionados.filter(alumno => {
          const mensualidad = mensualidadesPorAlumno.get(alumno.alumno_id);
          return mensualidad === null || mensualidad === undefined || Number.isNaN(mensualidad) || mensualidad <= 0;
        });

        if (alumnosSinMensualidad.length > 0) {
          const nombres = alumnosSinMensualidad
            .slice(0, 5)
            .map(a => `${a.nombres} ${a.apellidos}`)
            .join(', ');
          const extra = alumnosSinMensualidad.length > 5 ? ` y ${alumnosSinMensualidad.length - 5} mas` : '';
          throw new Error(`No se puede generar Mensualidad masiva: hay alumnos sin valor de mensualidad en su ficha (${nombres}${extra}).`);
        }
      }

      // Iterar sobre cada alumno seleccionado y crear su nota individual
      let completados = 0;
      for (const alumno of alumnosSeleccionados) {
        const lineasAlumno = lineasValidas.map(l => {
          if (!esLineaMensualidad(l)) return l;

          const cantidad = Math.max(l.periodo_meses.length, 1);
          const precioUnitario = Number(mensualidadesPorAlumno.get(alumno.alumno_id));

          return {
            ...l,
            cantidad,
            precio_unitario: precioUnitario,
            subtotal: precioUnitario * cantidad,
          };
        });
        const totalAlumno = lineasAlumno.reduce((s, l) => s + l.subtotal, 0);

        // 1. Guardar Nota
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
          nro_recibo: null
        }).select('id').single();
        
        if (errN) throw errN;
        const notaId = nueva.id;

        // 2. Detalle
        await supabase.from('cxc_detalle').insert(lineasAlumno.map(l => ({
          escuela_id: ctx.escuela_id,
          cuenta_cobrar_id: notaId,
          catalogo_item_id: l.catalogo_item_id,
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          periodo_meses: l.periodo_meses.length > 0 ? l.periodo_meses : null,
          detalle_extra: l.detalle_personalizado
        })));
        
        completados++;
        setProgreso(completados);
      }

      setExito(`✅ Se generaron ${completados} Notas de Servicio correctamente.`);
      onCreada();
      setTimeout(() => { onCerrar(); }, 1000);
    } catch (err: any) {
      setError(`Error: ${err.message}`);
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

                    // Sincronizar meses de mensualidad si existen
                    if (f) {
                      const monthIdx = parseInt(f.split('-')[1]) - 1;
                      const nuevasLineas = lineas.map(l => {
                        if (l.nombre === 'Mensualidad') {
                          return { 
                            ...l, 
                            periodo_meses: [MESES_ANIO[monthIdx]],
                            cantidad: 1,
                            subtotal: l.precio_unitario
                          };
                        }
                        return l;
                      });
                      setLineas(nuevasLineas);
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

            <div style={{ marginBottom: '1.5rem' }}>
              {lineas.map((linea, idx) => {
                const esMensualidad = linea.nombre === 'Mensualidad';
                const esTorneo = linea.nombre === 'Inscripción a Torneos';

                return (
                  <div key={idx} style={{ marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 100px 100px 30px', gap: '0.5rem', alignItems: 'center' }}>
                      <select value={linea.catalogo_item_id} onChange={e => {
                        const it = catalogo.find(c => c.id === e.target.value);
                        if (it) {
                          const nuevas = [...lineas];
                          const esMensualidad = it.nombre === 'Mensualidad';
                          const monthIdx = parseInt(fechaEmision.split('-')[1]) - 1;
                          const mesesIniciales = esMensualidad ? [MESES_ANIO[monthIdx]] : [];
                          const cantidadInicial = esMensualidad ? 1 : nuevas[idx].cantidad;

                          nuevas[idx] = { 
                            ...nuevas[idx], 
                            catalogo_item_id: it.id, 
                            nombre: it.nombre, 
                            precio_unitario: Number(it.precio_venta) || 0, 
                            cantidad: cantidadInicial,
                            subtotal: (Number(it.precio_venta) || 0) * cantidadInicial,
                            periodo_meses: mesesIniciales,
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
                      }} disabled={guardando || esMensualidad} title={esMensualidad ? 'Se usara la mensualidad de la ficha de cada alumno' : 'Precio Unitario'} />
                      <div style={{ textAlign: 'right', fontWeight: 700, fontSize: '0.9rem' }}>{esMensualidad ? 'Ficha' : `Bs ${fmtMonto(linea.subtotal)}`}</div>
                      <button type="button" onClick={() => setLineas(lineas.filter((_, i) => i !== idx))} disabled={lineas.length === 1} style={{ color: '#f87171' }}><Trash2 size={16} /></button>
                    </div>

                    {esMensualidad && (
                      <div style={{ marginTop: '0.75rem', padding: '0.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: '8px' }}>
                        <p style={{ fontSize: '0.7rem', fontWeight: 700, color: '#94a3b8', marginBottom: '0.5rem', textTransform: 'uppercase' }}>Seleccionar Mes(es)</p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0.4rem', marginBottom: '0.75rem' }}>
                          {MESES_ANIO.map(mes => (
                            <label key={mes} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.75rem', cursor: 'pointer', background: linea.periodo_meses.includes(mes) ? 'rgba(59,130,246,0.1)' : 'transparent', padding: '0.2rem 0.4rem', borderRadius: '4px', border: '1px solid', borderColor: linea.periodo_meses.includes(mes) ? '#3b82f6' : 'rgba(255,255,255,0.1)' }}>
                              <input 
                                type="checkbox" 
                                checked={linea.periodo_meses.includes(mes)} 
                                onChange={e => {
                                  const meses = e.target.checked 
                                    ? [...linea.periodo_meses, mes]
                                    : linea.periodo_meses.filter(m => m !== mes);
                                  const nuevas = [...lineas];
                                  nuevas[idx].periodo_meses = meses;
                                  nuevas[idx].cantidad = Math.max(meses.length, 1);
                                  nuevas[idx].subtotal = Math.max(meses.length, 1) * nuevas[idx].precio_unitario;
                                  setLineas(nuevas);
                                }}
                                style={{ width: '12px', height: '12px' }}
                              />
                              {mes}
                            </label>
                          ))}
                        </div>
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

            <div style={{ marginTop: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>
                Total por Alumno: {usaMensualidadPorFicha ? 'segun ficha del alumno' : `Bs ${fmtMonto(total)}`}
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
