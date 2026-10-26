export interface ItemResumen {
  nombre: string;
  monto: number;
  porcentaje: number;
}

interface FilaResumen {
  tipo: string;
  nombre: string;
  monto: number | string | null;
}

/** El arrastre afecta al balance, pero no a la distribucion del periodo. */
export function separarResumenFinanciero(filas: FilaResumen[]) {
  const ingresos: ItemResumen[] = [];
  const egresos: ItemResumen[] = [];
  let saldoPeriodoAnterior = 0;

  for (const fila of filas) {
    const monto = Number(fila.monto || 0);
    if (fila.nombre === 'Saldo periodo anterior') {
      saldoPeriodoAnterior += fila.tipo === 'egreso' ? -monto : monto;
    } else if (fila.tipo === 'ingreso' || fila.tipo === 'egreso') {
      const destino = fila.tipo === 'ingreso' ? ingresos : egresos;
      destino.push({ nombre: fila.nombre, monto, porcentaje: 0 });
    }
  }

  const totalIngresos = ingresos.reduce((sum, item) => sum + item.monto, 0);
  const totalEgresos = egresos.reduce((sum, item) => sum + item.monto, 0);
  for (const item of ingresos) item.porcentaje = totalIngresos > 0 ? item.monto / totalIngresos * 100 : 0;
  for (const item of egresos) item.porcentaje = totalEgresos > 0 ? item.monto / totalEgresos * 100 : 0;

  return { ingresos, egresos, totalIngresos, totalEgresos, saldoPeriodoAnterior };
}
