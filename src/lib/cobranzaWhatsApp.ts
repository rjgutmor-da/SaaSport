export const MAX_CARACTERES_COBRANZA = 600;
export const puedeConfigurarCobranza = (perfil: { rol: string; sucursal_id: string | null; activo: boolean } | null): boolean =>
  !!perfil?.activo && (perfil.rol === 'SuperAdministrador' || (perfil.rol === 'Administrador' && perfil.sucursal_id === null));
export const PARRAFO_COBRANZA_PREDETERMINADO = 'Si ya realizó alguno de estos pagos, por favor envíenos el comprobante por este medio para actualizar su estado. Muchas gracias. 🩶';

export const contarCaracteresCobranza = (texto: string): number => Array.from(texto).length;

export const normalizarParrafoCobranza = (texto: string): string | null => {
  if (contarCaracteresCobranza(texto) > MAX_CARACTERES_COBRANZA) {
    throw new Error('El párrafo final no puede superar los 600 caracteres.');
  }
  return texto.trim() || null;
};

export const resolverParrafoCobranza = (texto?: string | null): string =>
  texto?.trim() || PARRAFO_COBRANZA_PREDETERMINADO;

export const resolverSaludoCobranza = (nombre: string | null, parentesco: 'padre' | 'madre'): string => {
  const nombreLimpio = nombre?.trim();
  const sinNombre = !nombreLimpio || /^por\s+definir$/i.test(nombreLimpio);
  if (sinNombre) return parentesco === 'padre' ? 'Estimado Papá' : 'Estimada Mamá';
  return `${parentesco === 'padre' ? 'Estimado Señor' : 'Estimada Señora'} ${nombreLimpio}`;
};

export interface CuentaCobranzaOrdenable {
  id?: string;
  fecha_emision?: string | null;
  created_at?: string | null;
  ciclo_inicio?: string | null;
  periodo_estadistico?: string | null;
  periodo?: string | null;
}

export interface DetalleItemCobranzaOrdenable {
  ciclo_inicio?: string | null;
  periodo_estadistico?: string | null;
}

/**
 * Normaliza un campo de fecha o periodo a formato comparable 'YYYY-MM-DD'.
 */
export const normalizarFechaOrdenCobranza = (fecha: string | null | undefined): string | null => {
  if (!fecha) return null;
  const f = fecha.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0, 10);
  if (/^\d{4}-\d{2}$/.test(f)) return `${f}-01`;
  return null;
};

/**
 * Obtiene la fecha de referencia para determinar la antigüedad de una deuda.
 * Prioriza la fecha del ciclo (detalle o cuenta), periodo estadístico,
 * fecha de emisión y fecha de creación.
 */
export const obtenerFechaReferenciaDeuda = (
  cxc: CuentaCobranzaOrdenable,
  detallesPorCuenta?: Record<string, DetalleItemCobranzaOrdenable[]>,
): string => {
  const detalles = cxc.id && detallesPorCuenta ? detallesPorCuenta[cxc.id] || [] : [];

  // 1. Ciclo de inicio en los ítems de detalle
  const ciclos = detalles
    .map(d => normalizarFechaOrdenCobranza(d.ciclo_inicio))
    .filter((c): c is string => Boolean(c))
    .sort();
  if (ciclos.length > 0) return ciclos[0];

  // 2. Ciclo de inicio en la cuenta por cobrar
  const cicloCxc = normalizarFechaOrdenCobranza(cxc.ciclo_inicio);
  if (cicloCxc) return cicloCxc;

  // 3. Periodo estadístico en detalle o cuenta
  const periodosEstadisticos = detalles
    .map(d => normalizarFechaOrdenCobranza(d.periodo_estadistico))
    .filter((p): p is string => Boolean(p))
    .sort();
  if (periodosEstadisticos.length > 0) return periodosEstadisticos[0];

  const periodoCxc = normalizarFechaOrdenCobranza(cxc.periodo_estadistico) || normalizarFechaOrdenCobranza(cxc.periodo);
  if (periodoCxc) return periodoCxc;

  // 4. Fecha de emisión
  const emision = normalizarFechaOrdenCobranza(cxc.fecha_emision);
  if (emision) return emision;

  // 5. Fecha de creación
  const creacion = normalizarFechaOrdenCobranza(cxc.created_at);
  if (creacion) return creacion;

  return '';
};

/**
 * Ordena las deudas de cobranza de la más antigua arriba a la más reciente abajo
 * (orden cronológico ascendente).
 */
export const ordenarDeudasCobranza = <T extends CuentaCobranzaOrdenable>(
  deudas: T[],
  detallesPorCuenta?: Record<string, DetalleItemCobranzaOrdenable[]>,
): T[] => {
  return [...deudas].sort((a, b) => {
    const refA = obtenerFechaReferenciaDeuda(a, detallesPorCuenta);
    const refB = obtenerFechaReferenciaDeuda(b, detallesPorCuenta);
    if (refA !== refB) return refA.localeCompare(refB);

    const emisionA = a.fecha_emision || a.created_at || '';
    const emisionB = b.fecha_emision || b.created_at || '';
    if (emisionA !== emisionB) return emisionA.localeCompare(emisionB);

    const creacionA = a.created_at || '';
    const creacionB = b.created_at || '';
    if (creacionA !== creacionB) return creacionA.localeCompare(creacionB);

    return (a.id || '').localeCompare(b.id || '');
  });
};
