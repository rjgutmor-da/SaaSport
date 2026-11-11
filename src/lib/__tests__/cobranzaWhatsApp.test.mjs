import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParrafoCobranza, resolverParrafoCobranza, contarCaracteresCobranza, PARRAFO_COBRANZA_PREDETERMINADO, puedeConfigurarCobranza, resolverSaludoCobranza } from '../cobranzaWhatsApp.ts';

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
