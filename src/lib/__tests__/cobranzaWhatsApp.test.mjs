import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizarParrafoCobranza,
  resolverParrafoCobranza,
  contarCaracteresCobranza,
  PARRAFO_COBRANZA_PREDETERMINADO,
  puedeConfigurarCobranza,
  resolverSaludoCobranza,
  ordenarDeudasCobranza,
  obtenerFechaReferenciaDeuda
} from '../cobranzaWhatsApp.ts';

test('saluda a Papá o Mamá según el contacto elegido si el nombre está ausente o por definir', () => {
  for (const nombre of [null, '', '   ', 'Por Definir', ' POR DEFINIR ', 'por   definir']) {
    assert.equal(resolverSaludoCobranza(nombre, 'padre'), 'Estimado Papá');
    assert.equal(resolverSaludoCobranza(nombre, 'madre'), 'Estimada Mamá');
  }
  assert.equal(resolverSaludoCobranza(' Víctor Hugo Pérez ', 'padre'), 'Estimado Señor Víctor Hugo Pérez');
  assert.equal(resolverSaludoCobranza('María Pérez', 'madre'), 'Estimada Señora María Pérez');
});

test('solo superadministrador y administrador activo de todas las sucursales configuran cobranza', () => {
  assert.equal(puedeConfigurarCobranza(null), false);
  for (const rol of ['SuperAdministrador', 'Administrador', 'Asistente', 'Entrenador', 'Medico']) {
    for (const sucursal_id of [null, 'sucursal-1']) {
      for (const activo of [true, false]) {
        assert.equal(puedeConfigurarCobranza({ rol, sucursal_id, activo }),
          activo && (rol === 'SuperAdministrador' || (rol === 'Administrador' && sucursal_id === null)));
      }
    }
  }
});

test('configuración ausente o vacía conserva el cierre actual', () => {
  for (const valor of [null, undefined, '', ' \n\t ']) {
    assert.equal(resolverParrafoCobranza(valor), PARRAFO_COBRANZA_PREDETERMINADO);
  }
  assert.equal(normalizarParrafoCobranza(' \n\t '), null);
});

test('conserva texto, emojis y saltos internos al preparar WhatsApp', () => {
  const texto = 'Gracias 🩶\nEquipo de cobranza';
  assert.equal(normalizarParrafoCobranza(` ${texto} `), texto);
  assert.equal(decodeURIComponent(encodeURIComponent(resolverParrafoCobranza(texto))), texto);
});

test('límite de 600 puntos Unicode consistente con PostgreSQL', () => {
  for (const caracter of ['x', '🩶']) {
    const texto = caracter.repeat(600);
    assert.equal(contarCaracteresCobranza(texto), 600);
    assert.equal(normalizarParrafoCobranza(texto), texto);
    assert.throws(() => normalizarParrafoCobranza(texto + caracter), /600/);
  }
});

test('ordena deudas de la más antigua arriba a la más reciente abajo por ciclo de mensualidad', () => {
  const deudaNov = { id: '3', ciclo_inicio: '2026-11-01', fecha_emision: '2026-11-01' };
  const deudaOct = { id: '2', ciclo_inicio: '2026-10-01', fecha_emision: '2026-10-01' };
  const deudaSep = { id: '1', ciclo_inicio: '2026-09-01', fecha_emision: '2026-09-01' };

  // Entran en orden descendente (como vienen de la base de datos: la más reciente primero)
  const resultado = ordenarDeudasCobranza([deudaNov, deudaOct, deudaSep]);
  assert.deepEqual(resultado.map(d => d.id), ['1', '2', '3']);
});

test('ordena deudas por fecha_emision cuando no existe ciclo_inicio', () => {
  const deudaTorneo = { id: 'torneo', fecha_emision: '2026-09-15' };
  const deudaUniforme = { id: 'uniforme', fecha_emision: '2026-08-10' };

  const resultado = ordenarDeudasCobranza([deudaTorneo, deudaUniforme]);
  assert.deepEqual(resultado.map(d => d.id), ['uniforme', 'torneo']);
});

test('prioriza ciclo_inicio sobre fecha_emision si una mensualidad antigua se registró posteriormente', () => {
  const mensualidadAgostoTardia = { id: 'ago', ciclo_inicio: '2026-08-01', fecha_emision: '2026-10-20' };
  const mensualidadSeptiembre = { id: 'sep', ciclo_inicio: '2026-09-01', fecha_emision: '2026-09-05' };

  const resultado = ordenarDeudasCobranza([mensualidadAgostoTardia, mensualidadSeptiembre]);
  assert.deepEqual(resultado.map(d => d.id), ['ago', 'sep']);
});

test('detecta ciclo_inicio desde detallesPorCuenta si la cabecera no lo contiene', () => {
  const deudaA = { id: 'cxc-1', fecha_emision: '2026-11-01' };
  const deudaB = { id: 'cxc-2', fecha_emision: '2026-11-01' };
  const detalles = {
    'cxc-1': [{ ciclo_inicio: '2026-10-01' }],
    'cxc-2': [{ ciclo_inicio: '2026-09-01' }],
  };

  const resultado = ordenarDeudasCobranza([deudaA, deudaB], detalles);
  assert.deepEqual(resultado.map(d => d.id), ['cxc-2', 'cxc-1']);
});
