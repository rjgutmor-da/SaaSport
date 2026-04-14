/**
 * Estadisticas.tsx
 * Módulo principal de Estadísticas dentro de Contabilidad.
 *
 * Tiene 3 pestañas:
 *   1. Ingresos — Torta + lista por ítem
 *   2. Egresos  — Torta + lista por ítem
 *   3. Alumnos por Ítem — Tabla tipo Excel con subfiltros de meses/torneos
 *
 * Todas las pestañas comparten el SelectorFechas omnipresente.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft, RefreshCw, TrendingUp, TrendingDown, Users,
  ChevronDown, X
} from 'lucide-react';
import { supabase } from '../../../lib/supabaseClient';

// Sub-componentes
import SelectorFechas from './components/SelectorFechas';
import TortaIngresos from './components/TortaIngresos';
import TablaAlumnos from './components/TablaAlumnos';

// Hooks
import { useEscuelaId } from './hooks/useEscuelaId';
import { useResumenFinanciero } from './hooks/useResumenFinanciero';
import { useAlumnosPorItem } from './hooks/useAlumnosPorItem';

// Utilidades
import type { IntervaloPredefinido } from './utils/estadisticasUtils';
import { calcularRango, NOMBRES_MESES } from './utils/estadisticasUtils';

/** Lista de torneos predefinidos — misma que en NotaServicios */
const TORNEOS_PREDEFINIDOS = [
  'Torito Garcia',
  'Taquito',
  'Super Campeones',
  'Leones',
  'Atletico Junior',
  'Cañito',
  'Planeta',
  'Semillero',
  'JMP',
  'Milton Melgar',
  'Blooming Cup',
];

// Interfaz de ítem del catálogo
interface CatalogoItem {
  id: string;
  nombre: string;
  es_ingreso: boolean;
  es_gasto: boolean;
  activo: boolean;
}

type Pestaña = 'ingresos' | 'egresos' | 'alumnos';

const Estadisticas: React.FC = () => {
  const navigate = useNavigate();

  // ─── Escuela del usuario logueado ───
  const { escuelaId } = useEscuelaId();

  // ─── Estado compartido: filtro de fechas ───
  const [intervalo, setIntervalo] = useState<IntervaloPredefinido>('este-mes');
  const [desdePersonalizado, setDesdePersonalizado] = useState('');
  const [hastaPersonalizado, setHastaPersonalizado] = useState('');

  // ─── Pestaña activa ───
  const [pestaña, setPestaña] = useState<Pestaña>('ingresos');

  // ─── Catálogo de ítems ───
  const [catalogo, setCatalogo] = useState<CatalogoItem[]>([]);
  const [cargandoCatalogo, setCargandoCatalogo] = useState(false);

  // ─── Filtros pestaña "Alumnos por Ítem" ───
  const [itemSeleccionado, setItemSeleccionado] = useState<CatalogoItem | null>(null);
  const [dropdownItemAbierto, setDropdownItemAbierto] = useState(false);
  
  // Nuevos filtros solicitados (Entrenador y Categoría/Sucursal)
  const [entrenadorId, setEntrenadorId] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [entrenadores, setEntrenadores] = useState<any[]>([]);
  const [sucursales, setSucursales] = useState<any[]>([]);

  // Subfiltros: meses (para Mensualidad) o torneo seleccionado (para Torneos)
  const [mesesSeleccionados, setMesesSeleccionados] = useState<string[]>([]);
  // Torneo: selección del dropdown predefinido
  const [torneoSeleccionado, setTorneoSeleccionado] = useState('');
  // Si el usuario elige "Otro", puede escribir uno personalizado
  const [torneoPersonalizado, setTorneoPersonalizado] = useState('');

  // ─── Determinar si el ítem seleccionado tiene subfiltro ───
  const esMensualidad = itemSeleccionado?.nombre?.toLowerCase().includes('mensualidad') ?? false;
  const esTorneo = itemSeleccionado?.nombre?.toLowerCase().includes('torneo') ?? false;
  const tieneSubfiltro = esMensualidad || esTorneo;

  /** Etiqueta de la columna de detalle en la tabla */
  const etiquetaDetalle = esMensualidad ? 'Mes(es)' : esTorneo ? 'Torneo' : 'Detalle';

  /** Torneo efectivo para filtrar */
  const torneoEfectivo = torneoSeleccionado === 'Otro'
    ? torneoPersonalizado.trim()
    : torneoSeleccionado;

  /** Subfiltros activos para el hook */
  const subfiltrosActivos: string[] = useMemo(() => {
    if (esMensualidad) return mesesSeleccionados;
    if (esTorneo && torneoEfectivo) return [torneoEfectivo];
    return [];
  }, [esMensualidad, esTorneo, mesesSeleccionados, torneoEfectivo]);

  // ─── Hooks de datos ───
  const resumen = useResumenFinanciero(
    escuelaId,
    intervalo,
    desdePersonalizado,
    hastaPersonalizado
  );

  const alumnosResult = useAlumnosPorItem(
    escuelaId,
    itemSeleccionado?.id ?? null,
    intervalo,
    desdePersonalizado,
    hastaPersonalizado,
    subfiltrosActivos.length > 0 ? subfiltrosActivos : undefined,
    entrenadorId,
    sucursalId
  );

  // ─── Cargar catálogo ───
  useEffect(() => {
    if (!escuelaId) return;
    const cargar = async () => {
      setCargandoCatalogo(true);
      const { data } = await supabase
        .from('catalogo_items')
        .select('id, nombre, es_ingreso, es_gasto, activo')
        .eq('escuela_id', escuelaId)
        .eq('activo', true)
        .order('nombre');
      // Deduplica por nombre (puede haber múltiples escuelas previas con el mismo ítem)
      const vistos = new Set<string>();
      const unicos: CatalogoItem[] = [];
      for (const item of (data ?? []) as CatalogoItem[]) {
        if (!vistos.has(item.nombre)) {
          vistos.add(item.nombre);
          unicos.push(item);
        }
      }
      setCatalogo(unicos);
      setCargandoCatalogo(false);

      // Cargar Entrenadores (Usuarios de la escuela)
      const { data: users } = await supabase
        .from('usuarios')
        .select('id, nombres, apellidos')
        .eq('escuela_id', escuelaId)
        .order('nombres');
      setEntrenadores(users ?? []);

      // Cargar Sucursales (Como Categorías)
      const { data: sucs } = await supabase
        .from('sucursales')
        .select('id, nombre')
        .eq('escuela_id', escuelaId)
        .order('nombre');
      setSucursales(sucs ?? []);
    };
    cargar();
  }, [escuelaId]);

  /** Alterna la selección de un mes */
  const toggleMes = (mes: string) => {
    setMesesSeleccionados(prev =>
      prev.includes(mes) ? prev.filter(m => m !== mes) : [...prev, mes]
    );
  };

  // Fecha del rango para mostrar en el encabezado
  const rango = calcularRango(intervalo, desdePersonalizado, hastaPersonalizado);
  const labelRango = `${rango.desde} — ${rango.hasta}`;

  return (
    <main className="main-content cxc-main">
      {/* ─── Header ─── */}
      <div className="cxc-header-bar">
        <div className="cxc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/contabilidad')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="cxc-titulo-principal">Estadísticas</h1>
            <p className="est-subtitulo">{labelRango}</p>
          </div>
        </div>
        <div className="cxc-header-acciones">
          <button
            className="btn-refrescar"
            onClick={resumen.recargar}
            disabled={resumen.cargando}
            title="Actualizar datos"
          >
            <RefreshCw size={18} className={resumen.cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* ─── Selector de Fechas Omnipresente ─── */}
      <SelectorFechas
        intervalo={intervalo}
        onCambiarIntervalo={setIntervalo}
        desdePersonalizado={desdePersonalizado}
        hastaPersonalizado={hastaPersonalizado}
        onDesde={setDesdePersonalizado}
        onHasta={setHastaPersonalizado}
      />

      {/* ─── Pestañas ─── */}
      <div className="est-tabs-bar">
        <button
          className={`est-tab ${pestaña === 'ingresos' ? 'est-tab--activo est-tab--ingreso' : ''}`}
          onClick={() => setPestaña('ingresos')}
        >
          <TrendingUp size={16} /> Ingresos
        </button>
        <button
          className={`est-tab ${pestaña === 'egresos' ? 'est-tab--activo est-tab--egreso' : ''}`}
          onClick={() => setPestaña('egresos')}
        >
          <TrendingDown size={16} /> Egresos
        </button>
        <button
          className={`est-tab ${pestaña === 'alumnos' ? 'est-tab--activo est-tab--alumnos' : ''}`}
          onClick={() => setPestaña('alumnos')}
        >
          <Users size={16} /> Alumnos por Ítem
        </button>
      </div>

      {/* ─── Contenido de pestañas ─── */}
      <div className="est-contenido">

        {/* ══════ PESTAÑA INGRESOS ══════ */}
        {pestaña === 'ingresos' && (
          <div className="est-panel">
            {resumen.error && (
              <div className="est-error-banner">⚠️ {resumen.error}</div>
            )}
            {resumen.cargando ? (
              <div className="est-cargando">
                <RefreshCw size={32} className="spin" />
                <p>Calculando ingresos...</p>
              </div>
            ) : (
              <>
                {/* Tarjeta resumen total */}
                <div className="est-resumen-total est-resumen-total--ingreso">
                  <TrendingUp size={22} />
                  <span className="est-resumen-label">Total Ingresos del período</span>
                  <span className="est-resumen-monto">
                    Bs {resumen.totalIngresos.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Torta + leyenda */}
                <TortaIngresos
                  items={resumen.ingresos}
                  total={resumen.totalIngresos}
                  titulo="Ingresos"
                  colorBase="#10b981"
                />
              </>
            )}
          </div>
        )}

        {/* ══════ PESTAÑA EGRESOS ══════ */}
        {pestaña === 'egresos' && (
          <div className="est-panel">
            {resumen.error && (
              <div className="est-error-banner">⚠️ {resumen.error}</div>
            )}
            {resumen.cargando ? (
              <div className="est-cargando">
                <RefreshCw size={32} className="spin" />
                <p>Calculando egresos...</p>
              </div>
            ) : (
              <>
                {/* Tarjeta resumen total */}
                <div className="est-resumen-total est-resumen-total--egreso">
                  <TrendingDown size={22} />
                  <span className="est-resumen-label">Total Egresos del período</span>
                  <span className="est-resumen-monto">
                    Bs {resumen.totalEgresos.toLocaleString('es-BO', { minimumFractionDigits: 2 })}
                  </span>
                </div>

                {/* Torta + leyenda */}
                <TortaIngresos
                  items={resumen.egresos}
                  total={resumen.totalEgresos}
                  titulo="Egresos"
                  colorBase="#ef4444"
                />
              </>
            )}
          </div>
        )}

        {/* ══════ PESTAÑA ALUMNOS POR ÍTEM ══════ */}
        {pestaña === 'alumnos' && (
          <div className="est-panel">
            <div className="est-filtros-alumnos-v3">
              <div className="est-card-item-search">
                <div className="est-item-dropdown-wrap">
                  <button
                    className="est-item-dropdown-btn"
                    onClick={() => setDropdownItemAbierto(!dropdownItemAbierto)}
                  >
                    <span>{itemSeleccionado ? itemSeleccionado.nombre : 'Seleccionar ítem...'}</span>
                    <ChevronDown size={16} />
                  </button>

                  {dropdownItemAbierto && (
                    <div className="est-item-dropdown-lista">
                      {cargandoCatalogo ? (
                        <div className="est-item-cargando">Cargando ítems...</div>
                      ) : catalogo.length === 0 ? (
                        <div className="est-item-cargando">Sin ítems en el catálogo</div>
                      ) : (
                        catalogo.map(item => (
                          <button
                            key={item.id}
                            className={`est-item-opcion ${itemSeleccionado?.id === item.id ? 'est-item-opcion--activo' : ''}`}
                            onClick={() => {
                              setItemSeleccionado(item);
                              setDropdownItemAbierto(false);
                              setMesesSeleccionados([]);
                              setTorneoSeleccionado('');
                              setTorneoPersonalizado('');
                            }}
                          >
                            <span>{item.nombre}</span>
                            <span className="est-item-tipo">
                              {item.es_ingreso && !item.es_gasto && <span className="est-badge est-badge--ing">Ingreso</span>}
                              {item.es_gasto && !item.es_ingreso && <span className="est-badge est-badge--eg">Egreso</span>}
                              {item.es_ingreso && item.es_gasto && <span className="est-badge est-badge--ambos">Ambos</span>}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>

                {/* Filtros laterales (Entrenador y Categoría) */}
                <div className="est-filtros-laterales-wrap">
                  <select 
                    className="est-select-premium"
                    value={entrenadorId}
                    onChange={e => setEntrenadorId(e.target.value)}
                  >
                    <option value="">Todos los Entrenadores</option>
                    {entrenadores.map(e => (
                      <option key={e.id} value={e.id}>{e.nombres} {e.apellidos}</option>
                    ))}
                  </select>

                  <select 
                    className="est-select-premium"
                    value={sucursalId}
                    onChange={e => setSucursalId(e.target.value)}
                  >
                    <option value="">Todas las Categorías</option>
                    {sucursales.map(s => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Subfiltro para Mensualidad: selector de meses */}
              {esMensualidad && (
                <div className="est-filtro-grupo est-filtro-meses">
                  <label className="est-filtro-label">
                    Meses <span className="est-filtro-hint">(opcional — deja vacío para ver todos)</span>
                  </label>
                  <div className="est-meses-grid">
                    {NOMBRES_MESES.map(mes => (
                      <button
                        key={mes}
                        className={`est-mes-chip ${mesesSeleccionados.includes(mes) ? 'est-mes-chip--activo' : ''}`}
                        onClick={() => toggleMes(mes)}
                      >
                        {mes}
                      </button>
                    ))}
                  </div>
                  {mesesSeleccionados.length > 0 && (
                    <button
                      className="est-limpiar-subfiltro"
                      onClick={() => setMesesSeleccionados([])}
                    >
                      <X size={12} /> Limpiar selección
                    </button>
                  )}
                </div>
              )}

              {/* Subfiltro para Torneos: dropdown predefinido + campo libre para "Otro" */}
              {esTorneo && (
                <div className="est-filtro-grupo">
                  <label className="est-filtro-label">
                    Torneo <span className="est-filtro-hint">(opcional — sin selección muestra todos)</span>
                  </label>

                  {/* Chips de torneos predefinidos */}
                  <div className="est-fechas-chips" style={{ flexWrap: 'wrap', gap: '0.4rem' }}>
                    {/* Chip "Todos" para limpiar */}
                    <button
                      className={`est-chip ${torneoSeleccionado === '' ? 'est-chip--activo' : ''}`}
                      onClick={() => { setTorneoSeleccionado(''); setTorneoPersonalizado(''); }}
                    >
                      Todos
                    </button>

                    {TORNEOS_PREDEFINIDOS.map(t => (
                      <button
                        key={t}
                        className={`est-chip ${torneoSeleccionado === t ? 'est-chip--activo' : ''}`}
                        onClick={() => { setTorneoSeleccionado(t); setTorneoPersonalizado(''); }}
                      >
                        {t}
                      </button>
                    ))}

                    {/* Opción "Otro" */}
                    <button
                      className={`est-chip ${torneoSeleccionado === 'Otro' ? 'est-chip--activo' : ''}`}
                      onClick={() => setTorneoSeleccionado('Otro')}
                    >
                      Otro...
                    </button>
                  </div>

                  {/* Campo libre si eligió "Otro" */}
                  {torneoSeleccionado === 'Otro' && (
                    <div className="est-torneo-input-wrap" style={{ marginTop: '0.5rem' }}>
                      <input
                        type="text"
                        className="est-input-torneo"
                        placeholder="Escribe el nombre del torneo..."
                        value={torneoPersonalizado}
                        onChange={e => setTorneoPersonalizado(e.target.value)}
                        autoFocus
                      />
                      {torneoPersonalizado && (
                        <button
                          className="est-torneo-limpiar"
                          onClick={() => setTorneoPersonalizado('')}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tabla de alumnos */}
            {itemSeleccionado ? (
              <TablaAlumnos
                alumnos={alumnosResult.alumnos}
                cargando={alumnosResult.cargando}
                error={alumnosResult.error}
                etiquetaDetalle={etiquetaDetalle}
              />
            ) : (
              <div className="est-selecciona-item">
                <Users size={48} opacity={0.3} />
                <p>Selecciona un ítem del catálogo para ver los alumnos asociados</p>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
};

export default Estadisticas;
