/**
 * TablaMensualidades.tsx
 * Tabla estilo Excel con la mensualidad de la ficha de cada alumno activo.
 * - Columnas: #, Alumno, Entrenador, Grupo, Mensualidad
 * - Búsqueda por alumno, orden al hacer clic en las cabeceras
 * - Contador, total y botón "Copiar a Excel"
 */
import React, { useState, useMemo } from 'react';
import { Search, Copy, Check, RefreshCw, ArrowUp, ArrowDown } from 'lucide-react';
import { simboloMoneda } from '../../../../lib/moneda';
import { fmtMonto } from '../utils/estadisticasUtils';
import type { AlumnoMensualidad } from '../hooks/useMensualidadesAlumnos';

type ColumnaOrden = 'nombre_completo' | 'entrenador' | 'grupo' | 'mensualidad';

interface Props {
  alumnos: AlumnoMensualidad[];
  cargando: boolean;
  error: string | null;
}

const TablaMensualidades: React.FC<Props> = ({ alumnos, cargando, error }) => {
  const [busqueda, setBusqueda] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [orden, setOrden] = useState<{ columna: ColumnaOrden; asc: boolean }>({
    columna: 'nombre_completo',
    asc: true,
  });

  // Búsqueda + orden
  const filas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtradas = q
      ? alumnos.filter(a =>
          a.nombre_completo.toLowerCase().includes(q) ||
          a.entrenador.toLowerCase().includes(q) ||
          a.grupo.toLowerCase().includes(q))
      : alumnos;
    const factor = orden.asc ? 1 : -1;
    return [...filtradas].sort((x, y) => {
      if (orden.columna === 'mensualidad') return (x.mensualidad - y.mensualidad) * factor;
      return x[orden.columna].localeCompare(y[orden.columna], 'es') * factor;
    });
  }, [alumnos, busqueda, orden]);

  const total = useMemo(() => filas.reduce((s, a) => s + a.mensualidad, 0), [filas]);

  const cambiarOrden = (columna: ColumnaOrden) => {
    setOrden(prev => (prev.columna === columna ? { columna, asc: !prev.asc } : { columna, asc: true }));
  };

  const iconoOrden = (columna: ColumnaOrden) => {
    if (orden.columna !== columna) return null;
    return orden.asc ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  };

  /** Copia la tabla como TSV listo para pegar en Excel */
  const copiarTabla = () => {
    const cabecera = ['Alumno', 'Entrenador', 'Grupo', 'Mensualidad'].join('\t');
    const lineas = filas.map(a => [
      a.nombre_completo,
      a.entrenador,
      a.grupo,
      a.mensualidad.toFixed(2).replace('.', ','),
    ].join('\t'));
    navigator.clipboard.writeText([cabecera, ...lineas].join('\n')).then(() => {
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

  const cabeceraOrdenable = (columna: ColumnaOrden, texto: string, derecha = false) => (
    <th
      className={`est-th est-mens-th-orden ${derecha ? 'est-th-right' : ''}`}
      onClick={() => cambiarOrden(columna)}
      title="Ordenar"
    >
      {texto} {iconoOrden(columna)}
    </th>
  );

  return (
    <div className="est-tabla-alumnos-wrap">
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
            {filas.length} alumno{filas.length !== 1 ? 's' : ''}
          </span>
          <span className="est-tabla-total">
            Total: <strong>{simboloMoneda()} {fmtMonto(total)}</strong>
          </span>
          <button
            className={`est-tabla-copiar ${copiado ? 'est-tabla-copiar--ok' : ''}`}
            onClick={copiarTabla}
            title="Copiar tabla para pegar en Excel (formato TSV)"
          >
            {copiado ? <><Check size={14} /> ¡Copiado!</> : <><Copy size={14} /> Copiar a Excel</>}
          </button>
        </div>
      </div>

      <div className="est-tabla-scroll">
        <table className="est-tabla" id="tabla-mensualidades">
          <thead>
            <tr>
              <th className="est-th est-th-num">#</th>
              {cabeceraOrdenable('nombre_completo', 'Alumno')}
              {cabeceraOrdenable('entrenador', 'Entrenador')}
              {cabeceraOrdenable('grupo', 'Grupo')}
              {cabeceraOrdenable('mensualidad', 'Mensualidad', true)}
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={5} className="est-td-cargando">
                  <RefreshCw size={20} className="spin" /> Cargando...
                </td>
              </tr>
            ) : filas.length === 0 ? (
              <tr>
                <td colSpan={5} className="est-td-vacio">
                  {busqueda ? 'Sin resultados para la búsqueda.' : 'Sin alumnos para los filtros seleccionados.'}
                </td>
              </tr>
            ) : (
              filas.map((a, idx) => (
                <tr key={a.id} className="est-tr">
                  <td className="est-td est-td-num">{idx + 1}</td>
                  <td className="est-td est-td-nombre">{a.nombre_completo}</td>
                  <td className="est-td">{a.entrenador}</td>
                  <td className="est-td">{a.grupo}</td>
                  <td className="est-td est-td-right est-td-monto">{fmtMonto(a.mensualidad)}</td>
                </tr>
              ))
            )}
          </tbody>
          {!cargando && filas.length > 0 && (
            <tfoot>
              <tr className="est-tfoot-tr">
                <td colSpan={4} className="est-td est-tfoot-label">Total</td>
                <td className="est-td est-td-right est-tfoot-total">{fmtMonto(total)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default TablaMensualidades;
