import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizarParrafoCobranza, resolverParrafoCobranza, contarCaracteresCobranza, PARRAFO_COBRANZA_PREDETERMINADO } from '../cobranzaWhatsApp.ts';

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
