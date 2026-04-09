/**
 * CuentasPagar.tsx
 * Centro de Mando del módulo Cuentas por Pagar — Rediseño v2 (estilo CxC).
 *
 * Layout:
 * 1. Header (título + [Nuevo Pago] [Nueva Nota])
 * 2. Barra de Control: Filtros (Categoría + Antigüedad) + [Total Pendiente] [Agregar Proveedor]
 * 3. Barra de búsqueda de proveedor
 * 4. Lista tipo hoja de cálculo de proveedores con acciones inline
 */
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  ChevronLeft, RefreshCw, Plus, Search,
  Truck, AlertTriangle, DollarSign,
  CreditCard, FileText, Users, UserPlus
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Componentes del módulo
import FiltrosCxP, { CATEGORIAS_PROVEEDOR, OPCIONES_ANTIGUEDAD } from '../../components/cxp/FiltrosCxP';
import NotaPago from '../../components/cxp/NotaPago';
import DetalleProveedorCxP from '../../components/cxp/DetalleProveedorCxP';
import AdminEntidadesCxP from '../../components/cxp/AdminEntidadesCxP';

/** Formato de moneda boliviana */
const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Entidad CxP unificada (Proveedor o Personal) */
interface EntidadCxP {
  id: string;
  tipo: 'proveedor' | 'personal';
  nombre: string;
  categoria: string;
  cargo?: string;
  telefono?: string;
  saldo_pendiente: number;
  notas_pendientes: number;
  /** Fecha más antigua de nota pendiente (para calcular antigüedad) */
  fecha_mas_antigua: string | null;
}

const CuentasPagar: React.FC = () => {
  const navigate = useNavigate();

  // ── Estado principal ──
  const [entidades, setEntidades]     = useState<EntidadCxP[]>([]);
  const [cargando, setCargando]       = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [escuelaId, setEscuelaId]     = useState<string | null>(null);

  // ── Búsqueda y filtros ──
  const [busqueda, setBusqueda]         = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroAntiguedad, setFiltroAntiguedad] = useState('');

  // ── Modales ──
  const [mostrarNota, setMostrarNota]                   = useState(false);
  const [tipoNotaInicial, setTipoNotaInicial]           = useState<'proveedor' | 'personal' | 'gasto_corriente'>('proveedor');
  const [entidadSeleccionada, setEntidadSeleccionada]   = useState<EntidadCxP | null>(null);
  const [mostrarAdmin, setMostrarAdmin]                 = useState(false);

  // ── Entidad para pago rápido ──
  const [entidadParaNota, setEntidadParaNota]           = useState<EntidadCxP | null>(null);

  /** Obtiene escuela_id del usuario autenticado */
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

  /** Calcula la antigüedad en días de una fecha ISO */
  const calcularDias = (fechaISO: string | null): number => {
    if (!fechaISO) return 0;
    const hoy = new Date();
    const fecha = new Date(fechaISO);
    return Math.floor((hoy.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24));
  };

  /** Carga proveedores y personal con sus saldos pendientes */
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

    // Cargar todos los movimientos pendientes de CxP
    const { data: dataCxP, error: errCxP } = await supabase
      .from('v_estado_cuentas_pagar')
      .select(`
        id, proveedor_id, personal_id, tipo_gasto, estado,
        monto_total, monto_pagado, deuda_restante, fecha_emision
      `)
      .eq('escuela_id', eid)
      .neq('estado', 'pagada');

    if (errCxP) {
      setError(`Error al cargar datos: ${errCxP.message}`);
      setCargando(false);
      return;
    }

    const cxpRows = (dataCxP ?? []) as any[];

    // ── Agrupar por proveedor y por personal ──
    const saldoProv: Record<string, { saldo: number; notas: number; fechaAntigua: string | null }> = {};
    const saldoPers: Record<string, { saldo: number; notas: number; fechaAntigua: string | null }> = {};

    for (const row of cxpRows) {
      const saldo = Number(row.deuda_restante);
      if (row.proveedor_id) {
        if (!saldoProv[row.proveedor_id]) saldoProv[row.proveedor_id] = { saldo: 0, notas: 0, fechaAntigua: null };
        saldoProv[row.proveedor_id].saldo += saldo;
        saldoProv[row.proveedor_id].notas++;
        if (!saldoProv[row.proveedor_id].fechaAntigua || row.fecha_emision < saldoProv[row.proveedor_id].fechaAntigua!) {
          saldoProv[row.proveedor_id].fechaAntigua = row.fecha_emision;
        }
      }
      if (row.personal_id) {
        if (!saldoPers[row.personal_id]) saldoPers[row.personal_id] = { saldo: 0, notas: 0, fechaAntigua: null };
        saldoPers[row.personal_id].saldo += saldo;
        saldoPers[row.personal_id].notas++;
        if (!saldoPers[row.personal_id].fechaAntigua || row.fecha_emision < saldoPers[row.personal_id].fechaAntigua!) {
          saldoPers[row.personal_id].fechaAntigua = row.fecha_emision;
        }
      }
    }

    // Cargar proveedores
    const { data: dataProveedores } = await supabase
      .from('proveedores')
      .select('id, nombre, categoria, telefono, activo')
      .eq('escuela_id', eid)
      .eq('activo', true)
      .order('nombre');

    // Cargar personal
    const { data: dataPersonal } = await supabase
      .from('personal')
      .select('id, nombres, apellidos, cargo, telefono, activo')
      .eq('escuela_id', eid)
      .eq('activo', true)
      .order('nombres');

    const lista: EntidadCxP[] = [];

    for (const p of (dataProveedores ?? [])) {
      const sg = saldoProv[p.id] ?? { saldo: 0, notas: 0, fechaAntigua: null };
      lista.push({
        id: p.id,
        tipo: 'proveedor',
        nombre: p.nombre,
        categoria: p.categoria || 'otro',
        telefono: p.telefono,
        saldo_pendiente: sg.saldo,
        notas_pendientes: sg.notas,
        fecha_mas_antigua: sg.fechaAntigua,
      });
    }

    for (const p of (dataPersonal ?? [])) {
      const sg = saldoPers[p.id] ?? { saldo: 0, notas: 0, fechaAntigua: null };
      lista.push({
        id: p.id,
        tipo: 'personal',
        nombre: `${p.nombres} ${p.apellidos}`,
        categoria: 'trabajador',
        cargo: p.cargo,
        telefono: p.telefono,
        saldo_pendiente: sg.saldo,
        notas_pendientes: sg.notas,
        fecha_mas_antigua: sg.fechaAntigua,
      });
    }

    // Ordenar: primero con saldo, después por nombre
    lista.sort((a, b) => {
      if (b.saldo_pendiente !== a.saldo_pendiente) return b.saldo_pendiente - a.saldo_pendiente;
      return a.nombre.localeCompare(b.nombre);
    });

    setEntidades(lista);
    setCargando(false);
  }, [escuelaId, obtenerEscuelaId]);

  useEffect(() => { cargarDatos(); }, [cargarDatos]);

  // ── Estadísticas globales ──
  const statsGlobales = useMemo(() => ({
    totalEntidades:   entidades.length,
    conDeuda:         entidades.filter(e => e.saldo_pendiente > 0).length,
    totalPendiente:   entidades.reduce((s, e) => s + e.saldo_pendiente, 0),
  }), [entidades]);

  // ── Lista filtrada ──
  const entidadesFiltradas = useMemo(() => {
    let lista = entidades;

    if (filtroCategoria) {
      lista = lista.filter(e => e.categoria === filtroCategoria);
    }

    if (filtroAntiguedad) {
      const limite = filtroAntiguedad === 'mas' ? 45 : parseInt(filtroAntiguedad);
      lista = lista.filter(e => {
        if (!e.fecha_mas_antigua) return false;
        const dias = calcularDias(e.fecha_mas_antigua);
        if (filtroAntiguedad === 'mas') return dias > 45;
        return dias <= limite && dias > 0;
      });
    }

    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(e => e.nombre.toLowerCase().includes(q));
    }

    return lista;
  }, [entidades, filtroCategoria, filtroAntiguedad, busqueda]);

  const limpiarFiltros = () => {
    setFiltroCategoria('');
    setFiltroAntiguedad('');
  };

  /** Abrir nota para una entidad específica */
  const abrirNotaParaEntidad = (e: React.MouseEvent, entidad: EntidadCxP) => {
    e.stopPropagation();
    setEntidadParaNota(entidad);
    setTipoNotaInicial(entidad.tipo === 'proveedor' ? 'proveedor' : 'personal');
    setMostrarNota(true);
  };

  /** Abrir detalle de entidad */
  const abrirDetalle = (entidad: EntidadCxP) => {
    setEntidadSeleccionada(entidad);
  };

  // ── Vista: Panel de administración ──
  if (mostrarAdmin) {
    return <AdminEntidadesCxP onVolver={() => { setMostrarAdmin(false); cargarDatos(); }} />;
  }

  // ── Vista: Módulo principal ──
  return (
    <main className="main-content cxc-main">

      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Cuentas x Pagar</h1>
          </div>
        </div>
        <div className="cxc-header-acciones">
          <button
            className="btn-nueva-cuenta btn-nuevo-cobro"
            onClick={() => { setEntidadParaNota(null); setTipoNotaInicial('proveedor'); setMostrarNota(true); }}
          >
            <CreditCard size={16} /> Nuevo Pago
          </button>
          <button
            className="btn-nueva-cuenta"
            onClick={() => { setEntidadParaNota(null); setTipoNotaInicial('proveedor'); setMostrarNota(true); }}
          >
            <Plus size={16} /> Nueva Nota
          </button>
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Barra de Control: Filtros + Stats ─── */}
      <div className="cxc-barra-control">
        {/* Filtros a la izquierda */}
        <div className="cxc-filtros-inline">
          <FiltrosCxP
            categoria={filtroCategoria}
            antiguedad={filtroAntiguedad}
            onChangeCategoria={setFiltroCategoria}
            onChangeAntiguedad={setFiltroAntiguedad}
            onLimpiar={limpiarFiltros}
            compact
          />
        </div>

        {/* Stats + botón Agregar a la derecha */}
        <div className="cxc-stats-inline">
          {/* Total Pendiente */}
          <div className="cxc-mini-stat cxc-mini-stat--total">
            <DollarSign size={15} />
            <span className="cxc-mini-num cxc-mini-num--danger">
              Bs {fmtMonto(statsGlobales.totalPendiente)}
            </span>
            <span className="cxc-mini-label">Total Pendiente</span>
          </div>

          {/* Con deuda */}
          <div className="cxc-mini-stat cxc-mini-stat--deuda">
            <AlertTriangle size={15} />
            <span className="cxc-mini-num cxc-mini-num--warn">{statsGlobales.conDeuda}</span>
            <span className="cxc-mini-label">Con Deuda</span>
          </div>

          {/* Botón Agregar Proveedor */}
          <button
            className="btn-nueva-cuenta"
            style={{ flexShrink: 0, padding: '0.4rem 0.85rem', fontSize: '0.82rem' }}
            onClick={() => setMostrarAdmin(true)}
            title="Agregar o editar proveedores y personal"
          >
            <UserPlus size={15} /> Agregar Proveedor
          </button>
        </div>
      </div>

      {/* ─── Barra de búsqueda ─── */}
      <div className="cxc-busqueda-bar">
        <div className="pc-busqueda">
          <Search size={16} className="pc-busqueda-icono" />
          <input
            type="text"
            placeholder="Buscar proveedor por nombre..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pc-busqueda-input"
          />
        </div>
        {busqueda && (
          <button className="cxc-limpiar-busqueda" onClick={() => setBusqueda('')}>✕</button>
        )}
        <span className="cxc-conteo-resultado">
          {entidadesFiltradas.length} resultado{entidadesFiltradas.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* ─── Error ─── */}
      {error && (
        <div className="pc-error">
          <p>⚠️ {error}</p>
          <button onClick={cargarDatos}>Reintentar</button>
        </div>
      )}

      {/* ─── Lista de proveedores tipo hoja de cálculo ─── */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando proveedores...</p>
        </div>
      ) : entidadesFiltradas.length === 0 ? (
        <div className="arbol-vacio">
          <Truck size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>
            {busqueda || filtroCategoria || filtroAntiguedad
              ? 'No se encontraron proveedores con los filtros actuales.'
              : 'No hay proveedores registrados. Agrega el primero.'
            }
          </p>
          {!busqueda && !filtroCategoria && !filtroAntiguedad && (
            <button
              className="btn-nueva-cuenta"
              style={{ marginTop: '0.75rem' }}
              onClick={() => setMostrarAdmin(true)}
            >
              <UserPlus size={16} /> Agregar Proveedor
            </button>
          )}
        </div>
      ) : (
        <div className="cxc-tabla-wrapper">
          <table className="cxc-tabla">
            <thead>
              <tr>
                <th className="cxc-th cxc-th-alumno">Proveedor</th>
                <th className="cxc-th">Categoría</th>
                <th className="cxc-th cxc-th-center">Contacto</th>
                <th className="cxc-th cxc-th-center">Notas Pend.</th>
                <th className="cxc-th cxc-th-center">Antigüedad</th>
                <th className="cxc-th cxc-th-right">Total Deuda</th>
                <th className="cxc-th cxc-th-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {entidadesFiltradas.map(entidad => {
                const tieneDeuda  = entidad.saldo_pendiente > 0;
                const dias        = calcularDias(entidad.fecha_mas_antigua);
                const labelCat    = CATEGORIAS_PROVEEDOR.find(c => c.value === entidad.categoria)?.label ?? 'Otro';
                const colorDias   = dias > 45 ? 'var(--danger)' : dias > 30 ? 'var(--primary)' : 'var(--text-tertiary)';

                return (
                  <tr
                    key={entidad.id}
                    className={`cxc-tr ${tieneDeuda ? 'cxc-tr--deuda' : ''}`}
                    onClick={() => abrirDetalle(entidad)}
                    title="Clic para ver movimientos del proveedor"
                  >
                    {/* Nombre */}
                    <td className="cxc-td cxc-td-alumno">
                      <span className="cxc-alumno-avatar">
                        {entidad.tipo === 'proveedor'
                          ? <Truck size={15} />
                          : <Users size={15} />
                        }
                      </span>
                      <div className="cxc-alumno-info">
                        <span className="cxc-alumno-nombre">{entidad.nombre}</span>
                        {entidad.cargo && (
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                            {entidad.cargo}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Categoría */}
                    <td className="cxc-td cxc-td-meta">
                      <span style={{
                        fontSize: '0.8rem',
                        background: 'var(--secondary-glow)',
                        color: 'var(--secondary)',
                        borderRadius: '12px',
                        padding: '2px 8px',
                        whiteSpace: 'nowrap',
                      }}>
                        {labelCat}
                      </span>
                    </td>

                    {/* Teléfono */}
                    <td className="cxc-td cxc-td-center cxc-td-meta">
                      {entidad.telefono || '—'}
                    </td>

                    {/* Notas pendientes */}
                    <td className="cxc-td cxc-td-center">
                      {entidad.notas_pendientes > 0
                        ? <span className="cxc-badge-num">{entidad.notas_pendientes}</span>
                        : <span className="cxc-td-dash">—</span>
                      }
                    </td>

                    {/* Antigüedad */}
                    <td className="cxc-td cxc-td-center">
                      {tieneDeuda && dias > 0
                        ? <span style={{ color: colorDias, fontWeight: 600, fontSize: '0.85rem' }}>
                            {dias} días
                          </span>
                        : <span className="cxc-td-dash">—</span>
                      }
                    </td>

                    {/* Total deuda */}
                    <td className="cxc-td cxc-td-right">
                      {tieneDeuda
                        ? <span className="cxc-monto-deuda">Bs {fmtMonto(entidad.saldo_pendiente)}</span>
                        : <span className="cxc-al-dia">✓ Al día</span>
                      }
                    </td>

                    {/* Acciones inline */}
                    <td className="cxc-td cxc-td-acciones" onClick={e => e.stopPropagation()}>
                      {/* Nueva nota para esta entidad */}
                      <button
                        className="cxc-accion-btn cxc-accion-btn--nota"
                        onClick={e => abrirNotaParaEntidad(e, entidad)}
                        title="Crear Nota de Pago"
                      >
                        <FileText size={13} />
                        <span>Nota</span>
                      </button>

                      {/* Pago rápido si tiene deuda */}
                      {tieneDeuda && (
                        <button
                          className="cxc-accion-btn cxc-accion-btn--cobro"
                          onClick={e => { e.stopPropagation(); abrirDetalle(entidad); }}
                          title="Ver y registrar pago"
                        >
                          <CreditCard size={13} />
                          <span>Pagar</span>
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

      {/* ─── Modal: Nueva Nota de Pago ─── */}
      <NotaPago
        visible={mostrarNota}
        tipoInicial={tipoNotaInicial}
        onCerrar={() => { setMostrarNota(false); setEntidadParaNota(null); }}
        onCreada={() => { setMostrarNota(false); setEntidadParaNota(null); cargarDatos(); }}
      />

      {/* ─── Modal: Detalle del Proveedor ─── */}
      <DetalleProveedorCxP
        entidad={entidadSeleccionada}
        visible={!!entidadSeleccionada}
        onCerrar={() => setEntidadSeleccionada(null)}
        onActualizar={cargarDatos}
      />
    </main>
  );
};

export default CuentasPagar;
