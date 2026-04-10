import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import { ChevronLeft, Plus, Search, RefreshCw, Landmark, ArrowDownRight, ArrowUpRight, CheckCircle2, ArrowRightLeft, CheckSquare, Square } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { CuentaContable, MovimientoContable, AsientoContable } from '../../types/finanzas';
import ModalTransferencia from '../../components/cajas-bancos/ModalTransferencia';
import ModalMovimientoDirecto from '../../components/cajas-bancos/ModalMovimientoDirecto';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface MovimientoExtendido {
  id: string;
  debe: number;
  haber: number;
  fecha: string;
  descripcion: string;
  metodo_pago: string;
  asiento_id: string;
  cuenta_id: string;
  cuenta_nombre: string;
  conciliado: boolean;
}

const CajasBancos: React.FC = () => {
  const navigate = useNavigate();

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
  
  // Estados para formularios activos
  const [activeForm, setActiveForm] = useState<'ingreso' | 'salida' | 'transferencia' | null>(null);
  const [formDirty, setFormDirty] = useState(false);

  const obtenerEscuelaId = useCallback(async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', user.id)
      .single();
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

    // 1. Cargar las cuentas que sean Cajas o Bancos (tipo activo, transaccional, empieza con 1.1)
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
    
    // Si no usamos like 1.1.1.%, podríamos traer todas las transaccionales
    const listCajas = dataCuentas ?? [];
    setCajas(listCajas);

    if (listCajas.length === 0) {
      setCargando(false);
      return;
    }

    const idsCajas = listCajas.map((c: any) => c.id);

    // 2. Cargar movimientos de esas cuentas
    const { data: dataMovs, error: errMovs } = await supabase
      .from('movimientos_contables')
      .select(`
        id, debe, haber, cuenta_contable_id, conciliado,
        asientos_contables(id, fecha, descripcion, metodo_pago)
      `)
      .in('cuenta_contable_id', idsCajas)
      .order('created_at', { ascending: false });

    if (errMovs) {
      setError(`Error al cargar movimientos: ${errMovs.message}`);
      setCargando(false);
      return;
    }

    const movsList: MovimientoExtendido[] = (dataMovs ?? []).map((m: any) => ({
      id: m.id,
      debe: Number(m.debe),
      haber: Number(m.haber),
      fecha: m.asientos_contables?.fecha,
      descripcion: m.asientos_contables?.descripcion || 'Sin descripción',
      metodo_pago: m.asientos_contables?.metodo_pago,
      asiento_id: m.asientos_contables?.id,
      cuenta_id: m.cuenta_contable_id,
      cuenta_nombre: listCajas.find((c: any) => c.id === m.cuenta_contable_id)?.nombre || 'Desconocida',
      conciliado: m.conciliado || false
    })).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime());

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

  // Cálculos de saldo de cada caja
  const saldos = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of cajas) s[c.id] = 0;
    
    // Para activo, saldo = debe - haber (ingresos - egresos)
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

  // Filtros cruzados
  const movimientosFiltrados = useMemo(() => {
    let list = movimientos;
    
    if (filtroCuenta !== 'todas') {
      list = list.filter(m => m.cuenta_id === filtroCuenta);
    }

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      list = list.filter(m => 
        m.descripcion.toLowerCase().includes(q) || 
        m.metodo_pago?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [movimientos, filtroCuenta, busqueda]);

  // Manejo botón crear caja (por ahora manda al plan de cuentas)
  const handleCrearCaja = () => {
    navigate('/finanzas/plan-cuentas');
  };

  const toggleConciliar = async (id: string, valorActual: boolean) => {
    const newVal = !valorActual;
    const { error: err } = await supabase.from('movimientos_contables').update({ conciliado: newVal }).eq('id', id);
    if (!err) {
      setMovimientos(prev => prev.map(m => m.id === id ? { ...m, conciliado: newVal } : m));
    }
  };

  return (
    <main className="main-content cxc-main">
      {/* 1. Header Card */}
      <div className="cxc-header-bar" style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--border-light)' }}>
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              Caja y Bancos
            </h1>
          </div>
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

          <button 
            className="cxc-accion-btn" 
            onClick={handleCrearCaja} 
            title="Crear en Plan de Cuentas"
            style={{ fontWeight: 500, padding: '0.4rem 0.85rem' }}
          >
            <Plus size={16} /> Crear Caja o Banco
          </button>

          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* 2. Filtros de Cajas (Botones) */}
      <div className="cxc-barra-control" style={{ borderRadius: '0', borderBottom: '1px solid var(--border-light)', minHeight: '60px', padding: '0.75rem 1.5rem', background: 'var(--surface-50)' }}>
        <div className="cxc-filtros-inline" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', width: '100%' }}>
          <button
            className={`cxc-accion-btn ${filtroCuenta === 'todas' ? 'active-filter' : ''}`}
            style={{ 
              background: filtroCuenta === 'todas' ? 'var(--secondary)' : 'var(--bg-card)',
              color: filtroCuenta === 'todas' ? 'white' : 'var(--text-secondary)',
              border: '1px solid',
              borderColor: filtroCuenta === 'todas' ? 'var(--secondary)' : 'var(--border)',
              borderRadius: '8px',
              padding: '0.4rem 1rem',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}
            onClick={() => setFiltroCuenta('todas')}
          >
            Todas las Cuentas
            <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>Bs {fmtMonto(saldoTotal)}</span>
          </button>
          
          {cajas.map(c => (
             <button
             key={c.id}
             className={`cxc-accion-btn ${filtroCuenta === c.id ? 'active-filter' : ''}`}
             style={{ 
               background: filtroCuenta === c.id ? 'var(--secondary)' : 'var(--bg-card)',
               color: filtroCuenta === c.id ? 'white' : 'var(--text-secondary)',
               border: '1px solid',
               borderColor: filtroCuenta === c.id ? 'var(--secondary)' : 'var(--border)',
               borderRadius: '8px',
               padding: '0.4rem 1rem',
               fontWeight: 500,
               display: 'flex',
               alignItems: 'center',
               gap: '0.5rem'
             }}
             onClick={() => setFiltroCuenta(c.id)}
           >
             {c.nombre}
             <strong style={{ fontSize: '0.85rem' }}>Bs {fmtMonto(saldos[c.id])}</strong>
           </button>
          ))}
        </div>
      </div>

      {/* 3. Buscador */}
      <div className="cxc-busqueda-bar" style={{ borderRadius: '0 0 12px 12px', marginBottom: '1.5rem' }}>
        <div className="pc-busqueda">
          <Search size={16} className="pc-busqueda-icono" />
          <input
            type="text"
            placeholder="Buscar por descripción o método de pago..."
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
          <p style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
            Asegúrate de crear cuentas de tipo Activo, marcadas como Transaccionales, bajo el rubro de Efectivo ("1.1.1.X", ej. 1.1.1.01).
          </p>
          <button
              className="btn-nueva-cuenta"
              style={{ marginTop: '1rem' }}
              onClick={handleCrearCaja}
            >
              <Plus size={16} /> Ir a Plan de Cuentas
          </button>
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
                <th className="cxc-th">Fecha</th>
                <th className="cxc-th">Cuenta</th>
                <th className="cxc-th">Descripción</th>
                <th className="cxc-th cxc-th-center">Método</th>
                <th className="cxc-th cxc-th-right">Ingreso (Debe)</th>
                <th className="cxc-th cxc-th-right">Egreso (Haber)</th>
                <th className="cxc-th cxc-th-center">Conciliado</th>
              </tr>
            </thead>
            <tbody>
              {movimientosFiltrados.map(mov => {
                const esIngreso = mov.debe > 0;
                
                return (
                  <tr key={mov.id} className="cxc-tr">
                    <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(mov.fecha).toLocaleDateString()}
                    </td>
                    <td className="cxc-td" style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                      {mov.cuenta_nombre}
                    </td>
                    <td className="cxc-td cxc-td-meta">
                      {mov.descripcion}
                    </td>
                    <td className="cxc-td cxc-td-center cxc-td-meta">
                      <span style={{ textTransform: 'capitalize' }}>{mov.metodo_pago || '—'}</span>
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
                        onClick={() => toggleConciliar(mov.id, mov.conciliado)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: mov.conciliado ? 'var(--success)' : 'var(--text-tertiary)' }}
                        title={mov.conciliado ? "Marcar como no conciliado" : "Marcar como conciliado en Banco"}
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
    </main>
  );
};

export default CajasBancos;
