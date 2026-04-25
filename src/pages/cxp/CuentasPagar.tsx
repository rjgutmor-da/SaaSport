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
import React, { useState, useMemo, useCallback } from 'react';
import {
  RefreshCw, Plus, Search,
  Truck, CreditCard, FileText, UserPlus, BookOpen
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { SidebarContext } from '../../App';
import { useContext, useEffect } from 'react';

// Componentes del módulo
import FiltrosCxP, { CATEGORIAS_PROVEEDOR } from '../../components/cxp/FiltrosCxP';
import NotaPago from '../../components/cxp/NotaPago';
import DetalleProveedorCxP from '../../components/cxp/DetalleProveedorCxP';
import AdminEntidadesCxP from '../../components/cxp/AdminEntidadesCxP';
import ModalPagoRapidoCxP from '../../components/cxp/ModalPagoRapidoCxP';
import ModalSaldoInicialCxP from '../../components/cxp/ModalSaldoInicialCxP';
import type { EntidadCxP } from '../../types/cxp';

import { useAuthSaaSport } from '../../lib/authHelper';
import { useCxpEntidades, useCxpResumen } from '../../hooks/useFinanzas';
import { useQueryClient } from '@tanstack/react-query';


/** Formato de moneda boliviana */
const fmtMonto = (n: number) =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const CuentasPagar: React.FC = () => {
  const navigate = useNavigate();
  const { setExtra } = useContext(SidebarContext);
  const { escuelaId } = useAuthSaaSport();
  const queryClient = useQueryClient();

  // ── Búsqueda y filtros ──
  const [busqueda, setBusqueda]         = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroAntiguedad, setFiltroAntiguedad] = useState('');

  // ── Hooks de datos (Fase 1: Cálculos en DB + Fase 2: Caché) ──
  const filtros = {
    categoria: filtroCategoria,
    antiguedad: filtroAntiguedad,
    busqueda
  };

  const { data: entidadesRaw, isLoading: cargandoEntidades, error: errorEntidades } = useCxpEntidades(escuelaId, filtros);
  const { data: resumenData, isLoading: cargandoResumen } = useCxpResumen(escuelaId);

  const cargando = cargandoEntidades || cargandoResumen;
  const entidadesFiltradas = (entidadesRaw as unknown as EntidadCxP[]) || [];
  
  const statsGlobales = {
    totalEntidades: resumenData?.total_entidades || 0,
    conDeuda: resumenData?.con_deuda || 0,
    totalPendiente: Number(resumenData?.total_pendiente || 0)
  };

  // ── Modales ──
  const [mostrarNota, setMostrarNota]                   = useState(false);
  const [tipoNotaInicial, setTipoNotaInicial]           = useState<'proveedor' | 'personal'>('proveedor');
  const [entidadSeleccionada, setEntidadSeleccionada]   = useState<EntidadCxP | null>(null);
  const [mostrarAdmin, setMostrarAdmin]                 = useState(false);

  const [mostrarPagoRapido, setMostrarPagoRapido]       = useState(false);
  const [entidadParaPagoRapido, setEntidadParaPagoRapido] = useState<EntidadCxP | null>(null);
  const [mostrarSaldoInicial, setMostrarSaldoInicial]   = useState(false);

  // ── Entidad para pago rápido ──
  const [entidadParaNota, setEntidadParaNota]           = useState<EntidadCxP | null>(null);

  /** Calcula la antigüedad en días de una fecha ISO */
  const calcularDias = (fechaISO: string | null): number => {
    if (!fechaISO) return 0;
    const hoy = new Date();
    const fecha = new Date(fechaISO);
    return Math.floor((hoy.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24));
  };

  const manejarActualizacion = () => {
    queryClient.invalidateQueries({ queryKey: ['cxp-entidades'] });
    queryClient.invalidateQueries({ queryKey: ['cxp-resumen'] });
  };

  // Sidebar limpio para este módulo (según requerimiento)
  useEffect(() => {
    setExtra(null);
    return () => setExtra(null);
  }, [setExtra]);


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
    return <AdminEntidadesCxP onVolver={() => { setMostrarAdmin(false); manejarActualizacion(); }} />;
  }

  // ── Vista: Módulo principal ──
  return (
    <main className="main-content cxc-main-sticky" style={{ 
      paddingTop: 0, 
      paddingBottom: '1rem', 
      paddingLeft: '1.5rem', 
      paddingRight: '1.5rem', 
      margin: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      alignItems: 'stretch',
      minHeight: 'auto'
    }}>

      {/* ─── Barra de Control Simplificada ─── */}
      <div className="cxc-barra-control" style={{ margin: 0, padding: '0.5rem 1.25rem' }}>
        <div className="cxc-filtros-inline" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <FiltrosCxP
              categoria={filtroCategoria}
              antiguedad={filtroAntiguedad}
              onChangeCategoria={setFiltroCategoria}
              onChangeAntiguedad={setFiltroAntiguedad}
              onLimpiar={() => { setFiltroCategoria(''); setFiltroAntiguedad(''); }}
              compact
            />
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn-excel btn-cobro"
              onClick={() => { setEntidadParaPagoRapido(null); setMostrarPagoRapido(true); }}
              title="Nuevo Pago"
            >
              <CreditCard size={14} /> <span>Pago</span>
            </button>
            <button
              className="btn-excel btn-nota"
              onClick={() => { setEntidadParaNota(null); setTipoNotaInicial('proveedor'); setMostrarNota(true); }}
              title="Nueva Nota"
            >
              <Plus size={14} /> <span>Nota</span>
            </button>
            <button
              className="btn-excel-icon"
              onClick={() => setMostrarAdmin(true)}
              title="Administrar Entidades"
            >
              <UserPlus size={14} />
            </button>
            <button
              className="btn-excel-icon"
              onClick={() => setMostrarSaldoInicial(true)}
              title="Migración"
            >
              <BookOpen size={14} />
            </button>
            <button className="btn-excel-icon" onClick={manejarActualizacion} disabled={cargando} title="Actualizar">
              <RefreshCw size={14} className={cargando ? 'spin' : ''} />
            </button>
          </div>
        </div>
      </div>

      <div className="cxc-search-row" style={{ margin: '0 0 0.5rem 0', padding: '0 1.25rem', border: 'none', background: 'transparent' }}>
        <div className="cxc-search-container" style={{ background: 'var(--bg-card)' }}>
          <Search size={14} className="cxc-search-icon" />
          <input
            type="text"
            placeholder="Buscar proveedor o personal por nombre..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="cxc-search-input"
          />
          {busqueda && (
            <button className="cxc-search-clear" onClick={() => setBusqueda('')}>✕</button>
          )}
        </div>

        <div className="cxc-stats-horizontal">
          <div className="cxc-stat-pill">
            <span className="cxc-pill-label">Con Deuda</span>
            <span className="cxc-pill-value text-warn">
              {statsGlobales.conDeuda}
            </span>
          </div>
          <div className="cxc-stat-pill cxc-stat-pill--danger">
            <span className="cxc-pill-label">Pendiente</span>
            <span className="cxc-pill-value">Bs {fmtMonto(statsGlobales.totalPendiente)}</span>
          </div>
          <span className="cxc-divider-mini" />
          <span className="cxc-result-count">
            {entidadesFiltradas.length} entidades
          </span>
        </div>
      </div>

      {/* ─── Error ─── */}
      {errorEntidades && (
        <div className="pc-error">
          <p>⚠️ {errorEntidades instanceof Error ? errorEntidades.message : 'Error desconocido'}</p>
          <button onClick={manejarActualizacion}>Reintentar</button>
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
          <table className="cxc-tabla cxc-tabla-fixed">
            <thead>
              <tr>
                <th className="cxc-th cxp-th-alumno">Proveedor</th>
                <th className="cxc-th cxc-th-center">Contacto</th>
                <th className="cxc-th cxc-th-center">Notas Pend.</th>
                <th className="cxc-th cxc-th-center">Antigüedad</th>
                <th className="cxc-th cxc-th-right">Total Deuda</th>
                <th className="cxc-th cxc-th-acciones">Acciones</th>
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
                    className={`cxc-tr cxc-tr-clickable ${tieneDeuda ? 'cxc-tr--deuda' : ''}`}
                    onClick={() => abrirDetalle(entidad)}
                    title="Clic para ver movimientos del proveedor"
                  >
                    {/* Nombre */}
                    <td className="cxc-td cxp-th-alumno">
                      <div className="cxc-alumno-info">
                        <span className="cxc-alumno-nombre">{entidad.nombre}</span>
                        {entidad.cargo && (
                          <span style={{ fontSize: '0.76rem', color: 'var(--text-tertiary)' }}>
                            {entidad.cargo}
                          </span>
                        )}
                      </div>
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
                      <div className="cxc-acciones-wrap">
                        {/* Nueva nota para esta entidad */}
                        <button
                          className="cxc-accion-btn cxc-accion-btn--nota"
                          onClick={e => abrirNotaParaEntidad(e, entidad)}
                          title="Crear Nota de Pago"
                        >
                          <FileText size={13} />
                          <span>Nota</span>
                        </button>

                        {/* Pago rápido / Anticipo */}
                        <button
                          className="cxc-accion-btn cxc-accion-btn--cobro"
                          onClick={e => {
                            e.stopPropagation();
                            setEntidadParaPagoRapido(entidad);
                            setMostrarPagoRapido(true);
                          }}
                          title="Ver y registrar pago o anticipo"
                        >
                          <CreditCard size={13} />
                          <span>Pagar</span>
                        </button>


                      </div>
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
        onCreada={() => { setMostrarNota(false); setEntidadParaNota(null); manejarActualizacion(); }}
      />

      {/* ─── Modal: Pago Rápido ─── */}
      <ModalPagoRapidoCxP
        visible={mostrarPagoRapido}
        entidades={entidadesFiltradas}
        entidadInicial={entidadParaPagoRapido}
        onCerrar={() => { setMostrarPagoRapido(false); setEntidadParaPagoRapido(null); }}
        onPagado={manejarActualizacion}
      />

      {/* ─── Modal: Detalle del Proveedor ─── */}
      <DetalleProveedorCxP
        entidad={entidadSeleccionada}
        visible={!!entidadSeleccionada}
        onCerrar={() => setEntidadSeleccionada(null)}
        onActualizar={manejarActualizacion}
      />

      <ModalSaldoInicialCxP
        visible={mostrarSaldoInicial}
        onCerrar={() => setMostrarSaldoInicial(false)}
        onCreado={() => {
          setMostrarSaldoInicial(false);
          manejarActualizacion();
        }}
      />

    </main>
  );
};

export default CuentasPagar;
