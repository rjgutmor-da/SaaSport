/**
 * PlanCuentas.tsx
 * Pantalla principal del Plan de Cuentas contable.
 * Rediseño v3: Estilo Excel escalonado con tarjetas de resumen.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import type { CuentaContable, NodoCuenta, TipoCuenta } from '../../types/finanzas';
import { COLORES_TIPO, ETIQUETAS_TIPO } from '../../types/finanzas';
import {
  Search, RefreshCw, ChevronLeft, Plus, X, Check,
  TrendingUp, TrendingDown, Landmark, ArrowDownUp, Wallet,
  Folder, FileText, ChevronDown, ChevronRight, Edit2, Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ICONOS_TIPO: Record<TipoCuenta, React.ReactNode> = {
  activo: <TrendingUp size={16} />,
  pasivo: <TrendingDown size={16} />,
  patrimonio: <Landmark size={16} />,
  ingreso: <ArrowDownUp size={16} />,
  gasto: <Wallet size={16} />,
};

const PlanCuentas: React.FC = () => {
  const navigate = useNavigate();
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoCuenta | 'todos'>('todos');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  // Estado del formulario
  const [mostrarForm, setMostrarForm] = useState(false);
  const [padreCodigo, setPadreCodigo] = useState('');
  const [formCodigo, setFormCodigo] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formTipo, setFormTipo] = useState<TipoCuenta>('activo');
  const [formTransaccional, setFormTransaccional] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formExito, setFormExito] = useState<string | null>(null);

  // Estado del formulario de edición
  const [cuentaEditando, setCuentaEditando] = useState<CuentaContable | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editTransaccional, setEditTransaccional] = useState(true);
  const [guardandoEdit, setGuardandoEdit] = useState(false);

  // Lista de cuentas que pueden ser padres (no transaccionales y de nivel 2 o superior)
  const cuentasPadre = useMemo(() => {
    return cuentas.filter(c => !c.es_transaccional && c.codigo.split('.').length >= 2).sort((a,b) => a.codigo.localeCompare(b.codigo));
  }, [cuentas]);

  const handleCambioPadre = (cod: string) => {
    setPadreCodigo(cod);
    if (!cod) {
      setFormCodigo('');
      return;
    }
    
    const padre = cuentas.find(c => c.codigo === cod);
    if (padre) {
      setFormTipo(padre.tipo);
      
      // Buscar hijos directos
      const hijosDelPadre = cuentas.filter(c => {
        const partesPadre = cod.split('.');
        const partesHijo = c.codigo.split('.');
        return c.codigo.startsWith(cod + '.') && partesHijo.length === partesPadre.length + 1;
      });

      if (hijosDelPadre.length === 0) {
        setFormCodigo(`${cod}.01`);
      } else {
        const sufijos = hijosDelPadre.map(h => {
          const p = h.codigo.split('.');
          return parseInt(p[p.length - 1], 10);
        });
        const proximo = Math.max(...sufijos) + 1;
        setFormCodigo(`${cod}.${proximo.toString().padStart(2, '0')}`);
      }
    }
  };

  const cargarCuentas = async () => {
    setCargando(true);
    setError(null);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: userData } = await supabase.from('usuarios').select('escuela_id').eq('id', user.id).single();
    const escuelaId = userData?.escuela_id;

    if (!escuelaId) {
      setError('No se pudo determinar tu escuela.');
      setCargando(false);
      return;
    }

    const { data, error: err } = await supabase
      .from('plan_cuentas')
      .select('*')
      .or(`escuela_id.eq.${escuelaId},escuela_id.is.null`)
      .order('codigo', { ascending: true });

    if (err) {
      setError(`Error al cargar el plan de cuentas: ${err.message}`);
      setCargando(false);
      return;
    }
    setCuentas(data ?? []);
    // Expandir automáticamente los primeros niveles
    const initialExpanded = new Set<string>();
    (data ?? []).forEach(c => {
      if (c.codigo.split('.').length <= 2) initialExpanded.add(c.codigo);
    });
    setExpandidos(initialExpanded);
    setCargando(false);
  };

  useEffect(() => { cargarCuentas(); }, []);

  const toggleExpandir = (codigo: string) => {
    setExpandidos(prev => {
      const nuevo = new Set(prev);
      if (nuevo.has(codigo)) nuevo.delete(codigo); else nuevo.add(codigo);
      return nuevo;
    });
  };

  const cuentasFiltradas = useMemo(() => {
    let lista = cuentas;
    if (filtroTipo !== 'todos') lista = lista.filter(c => c.tipo === filtroTipo);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(c => c.codigo.toLowerCase().includes(q) || c.nombre.toLowerCase().includes(q));
    }
    return lista;
  }, [cuentas, filtroTipo, busqueda]);

  // Lista aplanada con visibilidad según expansión
  const listaVisible = useMemo(() => {
    const res: Array<CuentaContable & { nivel: number; tieneHijos: boolean; visible: boolean }> = [];
    const codigos = cuentasFiltradas.map(c => c.codigo);
    
    cuentasFiltradas.forEach(c => {
      const nivel = c.codigo.split('.').length - 1;
      const partes = c.codigo.split('.');
      const tieneHijos = cuentasFiltradas.some(h => h.codigo.startsWith(c.codigo + '.') && h.codigo !== c.codigo);
      
      // Un nodo es visible si todos sus ancestros están expandidos
      let visible = true;
      for (let i = 1; i < partes.length; i++) {
        const padreCodigo = partes.slice(0, i).join('.');
        if (!expandidos.has(padreCodigo) && !busqueda) {
          visible = false;
          break;
        }
      }
      
      if (visible || busqueda) {
        res.push({ ...c, nivel, tieneHijos, visible });
      }
    });
    return res;
  }, [cuentasFiltradas, expandidos, busqueda]);

  const estadisticas = useMemo(() => {
    return (Object.keys(ETIQUETAS_TIPO) as TipoCuenta[]).map(tipo => ({
      tipo,
      cantidad: cuentas.filter(c => c.tipo === tipo).length,
      // Placeholder para total real en pesos si estuviera disponible en BD
      total: 0 
    }));
  }, [cuentas]);

  const eliminarCuenta = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la cuenta "${nombre}"? Esta acción no se puede deshacer.`)) return;

    // Verificar movimientos
    const { count, error: errCount } = await supabase
      .from('movimientos_contables')
      .select('id', { count: 'exact', head: true })
      .eq('cuenta_contable_id', id);
    
    if (errCount) {
      setError(`Error al verificar la cuenta: ${errCount.message}`);
      return;
    }

    if (count && count > 0) {
      alert('No es posible eliminar esta cuenta porque ya tiene movimientos contables registrados.');
      return;
    }

    const { error: errDel } = await supabase.from('plan_cuentas').delete().eq('id', id);
    if (errDel) {
      alert(`Error al eliminar: ${errDel.message}\n(Código: ${errDel.code}, Detalles: ${errDel.details})`);
      setError(`Error al eliminar: ${errDel.message}`);
    } else {
      cargarCuentas();
    }
  };

  const guardarCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormExito(null);
    if (!formCodigo.trim() || !formNombre.trim()) { setFormError('Requerido.'); return; }
    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from('usuarios').select('escuela_id').eq('id', user?.id).single();
    const { error: insertErr } = await supabase.from('plan_cuentas').insert({
      escuela_id: userData?.escuela_id,
      codigo: formCodigo.trim(),
      nombre: formNombre.trim(),
      tipo: formTipo,
      es_transaccional: formTransaccional,
    });
    if (insertErr) { setFormError(insertErr.message); setGuardando(false); return; }
    setFormExito('Cuenta creada correctamente.');
    setFormCodigo(''); setFormNombre(''); setPadreCodigo('');
    setGuardando(false);
    cargarCuentas();
    // Opcional: ocultar form tras éxito
    setTimeout(() => setMostrarForm(false), 2000);
  };

  const abrirModalEdicion = (cuenta: CuentaContable) => {
    setCuentaEditando(cuenta);
    setEditNombre(cuenta.nombre);
    setEditTransaccional(cuenta.es_transaccional);
  };

  const guardarEdicionCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cuentaEditando || !editNombre.trim()) return;
    setGuardandoEdit(true);

    const { error: updateErr } = await supabase
      .from('plan_cuentas')
      .update({
        nombre: editNombre.trim(),
        es_transaccional: editTransaccional,
      })
      .eq('id', cuentaEditando.id);

    if (updateErr) {
      alert(`Error al actualizar: ${updateErr.message}`);
    } else {
      setCuentaEditando(null);
      cargarCuentas();
    }
    setGuardandoEdit(false);
  };

  return (
    <main className="main-content cxc-main">
      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/contabilidad')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <h1 className="cxc-titulo-principal">Plan de Cuentas</h1>
        </div>
        <div className="cxc-header-acciones">
          <button className="btn-nueva-cuenta" onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? <X size={18} /> : <Plus size={18} />}
            {mostrarForm ? 'Cerrar' : 'Nueva Cuenta'}
          </button>
          <button className="btn-refrescar" onClick={cargarCuentas} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {mostrarForm && (
        <section className="cxc-card" style={{ marginBottom: '1.5rem', padding: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Registrar Nueva Cuenta</h3>
            <button className="btn-close" onClick={() => setMostrarForm(false)}><X size={18} /></button>
          </div>

          <form onSubmit={guardarCuenta}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-campo">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Ubicación (Cuenta Padre)</label>
                <select 
                  value={padreCodigo} 
                  onChange={e => handleCambioPadre(e.target.value)}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border)' }}
                >
                  <option value="">-- Cuenta de Nivel Superior --</option>
                  {cuentasPadre.map(c => (
                    <option key={c.id} value={c.codigo}>{c.codigo} - {c.nombre}</option>
                  ))}
                </select>
              </div>

              <div className="form-campo">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Código de Cuenta</label>
                <input 
                  type="text" 
                  value={formCodigo} 
                  onChange={e => setFormCodigo(e.target.value)} 
                  placeholder="Ej: 1.1.1.01" 
                  required 
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border)' }}
                />
              </div>

              <div className="form-campo" style={{ gridColumn: 'span 2' }}>
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Nombre de la Cuenta</label>
                <input 
                  type="text" 
                  value={formNombre} 
                  onChange={e => setFormNombre(e.target.value)} 
                  placeholder="Nombre descriptivo" 
                  required 
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border)' }}
                />
              </div>

              <div className="form-campo">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Tipo</label>
                <select 
                  value={formTipo} 
                  onChange={e => setFormTipo(e.target.value as TipoCuenta)}
                  disabled={!!padreCodigo}
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border)', background: padreCodigo ? 'var(--bg-card)' : 'white' }}
                >
                  {Object.entries(ETIQUETAS_TIPO).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              <div className="form-campo" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.6rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input 
                    type="checkbox" 
                    checked={formTransaccional} 
                    onChange={e => setFormTransaccional(e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  /> 
                  <strong>Es Transaccional</strong> (Recibe movimientos)
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
              {formError && <span style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{formError}</span>}
              {formExito && <span style={{ color: 'var(--success)', fontSize: '0.85rem' }}>{formExito}</span>}
              <button type="submit" className="btn-guardar-cuenta" disabled={guardando} style={{ padding: '0.7rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Check size={18} /> {guardando ? 'Guardando...' : 'Crear Cuenta'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ─── Formulario de Edición ─── */}
      {cuentaEditando && (
        <section className="cxc-card" style={{ marginBottom: '1.5rem', padding: '1.5rem', background: 'var(--bg-panel)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600 }}>Editar Cuenta: {cuentaEditando.codigo}</h3>
            <button className="btn-close" onClick={() => setCuentaEditando(null)}><X size={18} /></button>
          </div>

          <form onSubmit={guardarEdicionCuenta}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '1rem', marginBottom: '1rem', alignItems: 'end' }}>
              <div className="form-campo">
                <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Nombre de la Cuenta</label>
                <input 
                  type="text" 
                  value={editNombre} 
                  onChange={e => setEditNombre(e.target.value)} 
                  required 
                  style={{ width: '100%', padding: '0.6rem', borderRadius: '8px', border: '1px solid var(--border)' }}
                />
              </div>

              <div className="form-campo" style={{ paddingBottom: '0.6rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
                  <input 
                    type="checkbox" 
                    checked={editTransaccional} 
                    onChange={e => setEditTransaccional(e.target.checked)}
                    style={{ width: '18px', height: '18px' }}
                  /> 
                  <strong>Es Transaccional</strong>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', alignItems: 'center' }}>
              <button type="submit" className="btn-guardar-cuenta" disabled={guardandoEdit} style={{ padding: '0.7rem 1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Check size={18} /> {guardandoEdit ? 'Guardando...' : 'Guardar Cambios'}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ─── Tarjetas de Resumen (Totales en Pesos/Cuentas) ─── */}
      <div className="pc-stats-grid" style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
        {estadisticas.map(({ tipo, cantidad, total }) => {
          const colores = COLORES_TIPO[tipo];
          return (
            <div 
              key={tipo} 
              className={`cxc-mini-stat ${filtroTipo === tipo ? 'cxc-mini-stat--activo' : ''}`}
              style={{ padding: '1rem', flexDirection: 'column', alignItems: 'flex-start', borderLeft: `4px solid ${colores.borde}` }}
              onClick={() => setFiltroTipo(filtroTipo === tipo ? 'todos' : tipo)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <span style={{ color: colores.texto }}>{ICONOS_TIPO[tipo]}</span>
                <span className="cxc-mini-label">{ETIQUETAS_TIPO[tipo]}</span>
              </div>
              <span className="cxc-mini-num" style={{ fontSize: '1.2rem' }}>Bs {total.toFixed(2)}</span>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>{cantidad} cuentas</span>
            </div>
          );
        })}
      </div>

      {/* ─── Barra de Búsqueda ─── */}
      <div className="cxc-busqueda-bar">
        <div className="pc-busqueda" style={{ flex: 1 }}>
          <Search size={16} className="pc-busqueda-icono" />
          <input type="text" placeholder="Buscar cuentas por código o nombre..." value={busqueda} onChange={e => setBusqueda(e.target.value)} className="pc-busqueda-input" />
        </div>
      </div>

      {/* ─── Tabla Excel Escalonada ─── */}
      <div className="excel-wrapper">
        <table className="excel-table">
          <thead>
            <tr>
              <th className="excel-th excel-cell-codigo">Código</th>
              <th className="excel-th">Nombre de la Cuenta</th>
              <th className="excel-th excel-cell-tipo">Tipo</th>
              <th className="excel-th excel-cell-trans">Transaccional</th>
              <th className="excel-th" style={{ textAlign: 'right' }}>Saldo (Bs)</th>
              <th className="excel-th" style={{ textAlign: 'center', width: '100px' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr><td colSpan={5} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>Cargando...</td></tr>
            ) : listaVisible.length === 0 ? (
              <tr><td colSpan={5} className="excel-td" style={{ textAlign: 'center', padding: '2rem' }}>No se encontraron cuentas.</td></tr>
            ) : (
              listaVisible.map(cuenta => {
                const colores = COLORES_TIPO[cuenta.tipo];
                return (
                  <tr 
                    key={cuenta.id} 
                    className={`excel-tr ${!cuenta.es_transaccional ? 'excel-tr--grupo' : ''}`}
                    onClick={() => cuenta.tieneHijos && toggleExpandir(cuenta.codigo)}
                    style={{ cursor: cuenta.tieneHijos ? 'pointer' : 'default' }}
                  >
                    <td className="excel-td excel-cell-codigo">
                      {cuenta.codigo}
                    </td>
                    <td className="excel-td">
                      <span className="excel-indent" style={{ width: `${cuenta.nivel * 20}px` }}></span>
                      <span style={{ marginRight: '8px', opacity: 0.6 }}>
                        {cuenta.tieneHijos ? (expandidos.has(cuenta.codigo) ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14, display: 'inline-block' }}></span>}
                      </span>
                      {cuenta.tieneHijos ? <Folder size={14} style={{ marginRight: '6px', color: colores.texto }} /> : <FileText size={14} style={{ marginRight: '6px', opacity: 0.5 }} />}
                      {cuenta.nombre}
                    </td>
                    <td className="excel-td excel-cell-tipo">
                      <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: colores.bg, color: colores.texto, border: `1px solid ${colores.borde}` }}>
                        {cuenta.tipo.toUpperCase()}
                      </span>
                    </td>
                    <td className="excel-td excel-cell-trans">
                      {cuenta.es_transaccional ? <span style={{ color: 'var(--success)' }}>✓ SI</span> : <span style={{ opacity: 0.3 }}>—</span>}
                    </td>
                    <td className="excel-td excel-monto">
                      0.00
                    </td>
                    <td className="excel-td" style={{ textAlign: 'center' }}>
                      {cuenta.escuela_id === null ? (
                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-panel)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}>
                          SISTEMA
                        </span>
                      ) : cuenta.codigo.split('.').length > 2 && (
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                          <button 
                            className="btn-refrescar" 
                            style={{ padding: '4px', background: 'none', border: 'none', color: 'var(--text-tertiary)' }} 
                            title="Editar"
                            onClick={(e) => { e.stopPropagation(); abrirModalEdicion(cuenta); }}
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            className="btn-refrescar" 
                            style={{ padding: '4px', background: 'none', border: 'none', color: 'var(--danger-color)' }} 
                            title="Eliminar"
                            onClick={(e) => { e.stopPropagation(); eliminarCuenta(cuenta.id, cuenta.nombre); }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
};

export default PlanCuentas;
