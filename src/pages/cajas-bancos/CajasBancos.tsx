import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  RefreshCw, Landmark, ArrowDownRight, ArrowUpRight, Search,
  CheckCircle2, ArrowRightLeft, CheckSquare, Square, Pencil, Trash2,
  Star, GripVertical
} from 'lucide-react';
import type { CajaBanco } from '../../types/finanzas';
import ModalTransferencia from '../../components/cajas-bancos/ModalTransferencia';
import ModalMovimientoDirecto from '../../components/cajas-bancos/ModalMovimientoDirecto';
import ModalEditarMovimiento from '../../components/cajas-bancos/ModalEditarMovimiento';
import ModalDetalleMovimiento from '../../components/cajas-bancos/ModalDetalleMovimiento';
import ModalNuevaCaja from '../../components/cajas-bancos/ModalNuevaCaja';
import ModalCobroRapido from '../../components/cxc/ModalCobroRapido';
import ModalPagoRapidoCxP from '../../components/cxp/ModalPagoRapidoCxP';
import NotaServicios from '../../components/cxc/NotaServicios';
import DropdownAcciones from '../../components/cajas-bancos/DropdownAcciones';
import { formatFecha } from '../../lib/dateUtils';

import { useAuthSaaSport } from '../../lib/authHelper';
import { useCajasBancos, useMovimientos, useCxpEntidades, type MovimientoFinanciero } from '../../hooks/useFinanzas';
import { useQueryClient } from '@tanstack/react-query';
import { useIsMobile } from '../../hooks/useIsMobile';

const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CajasBancos: React.FC = () => {
  const { esSuperAdmin, escuelaId, puedeEliminar, sucursalId, perfil } = useAuthSaaSport();
  const queryClient = useQueryClient();

  // Puede conciliar: SuperAdmin O Administrador sin sucursal específica asignada
  const puedeConciliar = esSuperAdmin || (perfil?.rol === 'Administrador' && sucursalId === null);
  const isMobile = useIsMobile();

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
  const [busquedaCuenta, setBusquedaCuenta] = useState('');

  // ── Drag-and-drop de tarjetas (solo super admin) ──
  const [cajasOrdenadas, setCajasOrdenadas] = useState<typeof cajas>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // Sincronizar cajasOrdenadas cuando cambian los datos del servidor
  useEffect(() => {
    if (cajas.length > 0) setCajasOrdenadas(cajas);
  }, [cajas]);

  // Estados para formularios activos
  const [activeForm, setActiveForm] = useState<'ingreso' | 'salida' | 'transferencia' | 'nueva_caja' | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [cajaAEditar, setCajaAEditar] = useState<CajaBanco | null>(null);

  // Estado para edición de movimientos
  const [movEditar, setMovEditar] = useState<MovimientoFinanciero | null>(null);
  const [movDetalle, setMovDetalle] = useState<MovimientoFinanciero | null>(null);
  const [notaCxcParaEditar, setNotaCxcParaEditar] = useState<any>(null);
  const [cargandoNotaCxc, setCargandoNotaCxc] = useState(false);

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
        saldo_historico: saldosHistoricos[m.cuenta_id]
      };
    });

    return result.reverse(); // Volver al más reciente primero
  }, [movimientosRaw, cajas]);

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cajas-bancos', escuelaId] });
    queryClient.invalidateQueries({ queryKey: ['movimientos-financieros', escuelaId] });
  };

  // ── Guardar nuevo orden en BD ──
  const guardarOrden = useCallback(async (listaOrdenada: typeof cajas) => {
    const updates = listaOrdenada.map((c, idx) => ({ id: c.id, orden: idx }));
    for (const u of updates) {
      await supabase.from('cajas_bancos').update({ orden: u.orden }).eq('id', u.id);
    }
    manejarActualizacion();
  }, []);

  // ── Marcar caja como predeterminada ──
  const marcarPredeterminada = useCallback(async (cajaId: string) => {
    if (!escuelaId) return;
    // Quitar predeterminada de todas
    await supabase.from('cajas_bancos')
      .update({ es_predeterminada: false })
      .eq('escuela_id', escuelaId);
    // Poner en la seleccionada
    await supabase.from('cajas_bancos')
      .update({ es_predeterminada: true })
      .eq('id', cajaId);
    manejarActualizacion();
  }, [escuelaId]);

  // ── Handlers de Drag-and-drop ──
  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== draggingId) setDragOverId(id);
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null); setDragOverId(null);
      return;
    }
    const lista = [...cajasOrdenadas];
    const fromIdx = lista.findIndex(c => c.id === draggingId);
    const toIdx = lista.findIndex(c => c.id === targetId);
    const [movida] = lista.splice(fromIdx, 1);
    lista.splice(toIdx, 0, movida);
    setCajasOrdenadas(lista);
    setDraggingId(null); setDragOverId(null);
    guardarOrden(lista);
  };

  const handleDragEnd = () => {
    setDraggingId(null); setDragOverId(null);
  };


  const toggleForm = (type: 'ingreso' | 'salida' | 'transferencia' | 'nueva_caja') => {
    if (activeForm === type) {
      handleCerrarModal();
      return;
    }

    if (activeForm && formDirty) {
      if (!window.confirm('Tienes cambios sin guardar en el formulario actual. ¿Deseas descartarlos y cambiar de operación?')) {
        return;
      }
    }
    if (type !== 'nueva_caja') {
      setCajaAEditar(null);
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
    setCajaAEditar(null);
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

  // Eliminar el useEffect que actualizaba el SidebarContext (líneas 195-230 aprox)
  // El saldo consolidado y el selector ahora se integran en la rejilla de tarjetas.

  // Normalizar texto: quitar acentos y pasar a minúsculas
  const normalizar = useCallback((str: string) =>
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  , []);

  // Filtros cruzados — búsqueda inteligente por Cuentas, Alumno/Proveedor y Documentos
  const movimientosFiltrados = useMemo(() => {
    let list = movimientos;
    if (filtroCuenta !== 'todas') list = list.filter(m => m.cuenta_id === filtroCuenta);
    if (busqueda.trim()) {
      // Separar la búsqueda en tokens individuales (AND lógico)
      const tokens = normalizar(busqueda).split(/\s+/).filter(t => t.length > 0);
      
      list = list.filter(m => {
        // Campos de búsqueda en orden de prioridad: Cuentas, Alumno/Proveedor, Documentos
        const campoCuentas = normalizar(m.cuenta_nombre || '');
        const campoCliente = normalizar(m.cliente || '');
        const campoDocumento = normalizar(m.nro_transaccion || '');
        
        // Concatenar todos los campos para buscar tokens que pueden cruzar columnas
        const textoCompleto = `${campoCuentas} ${campoCliente} ${campoDocumento}`;
        
        // Cada token debe encontrarse en al menos uno de los campos
        return tokens.every(token => textoCompleto.includes(token));
      });
    }
    return list;
  }, [movimientos, filtroCuenta, busqueda, normalizar]);


  const toggleConciliar = async (mov: MovimientoFinanciero) => {
    try {
      const tabla = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
      const isGrouped = (mov as any).is_grouped;

      if (isGrouped) {
        const ids = (mov as any).original_ids || [];
        for (const id of ids) {
          await supabase.from(tabla).update({ conciliado: !mov.conciliado }).eq('id', id);
        }
      } else {
        const { error: errUpd } = await supabase
          .from(tabla)
          .update({ conciliado: !mov.conciliado })
          .eq('id', mov.id);

        if (errUpd) throw errUpd;
      }

      manejarActualizacion();
    } catch (err: any) {
      alert("Error al actualizar estado: " + err.message);
    }
  };

  const abrirEdicionNotaCxc = async (notaId: string) => {
    if (!notaId) return;
    setCargandoNotaCxc(true);
    try {
      // 1. Obtener la Nota de Servicio desde cuentas_cobrar
      const { data: nota, error: errNota } = await supabase
        .from('cuentas_cobrar')
        .select('*')
        .eq('id', notaId)
        .single();

      if (errNota) throw errNota;
      if (!nota) throw new Error('No se encontró la Nota de Servicio generadora.');

      // 2. Obtener el total cobrado de cobros_aplicados para esta nota
      const { data: cobrosDB } = await supabase
        .from('cobros_aplicados')
        .select('monto_aplicado')
        .eq('cuenta_cobrar_id', notaId);
      const totalCobrado = (cobrosDB || []).reduce((s: number, c: any) => s + Number(c.monto_aplicado), 0);

      // 3. Obtener los detalles de cxc_detalle
      const { data: detalles, error: errDetalles } = await supabase
        .from('cxc_detalle')
        .select('catalogo_item_id, cantidad, precio_unitario, periodo_meses, detalle_extra, catalogo_items(nombre)')
        .eq('cuenta_cobrar_id', notaId);

      if (errDetalles) throw errDetalles;

      // 4. Formatear la Nota para NotaServicios
      const cxcEditar = {
        ...nota,
        total_cobrado: totalCobrado,
        lineas: (detalles || []).map((l: any) => ({
          catalogo_item_id: l.catalogo_item_id,
          nombre: l.catalogo_items?.nombre || 'Concepto no especificado',
          tipo: 'servicio',
          cantidad: l.cantidad,
          precio_unitario: l.precio_unitario,
          periodo_meses: l.periodo_meses || [],
          detalle_personalizado: l.detalle_extra || '',
          subtotal: l.cantidad * l.precio_unitario
        }))
      };

      setNotaCxcParaEditar(cxcEditar);
    } catch (e: any) {
      console.error(e);
      alert(`Error al cargar la Nota de Servicio: ${e.message}`);
    } finally {
      setCargandoNotaCxc(false);
    }
  };

  return (
    <main className="main-content cxc-main">
      {isMobile ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}>
          {/* Tarjetas de Cajas/Bancos — scroll horizontal */}
          <div style={{
            display: 'flex',
            gap: '0.75rem',
            overflowX: 'auto',
            padding: '0.75rem 0.25rem',
            WebkitOverflowScrolling: 'touch',
            scrollbarWidth: 'none',
          }}>
            {cajasOrdenadas.map(c => {
              const esActiva = filtroCuenta === c.id;
              const esPred = c.es_predeterminada;
              const saldoCaja = Number(c.saldo_actual) || 0;
              return (
                <div
                  key={c.id}
                  onClick={() => setFiltroCuenta(filtroCuenta === c.id ? 'todas' : c.id)}
                  onDoubleClick={() => {
                    if (esSuperAdmin) {
                      setCajaAEditar(c);
                      setActiveForm('nueva_caja');
                    }
                  }}
                  style={{
                    flexShrink: 0,
                    minWidth: '160px',
                    maxWidth: '200px',
                    background: esActiva ? 'var(--primary-glow)' : esPred ? 'rgba(255,200,0,0.07)' : 'var(--bg-card)',
                    border: `2px solid ${esActiva ? 'var(--primary)' : esPred ? '#f59e0b' : 'var(--border)'}`,
                    borderRadius: '12px',
                    padding: '0.6rem 0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px',
                    position: 'relative',
                    transition: 'all 0.2s ease',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {c.tipo === 'caja_chica' ? 'CAJA' : 'BANCO'}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                      {esPred && <Star size={10} fill="#f59e0b" stroke="#f59e0b" />}
                      <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.activo ? 'var(--success)' : 'var(--danger)' }} />
                    </div>
                  </div>
                  <span style={{
                    fontSize: '0.85rem', fontWeight: 800, color: 'var(--text-primary)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2
                  }}>
                    {c.nombre}
                  </span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 900, color: saldoCaja >= 0 ? 'var(--success)' : '#ef4444', marginTop: '2px' }}>
                    Bs {fmtMonto(saldoCaja)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Botones de acción: Ingresos, Egresos, Transferencia */}
          <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
            <button
              onClick={() => toggleForm('ingreso')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: 'rgba(16, 185, 129, 0.1)', color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.3)', cursor: 'pointer'
              }}
            >
              <ArrowDownRight size={14} /> Ingresos
            </button>
            <button
              onClick={() => toggleForm('salida')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444',
                border: '1px solid rgba(239, 68, 68, 0.3)', cursor: 'pointer'
              }}
            >
              <ArrowUpRight size={14} /> Egresos
            </button>
            <button
              onClick={() => toggleForm('transferencia')}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem',
                padding: '0.6rem 0.5rem', borderRadius: '10px', fontWeight: 700, fontSize: '0.75rem',
                background: activeForm === 'transferencia' ? 'var(--primary-glow)' : 'rgba(56, 189, 248, 0.1)',
                color: activeForm === 'transferencia' ? 'var(--primary)' : '#38bdf8',
                border: `1px solid ${activeForm === 'transferencia' ? 'var(--primary)' : 'rgba(56, 189, 248, 0.3)'}`,
                cursor: 'pointer'
              }}
            >
              <ArrowRightLeft size={14} /> Transf.
            </button>
          </div>

          {/* Tabla de movimientos de la caja seleccionada (inline, sin modal) */}
          {(() => {
            const cajasFiltradas = filtroCuenta === 'todas' ? cajasOrdenadas : cajasOrdenadas.filter(c => c.id === filtroCuenta);
            const movsFiltrados = filtroCuenta === 'todas' ? movimientosFiltrados : movimientosFiltrados.filter(m => m.cuenta_id === filtroCuenta);
            const cajaActiva = filtroCuenta !== 'todas' ? cajas.find(c => c.id === filtroCuenta) : null;

            return (
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '10px', overflow: 'hidden' }}>
                {/* Header de la tabla */}
                {cajaActiva && (
                  <div style={{
                    padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'var(--bg-table-header)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <Landmark size={16} style={{ color: 'var(--text-table-header)' }} />
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-table-header)' }}>
                        {cajaActiva.nombre}
                      </span>
                    </div>
                    <span style={{ fontWeight: 900, fontSize: '0.9rem', color: (Number(cajaActiva.saldo_actual) || 0) >= 0 ? '#10b981' : '#ef4444' }}>
                      Bs {fmtMonto(Number(cajaActiva.saldo_actual) || 0)}
                    </span>
                  </div>
                )}
                {!cajaActiva && (
                  <div style={{
                    padding: '0.75rem 1rem', borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-table-header)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--text-table-header)' }}>
                      Todos los movimientos
                    </span>
                    <span style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--primary)' }}>
                      Bs {fmtMonto(saldoTotal)}
                    </span>
                  </div>
                )}

                {/* Lista de movimientos tipo tarjeta */}
                <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
                  {movsFiltrados.length === 0 ? (
                    <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '0.85rem' }}>
                      {filtroCuenta === 'todas' ? 'No hay movimientos registrados.' : 'No hay movimientos en esta cuenta.'}
                    </div>
                  ) : (
                    movsFiltrados.map(mov => {
                      const esIngreso = mov.debe > 0;
                      const fechaStr = formatFecha(mov.fecha);
                      const cliente = mov.cliente && mov.cliente !== '—' ? mov.cliente : '';
                      const desc = mov.descripcion?.trim() || '';
                      const descLimpia = desc.replace(/^\[(INGRESO|EGRESO) TRF\]\s*/i, '');

                      return (
                        <div
                          key={mov.id}
                          style={{
                            padding: '0.7rem 1rem',
                            borderBottom: '1px solid var(--border)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.75rem'
                          }}
                        >
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', overflow: 'hidden', flex: 1, minWidth: 0 }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
                              {fechaStr}
                            </span>
                            <span style={{
                              fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                            }}>
                              {cliente || descLimpia || 'Movimiento'}
                            </span>
                            {cliente && descLimpia && (
                              <span style={{
                                fontSize: '0.75rem', color: 'var(--text-tertiary)',
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                              }}>
                                {descLimpia}
                              </span>
                            )}
                          </div>
                          <div style={{
                            fontSize: '0.9rem', fontWeight: 700,
                            color: esIngreso ? '#10b981' : '#ef4444',
                            whiteSpace: 'nowrap', flexShrink: 0
                          }}>
                            {esIngreso ? '+' : '-'} Bs {fmtMonto(esIngreso ? mov.debe : mov.haber)}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        <>
          <div className="sticky-header-container">
            {/* 1. Header Card */}
            <div className="cxc-header-bar" style={{ borderRadius: '12px 12px 0 0', borderBottom: '1px solid var(--border-light)', marginBottom: 0 }}>
              <div className="cxc-header-izq">
                <h1 className="cxc-titulo-principal" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  Caja y Bancos
                </h1>
              </div>
              <div className="cxc-header-acciones">
                {/* Dropdown unificado para Ingresos (Cobro e Ingreso Directo) */}
                <DropdownAcciones
                  label="Ingresos"
                  icon={<ArrowDownRight size={16} />}
                  tooltip="Opciones de ingreso de dinero"
                  opciones={[
                    {
                      label: "Cobro a Alumno (CxC)",
                      descripcion: "Registrar cobro de mensualidad o deuda",
                      icon: <ArrowDownRight size={16} />,
                      onClick: () => setShowCobro(true)
                    },
                    {
                      label: "Ingreso Directo",
                      descripcion: "Registrar otro tipo de ingreso a caja",
                      icon: <ArrowDownRight size={16} />,
                      onClick: () => toggleForm('ingreso')
                    }
                  ]}
                />

                {/* Dropdown unificado para Egresos (Pago y Gasto Directo) */}
                <DropdownAcciones
                  label="Egresos"
                  icon={<ArrowUpRight size={16} />}
                  tooltip="Opciones de egreso de dinero"
                  opciones={[
                    {
                      label: "Pago a Proveedor (CxP)",
                      descripcion: "Registrar pago de cuenta por pagar",
                      icon: <ArrowUpRight size={16} />,
                      onClick: () => setShowPago(true)
                    },
                    {
                      label: "Gasto Directo",
                      descripcion: "Registrar egreso o gasto inmediato",
                      icon: <ArrowUpRight size={16} />,
                      onClick: () => toggleForm('salida')
                    }
                  ]}
                />

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
                {!isMobile && (
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
                )}

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
                  placeholder="Buscar por cuenta, alumno, proveedor o documento..."
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  className="pc-busqueda-input"
                />
              </div>

              {/* Tarjetas de Cajas/Bancos — drag-and-drop (solo super admin) */}
              <div className="cajas-grid-header" style={{ 
                display: 'flex', 
                gap: '0.75rem', 
                flex: 1, 
                overflowX: 'auto', 
                padding: '0.25rem 0' 
              }}>
                {/* Tarjeta de Saldo Consolidado */}
                <div 
                  onClick={() => setFiltroCuenta('todas')}
                  style={{
                    background: filtroCuenta === 'todas' ? 'var(--primary-glow)' : 'rgba(255,255,255,0.05)',
                    border: `2px solid ${filtroCuenta === 'todas' ? 'var(--primary)' : '#E5E7EB'}`,
                    borderRadius: '10px',
                    padding: '0.4rem 1rem',
                    cursor: 'pointer',
                    minWidth: '160px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                    boxShadow: filtroCuenta === 'todas' ? '0 0 15px var(--primary-glow)' : 'none',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Resumen
                    </span>
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: 'var(--primary)' }}></div>
                  </div>
                  <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                    Saldo Consolidado
                  </span>
                  <span style={{ fontSize: '1rem', color: 'var(--primary)', fontWeight: 900, marginTop: '2px' }}>
                    Bs {fmtMonto(saldoTotal)}
                  </span>
                </div>

                {cajasOrdenadas.map(c => {
                  const esActiva = filtroCuenta === c.id;
                  const esPred   = c.es_predeterminada;
                  const esDragOver = dragOverId === c.id;
                  return (
                    <div 
                      key={c.id}
                      draggable={esSuperAdmin}
                      onDragStart={esSuperAdmin ? e => handleDragStart(e, c.id) : undefined}
                      onDragOver={esSuperAdmin ? e => handleDragOver(e, c.id) : undefined}
                      onDrop={esSuperAdmin ? e => handleDrop(e, c.id) : undefined}
                      onDragEnd={esSuperAdmin ? handleDragEnd : undefined}
                      onClick={() => setFiltroCuenta(filtroCuenta === c.id ? 'todas' : c.id)}
                      onDoubleClick={() => {
                        if (esSuperAdmin) {
                          setCajaAEditar(c);
                          setActiveForm('nueva_caja');
                        }
                      }}
                      style={{
                        background: esActiva ? 'var(--primary-glow)' : esPred ? 'rgba(255,200,0,0.07)' : 'rgba(255,255,255,0.05)',
                        border: `2px solid ${esActiva ? 'var(--primary)' : esPred ? '#f59e0b' : esDragOver ? 'var(--primary)' : '#E5E7EB'}`,
                        borderRadius: '10px',
                        padding: '0.4rem 1rem',
                        cursor: esSuperAdmin ? 'grab' : 'pointer',
                        minWidth: '160px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
                        boxShadow: esActiva ? '0 0 15px var(--primary-glow)' : esPred ? '0 0 10px rgba(245,158,11,0.25)' : 'none',
                        opacity: draggingId === c.id ? 0.5 : 1,
                        transform: esDragOver ? 'scale(1.03)' : 'scale(1)',
                        position: 'relative',
                        overflow: 'hidden'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          {esSuperAdmin && (
                            <GripVertical size={12} style={{ color: 'var(--text-tertiary)', flexShrink: 0, cursor: 'grab' }} />
                          )}
                          <span style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {c.tipo === 'caja_chica' ? 'Caja' : 'Banco'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                          {esPred && (
                            <span title="Predeterminada" style={{ lineHeight: 1, display: 'flex' }}>
                              <Star size={11} fill="#f59e0b" stroke="#f59e0b" />
                            </span>
                          )}
                          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.activo ? 'var(--success)' : 'var(--danger)' }}></div>
                        </div>
                      </div>
                      <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.2 }}>
                        {c.nombre}
                      </span>
                      <span style={{ fontSize: '1rem', color: 'var(--success)', fontWeight: 900, marginTop: '2px' }}>
                        Bs {fmtMonto(Number(c.saldo_actual) || 0)}
                      </span>
                      {esSuperAdmin && !esPred && (
                        <button
                          onClick={e => { e.stopPropagation(); marcarPredeterminada(c.id); }}
                          title="Marcar como predeterminada"
                          style={{
                            position: 'absolute', bottom: '4px', right: '6px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--text-tertiary)', padding: '2px', lineHeight: 1
                          }}
                        >
                          <Star size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {busqueda && (
                <button className="cxc-limpiar-busqueda" onClick={() => setBusqueda('')}>✕</button>
              )}
              {!isMobile && (
                <span className="cxc-conteo-resultado" style={{ marginLeft: 'auto' }}>
                  {movimientosFiltrados.length} mov.
                </span>
              )}
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
              {cajasOrdenadas.filter(c => filtroCuenta === 'todas' || c.id === filtroCuenta).map(caja => {
                const movsCaja = movimientosFiltrados.filter(m => m.cuenta_id === caja.id);

                // Si hay búsqueda y esta caja no tiene movimientos coincidentes, la ocultamos para limpiar la UI
                if (busqueda && movsCaja.length === 0) return null;

                return (
                  <div key={caja.id} className="caja-seccion">
                    <h3 style={{ marginBottom: '1rem', color: 'var(--text-primary)', fontSize: '1.2rem', fontWeight: 700 }}>
                      <Landmark size={20} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: '8px', color: 'var(--primary)' }} />
                      {caja.nombre}
                    </h3>
                    <div className="cxc-tabla-wrapper" style={{ borderRadius: '12px', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                      <table className="cxc-tabla" style={{ minWidth: isMobile ? '600px' : 'auto' }}>
                        <thead>
                          <tr>
                            <th className="cxc-th" style={{ width: '100px' }}>Fecha</th>
                            {!isMobile && <th className="cxc-th" style={{ width: '120px' }}>Documento</th>}
                            <th className="cxc-th" style={{ maxWidth: '280px' }}>Alumno / Proveedor</th>
                            {!isMobile && <th className="cxc-th" style={{ width: '240px' }}>Cuentas</th>}
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Ingreso</th>
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Salida</th>
                            <th className="cxc-th cxc-th-right" style={{ width: '120px' }}>Saldo</th>
                            {!isMobile && <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Acciones</th>}
                            {!isMobile && <th className="cxc-th cxc-th-center" style={{ width: '100px' }}>Conciliado</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {movsCaja.length === 0 ? (
                            <tr>
                              <td colSpan={isMobile ? 5 : 9} className="cxc-td cxc-td-center cxc-td-meta" style={{ padding: '2rem' }}>
                                {busqueda ? 'No se encontraron movimientos para esta búsqueda en esta cuenta.' : 'No hay movimientos registrados en esta cuenta.'}
                              </td>
                            </tr>
                          ) : movsCaja.map(mov => {
                            const esIngreso = mov.debe > 0;
                            const fechaStr = formatFecha(mov.fecha);

                            return (
                              <tr 
                                key={mov.id} 
                                className="cxc-tr cxc-tr-clickable"
                                onClick={() => setMovDetalle(mov)}
                              >
                                <td className="cxc-td cxc-td-meta" style={{ whiteSpace: 'nowrap' }}>
                                  {fechaStr}
                                </td>
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-meta">
                                    {/* Mostrar nro_transaccion en Documento (Amarillo) */}
                                    {(() => {
                                      if (!mov.nro_transaccion) return null;
                                      const nroTrim = mov.nro_transaccion.trim();
                                      if (!nroTrim) return null;
                                      
                                      const esMetodo = /^(efectivo|transferencia|qr|transferencia bancaria|pago qr)$/i.test(nroTrim);
                                      if (esMetodo) return null;

                                      return <div style={{ fontWeight: 400, color: 'var(--text-primary)' }}>{nroTrim}</div>;
                                    })()}
                                  </td>
                                )}
                                <td className="cxc-td" style={{ maxWidth: '280px' }}>
                                  {(() => {
                                    const cliente = mov.cliente && mov.cliente !== '—' ? mov.cliente : '';
                                    let desc = mov.descripcion?.trim() || '';
                                    
                                    // Limpiar prefijo de transferencia si existe
                                    desc = desc.replace(/^\[(INGRESO|EGRESO) TRF\]\s*/i, '');

                                    const cuentaTrim = mov.cuenta_nombre?.trim() || '';
                                    
                                    if (desc === cuentaTrim) desc = '';
                                    else if (cuentaTrim && desc.startsWith(cuentaTrim)) {
                                      desc = desc.substring(cuentaTrim.length).trim().replace(/^[:\-\s,]+/, '').trim();
                                    }
                                    
                                    // Quitar métodos de pago genéricos
                                    desc = desc.replace(/\b(efectivo|transferencia|qr|transferencia bancaria|pago qr)\b/gi, '').replace(/^[:\-\s,]+/, '').trim();

                                    return (
                                      <div style={{ 
                                        color: 'var(--text-primary)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: '6px'
                                      }} title={`${cliente}${desc ? ' - ' + desc : ''}`}>
                                        <span style={{ fontWeight: 600 }}>{cliente || '—'}</span>
                                        {desc && (
                                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 400 }}>
                                            - {desc}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })()}
                                </td>
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-meta">
                                    <div style={{ fontWeight: 400, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                      {mov.cuenta_nombre}
                                    </div>
                                  </td>
                                )}
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
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-center">
                                    {!mov.conciliado && (
                                      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
                                        <button
                                          onClick={(e) => { 
                                            e.stopPropagation(); 
                                            if (mov.tipo_origen === 'cobro' && mov.cuenta_maestra_id) {
                                              abrirEdicionNotaCxc(mov.cuenta_maestra_id);
                                            } else {
                                              setMovEditar(mov);
                                            }
                                          }}
                                          disabled={cargandoNotaCxc}
                                          style={{ background: 'none', border: 'none', cursor: cargandoNotaCxc ? 'wait' : 'pointer', color: 'var(--secondary)' }}
                                          title="Editar movimiento"
                                        >
                                          <Pencil size={15} />
                                        </button>
                                        {/* Solo SuperAdministrador puede eliminar transacciones */}
                                        {puedeEliminar && (
                                          <button
                                            onClick={async (e) => { 
                                              e.stopPropagation(); 
                                              if (window.confirm("¿Eliminar esta transacción definitivamente?")) {
                                              try {
                                                  const isGrouped = (mov as any).is_grouped;
                                                  if (isGrouped) {
                                                    const tablaApl = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
                                                    const ids = (mov as any).original_ids || [];
                                                    for (const id of ids) {
                                                      await supabase.from(tablaApl).delete().eq('id', id);
                                                    }
                                                  } else {
                                                    const tablaMaestra = mov.tipo_origen === 'cobro' ? 'cuentas_cobrar' : 'cuentas_pagar';
                                                    if (mov.cuenta_maestra_id) {
                                                      const { error: errDel } = await supabase.from(tablaMaestra).delete().eq('id', mov.cuenta_maestra_id);
                                                      if (errDel) throw errDel;
                                                    } else {
                                                      const tablaApl = mov.tipo_origen === 'cobro' ? 'cobros_aplicados' : 'pagos_aplicados';
                                                      const { error: errDel } = await supabase.from(tablaApl).delete().eq('id', mov.id);
                                                      if (errDel) throw errDel;
                                                    }
                                                  }
                                                  manejarActualizacion();
                                                } catch (err: any) {
                                                  console.error("Error al eliminar:", err);
                                                  alert("No se pudo eliminar la transacción: " + (err.message || "Error desconocido"));
                                                }
                                              }
                                            }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)' }}
                                            title="Eliminar movimiento"
                                          >
                                            <Trash2 size={15} />
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                )}
                                {!isMobile && (
                                  <td className="cxc-td cxc-td-center">
                                    <button 
                                      onClick={(e) => { 
                                        e.stopPropagation(); 
                                        if (puedeConciliar) toggleConciliar(mov); 
                                      }}
                                      style={{ 
                                        background: 'none', border: 'none', 
                                        cursor: puedeConciliar ? 'pointer' : 'default', 
                                        color: mov.conciliado ? 'var(--success)' : 'var(--text-tertiary)',
                                        opacity: puedeConciliar ? 1 : 0.6
                                      }}
                                      title={mov.conciliado ? "Conciliado" : (puedeConciliar ? "Marcar como conciliado" : "Sin permiso para conciliar")}
                                      disabled={!puedeConciliar}
                                    >
                                      {mov.conciliado ? <CheckSquare size={18} /> : <Square size={18} />}
                                    </button>
                                  </td>
                                )}
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
        </>
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
        onCerrar={() => { setActiveForm(null); setCajaAEditar(null); }}
        onCreado={() => {
          setActiveForm(null);
          setCajaAEditar(null);
          manejarActualizacion();
        }}
        cajaAEditar={cajaAEditar}
      />

      {/* Modal: Editar movimiento existente */}
      <ModalEditarMovimiento
        visible={!!movEditar}
        movimiento={movEditar}
        cajas={cajas}
        onCerrar={() => setMovEditar(null)}
        onGuardado={() => { setMovEditar(null); manejarActualizacion(); }}
      />

      {/* Modal: Detalle de movimiento */}
      <ModalDetalleMovimiento
        visible={!!movDetalle}
        movimiento={movDetalle}
        onCerrar={() => setMovDetalle(null)}
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

      {notaCxcParaEditar && (
        <NotaServicios
          visible={!!notaCxcParaEditar}
          onCerrar={() => setNotaCxcParaEditar(null)}
          onCreada={() => {
            setNotaCxcParaEditar(null);
            manejarActualizacion();
          }}
          cxcEditar={notaCxcParaEditar}
        />
      )}

    </main>
  );
};

export default CajasBancos;
