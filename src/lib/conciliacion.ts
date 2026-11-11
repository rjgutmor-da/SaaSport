import { supabase } from './supabaseClient';
import { logActivity } from './auditLogger';
import { formatFecha } from './dateUtils';

type MovimientoConciliado = {
  tabla: 'cobros_aplicados' | 'pagos_aplicados';
  fecha: string;
};

/**
 * Obtiene el último movimiento conciliado detectado en la caja a partir de una fecha base.
 */
export const obtenerUltimoMovimientoConciliado = async (
  cajaId: string,
  fechaISO: string
): Promise<MovimientoConciliado | null> => {
  if (!cajaId) return null;
  const fechaSolo = fechaISO.includes('T') ? fechaISO.split('T')[0] : fechaISO.split(' ')[0];
  const desde = `${fechaSolo}T00:00:00`;

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

export interface ConfirmarPeriodoConciliadoParams {
  cajaId: string;
  cajaNombre?: string;
  fechaISO: string;
  tipoMovimiento: string;
  esSuperAdmin?: boolean;
  escuelaId?: string | null;
  usuarioId?: string | null;
  usuarioNombre?: string | null;
}

/**
 * Valida si un movimiento a registrar/editar cae dentro de un periodo ya conciliado.
 * Reglas de negocio (Opción 1):
 * - Solo el SuperAdministrador puede registrar o mover pagos a fechas ya conciliadas.
 * - Los demás roles son bloqueados con mensaje explicativo.
 * - Si el SuperAdministrador confirma con motivo obligatorio, se desconcilian en cascada
 *   automáticamente todos los movimientos de esa caja desde esa fecha hacia adelante.
 */
export const confirmarMovimientoEnPeriodoConciliado = async ({
  cajaId,
  cajaNombre,
  fechaISO,
  tipoMovimiento,
  esSuperAdmin,
  escuelaId,
  usuarioId,
  usuarioNombre
}: ConfirmarPeriodoConciliadoParams): Promise<boolean> => {
  if (!cajaId) return true;

  const fechaSolo = fechaISO.includes('T') ? fechaISO.split('T')[0] : fechaISO.split(' ')[0];
  const conciliado = await obtenerUltimoMovimientoConciliado(cajaId, fechaSolo);
  if (!conciliado) return true;

  // Determinar si es SuperAdministrador si no vino explícito
  let superAdminEfectivo = esSuperAdmin;
  if (superAdminEfectivo === undefined) {
    if (usuarioId) {
      const { data: u } = await supabase.from('usuarios').select('rol').eq('id', usuarioId).maybeSingle();
      superAdminEfectivo = u?.rol === 'SuperAdministrador';
    } else {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: u } = await supabase.from('usuarios').select('rol').eq('id', user.id).maybeSingle();
        superAdminEfectivo = u?.rol === 'SuperAdministrador';
      }
    }
  }

  // Resolver nombre de la caja si no se proporcionó
  let nombreCuenta = cajaNombre;
  if (!nombreCuenta) {
    const { data: c } = await supabase.from('cajas_bancos').select('nombre').eq('id', cajaId).maybeSingle();
    nombreCuenta = c?.nombre || 'la cuenta seleccionada';
  }

  const fechaCorte = formatFecha(conciliado.fecha);
  const fechaMov = formatFecha(fechaSolo);

  // 1. Si NO es SuperAdministrador, se bloquea la acción
  if (!superAdminEfectivo) {
    alert(
      `⛔ Acción no permitida\n\n` +
      `La cuenta "${nombreCuenta}" se encuentra conciliada hasta el ${fechaCorte}.\n\n` +
      `Solo el SuperAdministrador tiene autorización para registrar o modificar pagos y cobros en fechas ya conciliadas.`
    );
    return false;
  }

  // 2. Si ES SuperAdministrador, solicitar confirmación y motivo obligatorio (Opción 1: reapertura en cascada)
  const mensaje =
    `⚠️ ATENCIÓN: Periodo ya conciliado\n\n` +
    `Estás registrando ${tipoMovimiento} con fecha ${fechaMov} en la cuenta "${nombreCuenta}", la cual ya está conciliada hasta el ${fechaCorte}.\n\n` +
    `Al registrar este movimiento anterior (Opción 1):\n` +
    `• Se mantendrán conciliados los movimientos anteriores al ${fechaMov}.\n` +
    `• Se reabrirán y desconciliarán automáticamente los movimientos posteriores desde el ${fechaMov} en adelante en esta cuenta para que sus saldos y registros vuelvan a ser auditados.\n\n` +
    `Ingresa el MOTIVO OBLIGATORIO para continuar con este registro retroactivo:`;

  const motivo = window.prompt(mensaje);
  if (!motivo || !motivo.trim()) {
    alert('Operación cancelada: Se requiere un motivo obligatorio para registrar movimientos en periodos ya conciliados.');
    return false;
  }

  const desdeTimestamp = `${fechaSolo}T00:00:00`;
  const { data: resRpc, error: errRpc } = await supabase.rpc('rpc_desconciliar_desde_fecha', {
    p_caja_id: cajaId,
    p_desde_fecha: desdeTimestamp,
    p_motivo: motivo.trim(),
    p_movimiento_id: null,
    p_tipo_origen: null
  });

  if (errRpc) {
    alert('Error al reabrir el periodo conciliado: ' + errRpc.message);
    return false;
  }

  if (escuelaId && usuarioId) {
    logActivity({
      escuela_id: escuelaId,
      usuario_id: usuarioId,
      usuario_nombre: usuarioNombre || 'SuperAdministrador',
      accion: 'reapertura_periodo_conciliado',
      modulo: 'cajas_bancos',
      entidad_id: cajaId,
      detalle: {
        caja_id: cajaId,
        caja_nombre: nombreCuenta,
        fecha_movimiento: fechaSolo,
        tipo_movimiento: tipoMovimiento,
        ultimo_conciliado_fecha: conciliado.fecha,
        motivo: motivo.trim(),
        cobros_desconciliados: resRpc?.cobros_desconciliados || 0,
        pagos_desconciliados: resRpc?.pagos_desconciliados || 0
      }
    });
  }

  return true;
};
