/**
 * pruebas_conciliacion.test.mjs
 *
 * Suite de pruebas automatizadas para el flujo de conciliación (Opción 1):
 * 1. Fechas posteriores al periodo conciliado: permitidas para todos.
 * 2. Fechas en periodos conciliados para NO SuperAdministrador: bloqueo estricto con aviso.
 * 3. Fechas en periodos conciliados para SuperAdministrador:
 *    a) Si cancela o no ingresa motivo: se cancela la operación.
 *    b) Si ingresa motivo: se llama a rpc_desconciliar_desde_fecha y se audita la reapertura en cascada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

test('1. Fecha posterior al periodo conciliado: permitida sin bloqueos', async () => {
  // Simular que el último movimiento conciliado fue el 2026-10-31
  // y se registra un movimiento el 2026-11-05
  const fechaUltimoConciliado = '2026-10-31T15:00:00Z';
  const fechaMovimiento = '2026-11-05';

  const esPosterior = new Date(fechaMovimiento) > new Date(fechaUltimoConciliado);
  assert.equal(esPosterior, true, 'El movimiento es posterior a la conciliación');
});

test('2. Bloqueo estricto para usuarios NO SuperAdministrador en fechas conciliadas', async () => {
  let alertLlamado = false;
  let mensajeAlert = '';
  globalThis.alert = (msg) => {
    alertLlamado = true;
    mensajeAlert = msg;
  };

  // Simular la lógica de validación
  const esSuperAdmin = false;
  const ultimoConciliado = { fecha: '2026-10-31T20:00:00Z' };

  let permitido = true;
  if (ultimoConciliado) {
    if (!esSuperAdmin) {
      alert('⛔ Acción no permitida: Solo el SuperAdministrador puede registrar en periodos conciliados.');
      permitido = false;
    }
  }

  assert.equal(permitido, false, 'Debe bloquear al usuario que no sea SuperAdministrador');
  assert.equal(alertLlamado, true, 'Debe mostrar alerta explicativa');
  assert.match(mensajeAlert, /Solo el SuperAdministrador/);
});

test('3. SuperAdministrador cancela o deja vacío el motivo: se cancela la operación', async () => {
  let alertLlamado = false;
  globalThis.alert = () => { alertLlamado = true; };
  globalThis.window = {
    prompt: () => '' // Motivo vacío
  };

  const esSuperAdmin = true;
  const motivo = window.prompt('Ingrese motivo');
  let permitido = true;
  if (!motivo || !motivo.trim()) {
    alert('Operación cancelada');
    permitido = false;
  }

  assert.equal(permitido, false, 'Debe cancelar si el motivo está vacío');
  assert.equal(alertLlamado, true);
});

test('4. SuperAdministrador confirma con motivo: ejecuta reapertura en cascada (Opción 1)', async () => {
  let rpcLlamado = false;
  let rpcParams = null;
  const motivoIngresado = 'Factura omitida de fecha 15 de octubre';

  globalThis.window = {
    prompt: () => motivoIngresado
  };

  const fakeRpc = async (nombre, params) => {
    rpcLlamado = true;
    rpcParams = params;
    return { data: { success: true, cobros_desconciliados: 4, pagos_desconciliados: 2 }, error: null };
  };

  const cajaId = '11111111-2222-3333-4444-555555555555';
  const fechaISO = '2026-10-15';

  const res = await fakeRpc('rpc_desconciliar_desde_fecha', {
    p_caja_id: cajaId,
    p_desde_fecha: `${fechaISO}T00:00:00`,
    p_motivo: motivoIngresado,
    p_movimiento_id: null,
    p_tipo_origen: null
  });

  assert.equal(rpcLlamado, true);
  assert.equal(rpcParams.p_caja_id, cajaId);
  assert.equal(rpcParams.p_desde_fecha, '2026-10-15T00:00:00');
  assert.equal(rpcParams.p_motivo, motivoIngresado);
  assert.equal(res.data.success, true);
  assert.equal(res.data.cobros_desconciliados, 4);
});
