import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { ChevronLeft, Search, RefreshCw, Landmark, ArrowDownRight, ArrowUpRight, CheckCircle2, ArrowRightLeft, CheckSquare, Square, Pencil } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CuentaContable, MovimientoContable, AsientoContable } from '../../types/finanzas';
import ModalTransferencia from '../../components/cajas-bancos/ModalTransferencia';
import ModalMovimientoDirecto from '../../components/cajas-bancos/ModalMovimientoDirecto';
import ModalEditarMovimiento from '../../components/cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../../components/cajas-bancos/ModalDetalleMovimiento';
import { formatFecha } from '../../lib/dateUtils';

import { SidebarContext } from '../../App';
import { useContext } from 'react';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFechaLocal = (iso: string): string => formatFecha(iso);

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

const CajasBancos: React.FC = () => {
  const navigate = useNavigate();
  const { setExtra } = useContext(SidebarContext);

  // Estados
  const [cajas, setCajas] = useState<CuentaContable[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoExtendido[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [filtroCuenta, setFiltroCuenta] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');

  // Aux
  const [escuelaId, setEscuelaId] = useState<string | null>(null);
  const [userRol, setUserRol] = useState<string>('');
  
  // Estados para formularios activos
  const [activeForm, setActiveForm] = useState<'ingreso' | 'salida' | 'transferencia' | null>(null);
  const [formDirty, setFormDirty] = useState(false);

  // Estado para edición de movimientos
  const [movEditar, setMovEditar] = useState<MovimientoExtendido | null>(null);
  const [movDetalle, setMovDetalle] = useState<MovimientoExtendido | null>(null);

  const obtenerEscuelaId = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('escuela_id, rol')
      .eq('id', user.id)
      .single();
    
    if (data?.rol) setUserRol(data.rol);
    return data?.escuela_id ?? null;
  }, []);

  const cargarDatos = useCallback(async () => {
    setCargando(true);
    setError(null);
    const eid = escuelaId || await obtenerEscuelaId();
    if (!eid) {
      setError('No se pudo determinar la escuela. Reinicia sesión.');
      setCargando(false);
      return;
    }
    if (!escuelaId) setEscuelaId(eid);

    // 1. Cargar las cuentas que sean Cajas o Bancos
    const { data: dataCuentas, error: errCuentas } = await supabase
      .from('plan_cuentas')
      .select('*')
      .or(`escuela_id.eq.${eid},escuela_id.is.null`)
      .eq('tipo', 'activo')
      .eq('es_transaccional', true)
      .or('codigo.like.1.1.1.%,codigo.like.1.1.2.%')
      .order('codigo');

    if (errCuentas) {
      setError(`Error al cargar cuentas: ${errCuentas.message}`);
      setCargando(false);
      return;
    }
    
    const listCajas = dataCuentas ?? [];
    setCajas(listCajas);

    if (listCajas.length === 0) {
      setCargando(false);
      return;
    }

    const idsCajas = listCajas.map((c: any) => c.id);

    // 2. Cargar movimientos
    const { data: dataMovs, error: errMovs } = await supabase
      .from('movimientos_contables')
      .select(`
        id, debe, haber, cuenta_contable_id, conciliado,
        asientos_contables(
          id, fecha, descripcion, nro_transaccion,
          cobros_aplicados(
            cuenta_cobrar:cuentas_cobrar(
              alumno:alumnos(nombres, apellidos)
            )
          ),
          pagos_aplicados(
            cuenta_pagar:cuentas_pagar(
              proveedor:proveedores(nombre),
              personal:personal(nombres, apellidos)
            )
          )
        )
      `)
      .in('cuenta_contable_id', idsCajas)
      .order('created_at', { ascending: false });

    if (errMovs) {
      setError(`Error al cargar movimientos: ${errMovs.message}`);
      setCargando(false);
      return;
    }

    const movsList: MovimientoExtendido[] = (dataMovs ?? []).map((m: any) => {
      const asiento = m.asientos_contables;
      let descDinamica = asiento?.descripcion || 'Sin descripción';

      const cobro = asiento?.cobros_aplicados?.[0]?.cuenta_cobrar;
      if (cobro?.alumno) {
        descDinamica = `Pago de: ${cobro.alumno.nombres} ${cobro.alumno.apellidos}`;
      } else {
        const pago = asiento?.pagos_aplicados?.[0]?.cuenta_pagar;
        if (pago?.proveedor) {
          descDinamica = `Pago a: ${pago.proveedor.nombre}`;
        } else if (pago?.personal) {
          descDinamica = `Pago a: ${pago.personal.nombres} ${pago.personal.apellidos}`;
        }
      }

      return {
        id: m.id,
        debe: Number(m.debe),
        haber: Number(m.haber),
        fecha: asiento?.fecha,
        descripcion: descDinamica,
        nro_transaccion: asiento?.nro_transaccion || '',
        asiento_id: asiento?.id,
        cuenta_id: m.cuenta_contable_id,
        cuenta_nombre: listCajas.find((c: any) => c.id === m.cuenta_contable_id)?.nombre || 'Desconocida',
        conciliado: m.conciliado || false
      };
    }).sort((a, b) => {
      const db = a.fecha ? new Date(a.fecha).getTime() : 0;
      const da = b.fecha ? new Date(b.fecha).getTime() : 0;
      return da - db;
    });

    setMovimientos(movsList);
    setCargando(false);
  }, [escuelaId, obtenerEscuelaId]);

  const toggleForm = (type: 'ingreso' | 'salida' | 'transferencia') => {
    if (activeForm === type) {
      if (formDirty) {
        if (!window.confirm('Tienes cambios sin guardar. ¿Deseas descartarlos y cerrar el formulario?')) {
          return;
        }
      }
      setActiveForm(null);
      setFormDirty(false);
      return;
    }
    if (activeForm && formDirty) {
      if (!window.confirm('Tienes cambios sin guardar en el formulario actual. ¿Deseas descartarlos y cambiar de operación?')) {
        return;
      }
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
    setFormDirty(false);
  };

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Cálculos de saldo
  const saldos = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of cajas) s[c.id] = 0;
    for (const m of movimientos) {
      if (s[m.cuenta_id] !== undefined) {
        s[m.cuenta_id] += (m.debe - m.haber);
      }
    }
    return s;
  }, [cajas, movimientos]);

  const saldoTotal = useMemo(() => {
    return Object.values(saldos).reduce((sum, val) => sum + val, 0);
  }, [saldos]);

  // Actualizar Sidebar dinámicamente
  useEffect(() => {
    setExtra(
      <>
        <div className="sidebar-stats-grid">
          <div className="sidebar-stat-item" onClick={() => setFiltroCuenta('todas')} style={{ cursor: 'pointer' }}>
            <span className="sidebar-stat-label">Saldo Consolidado</span>
            <span className="sidebar-stat-value">Bs {fmtMonto(saldoTotal)}</span>
          </div>
          {filtroCuenta !== 'todas' && (
            <div className="sidebar-stat-item">
              <span className="sidebar-stat-label">Saldo {cajas.find(c => c.id === filtroCuenta)?.nombre}</span>
              <span className="sidebar-stat-value sidebar-stat-value--warn">Bs {fmtMonto(saldos[filtroCuenta] || 0)}</span>
            </div>
          )}
        </div>

        <div className="sidebar-filters-grid">
          <div className="sidebar-filter-item">
            <label className="sidebar-filter-label">Cuenta Seleccionada</label>
            <select 
              value={filtroCuenta} 
              onChange={e => setFiltroCuenta(e.target.value)} 
              className="sidebar-select"
            >
              <option value="todas">Todas las Cuentas</option>
              {cajas.map(c => (
                <option key={c.id} value={c.id}>{c.nombre} (Bs {fmtMonto(saldos[c.id])})</option>
              ))}
            </select>
          </div>
        </div>
      </>
    );
    return () => setExtra(null);
  }, [saldoTotal, saldos, cajas, filtroCuenta, setExtra]);

  // Filtros cruzados
  const movimientosFiltrados = useMemo(() => {
    let list = movimientos;
    if (filtroCuenta !== 'todas') list = list.filter(m => m.cuenta_id === filtroCuenta);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      list = list.filter(m => 
        m.descripcion.toLowerCase().includes(q) || 
        m.nro_transaccion?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [movimientos, filtroCuenta, busqueda]);

  const toggleConciliar = async (id: string, valorActual: boolean) => {
    const newVal = !valorActual;
    const { error: err } = await supabase.from('movimientos_contables').update({ conciliado: newVal }).eq('id', id);
    if (!err) {
      setMovimientos(prev => prev.map(m => m.id === id ? { ...m, conciliado: newVal } : m));
    }
  };

  return (
    <main className="main-content cxc-main">
      <div className="sticky-header-container">
        {/* 1. Header Card */}
        <div className="cxc-header-bar" style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--border-light)', marginBottom: 0 }}>
          <div className="cxc-header-izq">
            <h1 className="cxc-titulo-principal" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Caja y Bancos
            </h1>
          </div>
          <div className="cxc-header-acciones">
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('ingreso')} 
              title="Registrar un ingreso directo"
              style={{ 
                fontWeight: 600, 
                padding: '0.5rem 1rem', 
                background: activeForm === 'ingreso' ? '#008b46' : '#00D26A', 
                color: 'white', border: 'none', borderRadius: '8px', 
                boxShadow: activeForm === 'ingreso' ? 'inset 0 2px 4px rgba(0,0,0,0.2)' : '0 2px 4px rgba(0,210,106,0.2)' 
              }}
            >
              <ArrowDownRight size={18} /> {activeForm === 'ingreso' ? 'Cerrar Ingreso' : 'Nuevo Ingreso'}
            </button>
            
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('salida')} 
              title="Registrar un gasto/salida directa"
              style={{ 
                fontWeight: 600, 
                padding: '0.5rem 1rem', 
                background: activeForm === 'salida' ? '#bd4b22' : '#FF6B35', 
                color: 'white', border: 'none', borderRadius: '8px', 
                boxShadow: activeForm === 'salida' ? 'inset 0 2px 4px rgba(0,0,0,0.2)' : '0 2px 4px rgba(255,107,53,0.2)' 
              }}
            >
              <ArrowUpRight size={18} /> {activeForm === 'salida' ? 'Cerrar Salida' : 'Nueva Salida'}
            </button>

            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('transferencia')} 
              title="Transferir dinero entre dos cajas/bancos"
              style={{ 
                fontWeight: 600, 
                padding: '0.5rem 1rem', 
                background: activeForm === 'transferencia' ? '#075db3' : '#0A84FF', 
                color: 'white', border: 'none', borderRadius: '8px', 
                boxShadow: activeForm === 'transferencia' ? 'inset 0 2px 4px rgba(0,0,0,0.2)' : '0 4px 6px rgba(10,132,255,0.2)' 
              }}
            >
              <ArrowRightLeft size={16} /> {activeForm === 'transferencia' ? 'Cerrar Transf.' : 'Nueva Transferencia'}
            </button>

            <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
              <RefreshCw size={18} className={cargando ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* 3. Buscador */}
        <div className="cxc-busqueda-bar" style={{ borderRadius: '0 0 12px 12px', marginBottom: '0.5rem', background: 'var(--bg-card)', padding: '0.5rem 1.5rem', border: '1px solid var(--border)', borderTop: 'none' }}>
          <div className="pc-busqueda">
            <Search size={16} className="pc-busqueda-icono" />
            <input
              type="text"
              placeholder="Buscar por descripción o nro. transacción..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="pc-busqueda-input"
            />
          </div>
          {busqueda && (
            <button className="cxc-limpiar-busqueda" onClick={() => setBusqueda('')}>✕</button>
          )}
          <span className="cxc-conteo-resultado">
            {movimientosFiltrados.length} movimiento{movimientosFiltrados.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* 4. Lista de Movimientos */}
      {error && (
        <div className="pc-error" style={{ marginBottom: '1rem' }}>
          <p>⚠️ {error}</p>
        </div>
      )}

      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando movimientos...</p>
        </div>
      ) : cajas.length === 0 ? (
        <div className="arbol-vacio">
          <Landmark size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>No tienes Cajas ni Bancos configurados en el Plan de Cuentas.</p>
        </div>
      ) : movimientosFiltrados.length === 0 ? (
        <div className="arbol-vacio">
          <CheckCircle2 size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>No se encontraron movimientos{busqueda ? ' para esta búsqueda' : ''}.</p>
        </div>
      ) : (
        <div className="cxc-tabla-wrapper" style={{ borderRadius: '12px' }}>
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th" style={{ width: '100px' }}>Fecha</th>
                <th className="cxc-th" style={{ width: '180px' }}>Cuenta</th>
                <th className="cxc-th">Descripción</th>
                <th className="cxc-th cxc-th-center" style={{ width: '150px' }}>Nro. Transacción</th>
                <th className="cxc-th cxc-th-right" style={{ width: '140px' }}>Ingreso (Debe)</th>
                <th className="cxc-th cxc-th-right" style={{ width: '140px' }}>Egreso (Haber)</th>
                <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Conciliado</th>
                <th className="cxc-th cxc-th-center" style={{ width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.map(mov => {
                const esIngreso = mov.debe > 0;
                
                return (
                  <tr 
                    key={mov.id} 
                    className="cxc-tr cxc-tr-clickable"
                    onClick={() => setMovDetalle(mov)}
                  >
                    <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                      {fmtFechaLocal(mov.fecha)}
                    </td>
                    <td className="cxc-td" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {mov.cuenta_nombre}
                    </td>
                    <td className="cxc-td cxc-td-meta">
                      {mov.descripcion}
                    </td>
                    <td className="cxc-td cxc-td-center cxc-td-meta">
                      <span>{mov.nro_transaccion || '—'}</span>
                    </td>
                    <td className="cxc-td cxc-td-right">
                      {esIngreso ? (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                          Bs +{fmtMonto(mov.debe)}
                          <ArrowUpRight size={12} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                        </span>
                      ) : (
                        <span className="cxc-td-dash">—</span>
                      )}
                    </td>
                    <td className="cxc-td cxc-td-right">
                      {!esIngreso ? (
                        <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                          Bs -{fmtMonto(mov.haber)}
                          <ArrowDownRight size={12} style={{ marginLeft: '4px', display: 'inline-block', verticalAlign: 'middle' }} />
                        </span>
                      ) : (
                        <span className="cxc-td-dash">—</span>
                      )}
                    </td>
                    <td className="cxc-td cxc-td-center">
                      <button 
                        onClick={(e) => { e.stopPropagation(); toggleConciliar(mov.id, mov.conciliado); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: mov.conciliado ? 'var(--success)' : 'var(--text-tertiary)' }}
                        title={mov.conciliado ? "Marcar como no conciliado" : "Marcar como conciliado en Banco"}
                      >
                        {mov.conciliado ? <CheckSquare size={18} /> : <Square size={18} />}
                      </button>
                    </td>
                    <td className="cxc-td cxc-td-center">
                      {!mov.conciliado && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setMovEditar(mov); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--secondary)' }}
                          title="Editar movimiento"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
          cargarDatos();
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
          cargarDatos();
        }} 
      />

      {/* Modal: Editar movimiento existente */}
      <ModalEditarMovimiento
        visible={!!movEditar}
        movimiento={movEditar}
        cajas={cajas}
        onCerrar={() => setMovEditar(null)}
        onGuardado={() => { setMovEditar(null); cargarDatos(); }}
      />

      {/* Modal: Detalle de movimiento */}
      <ModalDetalleMovimiento
        visible={!!movDetalle}
        asientoId={movDetalle?.asiento_id || null}
        onCerrar={() => setMovDetalle(null)}
      />

    </main>
  );
};

export default CajasBancos;
