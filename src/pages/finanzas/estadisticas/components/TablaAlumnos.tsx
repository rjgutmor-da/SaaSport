/**
 * TablaAlumnos.tsx
 * Tabla estilo Excel de alumnos por ítem de catálogo.
 * - Paginación y búsqueda interna
 * - Lista seleccionable (toda la tabla o filas individuales para copiar a Excel)
 * - Columnas: Alumno, Detalle (mes/torneo), Monto, Fecha
 */
import React, { useState, useMemo } from 'react';
import { Search, Copy, Check, RefreshCw } from 'lucide-react';
import type { AlumnoPorItem } from '../hooks/useAlumnosPorItem';
import { fmtMonto } from '../utils/estadisticasUtils';

interface Props {
  alumnos: AlumnoPorItem[];
  cargando: boolean;
  error: string | null;
  /** Etiqueta de la columna "Detalle" (ej. "Meses" o "Torneo") */
  etiquetaDetalle?: string;
}

const TablaAlumnos: React.FC<Props> = ({
  alumnos,
  cargando,
  error,
  etiquetaDetalle = 'Detalle',
}) => {
  const [busqueda, setBusqueda] = useState('');
  const [copiado, setCopiado] = useState(false);

  // Filtrado por búsqueda
  const alumnosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return alumnos;
    const q = busqueda.toLowerCase();
    return alumnos.filter(a =>
      a.nombre_completo.toLowerCase().includes(q) ||
      a.detalle.toLowerCase().includes(q)
    );
  }, [alumnos, busqueda]);

  // Total del período filtrado
  const totalMonto = useMemo(
    () => alumnosFiltrados.reduce((s, a) => s + a.monto, 0),
    [alumnosFiltrados]
  );

  /** Copia la tabla como texto TSV (Tab-Separated Values) listo para pegar en Excel */
  const copiarTabla = () => {
    const cabecera = ['Alumno', etiquetaDetalle, 'Monto (Bs)', 'Fecha'].join('\t');
    const filas = alumnosFiltrados.map(a => [
      a.nombre_completo,
      a.detalle || '—',
      a.monto.toFixed(2),
      a.fecha,
    ].join('\t'));
    const texto = [cabecera, ...filas].join('\n');
    navigator.clipboard.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    });
  };

  if (error) {
    return (
      <div className="est-tabla-error">
        <p>⚠️ {error}</p>
      </div>
    );
  }

  return (
    <div className="est-tabla-alumnos-wrap">
      {/* Barra de búsqueda + botón copiar */}
      <div className="est-tabla-barra">
        <div className="est-tabla-busqueda">
          <Search size={15} />
          <input
            type="text"
            placeholder="Buscar alumno..."
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            className="est-tabla-input-busq"
          />
          {busqueda && (
            <button className="est-tabla-limpiar" onClick={() => setBusqueda('')}>✕</button>
          )}
        </div>

        <div className="est-tabla-info">
          <span className="est-tabla-conteo">
            {alumnosFiltrados.length} alumno{alumnosFiltrados.length !== 1 ? 's' : ''}
          </span>
          <span className="est-tabla-total">
            Total: <strong>Bs {fmtMonto(totalMonto)}</strong>
          </span>
          <button
            className={`est-tabla-copiar ${copiado ? 'est-tabla-copiar--ok' : ''}`}
            onClick={copiarTabla}
            title="Copiar tabla para pegar en Excel (formato TSV)"
          >
            {copiado ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar a Excel</>}
          </button>
        </div>
      </div>

      {/* Tabla */}
      <div className="est-tabla-scroll">
        <table className="est-tabla" id="tabla-alumnos-item">
          <thead>
            <tr>
              <th className="est-th est-th-num">#</th>
              <th className="est-th">Alumno</th>
              <th className="est-th">{etiquetaDetalle}</th>
              <th className="est-th est-th-right">Monto (Bs)</th>
              <th className="est-th est-th-right">Fecha</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={5} className="est-td-cargando">
                  <RefreshCw size={20} className="spin" /> Cargando...
                </td>
              </tr>
            ) : alumnosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={5} className="est-td-vacio">
                  {busqueda ? 'Sin resultados para la búsqueda.' : 'Sin datos para los filtros seleccionados.'}
                </td>
              </tr>
            ) : (
              alumnosFiltrados.map((a, idx) => (
                <tr key={`${a.nota_id}-${idx}`} className="est-tr">
                  <td className="est-td est-td-num">{idx + 1}</td>
                  <td className="est-td est-td-nombre">{a.nombre_completo}</td>
                  <td className="est-td est-td-detalle">{a.detalle || '—'}</td>
                  <td className="est-td est-td-right est-td-monto">
                    {fmtMonto(a.monto)}
                  </td>
                  <td className="est-td est-td-right est-td-fecha">{a.fecha}</td>
                </tr>
              ))
            )}
          </tbody>
          {/* Pie de tabla con total */}
          {!cargando && alumnosFiltrados.length > 0 && (
            <tfoot>
              <tr className="est-tfoot-tr">
                <td colSpan={3} className="est-td est-tfoot-label">Total período</td>
                <td className="est-td est-td-right est-tfoot-total">
                  {fmtMonto(totalMonto)}
                </td>
                <td className="est-td" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default TablaAlumnos;
