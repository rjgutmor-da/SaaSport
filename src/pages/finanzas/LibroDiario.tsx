/**
 * LibroDiario.tsx
 * Pantalla del Libro Diario — Registro inmutable de Asientos Contables.
 * Muestra asientos con sus movimientos (Debe/Haber) y permite crear nuevos
 * mediante la función RPC atómica del backend.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CuentaContable, TipoCuenta } from '../../types/finanzas';
import { COLORES_TIPO } from '../../types/finanzas';
import {
  BookOpen, ChevronLeft, ChevronDown, ChevronRight, Plus, X, Check,
  RefreshCw, Calendar, CreditCard, FileText, AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Tipos locales del Libro Diario
interface Movimiento {
  id: string;
  cuenta_contable_id: string;
  debe: number;
  haber: number;
  cuenta?: { codigo: string; nombre: string; tipo: TipoCuenta };
}

interface Asiento {
  id: string;
  fecha: string;
  descripcion: string;
  metodo_pago: string;
  created_at: string;
  movimientos_contables: Movimiento[];
}

// Línea del formulario para nuevo asiento
interface LineaForm {
  cuenta_contable_id: string;
  debe: string;
  haber: string;
}

const METODOS_PAGO = [
  { valor: 'efectivo', etiqueta: 'Efectivo' },
  { valor: 'transferencia', etiqueta: 'Transferencia' },
  { valor: 'qr', etiqueta: 'QR' },
];

/** Formatea un número como moneda (Bs) */
const formatMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Formatea fecha legible */
const formatFecha = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: 'short', year: 'numeric' });
};
const formatHora = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
};

const LibroDiario: React.FC = () => {
  const navigate = useNavigate();
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Formulario
  const [mostrarForm, setMostrarForm] = useState(false);
  const [formDesc, setFormDesc] = useState('');
  const [formMetodo, setFormMetodo] = useState('efectivo');
  const [formLineas, setFormLineas] = useState<LineaForm[]>([
    { cuenta_contable_id: '', debe: '', haber: '' },
    { cuenta_contable_id: '', debe: '', haber: '' },
  ]);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formExito, setFormExito] = useState<string | null>(null);

  // Obtener escuela_id
  const obtenerEscuelaId = async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', user.id)
      .single();
    return data?.escuela_id ?? null;
  };

  // Cargar asientos desde Supabase
  const cargarAsientos = async () => {
    setCargando(true);
    setError(null);

    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) {
      setError('Sesión expirada.');
      setCargando(false);
      return;
    }

    const { data, error: err } = await supabase
      .from('asientos_contables')
      .select(`
        id, fecha, descripcion, metodo_pago, created_at,
        movimientos_contables (
          id, cuenta_contable_id, debe, haber,
          cuenta:plan_cuentas ( codigo, nombre, tipo )
        )
      `)
      .eq('escuela_id', escuelaId)
      .order('fecha', { ascending: false })
      .limit(50);

    if (err) {
      setError(`Error al cargar asientos: ${err.message}`);
      setCargando(false);
      return;
    }
    setAsientos((data as unknown as Asiento[]) ?? []);
    setCargando(false);
  };

  // Cargar cuentas transaccionales para el formulario
  const cargarCuentas = async () => {
    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) return;

    const { data } = await supabase
      .from('plan_cuentas')
      .select('*')
      .eq('escuela_id', escuelaId)
      .eq('es_transaccional', true)
      .order('codigo', { ascending: true });
    setCuentas(data ?? []);
  };

  useEffect(() => {
    cargarAsientos();
    cargarCuentas();
  }, []);

  // Toggle expandir/colapsar asiento
  const toggleExpandir = (id: string) => {
    setExpandidos(prev => {
      const nuevo = new Set(prev);
      if (nuevo.has(id)) nuevo.delete(id); else nuevo.add(id);
      return nuevo;
    });
  };

  // Totales del formulario
  const totalesForm = useMemo(() => {
    const totalDebe = formLineas.reduce((s, l) => s + (parseFloat(l.debe) || 0), 0);
    const totalHaber = formLineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
    return { totalDebe, totalHaber, cuadrado: Math.abs(totalDebe - totalHaber) < 0.01 && totalDebe > 0 };
  }, [formLineas]);

  // Agregar línea al formulario
  const agregarLinea = () => {
    setFormLineas([...formLineas, { cuenta_contable_id: '', debe: '', haber: '' }]);
  };

  // Quitar línea del formulario
  const quitarLinea = (idx: number) => {
    if (formLineas.length <= 2) return;
    setFormLineas(formLineas.filter((_, i) => i !== idx));
  };

  // Actualizar línea
  const actualizarLinea = (idx: number, campo: keyof LineaForm, valor: string) => {
    const nuevas = [...formLineas];
    nuevas[idx] = { ...nuevas[idx], [campo]: valor };
    // Auto-limpiar el lado contrario
    if (campo === 'debe' && parseFloat(valor) > 0) nuevas[idx].haber = '';
    if (campo === 'haber' && parseFloat(valor) > 0) nuevas[idx].debe = '';
    setFormLineas(nuevas);
  };

  // Obtener escuela_id y usuario_id
  const obtenerContexto = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('id, escuela_id, sucursal_id')
      .eq('id', user.id)
      .single();
    return data;
  };

  // Guardar asiento usando RPC atómica
  const guardarAsiento = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormExito(null);

    if (!formDesc.trim()) { setFormError('La descripción es obligatoria.'); return; }

    // Validar líneas
    const lineasValidas = formLineas.filter(l => l.cuenta_contable_id && (parseFloat(l.debe) > 0 || parseFloat(l.haber) > 0));
    if (lineasValidas.length < 2) { setFormError('Se necesitan al menos 2 líneas con montos.'); return; }
    if (!totalesForm.cuadrado) { setFormError(`Partida doble: Debe (${formatMonto(totalesForm.totalDebe)}) ≠ Haber (${formatMonto(totalesForm.totalHaber)})`); return; }

    setGuardando(true);
    const ctx = await obtenerContexto();
    if (!ctx) { setFormError('No se pudo obtener el contexto del usuario.'); setGuardando(false); return; }

    const payload = {
      escuela_id: ctx.escuela_id,
      sucursal_id: ctx.sucursal_id,
      usuario_id: ctx.id,
      descripcion: formDesc.trim(),
      metodo_pago: formMetodo,
      movimientos: lineasValidas.map(l => ({
        cuenta_contable_id: l.cuenta_contable_id,
        debe: parseFloat(l.debe) || 0,
        haber: parseFloat(l.haber) || 0,
      })),
    };

    const { error: rpcErr } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payload });

    if (rpcErr) {
      setFormError(`Error al registrar: ${rpcErr.message}`);
      setGuardando(false);
      return;
    }

    setFormExito('Asiento contable registrado exitosamente.');
    setFormDesc('');
    setFormMetodo('efectivo');
    setFormLineas([
      { cuenta_contable_id: '', debe: '', haber: '' },
      { cuenta_contable_id: '', debe: '', haber: '' },
    ]);
    setGuardando(false);
    cargarAsientos();
  };

  return (
    <main className="main-content">
      {/* Encabezado */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/finanzas')} title="Volver a Finanzas">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <BookOpen size={28} style={{ marginRight: '0.5rem' }} />
              Libro Diario
            </h1>
            <p className="pc-subtitulo">Registro inmutable de asientos contables — {asientos.length} registros</p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button className="btn-nueva-cuenta" onClick={() => { setMostrarForm(!mostrarForm); setFormError(null); setFormExito(null); }}>
            {mostrarForm ? <X size={18} /> : <Plus size={18} />}
            {mostrarForm ? 'Cerrar' : 'Nuevo Asiento'}
          </button>
          <button className="btn-refrescar" onClick={cargarAsientos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Formulario nuevo asiento */}
      {mostrarForm && (
        <form className="ld-form" onSubmit={guardarAsiento}>
          {/* Fila superior: Descripción + Método de pago */}
          <div className="ld-form-top">
            <div className="form-campo" style={{ flex: 1 }}>
              <label htmlFor="ld-desc">Descripción del asiento</label>
              <input
                id="ld-desc"
                type="text"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="Ej: Cobro mensualidad alumno Juan Pérez"
                required
                disabled={guardando}
              />
            </div>
            <div className="form-campo" style={{ flex: '0 0 160px' }}>
              <label htmlFor="ld-metodo">Método de pago</label>
              <select id="ld-metodo" value={formMetodo} onChange={(e) => setFormMetodo(e.target.value)} disabled={guardando}>
                {METODOS_PAGO.map(m => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
          </div>

          {/* Tabla de líneas */}
          <div className="ld-lineas-header">
            <span className="ld-lh-cuenta">Cuenta Contable</span>
            <span className="ld-lh-monto">Debe (Bs)</span>
            <span className="ld-lh-monto">Haber (Bs)</span>
            <span className="ld-lh-accion"></span>
          </div>
          {formLineas.map((linea, idx) => (
            <div key={idx} className="ld-linea">
              <select
                className="ld-linea-cuenta"
                value={linea.cuenta_contable_id}
                onChange={(e) => actualizarLinea(idx, 'cuenta_contable_id', e.target.value)}
                disabled={guardando}
              >
                <option value="">— Seleccionar cuenta —</option>
                {cuentas.map(c => (
                  <option key={c.id} value={c.id}>{c.codigo} — {c.nombre}</option>
                ))}
              </select>
              <input
                className="ld-linea-monto"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={linea.debe}
                onChange={(e) => actualizarLinea(idx, 'debe', e.target.value)}
                disabled={guardando}
              />
              <input
                className="ld-linea-monto"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={linea.haber}
                onChange={(e) => actualizarLinea(idx, 'haber', e.target.value)}
                disabled={guardando}
              />
              <button
                type="button"
                className="ld-linea-quitar"
                onClick={() => quitarLinea(idx)}
                disabled={formLineas.length <= 2}
                title="Quitar línea"
              >
                <X size={14} />
              </button>
            </div>
          ))}

          {/* Totales + acciones */}
          <div className="ld-totales">
            <button type="button" className="ld-btn-agregar" onClick={agregarLinea} disabled={guardando}>
              <Plus size={14} /> Agregar línea
            </button>
            <div className="ld-totales-nums">
              <span className={`ld-total ${totalesForm.cuadrado ? 'ld-total--ok' : 'ld-total--error'}`}>
                Debe: <strong>{formatMonto(totalesForm.totalDebe)}</strong>
              </span>
              <span className={`ld-total ${totalesForm.cuadrado ? 'ld-total--ok' : 'ld-total--error'}`}>
                Haber: <strong>{formatMonto(totalesForm.totalHaber)}</strong>
              </span>
              {totalesForm.cuadrado && <span className="ld-cuadrado">✓ Cuadrado</span>}
            </div>
            <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !totalesForm.cuadrado}>
              <Check size={16} />
              {guardando ? 'Registrando...' : 'Registrar Asiento'}
            </button>
          </div>

          {formError && <div className="form-msg form-msg--error"><AlertCircle size={14} /> {formError}</div>}
          {formExito && <div className="form-msg form-msg--exito"><Check size={14} /> {formExito}</div>}
        </form>
      )}

      {/* Error general */}
      {error && (
        <div className="pc-error">
          <p>⚠️ {error}</p>
          <button onClick={cargarAsientos}>Reintentar</button>
        </div>
      )}

      {/* Lista de asientos */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando libro diario...</p>
        </div>
      ) : asientos.length === 0 ? (
        <div className="arbol-vacio">
          <FileText size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>No hay asientos registrados aún.</p>
          <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
            Usa el botón "Nuevo Asiento" para crear el primer registro contable.
          </p>
        </div>
      ) : (
        <div className="ld-lista">
          {asientos.map((a) => {
            const totalDebe = a.movimientos_contables.reduce((s, m) => s + Number(m.debe), 0);
            const totalHaber = a.movimientos_contables.reduce((s, m) => s + Number(m.haber), 0);
            const expandido = expandidos.has(a.id);
            return (
              <div key={a.id} className="ld-asiento">
                {/* Cabecera del asiento */}
                <div className="ld-asiento-header" onClick={() => toggleExpandir(a.id)} role="button" tabIndex={0}>
                  <span className="ld-asiento-chevron">
                    {expandido ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className="ld-asiento-fecha">
                    <Calendar size={14} /> {formatFecha(a.fecha)}
                  </span>
                  <span className="ld-asiento-hora">{formatHora(a.fecha)}</span>
                  <span className="ld-asiento-desc">{a.descripcion}</span>
                  <span className="ld-asiento-metodo">
                    <CreditCard size={13} /> {a.metodo_pago}
                  </span>
                  <span className="ld-asiento-monto ld-monto-debe">{formatMonto(totalDebe)}</span>
                  <span className="ld-asiento-monto ld-monto-haber">{formatMonto(totalHaber)}</span>
                </div>

                {/* Detalle de movimientos */}
                {expandido && (
                  <div className="ld-movimientos">
                    <div className="ld-mov-header">
                      <span className="ld-mov-col-cuenta">Cuenta</span>
                      <span className="ld-mov-col-monto">Debe</span>
                      <span className="ld-mov-col-monto">Haber</span>
                    </div>
                    {a.movimientos_contables.map((m) => {
                      const color = m.cuenta ? COLORES_TIPO[m.cuenta.tipo] : null;
                      return (
                        <div key={m.id} className="ld-mov-fila">
                          <span className="ld-mov-col-cuenta">
                            {color && <span className="ld-mov-badge" style={{ background: color.bg, color: color.texto, borderColor: color.borde }}>{m.cuenta?.codigo}</span>}
                            {m.cuenta?.nombre || 'Cuenta no encontrada'}
                          </span>
                          <span className={`ld-mov-col-monto ${Number(m.debe) > 0 ? 'ld-monto-debe' : ''}`}>
                            {Number(m.debe) > 0 ? formatMonto(Number(m.debe)) : '—'}
                          </span>
                          <span className={`ld-mov-col-monto ${Number(m.haber) > 0 ? 'ld-monto-haber' : ''}`}>
                            {Number(m.haber) > 0 ? formatMonto(Number(m.haber)) : '—'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
};

export default LibroDiario;
