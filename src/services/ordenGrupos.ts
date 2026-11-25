/** Elemento mínimo requerido para ordenar grupos por sucursal y nombre. */
export interface GrupoOrdenable {
  nombre: string;
  sucursal?: {
    nombre?: string | null;
  } | null;
}

const OPCIONES_ORDEN_ES: Intl.CollatorOptions = {
  sensitivity: 'base',
  numeric: true,
};

/**
 * Ordena una lista de grupos primero por nombre de sucursal y luego por nombre del grupo.
 * Los grupos sin sucursal asignada se ubican al final de la lista.
 */
export function ordenarGruposPorSucursalYNombre<T extends GrupoOrdenable>(
  grupos: readonly T[]
): T[] {
  return [...grupos].sort((a, b) => {
    const sucursalA = a.sucursal?.nombre?.trim() || '';
    const sucursalB = b.sucursal?.nombre?.trim() || '';

    // Mantener al final los grupos sin sucursal asignada
    if (sucursalA && !sucursalB) return -1;
    if (!sucursalA && sucursalB) return 1;

    if (sucursalA !== sucursalB) {
      const compSucursal = sucursalA.localeCompare(sucursalB, 'es', OPCIONES_ORDEN_ES);
      if (compSucursal !== 0) return compSucursal;
    }

    const nombreA = (a.nombre || '').trim();
    const nombreB = (b.nombre || '').trim();

    const compNombre = nombreA.localeCompare(nombreB, 'es', OPCIONES_ORDEN_ES);
    if (compNombre !== 0) return compNombre;

    return (a.nombre || '').localeCompare(b.nombre || '', 'es');
  });
}
