import test from 'node:test';
import assert from 'node:assert/strict';
import { separarResumenFinanciero } from '../resumenFinancieroUtils.ts';

test('separa el arrastre sin perder el ingreso real llamado Saldo Inicial', () => {
  const resumen = separarResumenFinanciero([
    { tipo: 'ingreso', nombre: 'Saldo periodo anterior', monto: '26728.83' },
    { tipo: 'ingreso', nombre: 'Saldo Inicial', monto: '800' },
    { tipo: 'ingreso', nombre: 'Mensualidad', monto: '2400' },
    { tipo: 'egreso', nombre: 'Servicios', monto: '400' },
  ]);
  assert.equal(resumen.saldoPeriodoAnterior, 26728.83);
  assert.equal(resumen.totalIngresos, 3200);
  assert.equal(resumen.totalEgresos, 400);
  assert.deepEqual(resumen.ingresos.map(item => [item.nombre, item.porcentaje]), [['Saldo Inicial', 25], ['Mensualidad', 75]]);
  assert.equal(resumen.egresos[0].porcentaje, 100);
  assert.equal(resumen.saldoPeriodoAnterior + resumen.totalIngresos - resumen.totalEgresos, 29528.83);
});

test('conserva el signo de un saldo previo negativo sin inflar los egresos', () => {
  const resumen = separarResumenFinanciero([
    { tipo: 'egreso', nombre: 'Saldo periodo anterior', monto: '150' },
    { tipo: 'egreso', nombre: 'Servicios', monto: '50' },
  ]);
  assert.equal(resumen.saldoPeriodoAnterior, -150);
  assert.equal(resumen.totalEgresos, 50);
  assert.equal(resumen.egresos[0].porcentaje, 100);
});

test('un periodo sin movimientos puede conservar un saldo anterior', () => {
  const resumen = separarResumenFinanciero([{ tipo: 'ingreso', nombre: 'Saldo periodo anterior', monto: '800' }]);
  assert.deepEqual(resumen.ingresos, []);
  assert.deepEqual(resumen.egresos, []);
  assert.equal(resumen.totalIngresos, 0);
  assert.equal(resumen.saldoPeriodoAnterior, 800);
});

test('sin datos devuelve ceros y porcentajes finitos con montos nulos', () => {
  assert.equal(separarResumenFinanciero([]).saldoPeriodoAnterior, 0);
  const resumen = separarResumenFinanciero([{ tipo: 'ingreso', nombre: 'Otros', monto: null }]);
  assert.equal(resumen.ingresos[0].porcentaje, 0);
});
