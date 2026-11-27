export const DIAS_VIGENCIA_NOTAS_AUTOMATICAS = 25;
export const NOTAS_AUTOMATICAS_POR_PAGINA = 30;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export type NivelUrgenciaVigencia = 'normal' | 'proximo' | 'critico';

export interface EstadoVigenciaNota {
  diasRestantes: number;
  nivel: NivelUrgenciaVigencia;
  etiqueta: string;
}

/** Calcula la fecha ISO mínima (hace 25 días) para considerar vigente un borrador automático. */
export function obtenerFechaCorteVigenciaIso(ahoraMs = Date.now()): string {
  return new Date(ahoraMs - DIAS_VIGENCIA_NOTAS_AUTOMATICAS * MS_POR_DIA).toISOString();
}

/** Clasifica los días restantes antes del borrado automático y devuelve el texto en español. */
export function obtenerEstadoVigenciaNota(diasRestantes: number): EstadoVigenciaNota {
  const dias = Math.max(1, Math.min(DIAS_VIGENCIA_NOTAS_AUTOMATICAS, Math.trunc(diasRestantes)));

  if (dias <= 2) {
    return {
      diasRestantes: dias,
      nivel: 'critico',
      etiqueta: dias === 1 ? 'Último día' : 'Quedan 2 días',
    };
  }

  if (dias <= 5) {
    return {
      diasRestantes: dias,
      nivel: 'proximo',
      etiqueta: `Quedan ${dias} días`,
    };
  }

  return {
    diasRestantes: dias,
    nivel: 'normal',
    etiqueta: `Quedan ${dias} días`,
  };
}
