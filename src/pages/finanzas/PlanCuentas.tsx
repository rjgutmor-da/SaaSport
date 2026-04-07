/**
 * PlanCuentas.tsx
 * Pantalla principal del Plan de Cuentas contable.
 * Carga las cuentas desde Supabase, las presenta como árbol jerárquico,
 * y permite crear nuevas cuentas con un formulario inline.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import ArbolCuentas from '../../components/finanzas/ArbolCuentas';
import type { CuentaContable, NodoCuenta, TipoCuenta } from '../../types/finanzas';
import { COLORES_TIPO, ETIQUETAS_TIPO } from '../../types/finanzas';
import {
  Search, TreePine, RefreshCw, ChevronLeft, Plus, X, Check,
  TrendingUp, TrendingDown, Landmark, ArrowDownUp, Wallet
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Iconos por tipo de cuenta
const ICONOS_TIPO: Record<TipoCuenta, React.ReactNode> = {
  activo: <TrendingUp size={16} />,
  pasivo: <TrendingDown size={16} />,
  patrimonio: <Landmark size={16} />,
  ingreso: <ArrowDownUp size={16} />,
  gasto: <Wallet size={16} />,
};

/**
 * Transforma una lista plana de cuentas en un árbol jerárquico
 * basándose en la convención de códigos (ej: 1 → 1.1 → 1.1.1)
 */
const construirArbol = (cuentas: CuentaContable[]): NodoCuenta[] => {
  const ordenadas = [...cuentas].sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
  const mapa = new Map<string, NodoCuenta>();
  const raices: NodoCuenta[] = [];

  for (const cuenta of ordenadas) {
    const nodo: NodoCuenta = {
      ...cuenta,
      hijos: [],
      nivel: cuenta.codigo.split('.').length - 1,
      expandido: cuenta.codigo.split('.').length <= 2,
    };
    mapa.set(cuenta.codigo, nodo);
    const partes = cuenta.codigo.split('.');
    if (partes.length > 1) {
      const codigoPadre = partes.slice(0, -1).join('.');
      const padre = mapa.get(codigoPadre);
      if (padre) { padre.hijos.push(nodo); } else { raices.push(nodo); }
    } else {
      raices.push(nodo);
    }
  }
  return raices;
};


const PlanCuentas: React.FC = () => {
  const navigate = useNavigate();
  const [cuentas, setCuentas] = useState<CuentaContable[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<TipoCuenta | 'todos'>('todos');

  // Estado del formulario de nueva cuenta
  const [mostrarForm, setMostrarForm] = useState(false);
  const [formCodigo, setFormCodigo] = useState('');
  const [formNombre, setFormNombre] = useState('');
  const [formTipo, setFormTipo] = useState<TipoCuenta>('activo');
  const [formTransaccional, setFormTransaccional] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formExito, setFormExito] = useState<string | null>(null);

  // Cargar cuentas desde Supabase
  const cargarCuentas = async () => {
    setCargando(true);
    setError(null);
    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) {
      setError('No se pudo determinar tu escuela.');
      setCargando(false);
      return;
    }

    const { data, error: err } = await supabase
      .from('plan_cuentas')
      .select('*')
      .eq('escuela_id', escuelaId)
      .order('codigo', { ascending: true });

    if (err) {
      setError(`Error al cargar el plan de cuentas: ${err.message}`);
      setCargando(false);
      return;
    }
    setCuentas(data ?? []);
    setCargando(false);
  };

  useEffect(() => { cargarCuentas(); }, []);

  // Filtrar cuentas por tipo
  const cuentasFiltradas = useMemo(() => {
    if (filtroTipo === 'todos') return cuentas;
    return cuentas.filter(c => c.tipo === filtroTipo);
  }, [cuentas, filtroTipo]);

  // Construir árbol
  const arbol = useMemo(() => construirArbol(cuentasFiltradas), [cuentasFiltradas]);

  // Estadísticas rápidas
  const estadisticas = useMemo(() => {
    const total = cuentas.length;
    const porTipo = (Object.keys(ETIQUETAS_TIPO) as TipoCuenta[]).map(tipo => ({
      tipo,
      cantidad: cuentas.filter(c => c.tipo === tipo).length,
    }));
    return { total, porTipo };
  }, [cuentas]);

  // Autodetectar tipo según el código ingresado
  const autodetectarTipo = (codigo: string) => {
    const primer = codigo.split('.')[0];
    const mapaAuto: Record<string, TipoCuenta> = {
      '1': 'activo', '2': 'pasivo', '3': 'patrimonio', '4': 'ingreso', '5': 'gasto'
    };
    if (mapaAuto[primer]) setFormTipo(mapaAuto[primer]);
  };

  // Obtener escuela_id del usuario autenticado
  const obtenerEscuelaId = async (): Promise<string | null> => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data } = await supabase
      .from('usuarios')
      .select('escuela_id')
      .eq('id', user.id)
      .single();
    return data?.escuela_id ?? null;
  };

  // Guardar nueva cuenta
  const guardarCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormExito(null);

    // Validaciones
    if (!formCodigo.trim() || !formNombre.trim()) {
      setFormError('Código y nombre son obligatorios.');
      return;
    }
    if (cuentas.some(c => c.codigo === formCodigo.trim())) {
      setFormError(`El código "${formCodigo}" ya existe.`);
      return;
    }

    setGuardando(true);
    const escuelaId = await obtenerEscuelaId();
    if (!escuelaId) {
      setFormError('No se pudo determinar tu escuela. Inicia sesión de nuevo.');
      setGuardando(false);
      return;
    }

    const { error: insertErr } = await supabase
      .from('plan_cuentas')
      .insert({
        escuela_id: escuelaId,
        codigo: formCodigo.trim(),
        nombre: formNombre.trim(),
        tipo: formTipo,
        es_transaccional: formTransaccional,
      });

    if (insertErr) {
      setFormError(`Error al crear: ${insertErr.message}`);
      setGuardando(false);
      return;
    }

    setFormExito(`Cuenta "${formCodigo} - ${formNombre}" creada exitosamente.`);
    setFormCodigo('');
    setFormNombre('');
    setFormTransaccional(true);
    setGuardando(false);
    cargarCuentas(); // Recargar árbol
  };

  // Abrir formulario con código pre-sugerido
  const abrirFormulario = () => {
    setMostrarForm(true);
    setFormError(null);
    setFormExito(null);
  };

  return (
    <main className="main-content">
      {/* Encabezado */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/finanzas')} title="Volver a Finanzas">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <TreePine size={28} style={{ marginRight: '0.5rem' }} />
              Plan de Cuentas
            </h1>
            <p className="pc-subtitulo">Árbol contable jerárquico — {estadisticas.total} cuentas registradas</p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button
            className="btn-nueva-cuenta"
            onClick={() => mostrarForm ? setMostrarForm(false) : abrirFormulario()}
          >
            {mostrarForm ? <X size={18} /> : <Plus size={18} />}
            {mostrarForm ? 'Cerrar' : 'Nueva Cuenta'}
          </button>
          <button
            className="btn-refrescar"
            onClick={cargarCuentas}
            disabled={cargando}
            title="Recargar cuentas"
          >
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Formulario inline para crear cuenta */}
      {mostrarForm && (
        <form className="form-nueva-cuenta" onSubmit={guardarCuenta}>
          <div className="form-fila">
            {/* Código */}
            <div className="form-campo form-campo--codigo">
              <label htmlFor="fc-codigo">Código</label>
              <input
                id="fc-codigo"
                type="text"
                value={formCodigo}
                onChange={(e) => { setFormCodigo(e.target.value); autodetectarTipo(e.target.value); }}
                placeholder="Ej: 1.1.1.01"
                required
                disabled={guardando}
              />
            </div>

            {/* Nombre */}
            <div className="form-campo form-campo--nombre">
              <label htmlFor="fc-nombre">Nombre</label>
              <input
                id="fc-nombre"
                type="text"
                value={formNombre}
                onChange={(e) => setFormNombre(e.target.value)}
                placeholder="Ej: Caja Sucursal Norte"
                required
                disabled={guardando}
              />
            </div>

            {/* Tipo */}
            <div className="form-campo form-campo--tipo">
              <label htmlFor="fc-tipo">Tipo</label>
              <select
                id="fc-tipo"
                value={formTipo}
                onChange={(e) => setFormTipo(e.target.value as TipoCuenta)}
                disabled={guardando}
              >
                {(Object.keys(ETIQUETAS_TIPO) as TipoCuenta[]).map(t => (
                  <option key={t} value={t}>{ETIQUETAS_TIPO[t]}</option>
                ))}
              </select>
            </div>

            {/* Transaccional */}
            <div className="form-campo form-campo--check">
              <label>
                <input
                  type="checkbox"
                  checked={formTransaccional}
                  onChange={(e) => setFormTransaccional(e.target.checked)}
                  disabled={guardando}
                />
                Transaccional
              </label>
            </div>

            {/* Botón guardar */}
            <button type="submit" className="btn-guardar-cuenta" disabled={guardando}>
              <Check size={16} />
              {guardando ? 'Creando...' : 'Crear'}
            </button>
          </div>

          {/* Mensajes de error/éxito */}
          {formError && <div className="form-msg form-msg--error">{formError}</div>}
          {formExito && <div className="form-msg form-msg--exito">{formExito}</div>}

          {/* Ayuda rápida para sugerir código */}
          {formCodigo && (
            <p className="form-ayuda">
              {(() => {
                const partes = formCodigo.split('.');
                if (partes.length > 1) {
                  const padre = partes.slice(0, -1).join('.');
                  const cuentaPadre = cuentas.find(c => c.codigo === padre);
                  return cuentaPadre
                    ? `↳ Hijo de: ${padre} — ${cuentaPadre.nombre}`
                    : `⚠ Padre "${padre}" no encontrado`;
                }
                return 'Nivel raíz (categoría principal)';
              })()}
            </p>
          )}
        </form>
      )}

      {/* Estadísticas */}
      <div className="pc-stats-grid">
        {estadisticas.porTipo.map(({ tipo, cantidad }) => {
          const colores = COLORES_TIPO[tipo];
          return (
            <div
              key={tipo}
              className={`pc-stat-card ${filtroTipo === tipo ? 'pc-stat-card--activo' : ''}`}
              style={{ borderColor: colores.borde }}
              onClick={() => setFiltroTipo(filtroTipo === tipo ? 'todos' : tipo)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setFiltroTipo(filtroTipo === tipo ? 'todos' : tipo);
                }
              }}
            >
              <span className="pc-stat-icono" style={{ color: colores.texto }}>
                {ICONOS_TIPO[tipo]}
              </span>
              <span className="pc-stat-cantidad" style={{ color: colores.texto }}>{cantidad}</span>
              <span className="pc-stat-label">{ETIQUETAS_TIPO[tipo]}</span>
            </div>
          );
        })}
      </div>

      {/* Barra de búsqueda + filtro activo */}
      <div className="pc-barra">
        <div className="pc-busqueda">
          <Search size={18} className="pc-busqueda-icono" />
          <input
            id="busqueda-plan-cuentas"
            type="text"
            placeholder="Buscar por código o nombre..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            className="pc-busqueda-input"
          />
        </div>
        {filtroTipo !== 'todos' && (
          <button
            className="pc-filtro-badge"
            style={{
              backgroundColor: COLORES_TIPO[filtroTipo].bg,
              color: COLORES_TIPO[filtroTipo].texto,
              borderColor: COLORES_TIPO[filtroTipo].borde,
            }}
            onClick={() => setFiltroTipo('todos')}
          >
            {ETIQUETAS_TIPO[filtroTipo]} ✕
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="pc-error">
          <p>⚠️ {error}</p>
          <button onClick={cargarCuentas}>Reintentar</button>
        </div>
      )}

      {/* Árbol */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando plan de cuentas...</p>
        </div>
      ) : (
        <ArbolCuentas nodos={arbol} busqueda={busqueda} />
      )}
    </main>
  );
};

export default PlanCuentas;
