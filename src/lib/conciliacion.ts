import { supabase } from './supabaseClient';
import { logActivity } from './auditLogger';
import { formatFecha } from './dateUtils';

type MovimientoConciliado = {
  tabla: 'cobros_aplicados' | 'pagos_aplicados';
  fecha: string;
};

const obtenerUltimoMovimientoConciliado = async (cajaId: string, fechaISO: string): Promise<MovimientoConciliado | null> => {
  const desde = `${fechaISO}T00:00:00`;

  const [cobros, pagos] = await Promise.all([
    supabase
      .from('cobros_aplicados')
      .select('fecha')
      .eq('caja_id', cajaId)
      .eq('conciliado', true)
      .gte('fecha', desde)
      .order('fecha', { ascending: false })
      .limit(1),
    supabase
      .from('pagos_aplicados')
      .select('fecha')
      .eq('caja_id', cajaId)
      .eq('conciliado', true)
      .gte('fecha', desde)
      .order('fecha', { ascending: false })
      .limit(1)
  ]);

  if (cobros.error) throw cobros.error;
  if (pagos.error) throw pagos.error;

  const candidatos: MovimientoConciliado[] = [
    ...((cobros.data ?? []).map((m: any) => ({ tabla: 'cobros_aplicados' as const, fecha: m.fecha }))),
    ...((pagos.data ?? []).map((m: any) => ({ tabla: 'pagos_aplicados' as const, fecha: m.fecha })))
  ];

  return candidatos.sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())[0] ?? null;
};

export const confirmarMovimientoEnPeriodoConciliado = async ({
  cajaId,
  cajaNombre,
  fechaISO,
  tipoMovimiento,
  escuelaId,
  usuarioId,
  usuarioNombre
}: {
  cajaId: string;
  cajaNombre: string;
  fechaISO: string;
  tipoMovimiento: string;
  escuelaId?: string | null;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
}): Promise<boolean> => {
  const conciliado = await obtenerUltimoMovimientoConciliado(cajaId, fechaISO);
  if (!conciliado) return true;

  const continuar = window.confirm(
    `Estas registrando ${tipoMovimiento} con fecha ${formatFecha(fechaISO)} dentro de un periodo ya conciliado de ${cajaNombre}.\n\n` +
    `Ultimo movimiento conciliado detectado: ${formatFecha(conciliado.fecha)}.\n\n` +
    'El movimiento se guardara como NO conciliado y puede cambiar saldos historicos verificados. Deseas continuar?'
  );

  if (continuar && escuelaId && usuarioId) {
    logActivity({
      escuela_id: escuelaId,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre || 'Usuario',
      accion: 'movimiento_en_periodo_conciliado',
      modulo: 'cajas_bancos',
      entidad_id: cajaId,
      detalle: {
        caja_id: cajaId,
        caja_nombre: cajaNombre,
        fecha_movimiento: fechaISO,
        tipo_movimiento: tipoMovimiento,
        ultimo_conciliado_fecha: conciliado.fecha,
        ultimo_conciliado_tabla: conciliado.tabla
      }
    });
  }

  return continuar;
};
