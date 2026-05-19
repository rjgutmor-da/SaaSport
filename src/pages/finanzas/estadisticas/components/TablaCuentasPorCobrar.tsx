/**
 * TablaCuentasPorCobrar.tsx
 * Tabla de deudas pendientes por concepto.
 */
import React, { useState, useMemo } from 'react';
import { Search, Copy, Check, RefreshCw } from 'lucide-react';
import type { CuentaPorCobrarRow } from '../hooks/useCuentasPorCobrar';
import { fmtMonto } from '../utils/estadisticasUtils';

interface Props {
  datos: CuentaPorCobrarRow[];
  cargando: boolean;
  error: string | null;
}

const TablaCuentasPorCobrar: React.FC<Props> = ({ datos, cargando, error }) => {
  const [busqueda, setBusqueda] = useState('');
  const [copiado, setCopiado] = useState(false);

  // Filtrado por búsqueda
  const datosFiltrados = useMemo(() => {
    if (!busqueda.trim()) return datos;
    const q = busqueda.toLowerCase();
    return datos.filter(d =>
      d.alumno.toLowerCase().includes(q) ||
      d.concepto.toLowerCase().includes(q) ||
      d.entrenador.toLowerCase().includes(q)
    );
  }, [datos, busqueda]);

  // Total adeudado
  const totalAdeudado = useMemo(
    () => datosFiltrados.reduce((s, d) => s + d.monto_adeudado, 0),
    [datosFiltrados]
  );

  /** Copia la tabla como texto TSV */
  const copiarTabla = () => {
    const cabecera = ['#', 'Alumno', 'Concepto', 'Sub', 'Monto Adeudado', 'Teléfono'].join('\t');
    const filas = datosFiltrados.map((d, idx) => [
      idx + 1,
      d.alumno,
      d.concepto,
      d.sub,
      d.monto_adeudado.toFixed(2),
      d.telefono
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
      <div className="est-tabla-barra">
        <div className="est-tabla-busqueda">
          <Search size={15} />
          <input
            type="text"
            placeholder="Buscar por alumno o concepto..."
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
            {datosFiltrados.length} registro{datosFiltrados.length !== 1 ? 's' : ''}
          </span>
          <span className="est-tabla-total">
            Total Adeudado: <strong>Bs {fmtMonto(totalAdeudado)}</strong>
          </span>
          <button
            className={`est-tabla-copiar ${copiado ? 'est-tabla-copiar--ok' : ''}`}
            onClick={copiarTabla}
          >
            {copiado ? <><Check size={14} /> Copiado!</> : <><Copy size={14} /> Copiar a Excel</>}
          </button>
        </div>
      </div>

      <div className="est-tabla-scroll">
        <table className="est-tabla">
          <thead>
            <tr>
              <th className="est-th est-th-num">#</th>
              <th className="est-th">Alumno</th>
              <th className="est-th">Concepto</th>
              <th className="est-th">Sub</th>
              <th className="est-th est-th-right">Monto Adeudado</th>
              <th className="est-th">Teléfono</th>
            </tr>
          </thead>
          <tbody>
            {cargando ? (
              <tr>
                <td colSpan={6} className="est-td-cargando">
                  <RefreshCw size={20} className="spin" /> Cargando datos...
                </td>
              </tr>
            ) : datosFiltrados.length === 0 ? (
              <tr>
                <td colSpan={6} className="est-td-vacio">
                  {busqueda ? 'Sin resultados para la búsqueda.' : 'No hay deudas pendientes en este período.'}
                </td>
              </tr>
            ) : (
              datosFiltrados.map((d, idx) => (
                <tr key={`${d.detalle_id}`} className="est-tr">
                  <td className="est-td est-td-num">{idx + 1}</td>
                  <td className="est-td est-td-nombre">{d.alumno}</td>
                  <td className="est-td est-td-detalle">{d.concepto}</td>
                  <td className="est-td">{d.sub}</td>
                  <td className="est-td est-td-right text-error font-bold">
                    {fmtMonto(d.monto_adeudado)}
                  </td>
                  <td className="est-td">{d.telefono}</td>
                </tr>
              ))
            )}
          </tbody>
          {!cargando && datosFiltrados.length > 0 && (
            <tfoot>
              <tr className="est-tfoot-tr">
                <td colSpan={4} className="est-td est-tfoot-label">Total Pendiente</td>
                <td className="est-td est-td-right est-tfoot-total text-error">
                  {fmtMonto(totalAdeudado)}
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

export default TablaCuentasPorCobrar;
