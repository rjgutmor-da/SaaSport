/** Modal de confirmación para archivar un alumno con advertencias de deuda y borradores. */
import React, { useState } from 'react';
import { AlertTriangle, Archive, X } from 'lucide-react';
import { simboloMoneda } from '../../lib/moneda';
import { archivarAlumnoSaaSport } from '../../services/alumnos';
import type { AlumnoListadoSaaSport } from '../../types/alumnos';

interface ModalConfirmarArchivoAlumnoProps {
  alumno: AlumnoListadoSaaSport | null;
  onCerrar: () => void;
  onArchivado: (resultado: { alumno: AlumnoListadoSaaSport; borradores_eliminados: number }) => void;
}

const fmtMonto = (n: number): string =>
  n.toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ModalConfirmarArchivoAlumno: React.FC<ModalConfirmarArchivoAlumnoProps> = ({
  alumno,
  onCerrar,
  onArchivado,
}) => {
  const [archivando, setArchivando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!alumno) return null;

  const saldoPendiente = Number(alumno.saldo_pendiente || 0);
  const borradores = Number(alumno.borradores_pendientes || 0);

  const confirmarArchivo = async () => {
    if (archivando) return;
    setArchivando(true);
    setError(null);
    try {
      const resultado = await archivarAlumnoSaaSport(alumno.id);
      onArchivado({
        alumno,
        borradores_eliminados: resultado.borradores_eliminados,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se pudo archivar al alumno.');
    } finally {
      setArchivando(false);
    }
  };

  return (
    <div className="cxc-modal-overlay" onClick={() => !archivando && onCerrar()}>
      <div className="cxc-modal" style={{ maxWidth: '480px' }} onClick={e => e.stopPropagation()}>
        <div className="cxc-modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Archive size={20} style={{ color: 'var(--primary)' }} />
            Archivar Alumno
          </h2>
          <button type="button" onClick={onCerrar} disabled={archivando} aria-label="Cerrar">
            <X size={20} />
          </button>
        </div>

        <div className="cxc-modal-form" style={{ gap: '1rem' }}>
          <p style={{ color: 'var(--text-primary)', lineHeight: 1.6 }}>
            ¿Confirmas archivar a <strong>{alumno.nombres} {alumno.apellidos}</strong>? El alumno
            dejará de ocupar cupo activo y no generará futuras mensualidades.
          </p>

          {saldoPendiente > 0 && (
            <div className="alumno-duplicado-alerta" role="alert">
              <AlertTriangle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
              <div>
                <p className="alumno-duplicado-titulo">
                  Saldo pendiente: {simboloMoneda()} {fmtMonto(saldoPendiente)}
                </p>
                <p className="alumno-duplicado-desc">
                  Su deuda histórica se conservará intacta y seguirá disponible para cobro en{' '}
                  <strong>Cuentas por Cobrar → Archivados</strong>.
                </p>
              </div>
            </div>
          )}

          {borradores > 0 && (
            <div className="alumno-archivo-nota-borrador">
              <span>
                Se eliminarán automáticamente <strong>{borradores}</strong> mensualidad(es) en
                borrador que aún no habían sido aprobadas.
              </span>
            </div>
          )}

          {error && (
            <div className="login-error" style={{ margin: 0 }}>
              <span>{error}</span>
            </div>
          )}

          <div className="alumno-form-pie">
            <button
              type="button"
              className="btn-refrescar"
              onClick={onCerrar}
              disabled={archivando}
              style={{ width: 'auto', padding: '0 1.25rem' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="btn-guardar-cuenta"
              onClick={confirmarArchivo}
              disabled={archivando}
              style={{ width: 'auto', padding: '0 1.5rem' }}
            >
              {archivando ? 'Archivando...' : 'Confirmar Archivo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModalConfirmarArchivoAlumno;
