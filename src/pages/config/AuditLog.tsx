/**
 * AuditLog.tsx
 * Pantalla de auditoría: muestra la huella verificable de todas las
 * operaciones financieras (CxC, CxP, Banco) realizadas por los usuarios.
 * Accesible desde Configuraciones.
 */
import React, { useEffect, useState, useMemo } from 'react';
import { supabase } from '../../lib/supabaseClient';
import {
  ChevronLeft, RefreshCw, Search, Shield, Clock,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Registro de auditoría */
interface AuditEntry {
  id: string;
  escuela_id: string;
  usuario_id: string;
  usuario_nombre: string;
  accion: string;
  modulo: string;
  entidad_id: string;
  detalle: any;
  created_at: string;
}

/** Formatea fecha y hora legible */
const fmtFechaHora = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('es-BO', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
};

/** Íconos por acción */
const ACCION_ESTILO: Record<string, { color: string; bg: string; label: string }> = {
  crear:  { color: '#4ade80', bg: 'rgba(74,222,128,0.1)', label: 'Creación' },
  editar: { color: '#38bdf8', bg: 'rgba(56,189,248,0.1)', label: 'Edición' },
  anular: { color: '#f87171', bg: 'rgba(248,113,113,0.1)', label: 'Anulación' },
  cobro:  { color: '#facc15', bg: 'rgba(250,204,21,0.1)', label: 'Cobro' },
};

/** Etiquetas de módulo */
const MODULO_LABEL: Record<string, string> = {
  cxc: 'Cuentas x Cobrar',
  cxp: 'Cuentas x Pagar',
  banco: 'Mov. Bancario',
};

const AuditLog: React.FC = () => {
  const navigate = useNavigate();
  const [registros, setRegistros] = useState<AuditEntry[]>([]);
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState('');
  const [filtroModulo, setFiltroModulo] = useState('');
  const [filtroAccion, setFiltroAccion] = useState('');
  const [expandido, setExpandido] = useState<string | null>(null);

  /** Cargar registros de auditoría */
  const cargarDatos = async () => {
    setCargando(true);
    const { data, error } = await supabase.from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);

    if (!error) setRegistros(data ?? []);
    setCargando(false);
  };

  useEffect(() => { cargarDatos(); }, []);

  /** Filtrar registros */
  const registrosFiltrados = useMemo(() => {
    let lista = registros;
    if (filtroModulo) lista = lista.filter(r => r.modulo === filtroModulo);
    if (filtroAccion) lista = lista.filter(r => r.accion === filtroAccion);
    if (busqueda.trim()) {
      const q = busqueda.toLowerCase();
      lista = lista.filter(r =>
        r.usuario_nombre.toLowerCase().includes(q) ||
        JSON.stringify(r.detalle).toLowerCase().includes(q)
      );
    }
    return lista;
  }, [registros, filtroModulo, filtroAccion, busqueda]);

  return (
    <main className="main-content">
      {/* Header */}
      <div className="pc-header">
        <div className="pc-header-izq">
          <button className="btn-volver" onClick={() => navigate('/configuraciones')} title="Volver">
            <ChevronLeft size={20} />
          </button>
          <div>
            <h1 className="pc-titulo">
              <Shield size={28} style={{ marginRight: '0.5rem' }} />
              Registro de Auditoría
            </h1>
            <p className="pc-subtitulo">
              Huella verificable de operaciones financieras — {registrosFiltrados.length} registros
            </p>
          </div>
        </div>
        <div className="pc-header-acciones">
          <button className="btn-refrescar" onClick={cargarDatos} disabled={cargando}>
            <RefreshCw size={18} className={cargando ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="audit-filtros">
        <div className="pc-busqueda" style={{ flex: 1 }}>
          <Search size={18} className="pc-busqueda-icono" />
          <input
            type="text"
            placeholder="Buscar por usuario o detalle..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="pc-busqueda-input"
          />
        </div>
        <select
          value={filtroModulo}
          onChange={e => setFiltroModulo(e.target.value)}
          className="audit-select"
        >
          <option value="">Todos los módulos</option>
          <option value="cxc">Cuentas x Cobrar</option>
          <option value="cxp">Cuentas x Pagar</option>
          <option value="banco">Mov. Bancario</option>
        </select>
        <select
          value={filtroAccion}
          onChange={e => setFiltroAccion(e.target.value)}
          className="audit-select"
        >
          <option value="">Todas las acciones</option>
          <option value="crear">Creación</option>
          <option value="editar">Edición</option>
          <option value="anular">Anulación</option>
          <option value="cobro">Cobro</option>
        </select>
      </div>

      {/* Lista de registros */}
      {cargando ? (
        <div className="pc-cargando">
          <RefreshCw size={32} className="spin" />
          <p>Cargando registros...</p>
        </div>
      ) : registrosFiltrados.length === 0 ? (
        <div className="arbol-vacio">
          <Shield size={40} style={{ marginBottom: '0.75rem', opacity: 0.4 }} />
          <p>No hay registros de auditoría.</p>
        </div>
      ) : (
        <div className="audit-lista">
          {registrosFiltrados.map(r => {
            const estilo = ACCION_ESTILO[r.accion] || { color: '#94a3b8', bg: 'rgba(148,163,184,0.1)', label: r.accion };
            const isExp = expandido === r.id;

            return (
              <div key={r.id} className="audit-row" onClick={() => setExpandido(isExp ? null : r.id)}>
                <div className="audit-row-main">
                  <div className="audit-col-fecha">
                    <Clock size={12} />
                    <span>{fmtFechaHora(r.created_at)}</span>
                  </div>
                  <span className="audit-col-usuario">{r.usuario_nombre || 'Sistema'}</span>
                  <span className="cxc-badge" style={{ background: estilo.bg, color: estilo.color, borderColor: estilo.color }}>
                    {estilo.label}
                  </span>
                  <span className="audit-col-modulo">{MODULO_LABEL[r.modulo] || r.modulo}</span>
                  {isExp ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </div>

                {/* Detalle expandido */}
                {isExp && (
                  <div className="audit-detalle" onClick={e => e.stopPropagation()}>
                    <div className="audit-detalle-campo">
                      <strong>ID del registro:</strong> <code>{r.entidad_id}</code>
                    </div>
                    <div className="audit-detalle-campo">
                      <strong>Usuario ID:</strong> <code>{r.usuario_id}</code>
                    </div>
                    <div className="audit-detalle-campo">
                      <strong>Detalle:</strong>
                      <pre className="audit-detalle-json">
                        {JSON.stringify(r.detalle, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
};

export default AuditLog;
