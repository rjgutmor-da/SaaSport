/**
 * LibroDiario.tsx
 * Pantalla del Libro Diario — Registro de Asientos Contables.
 * Rediseño v3: Estilo Excel imitando hojas de cálculo.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CuentaContable, TipoCuenta } from '../../types/finanzas';
import { COLORES_TIPO } from '../../types/finanzas';
import {
  ChevronLeft, Plus, X,
  RefreshCw
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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

const formatMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatFecha = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const LibroDiario: React.FC = () => {
  const navigate = useNavigate();
  const [asientos, setAsientos] = useState<Asiento[]>([]);
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [_error, setError] = useState<string | null>(null);

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
  const [_formExito, setFormExito] = useState<string | null>(null);

  const cargarAsientos = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    const escuelaId = userData?.escuela_id;

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
      .limit(100);

    if (err) { setError(err.message); setCargando(false); return; }
    setAsientos((data as unknown as Asiento[]) ?? []);
    setCargando(false);
  };

  const cargarCuentas = async () => {
    const { data } = await supabase.from('plan_cuentas').select('*').eq('es_transaccional', true).order('codigo');
    setCuentas(data ?? []);
  };

  useEffect(() => { cargarAsientos(); cargarCuentas(); }, []);

  const totalesForm = useMemo(() => {
    const totalDebe = formLineas.reduce((s, l) => s + (parseFloat(l.debe) || 0), 0);
    const totalHaber = formLineas.reduce((s, l) => s + (parseFloat(l.haber) || 0), 0);
    return { totalDebe, totalHaber, cuadrado: Math.abs(totalDebe - totalHaber) < 0.01 && totalDebe > 0 };
  }, [formLineas]);

  const guardarAsiento = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formDesc.trim() || !totalesForm.cuadrado) { setFormError('Error en cuadre o descripción.'); return; }
    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from('usuarios').select('id, escuela_id, sucursal_id').eq('id', user?.id).single();
    
    const payload = {
      escuela_id: userData?.escuela_id,
      sucursal_id: userData?.sucursal_id,
      usuario_id: userData?.id,
      descripcion: formDesc.trim(),
      metodo_pago: formMetodo,
      movimientos: formLineas.filter(l => l.cuenta_contable_id && (parseFloat(l.debe) > 0 || parseFloat(l.haber) > 0)).map(l => ({
        cuenta_contable_id: l.cuenta_contable_id,
        debe: parseFloat(l.debe) || 0,
        haber: parseFloat(l.haber) || 0,
      })),
    };

    const { error: rpcErr } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payload });
    if (rpcErr) { setFormError(rpcErr.message); setGuardando(false); return; }
    setFormExito('Registrado.');
    setFormDesc('');
    setFormLineas([{ cuenta_contable_id: '', debe: '', haber: '' }, { cuenta_contable_id: '', debe: '', haber: '' }]);
    setGuardando(false);
    cargarAsientos();
  };

  return (
    <main className="main-content cxc-main">
      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/contabilidad')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <h1 className="cxc-titulo-principal">Libro Diario</h1>
        </div>
        <div className="cxc-header-acciones">
          <button className="btn-nueva-cuenta" onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? <X size={18} /> : <Plus size={18} />}
            {mostrarForm ? 'Cerrar' : 'Nuevo Asiento'}
          </button>
          <button className="btn-refrescar" onClick={cargarAsientos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Formulario ─── */}
      {mostrarForm && (
        <form className="ld-form" onSubmit={guardarAsiento} style={{ background: 'var(--bg-card)', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border)', marginBottom: '1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 180px', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-campo">
              <label>Glosa / Descripción</label>
              <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Descripción del asiento..." required />
            </div>
            <div className="form-campo">
              <label>Método de Pago</label>
              <select value={formMetodo} onChange={e => setFormMetodo(e.target.value)}>
                {METODOS_PAGO.map(m => <option key={m.valor} value={m.valor}>{m.etiqueta}</option>)}
              </select>
            </div>
          </div>
          
          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '0.5rem', borderRadius: '6px' }}>
            {formLineas.map((linea, idx) => (
              <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 120px 40px', gap: '0.75rem', marginBottom: '0.5rem' }}>
                <select value={linea.cuenta_contable_id} onChange={e => {
                  const n = [...formLineas]; n[idx].cuenta_contable_id = e.target.value; setFormLineas(n);
                }}>
                  <option value="">— Cuenta —</option>
                  {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} {c.nombre}</option>)}
                </select>
                <input type="number" step="0.01" value={linea.debe} onChange={e => {
                  const n = [...formLineas]; n[idx].debe = e.target.value; n[idx].haber = ''; setFormLineas(n);
                }} placeholder="Debe" />
                <input type="number" step="0.01" value={linea.haber} onChange={e => {
                  const n = [...formLineas]; n[idx].haber = e.target.value; n[idx].debe = ''; setFormLineas(n);
                }} placeholder="Haber" />
                <button type="button" onClick={() => setFormLineas(formLineas.filter((_, i) => i !== idx))} disabled={formLineas.length <= 2} style={{ background: 'var(--danger-bg)', color: 'var(--danger)', border: 'none', borderRadius: '4px' }}>
                  <X size={14} />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setFormLineas([...formLineas, { cuenta_contable_id: '', debe: '', haber: '' }])} style={{ padding: '0.4rem', fontSize: '0.8rem', background: 'none', color: 'var(--secondary)', border: '1px dashed var(--secondary)', borderRadius: '4px', cursor: 'pointer' }}>
              + Agregar Línea
            </button>
          </div>

          <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
             <div style={{ display: 'flex', gap: '2rem' }}>
               <span style={{ fontSize: '0.9rem' }}>Debe: <strong style={{ color: totalesForm.cuadrado ? 'var(--success)' : 'var(--danger)' }}>Bs {totalesForm.totalDebe.toFixed(2)}</strong></span>
               <span style={{ fontSize: '0.9rem' }}>Haber: <strong style={{ color: totalesForm.cuadrado ? 'var(--success)' : 'var(--danger)' }}>Bs {totalesForm.totalHaber.toFixed(2)}</strong></span>
             </div>
             <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !totalesForm.cuadrado}>
               {guardando ? 'Registrando...' : 'Registrar Asiento Contable'}
             </button>
          </div>
          {formError && <p style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.5rem' }}>{formError}</p>}
        </form>
      )}

      {/* ─── Tabla Excel ─── */}
      <div className="excel-wrapper">
        <table className="excel-table">
          <thead>
            <tr>
              <th className="excel-th" style={{ width: '100px' }}>Fecha</th>
              <th className="excel-th" style={{ width: '120px' }}>Código</th>
              <th className="excel-th">Cuenta / Descripción</th>
              <th className="excel-th excel-monto" style={{ width: '120px' }}>Debe (Bs)</th>
              <th className="excel-th excel-monto" style={{ width: '120px' }}>Haber (Bs)</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={5} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>Cargando datos...</td></tr>
            ) : asientos.length === 0 ? (
              <tr><td colSpan={5} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>No hay registros.</td></tr>
            ) : (
              asientos.map((a, idx) => (
                <React.Fragment key={a.id}>
                  {/* Fila Encabezado Asiento - Intercalado Azul y Blanco */}
                  <tr style={{ background: 'rgba(255,255,255,0.02)', fontWeight: 800 }}>
                    <td className="excel-td">{formatFecha(a.fecha)}</td>
                    <td className="excel-td" colSpan={2} style={{ color: idx % 2 === 0 ? 'var(--secondary)' : 'var(--text-primary)' }}>
                      {a.descripcion.toUpperCase()} 
                      <span style={{ marginLeft: '1rem', fontStyle: 'italic', fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        ({a.metodo_pago.toUpperCase()})
                      </span>
                    </td>
                    <td className="excel-td excel-monto"></td>
                    <td className="excel-td excel-monto"></td>
                  </tr>
                  {/* Filas de Movimientos */}
                  {a.movimientos_contables.map((m) => {
                     const color = m.cuenta ? COLORES_TIPO[m.cuenta.tipo] : null;
                     return (
                      <tr key={m.id} className="excel-tr">
                        <td className="excel-td"></td>
                        <td className="excel-td" style={{ fontSize: '0.75rem', color: color?.texto || 'inherit' }}>{m.cuenta?.codigo}</td>
                        <td className="excel-td">
                          {Number(m.haber) > 0 && <span style={{ marginLeft: '2rem' }}></span>}
                          {m.cuenta?.nombre || 'S/N'}
                        </td>
                        <td className="excel-td excel-monto">
                          {Number(m.debe) > 0 ? formatMonto(Number(m.debe)) : ''}
                        </td>
                        <td className="excel-td excel-monto" style={{ color: 'var(--primary)' }}>
                          {Number(m.haber) > 0 ? formatMonto(Number(m.haber)) : ''}
                        </td>
                      </tr>
                     );
                  })}
                  {/* Fila de separación vacía (línea de excel) */}
                  <tr style={{ height: '8px' }}><td colSpan={5} style={{ border: 'none', background: 'transparent' }}></td></tr>
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
};

export default LibroDiario;
