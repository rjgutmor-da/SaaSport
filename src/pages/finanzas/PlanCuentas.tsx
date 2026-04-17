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

/** Formatea un número como moneda (Bs) */
const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PlanCuentas: React.FC = () => {
  const navigate = useNavigate();
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoCuenta | 'todos'>('todos');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [saldos, setSaldos] = useState<Record<string, { debe: number, haber: number }>>({});

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
  const [idEnEdicion, setIdEnEdicion] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState('');
  const [editCodigo, setEditCodigo] = useState('');
  const [editTransaccional, setEditTransaccional] = useState(true);
  const [guardandoEdit, setGuardandoEdit] = useState(false);
  const [formCreandoPadre, setFormCreandoPadre] = useState<string | null>(null); // código del padre donde se crea

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
    
    // 2. Cargar saldos agrupados
    const { data: dataSaldos } = await supabase
      .from('movimientos_contables')
      .select('cuenta_contable_id, debe, haber');

    const mapaSaldos: Record<string, { debe: number, haber: number }> = {};
    (dataSaldos ?? []).forEach(m => {
      if (!mapaSaldos[m.cuenta_contable_id]) mapaSaldos[m.cuenta_contable_id] = { debe: 0, haber: 0 };
      mapaSaldos[m.cuenta_contable_id].debe += Number(m.debe) || 0;
      mapaSaldos[m.cuenta_contable_id].haber += Number(m.haber) || 0;
    });
    setSaldos(mapaSaldos);

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

  /** Calcula el saldo final (Debe/Haber o según naturaleza) incluyendo hijos */
  const saldosCompletos = useMemo(() => {
    const res: Record<string, number> = {};
    
    // Primero, saldos netos de cuentas transaccionales
    cuentas.forEach(c => {
      if (c.es_transaccional) {
        const s = saldos[c.id] || { debe: 0, haber: 0 };
        // Naturaleza: Activo y Gasto aumentan por el Debe. Pasivo, Patrimonio e Ingreso por el Haber.
        if (c.tipo === 'activo' || c.tipo === 'gasto') {
          res[c.codigo] = s.debe - s.haber;
        } else {
          res[c.codigo] = s.haber - s.debe;
        }
      } else {
        res[c.codigo] = 0;
      }
    });

    // Luego, sumar hacia los padres (de niveles profundos a niveles altos)
    const codigosOrdenados = [...cuentas].map(c => c.codigo).sort((a, b) => b.length - a.length);
    codigosOrdenados.forEach(cod => {
      const partes = cod.split('.');
      if (partes.length > 1) {
        const padreCod = partes.slice(0, -1).join('.');
        if (res[padreCod] !== undefined) {
          res[padreCod] += res[cod] || 0;
        }
      }
    });

    return res;
  }, [cuentas, saldos]);

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
    return (Object.keys(ETIQUETAS_TIPO) as TipoCuenta[]).map(tipo => {
      // Sumar solo los niveles raíz para evitar duplicar montos
      const totalRaiz = cuentas
        .filter(c => c.tipo === tipo && c.codigo.split('.').length === 1)
        .reduce((acc, curr) => acc + (saldosCompletos[curr.codigo] || 0), 0);

      return {
        tipo,
        cantidad: cuentas.filter(c => c.tipo === tipo).length,
        total: totalRaiz
      };
    });
  }, [cuentas, saldosCompletos]);

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
    const cod = formCodigo.trim();
    const nom = formNombre.trim();
    if (!cod || !nom) { setFormError('Requerido.'); return; }

    // Evitar duplicados
    if (cuentas.some(c => c.codigo === cod)) {
      setFormError(`El código "${cod}" ya existe en el plan de cuentas.`);
      return;
    }

    setGuardando(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase.from('usuarios').select('escuela_id').eq('id', user?.id).single();
    const { error: insertErr } = await supabase.from('plan_cuentas').insert({
      escuela_id: userData?.escuela_id,
      codigo: cod,
      nombre: nom,
      tipo: formTipo,
      es_transaccional: formTransaccional,
    });
    if (insertErr) { setFormError(insertErr.message); setGuardando(false); return; }
    setFormExito('Cuenta creada correctamente.');
    setFormCodigo(''); setFormNombre(''); setPadreCodigo('');
    setGuardando(false);
    setFormCreandoPadre(null);
    cargarCuentas();
    // Opcional: ocultar form tras éxito
    setTimeout(() => { setMostrarForm(false); setFormExito(null); }, 2000);
  };

  const abrirEdicionInSitu = (cuenta: CuentaContable) => {
    setIdEnEdicion(cuenta.id);
    setEditNombre(cuenta.nombre);
    setEditCodigo(cuenta.codigo);
    setEditTransaccional(cuenta.es_transaccional);
  };

  const guardarEdicionCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idEnEdicion || !editNombre.trim() || !editCodigo.trim()) return;

    // Evitar duplicados (excluyendo la cuenta actual)
    if (cuentas.some(c => c.codigo === editCodigo.trim() && c.id !== idEnEdicion)) {
      alert(`El código "${editCodigo.trim()}" ya está en uso por otra cuenta.`);
      return;
    }

    setGuardandoEdit(true);

    const { error: updateErr } = await supabase
      .from('plan_cuentas')
      .update({
        codigo: editCodigo.trim(),
        nombre: editNombre.trim(),
        es_transaccional: editTransaccional,
      })
      .eq('id', idEnEdicion);

    if (updateErr) {
      alert(`Error al actualizar: ${updateErr.message}`);
    } else {
      setIdEnEdicion(null);
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

      {/* El formulario superior se mantiene solo si se activa desde el botón global, 
          pero ahora favorecemos la creación in-situ mediante botones en la tabla */}
      {mostrarForm && !formCreandoPadre && (
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


      {/* ─── Tarjetas de Resumen (Totales en Pesos/Cuentas) ─── */}
      <div className="pc-stats-grid" style={{ marginBottom: '1rem', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem' }}>
        {estadisticas.map(({ tipo, cantidad, total }) => {
          const colores = COLORES_TIPO[tipo];
          return (
            <div 
              key={tipo} 
              className={`cxc-mini-stat ${filtroTipo === tipo ? 'cxc-mini-stat--activo' : ''}`}
              style={{ padding: '0.6rem 0.8rem', flexDirection: 'column', alignItems: 'flex-start', borderLeft: `4px solid ${colores.borde}`, height: '80px', justifyContent: 'center' }}
              onClick={() => setFiltroTipo(filtroTipo === tipo ? 'todos' : tipo)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                <span style={{ color: colores.texto }}>{ICONOS_TIPO[tipo]}</span>
                <span className="cxc-mini-label" style={{ fontSize: '0.75rem' }}>{ETIQUETAS_TIPO[tipo]}</span>
              </div>
              <span className="cxc-mini-num" style={{ fontSize: '1.1rem' }}>Bs {total.toFixed(2)}</span>
              <span style={{ fontSize: '0.65rem', color: 'var(--text-tertiary)' }}>{cantidad} cuentas</span>
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
                  <React.Fragment key={cuenta.id}>
                    <tr 
                      className={`excel-tr ${!cuenta.es_transaccional ? 'excel-tr--grupo' : ''} ${idEnEdicion === cuenta.id ? 'excel-tr--editing' : ''}`}
                      onClick={() => !idEnEdicion && cuenta.tieneHijos && toggleExpandir(cuenta.codigo)}
                      style={{ cursor: (cuenta.tieneHijos && !idEnEdicion) ? 'pointer' : 'default' }}
                    >
                      <td className="excel-td excel-cell-codigo">
                        {idEnEdicion === cuenta.id ? (
                          <input 
                            type="text" 
                            value={editCodigo} 
                            onChange={e => setEditCodigo(e.target.value)}
                            style={{ width: '100%', padding: '4px', border: '1px solid var(--primary)', borderRadius: '4px' }}
                          />
                        ) : cuenta.codigo}
                      </td>
                      <td className="excel-td">
                        <span className="excel-indent" style={{ width: `${cuenta.nivel * 20}px` }}></span>
                        {idEnEdicion === cuenta.id ? (
                          <input 
                            type="text" 
                            value={editNombre} 
                            onChange={e => setEditNombre(e.target.value)}
                            style={{ width: '80%', padding: '4px', border: '1px solid var(--primary)', borderRadius: '4px' }}
                          />
                        ) : (
                          <>
                            <span style={{ marginRight: '8px', opacity: 0.6 }}>
                              {cuenta.tieneHijos ? (expandidos.has(cuenta.codigo) ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{ width: 14, display: 'inline-block' }}></span>}
                            </span>
                            {cuenta.tieneHijos ? <Folder size={14} style={{ marginRight: '6px', color: colores.texto }} /> : <FileText size={14} style={{ marginRight: '6px', opacity: 0.5 }} />}
                            {cuenta.nombre}
                          </>
                        )}
                      </td>
                      <td className="excel-td excel-cell-tipo">
                        <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: colores.bg, color: colores.texto, border: `1px solid ${colores.borde}` }}>
                          {cuenta.tipo.toUpperCase()}
                        </span>
                      </td>
                      <td className="excel-td excel-cell-trans">
                        {idEnEdicion === cuenta.id ? (
                          <input 
                            type="checkbox" 
                            checked={editTransaccional} 
                            onChange={e => setEditTransaccional(e.target.checked)}
                          />
                        ) : (
                          cuenta.es_transaccional ? <span style={{ color: 'var(--success)' }}>✓ SI</span> : <span style={{ opacity: 0.3 }}>—</span>
                        )}
                      </td>
                      <td className="excel-td excel-monto" style={{ color: (saldosCompletos[cuenta.codigo] || 0) < 0 ? 'var(--danger)' : 'inherit' }}>
                        {fmtMonto(saldosCompletos[cuenta.codigo] || 0)}
                      </td>
                      <td className="excel-td" style={{ textAlign: 'center' }}>
                        {idEnEdicion === cuenta.id ? (
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button onClick={guardarEdicionCuenta} title="Guardar" style={{ color: 'var(--success)', background: 'none', border: 'none' }}><Check size={16} /></button>
                            <button onClick={() => setIdEnEdicion(null)} title="Cancelar" style={{ color: 'var(--danger)', background: 'none', border: 'none' }}><X size={16} /></button>
                          </div>
                        ) : (
                          (cuenta.escuela_id === null || cuenta.codigo === '1.1.7') ? (
                            <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'var(--bg-panel)', color: 'var(--text-tertiary)', border: '1px solid var(--border)' }}>
                              SISTEMA
                            </span>
                          ) : (
                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                              {!cuenta.es_transaccional && (
                                <button 
                                  className="btn-refrescar" 
                                  style={{ padding: '4px', background: 'none', border: 'none', color: 'var(--primary)' }} 
                                  title="Agregar Subcuenta"
                                  onClick={(e) => { e.stopPropagation(); handleCambioPadre(cuenta.codigo); setFormCreandoPadre(cuenta.codigo); }}
                                >
                                  <Plus size={14} />
                                </button>
                              )}
                              <button 
                                className="btn-refrescar" 
                                style={{ padding: '4px', background: 'none', border: 'none', color: 'var(--text-tertiary)' }} 
                                title="Editar"
                                onClick={(e) => { e.stopPropagation(); abrirEdicionInSitu(cuenta); }}
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
                          )
                        )}
                      </td>
                    </tr>
                    
                    {/* Fila de creación in-situ */}
                    {formCreandoPadre === cuenta.codigo && (
                      <tr className="excel-tr excel-tr--creating">
                        <td className="excel-td excel-cell-codigo">
                          <input 
                            type="text" 
                            value={formCodigo} 
                            onChange={e => setFormCodigo(e.target.value)}
                            placeholder="Código"
                            style={{ width: '100%', padding: '4px', border: '1px solid var(--primary)', borderRadius: '4px' }}
                          />
                        </td>
                        <td className="excel-td">
                          <span className="excel-indent" style={{ width: `${(cuenta.nivel + 1) * 20}px` }}></span>
                          <input 
                            type="text" 
                            value={formNombre} 
                            onChange={e => setFormNombre(e.target.value)}
                            placeholder="Nombre de la subcuenta"
                            style={{ width: '80%', padding: '4px', border: '1px solid var(--primary)', borderRadius: '4px' }}
                          />
                        </td>
                        <td className="excel-td">
                           <span style={{ fontSize: '0.65rem' }}>{cuenta.tipo.toUpperCase()}</span>
                        </td>
                        <td className="excel-td">
                           <input type="checkbox" checked={formTransaccional} onChange={e => setFormTransaccional(e.target.checked)} />
                        </td>
                        <td className="excel-td"></td>
                        <td className="excel-td" style={{ textAlign: 'center' }}>
                          <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                            <button onClick={guardarCuenta} title="Crear" style={{ color: 'var(--primary)', background: 'none', border: 'none' }}><Check size={16} /></button>
                            <button onClick={() => setFormCreandoPadre(null)} title="Cancelar" style={{ color: 'var(--danger)', background: 'none', border: 'none' }}><X size={16} /></button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
