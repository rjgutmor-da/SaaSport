import React from 'react';
import { ChevronLeft, ChevronRight, Clock, Info } from 'lucide-react';
import {
  DIAS_VIGENCIA_NOTAS_AUTOMATICAS,
  obtenerEstadoVigenciaNota,
  type NivelUrgenciaVigencia,
} from '../../lib/notasAutomaticasVigencia';

const ESTILOS_NIVEL: Record<NivelUrgenciaVigencia, { bg: string; color: string; border: string }> = {
  normal: {
    bg: 'rgba(10, 132, 255, 0.12)',
    color: '#60a5fa',
    border: 'rgba(10, 132, 255, 0.28)',
  },
  proximo: {
    bg: 'rgba(245, 158, 11, 0.14)',
    color: '#fbbf24',
    border: 'rgba(245, 158, 11, 0.35)',
  },
  critico: {
    bg: 'rgba(239, 68, 68, 0.15)',
    color: '#f87171',
    border: 'rgba(239, 68, 68, 0.38)',
  },
};

export const AvisoVigenciaNotasAutomaticas: React.FC = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.65rem',
      marginBottom: '1rem',
      padding: '0.75rem 1rem',
      borderRadius: '8px',
      background: 'rgba(10, 132, 255, 0.08)',
      border: '1px solid rgba(10, 132, 255, 0.25)',
      color: 'var(--text-primary)',
      fontSize: '0.85rem',
    }}
  >
    <Info size={16} style={{ color: '#60a5fa', flexShrink: 0 }} />
    <span>
      Las notas automáticas pendientes se conservan durante{' '}
      <strong>{DIAS_VIGENCIA_NOTAS_AUTOMATICAS} días</strong> desde su generación. Si no se
      aprueban dentro de ese plazo, el sistema las elimina automáticamente.
    </span>
  </div>
);

interface EtiquetaVigenciaNotaProps {
  diasRestantes: number;
  expiraAt?: string | null;
}

export const EtiquetaVigenciaNota: React.FC<EtiquetaVigenciaNotaProps> = ({
  diasRestantes,
  expiraAt,
}) => {
  const estado = obtenerEstadoVigenciaNota(diasRestantes);
  const estilo = ESTILOS_NIVEL[estado.nivel];
  const fechaExpiracion = expiraAt
    ? new Date(expiraAt).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  return (
    <span
      title={
        fechaExpiracion
          ? `Se eliminará automáticamente el ${fechaExpiracion} si no se aprueba.`
          : 'Vigencia restante antes de la eliminación automática.'
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.2rem 0.55rem',
        borderRadius: '999px',
        fontSize: '0.75rem',
        fontWeight: 600,
        background: estilo.bg,
        color: estilo.color,
        border: `1px solid ${estilo.border}`,
        whiteSpace: 'nowrap',
      }}
    >
      <Clock size={12} />
      <span>{estado.etiqueta}</span>
    </span>
  );
};

interface BarraPaginacionNotasAutomaticasProps {
  pagina: number;
  limite: number;
  totalResultados: number;
  cargando: boolean;
  onCambiarPagina: (nuevaPagina: number) => void;
}

export const BarraPaginacionNotasAutomaticas: React.FC<BarraPaginacionNotasAutomaticasProps> = ({
  pagina,
  limite,
  totalResultados,
  cargando,
  onCambiarPagina,
}) => {
  if (totalResultados === 0) return null;

  const totalPaginas = Math.max(1, Math.ceil(totalResultados / limite));
  const desde = (pagina - 1) * limite + 1;
  const hasta = Math.min(pagina * limite, totalResultados);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '0.75rem',
        padding: '0.85rem 1rem',
        borderTop: '1px solid var(--border)',
        background: 'rgba(255, 255, 255, 0.02)',
        fontSize: '0.85rem',
        color: 'var(--text-secondary)',
      }}
    >
      <span>
        Mostrando <strong>{desde}</strong>–<strong>{hasta}</strong> de{' '}
        <strong>{totalResultados}</strong> mensualidades
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn-volver"
          disabled={cargando || pagina <= 1}
          onClick={() => onCambiarPagina(pagina - 1)}
          style={{
            height: '32px',
            padding: '0 0.7rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            opacity: cargando || pagina <= 1 ? 0.45 : 1,
            cursor: cargando || pagina <= 1 ? 'not-allowed' : 'pointer',
          }}
        >
          <ChevronLeft size={14} />
          <span>Anterior</span>
        </button>

        <span style={{ color: 'var(--text-primary)', fontWeight: 600, padding: '0 0.35rem' }}>
          Página {pagina} de {totalPaginas}
        </span>

        <button
          type="button"
          className="btn-volver"
          disabled={cargando || pagina >= totalPaginas}
          onClick={() => onCambiarPagina(pagina + 1)}
          style={{
            height: '32px',
            padding: '0 0.7rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            opacity: cargando || pagina >= totalPaginas ? 0.45 : 1,
            cursor: cargando || pagina >= totalPaginas ? 'not-allowed' : 'pointer',
          }}
        >
          <span>Siguiente</span>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
};
