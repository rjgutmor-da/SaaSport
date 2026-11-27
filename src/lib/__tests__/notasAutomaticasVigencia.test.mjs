import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DIAS_VIGENCIA_NOTAS_AUTOMATICAS,
  NOTAS_AUTOMATICAS_POR_PAGINA,
  obtenerEstadoVigenciaNota,
  obtenerFechaCorteVigenciaIso,
} from '../notasAutomaticasVigencia.ts';

test('constantes de vigencia y paginación tienen los valores acordados', () => {
  assert.equal(DIAS_VIGENCIA_NOTAS_AUTOMATICAS, 25);
  assert.equal(NOTAS_AUTOMATICAS_POR_PAGINA, 30);
});

test('obtenerFechaCorteVigenciaIso resta exactamente 25 días en UTC', () => {
  const base = Date.UTC(2026, 10, 27, 12, 0, 0);
  const corte = obtenerFechaCorteVigenciaIso(base);
  assert.equal(corte, '2026-11-02T12:00:00.000Z');
});

test('obtenerEstadoVigenciaNota clasifica los umbrales crítico, próximo y normal', () => {
  assert.deepEqual(obtenerEstadoVigenciaNota(0), {
    diasRestantes: 1,
    nivel: 'critico',
    etiqueta: 'Último día',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(1), {
    diasRestantes: 1,
    nivel: 'critico',
    etiqueta: 'Último día',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(2), {
    diasRestantes: 2,
    nivel: 'critico',
    etiqueta: 'Quedan 2 días',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(3), {
    diasRestantes: 3,
    nivel: 'proximo',
    etiqueta: 'Quedan 3 días',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(5), {
    diasRestantes: 5,
    nivel: 'proximo',
    etiqueta: 'Quedan 5 días',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(6), {
    diasRestantes: 6,
    nivel: 'normal',
    etiqueta: 'Quedan 6 días',
  });
  assert.deepEqual(obtenerEstadoVigenciaNota(30), {
    diasRestantes: 25,
    nivel: 'normal',
    etiqueta: 'Quedan 25 días',
  });
});
