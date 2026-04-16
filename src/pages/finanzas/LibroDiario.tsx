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
  RefreshCw, Pencil
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ModalEditarMovimiento from '../../components/cajas-bancos/ModalEditarMovimiento';

interface MovimientoExtendido {
  id: string;
  debe: number;
  haber: number;
  fecha: string;
  descripcion: string;
  nro_transaccion: string;
  asiento_id: string;
  cuenta_id: string;
  cuenta_nombre: string;
  conciliado: boolean;
}

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
  nro_transaccion: string;
  created_at: string;
  movimientos_contables: Movimiento[];
}

interface LineaForm {
  cuenta_contable_id: string;
  debe: string;
  haber: string;
}



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

  const [mostrarForm, setMostrarForm] = useState(false);
  const [formDesc, setFormDesc] = useState('');
  const [formFecha, setFormFecha] = useState<string>(new Date().toISOString().split('T')[0]);
  const [formNroTransaccion, setFormNroTransaccion] = useState('');
  const [formLineas, setFormLineas] = useState<LineaForm[]>([
    { cuenta_contable_id: '', debe: '', haber: '' },
    { cuenta_contable_id: '', debe: '', haber: '' },
  ]);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [_formExito, setFormExito] = useState<string | null>(null);

  const [userRol, setUserRol] = useState('');
  const [movEditar, setMovEditar] = useState<MovimientoExtendido | null>(null);

  const cargarAsientos = async () => {
    setCargando(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase.from('usuarios').select('escuela_id, rol').eq('id', user.id).single();
    const escuelaId = userData?.escuela_id;
    if (userData?.rol) setUserRol(userData.rol);

    const { data, error: err } = await supabase
      .from('asientos_contables')
      .select(`
        id, fecha, descripcion, nro_transaccion, created_at,
        movimientos_contables (
          id, cuenta_contable_id, debe, haber, conciliado,
          cuenta:plan_cuentas ( id, codigo, nombre, tipo )
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

  const [asientoEditandoId, setAsientoEditandoId] = useState<string | null>(null);

  const handleEditarAsiento = (a: Asiento) => {
    if (a.movimientos_contables.some(m => m.conciliado)) {
      alert('Contiene movimientos conciliados. Edición denegada.');
      return;
    }
    setAsientoEditandoId(a.id);
    setFormDesc(a.descripcion);
    setFormFecha(a.fecha ? new Date(a.fecha).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
    setFormNroTransaccion(a.nro_transaccion || '');
    setFormLineas(a.movimientos_contables.map(m => ({
      cuenta_contable_id: m.cuenta_contable_id,
      debe: parseFloat(String(m.debe)) > 0 ? String(m.debe) : '',
      haber: parseFloat(String(m.haber)) > 0 ? String(m.haber) : ''
    })));
    setMostrarForm(true);
  };

  const guardarAsiento = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!formDesc.trim() || !totalesForm.cuadrado || !formFecha) { setFormError('Error en cuadre, descripción o fecha.'); return; }
    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from('usuarios').select('id, escuela_id, sucursal_id').eq('id', user?.id).single();
    
    const movsValidos = formLineas.filter(l => l.cuenta_contable_id && (parseFloat(l.debe) > 0 || parseFloat(l.haber) > 0)).map(l => ({
      cuenta_contable_id: l.cuenta_contable_id,
      debe: parseFloat(l.debe) || 0,
      haber: parseFloat(l.haber) || 0,
    }));

    if (asientoEditandoId) {
       // Editar existente
       const { error: rpcErr } = await supabase.rpc('rpc_actualizar_asiento_completo', {
         p_payload: {
            asiento_id: asientoEditandoId,
            descripcion: formDesc.trim(),
            fecha: formFecha,
            nro_transaccion: formNroTransaccion.trim() || null,
            lineas: movsValidos
         }
       });
       if (rpcErr) { setFormError(rpcErr.message); setGuardando(false); return; }
       setFormExito('Asiento Actualizado.');
    } else {
       // Nuevo asiento manual
       const payload = {
         escuela_id: userData?.escuela_id,
         sucursal_id: userData?.sucursal_id,
         usuario_id: userData?.id,
         descripcion: formDesc.trim(),
         fecha: formFecha,
         metodo_pago: 'efectivo',
         nro_transaccion: formNroTransaccion.trim() || null,
         movimientos: movsValidos,
       };
       const { error: rpcErr } = await supabase.rpc('rpc_procesar_transaccion_financiera', { p_payload: payload });
       if (rpcErr) { setFormError(rpcErr.message); setGuardando(false); return; }
       setFormExito('Registrado.');
    }

    setFormDesc('');
    setFormNroTransaccion('');
    setFormFecha(new Date().toISOString().split('T')[0]);
    setFormLineas([{ cuenta_contable_id: '', debe: '', haber: '' }, { cuenta_contable_id: '', debe: '', haber: '' }]);
    setAsientoEditandoId(null);
    setMostrarForm(false);
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
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 1fr) minmax(200px, 3fr) minmax(120px, 1.5fr)', gap: '1rem', marginBottom: '1rem' }}>
            <div className="form-campo">
              <label>Fecha</label>
              <input type="date" value={formFecha} onChange={e => setFormFecha(e.target.value)} required />
            </div>
            <div className="form-campo">
              <label>Glosa / Descripción</label>
              <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Descripción del asiento..." required />
            </div>
            <div className="form-campo">
              <label>Nro. Transacción</label>
              <input type="text" value={formNroTransaccion} onChange={e => setFormNroTransaccion(e.target.value)} placeholder="Ej: 00123..." />
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
             <div style={{ display: 'flex', gap: '1rem' }}>
               {asientoEditandoId && (
                 <button type="button" onClick={() => { setAsientoEditandoId(null); setMostrarForm(false); }} disabled={guardando} style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-color)', padding: '0.5rem 1rem', borderRadius: '4px', cursor: 'pointer' }}>
                   Cancelar
                 </button>
               )}
               <button type="submit" className="btn-guardar-cuenta" disabled={guardando || !totalesForm.cuadrado}>
                 {guardando ? (asientoEditandoId ? 'Actualizando...' : 'Registrando...') : (asientoEditandoId ? 'Guardar Cambios' : 'Registrar Asiento Contable')}
               </button>
             </div>
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
              <th className="excel-th" style={{ width: '50px' }}></th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={6} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>Cargando datos...</td></tr>
            ) : asientos.length === 0 ? (
              <tr><td colSpan={6} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>No hay registros.</td></tr>
            ) : (
              asientos.map((a, idx) => (
                <React.Fragment key={a.id}>
                  {/* Fila Encabezado Asiento - Intercalado Azul y Blanco */}
                  <tr style={{ background: 'rgba(255,255,255,0.02)', fontWeight: 800 }}>
                    <td className="excel-td">{formatFecha(a.fecha)}</td>
                    <td className="excel-td" colSpan={2} style={{ color: idx % 2 === 0 ? 'var(--secondary)' : 'var(--text-primary)' }}>
                      {a.descripcion.toUpperCase()} 
                      {a.nro_transaccion && (
                        <span style={{ marginLeft: '1rem', fontStyle: 'italic', fontWeight: 400, fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                          (Nro: {a.nro_transaccion})
                        </span>
                      )}
                    </td>
                    <td className="excel-td excel-monto"></td>
                    <td className="excel-td excel-monto"></td>
                    <td className="excel-td" style={{ textAlign: 'center' }}>
                      {!a.movimientos_contables.some(m => m.conciliado) && (
                        <button
                          onClick={() => handleEditarAsiento(a)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--secondary)', opacity: 0.7 }}
                          title="Editar Asiento Manual"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </td>
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
                        <td className="excel-td"></td>
                      </tr>
                     );
                  })}
                  {/* Fila de separación vacía (línea de excel) */}
                  <tr style={{ height: '8px' }}><td colSpan={6} style={{ border: 'none', background: 'transparent' }}></td></tr>
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
