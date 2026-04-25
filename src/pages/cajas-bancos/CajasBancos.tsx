import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  RefreshCw, Landmark, ArrowDownRight, ArrowUpRight, Search,
  CheckCircle2, ArrowRightLeft, CheckSquare, Square, Pencil, Trash2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CajaBanco, MovimientoContable, AsientoContable } from '../../types/finanzas';
import ModalTransferencia from '../../components/cajas-bancos/ModalTransferencia';
import ModalMovimientoDirecto from '../../components/cajas-bancos/ModalMovimientoDirecto';
import ModalEditarMovimiento from '../../components/cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../../components/cajas-bancos/ModalDetalleMovimiento';
import ModalNuevaCaja from '../../components/cajas-bancos/ModalNuevaCaja';
import ModalCobroRapido from '../../components/cxc/ModalCobroRapido';
import ModalPagoRapidoCxP from '../../components/cxp/ModalPagoRapidoCxP';
import { formatFecha } from '../../lib/dateUtils';
import type { EntidadCxP } from '../../types/cxp';

import { SidebarContext } from '../../App';
import { useContext } from 'react';
import { useAuthSaaSport } from '../../lib/authHelper';
import { useCajasBancos, useMovimientos, useCxpEntidades } from '../../hooks/useFinanzas';
import { useQueryClient } from '@tanstack/react-query';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtFechaLocal = (iso: string): string => formatFecha(iso);

interface MovimientoUI {
  id: string;
  tipo_origen: 'cobro' | 'pago';
  debe: number;
  haber: number;
  fecha: string;
  descripcion: string;
  nro_transaccion: string;
  cuenta_id: string;
  conciliado: boolean;
  cliente?: string;
  saldo_historico?: number;
  cuenta_maestra_id?: string;
  cuenta_nombre?: string;
}

const CajasBancos: React.FC = () => {
  const navigate = useNavigate();
  const { setExtra } = useContext(SidebarContext);
  const { esSuperAdmin, escuelaId } = useAuthSaaSport();
  const queryClient = useQueryClient();

  // ── Hooks de datos con TanStack Query ──
  const { data: cajas = [], isLoading: cargandoCajas } = useCajasBancos(escuelaId);
  const cajaIds = useMemo(() => cajas.map(c => c.id), [cajas]);
  const { data: movimientosRaw = [], isLoading: cargandoMovimientos, error: errorMovs } = useMovimientos(escuelaId, cajaIds);
  const { data: entidades = [] } = useCxpEntidades(escuelaId, {});

  const cargando = cargandoCajas || cargandoMovimientos;
  const error = errorMovs ? (errorMovs instanceof Error ? errorMovs.message : 'Error al cargar datos') : null;

  // Filtros
  const [filtroCuenta, setFiltroCuenta] = useState<string>('todas');
  const [busqueda, setBusqueda] = useState('');

  // Estados para formularios activos
  const [activeForm, setActiveForm] = useState<'ingreso' | 'salida' | 'transferencia' | 'nueva_caja' | null>(null);
  const [formDirty, setFormDirty] = useState(false);

  // Estado para edición de movimientos
  const [movEditar, setMovEditar] = useState<MovimientoUI | null>(null);
  const [movDetalle, setMovDetalle] = useState<MovimientoUI | null>(null);

  // Estados para Cobros/Pagos rápidos
  const [showCobro, setShowCobro] = useState(false);
  const [showPago, setShowPago] = useState(false);

  // Procesar movimientos con saldo histórico
  const movimientos = useMemo(() => {
    const list = [...movimientosRaw].reverse(); // Empezar por el más antiguo para saldo
    const saldosHistoricos: Record<string, number> = {};
    
    const result = list.map(m => {
      if (!saldosHistoricos[m.cuenta_id]) saldosHistoricos[m.cuenta_id] = 0;
      saldosHistoricos[m.cuenta_id] += (m.debe - m.haber);
      return {
        ...m,
        cuenta_nombre: cajas.find(c => c.id === m.cuenta_id)?.nombre || 'Desconocida',
        saldo_historico: saldosHistoricos[m.cuenta_id]
      };
    });

    return result.reverse(); // Volver al más reciente primero
  }, [movimientosRaw, cajas]);

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cajas-bancos', escuelaId] });
    queryClient.invalidateQueries({ queryKey: ['movimientos-contables', escuelaId] });
  };


  const toggleForm = (type: 'ingreso' | 'salida' | 'transferencia' | 'nueva_caja') => {
    if (activeForm === type) {
      setActiveForm(null);
    } else {
      setActiveForm(type);
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



  // Cálculos de saldo
  const saldos = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of cajas) {
      s[c.id] = Number(c.saldo_actual) || 0;
    }
    // Si en el futuro se vuelven a cargar movimientos dinámicos, se sumarían aquí
    return s;
  }, [cajas]);


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

  const toggleConciliar = async (mov: MovimientoUI) => {
    try {
      const tabla = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
      const { error: errUpd } = await supabase
        .from(tabla)
        .update({ conciliado: !mov.conciliado })
        .eq('id', mov.id);

      if (errUpd) throw errUpd;

      manejarActualizacion();
    } catch (err: any) {
      alert("Error al actualizar estado: " + err.message);
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
            {/* 1. Cobro */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => setShowCobro(true)} 
              title="Registrar cobro a un alumno (CxC)"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: '#E5E7EB', color: '#000', 
                border: 'none', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <ArrowDownRight size={16} /> Cobro
            </button>

            {/* 2. Pago */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => setShowPago(true)} 
              title="Registrar pago a proveedor/personal (CxP)"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: '#E5E7EB', color: '#000', 
                border: 'none', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <ArrowUpRight size={16} /> Pago
            </button>

            {/* 3. Ingreso */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('ingreso')} 
              title="Registrar un ingreso directo"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: activeForm === 'ingreso' ? 'var(--primary-glow)' : '#E5E7EB', 
                color: activeForm === 'ingreso' ? 'var(--primary)' : '#000', 
                border: activeForm === 'ingreso' ? '1px solid var(--primary)' : 'none', 
                borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <ArrowDownRight size={16} /> {activeForm === 'ingreso' ? 'Cerrar Ingreso' : 'Ingreso'}
            </button>
            
            {/* 4. Gasto */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('salida')} 
              title="Registrar un gasto/salida directa"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: activeForm === 'salida' ? 'var(--primary-glow)' : '#E5E7EB', 
                color: activeForm === 'salida' ? 'var(--primary)' : '#000', 
                border: activeForm === 'salida' ? '1px solid var(--primary)' : 'none', 
                borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <ArrowUpRight size={16} /> {activeForm === 'salida' ? 'Cerrar Gasto' : 'Gasto'}
            </button>

            {/* 5. Transferencia */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('transferencia')} 
              title="Transferir dinero entre dos cajas/bancos"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: activeForm === 'transferencia' ? 'var(--primary-glow)' : '#E5E7EB', 
                color: activeForm === 'transferencia' ? 'var(--primary)' : '#000', 
                border: activeForm === 'transferencia' ? '1px solid var(--primary)' : 'none', 
                borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <ArrowRightLeft size={16} /> {activeForm === 'transferencia' ? 'Cerrar Transf.' : 'Transferencia'}
            </button>

            {/* 6. Nueva Caja */}
            <button 
              className="cxc-accion-btn" 
              onClick={() => toggleForm('nueva_caja')} 
              title="Crear una nueva caja o cuenta bancaria"
              style={{ 
                fontWeight: 700, padding: '0.5rem 1rem', 
                background: activeForm === 'nueva_caja' ? 'var(--primary-glow)' : '#E5E7EB', 
                color: activeForm === 'nueva_caja' ? 'var(--primary)' : '#000', 
                border: activeForm === 'nueva_caja' ? '1px solid var(--primary)' : 'none', 
                borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
              }}
            >
              <Landmark size={16} /> {activeForm === 'nueva_caja' ? 'Cerrar Nueva' : 'Nueva Caja'}
            </button>

            <button className="btn-refrescar" onClick={manejarActualizacion} disabled={cargando}>
              <RefreshCw size={18} className={cargando ? 'spin' : ''} />
            </button>
          </div>
        </div>

        {/* 3. Buscador */}
        <div className="cxc-busqueda-bar" style={{ 
          borderRadius: '0 0 12px 12px', 
          marginBottom: '0.5rem', 
          background: 'var(--bg-card)', 
          padding: '0.5rem 1.5rem', 
          border: '1px solid var(--border)', 
          borderTop: 'none',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          flexWrap: 'wrap'
        }}>
          <div className="pc-busqueda" style={{ flexShrink: 0, width: '300px' }}>
            <Search size={16} className="pc-busqueda-icono" />
            <input
              type="text"
              placeholder="Buscar movimientos..."
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              className="pc-busqueda-input"
            />
          </div>

          {/* Tarjetas de Cajas/Bancos (Los recuadros blancos solicitados) */}
          <div className="cajas-grid-header" style={{ 
            display: 'flex', 
            gap: '0.75rem', 
            flex: 1, 
            overflowX: 'auto', 
            padding: '0.25rem 0' 
          }}>
            {cajas.map(c => (
              <div 
                key={c.id} 
                onClick={() => setFiltroCuenta(filtroCuenta === c.id ? 'todas' : c.id)}
                style={{
                  background: filtroCuenta === c.id ? 'var(--primary-glow)' : 'rgba(255,255,255,0.05)',
                  border: `2px solid ${filtroCuenta === c.id ? 'var(--primary)' : '#E5E7EB'}`,
                  borderRadius: '10px',
                  padding: '0.4rem 1rem',
                  cursor: 'pointer',
                  minWidth: '160px',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                  boxShadow: filtroCuenta === c.id ? '0 0 15px var(--primary-glow)' : 'none',
                  position: 'relative',
                  overflow: 'hidden'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {c.tipo === 'caja_chica' ? 'Caja' : 'Banco'}
                  </span>
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.activo ? 'var(--success)' : 'var(--danger)' }}></div>
                </div>
                <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                  {c.nombre}
                </span>
                <span style={{ fontSize: '1rem', color: 'var(--success)', fontWeight: 900, marginTop: '2px' }}>
                  Bs {fmtMonto(Number(c.saldo_actual) || 0)}
                </span>
              </div>
            ))}
          </div>

          {busqueda && (
            <button className="cxc-limpiar-busqueda" onClick={() => setBusqueda('')}>✕</button>
          )}
          <span className="cxc-conteo-resultado" style={{ marginLeft: 'auto' }}>
            {movimientosFiltrados.length} mov.
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
      ) : (
        <div className="cajas-tablas-container" style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          {cajas.filter(c => filtroCuenta === 'todas' || c.id === filtroCuenta).map(caja => {
            const movsCaja = movimientosFiltrados.filter(m => m.cuenta_id === caja.id);

            // Si hay búsqueda y esta caja no tiene movimientos coincidentes, la ocultamos para limpiar la UI
            if (busqueda && movsCaja.length === 0) return null;

            return (
              <div key={caja.id} className="caja-seccion">
                <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700 }}>
                  <Landmark size={20} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px', color: 'var(--primary)' }} />
                  {caja.nombre}
                </h3>
                <div className="cxc-tabla-wrapper" style={{ borderRadius: '12px' }}>
                  <table className="cxc-tabla">
                    <thead>
                      <tr>
                        <th className="cxc-th" style={{ width: '100px' }}>Fecha</th>
                        <th className="cxc-th" style={{ width: '80px' }}>Hora</th>
                        <th className="cxc-th" style={{ width: '120px' }}>Documento</th>
                        <th className="cxc-th">Alumno</th>
                        <th className="cxc-th" style={{ width: '120px' }}>Cuentas</th>
                        <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Ingreso</th>
                        <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Salida</th>
                        <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Saldo</th>
                        <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Acciones</th>
                        <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Conciliado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {movsCaja.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="cxc-td cxc-td-center cxc-td-meta" style={{ padding: '2rem' }}>
                            {busqueda ? 'No se encontraron movimientos para esta búsqueda en esta cuenta.' : 'No hay movimientos registrados en esta cuenta.'}
                          </td>
                        </tr>
                      ) : movsCaja.map(mov => {
                        const esIngreso = mov.debe > 0;
                        const fechaObj = new Date(mov.fecha);
                        const fechaStr = fechaObj.toLocaleDateString('es-BO');
                        const horaStr = fechaObj.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' });
                        
                        return (
                          <tr 
                            key={mov.id} 
                            className="cxc-tr cxc-tr-clickable"
                            onClick={() => setMovDetalle(mov)}
                          >
                            <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                              {fechaStr}
                            </td>
                            <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                              {horaStr}
                            </td>
                            <td className="cxc-td cxc-td-meta">
                              {mov.nro_transaccion ? <div style={{ fontWeight: 600 }}>{mov.nro_transaccion}</div> : null}
                              <div style={{ fontSize: '0.8rem' }}>{mov.descripcion}</div>
                            </td>
                            <td className="cxc-td" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                              {mov.cliente}
                            </td>
                            <td className="cxc-td cxc-td-meta">
                              {mov.cuenta_nombre}
                            </td>
                            <td className="cxc-td cxc-td-right">
                              {esIngreso ? (
                                <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                  +{fmtMonto(mov.debe)}
                                </span>
                              ) : (
                                <span className="cxc-td-dash">—</span>
                              )}
                            </td>
                            <td className="cxc-td cxc-td-right">
                              {!esIngreso ? (
                                <span style={{ color: 'var(--danger)', fontWeight: 600 }}>
                                  -{fmtMonto(mov.haber)}
                                </span>
                              ) : (
                                <span className="cxc-td-dash">—</span>
                              )}
                            </td>
                            <td className="cxc-td cxc-td-right">
                              <span style={{ fontWeight: 700, color: (mov as any).saldo_historico >= 0 ? 'var(--text-primary)' : 'var(--danger)' }}>
                                {fmtMonto((mov as any).saldo_historico || 0)}
                              </span>
                            </td>
                            <td className="cxc-td cxc-td-center">
                              {!mov.conciliado && (
                                <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setMovEditar(mov); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--secondary)' }}
                                    title="Editar movimiento"
                                  >
                                    <Pencil size={15} />
                                  </button>
                                  <button
                                    onClick={async (e) => { 
                                      e.stopPropagation(); 
                                      if (window.confirm("¿Eliminar esta transacción definitivamente?")) {
                                        const tablaMaestra = mov.tipo_origen === 'cobro' ? 'cuentas_cobrar' : 'cuentas_pagar';
                                        
                                        // 1. Revertir saldo de caja
                                        const { data: cajaData } = await supabase.from('cajas_bancos').select('saldo_actual').eq('id', mov.cuenta_id).single();
                                        const nuevoSaldo = (Number(cajaData?.saldo_actual) || 0) - (mov.debe - mov.haber);
                                        await supabase.from('cajas_bancos').update({ saldo_actual: nuevoSaldo }).eq('id', mov.cuenta_id);
                                        
                                        // 2. Eliminar cuenta (cascada)
                                        if ((mov as any).cuenta_maestra_id) {
                                          await supabase.from(tablaMaestra).delete().eq('id', (mov as any).cuenta_maestra_id);
                                        } else {
                                          // Fallback en caso de que solo haya aplicación
                                          const tablaApl = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
                                          await supabase.from(tablaApl).delete().eq('id', mov.id);
                                        }
                                        manejarActualizacion();
                                      }
                                    }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                                    title="Eliminar movimiento"
                                  >
                                    <Trash2 size={15} />
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="cxc-td cxc-td-center">
                              <button 
                                onClick={(e) => { 
                                  e.stopPropagation(); 
                                  if (esSuperAdmin) toggleConciliar(mov); 
                                }}
                                style={{ 
                                  background: 'none', border: 'none', 
                                  cursor: esSuperAdmin ? 'pointer' : 'default', 
                                  color: mov.conciliado ? 'var(--success)' : 'var(--text-tertiary)',
                                  opacity: esSuperAdmin ? 1 : 0.6
                                }}
                                title={mov.conciliado ? "Conciliado" : (esSuperAdmin ? "Marcar como conciliado" : "Solo el super admin puede conciliar")}
                                disabled={!esSuperAdmin}
                              >
                                {mov.conciliado ? <CheckSquare size={18} /> : <Square size={18} />}
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
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
          manejarActualizacion();
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
          manejarActualizacion();
        }} 
      />

      <ModalNuevaCaja
        visible={activeForm === 'nueva_caja'}
        onCerrar={() => setActiveForm(null)}
        onCreado={() => {
          setActiveForm(null);
          manejarActualizacion();
        }}
      />

      {/* Modal: Editar movimiento existente */}
      <ModalEditarMovimiento
        visible={!!movEditar}
        movimiento={movEditar}
        cajas={cajas}
        onCerrar={() => setMovEditar(null)}
        onGuardado={() => { setMovEditar(null); manejarActualizacion(); }}
      />

      {/* Nuevos modales de Cobro y Pago rápidos */}
      <ModalCobroRapido
        visible={showCobro}
        alumnoInicial={null}
        onCerrar={() => setShowCobro(false)}
        onCobrado={() => { setShowCobro(false); manejarActualizacion(); }}
      />

      <ModalPagoRapidoCxP
        visible={showPago}
        entidadInicial={null}
        entidades={entidades}
        onCerrar={() => setShowPago(false)}
        onPagado={() => { setShowPago(false); manejarActualizacion(); }}
      />

    </main>
  );
};

export default CajasBancos;
