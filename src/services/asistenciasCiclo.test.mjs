import test from 'node:test';
import assert from 'node:assert/strict';
import { contarAsistenciasCicloAnterior, obtenerCicloAnterior } from './asistenciasCiclo.ts';

const nota = (id = 'n1', inicio = '2026-09-14', fin = '2026-10-13') => ({
  id, alumnos: { id: 'a1' }, ciclo_inicio: inicio, ciclo_fin: fin,
});

function clientePrueba(filas = {}, fallo = false) {
  const metricas = { activas: 0, maximo: 0, consultas: 0 };
  const cliente = {
    from(tabla) {
      const filtros = [];
      return {
        select(columna, opciones) {
          assert.equal(columna, 'id');
          assert.deepEqual(opciones, { count: 'exact', head: true });
          return this;
        },
        eq(campo, valor) { filtros.push(fila => fila[campo] === valor); return this; },
        gte(campo, valor) { filtros.push(fila => fila[campo] >= valor); return this; },
        lte(campo, valor) { filtros.push(fila => fila[campo] <= valor); return this; },
        async abortSignal(signal) {
          metricas.consultas++;
          metricas.activas++;
          metricas.maximo = Math.max(metricas.maximo, metricas.activas);
          try {
            await new Promise(resolve => setTimeout(resolve, 5));
            signal.throwIfAborted();
            return fallo && tabla === 'asistencias_arqueros'
              ? { error: new Error('Sin acceso'), count: null }
              : { error: null, count: (filas[tabla] || []).filter(fila => filtros.every(f => f(fila))).length };
          } finally {
            metricas.activas--;
          }
        },
      };
    },
  };
  return { cliente, metricas };
}

test('cuenta el ciclo anterior en ambas tablas; excluye el facturado, otros alumnos y estados', async () => {
  const fila = (fecha, estado = 'Presente', alumno_id = 'a1') => ({ fecha, estado, alumno_id });
  const { cliente } = clientePrueba({
    asistencias_normales: [fila('2026-10-03'), fila('2026-11-02'), fila('2026-10-02'),
      fila('2026-11-03'), fila('2026-12-02'), fila('2026-10-20', 'Licencia'),
      fila('2026-10-21', 'Ausente'), fila('2026-10-22', 'Presente', 'otro')],
    asistencias_arqueros: [fila('2026-10-03')],
  });
  assert.deepEqual(await contarAsistenciasCicloAnterior(cliente,
    [nota('n1', '2026-11-03', '2026-12-02'), nota('n2', '2026-12-03', '2027-01-02'), nota('n3')],
    new AbortController().signal), { n1: 3, n2: 2, n3: 0 });
});

test('calcula el mes previo sin desbordar febrero ni desplazar fechas por zona horaria', () => {
  for (const [inicio, fin, esperado] of [
    ['2026-11-03', '2026-12-02', { inicio: '2026-10-03', fin: '2026-11-02' }],
    ['2026-11-01', '2026-11-30', { inicio: '2026-10-01', fin: '2026-10-31' }],
    ['2026-01-03', '2026-02-02', { inicio: '2025-12-03', fin: '2026-01-02' }],
    ['2026-03-31', '2026-04-29', { inicio: '2026-02-28', fin: '2026-03-30' }],
    ['2024-03-31', '2024-04-29', { inicio: '2024-02-29', fin: '2024-03-30' }],
    ['2024-03-01', '2024-03-31', { inicio: '2024-02-01', fin: '2024-02-29' }],
  ]) {
    assert.deepEqual(obtenerCicloAnterior(nota('n1', inicio, fin)), esperado);
  }
});

test('ciclos incompletos o inválidos y alumno ausente no generan consultas', async () => {
  const { cliente, metricas } = clientePrueba();
  const notas = [nota('n1', null), nota('n2', '2026-02-30'),
    nota('n3', '2026-11-01'), { ...nota('n4'), alumnos: null }];
  assert.deepEqual(await contarAsistenciasCicloAnterior(cliente, notas, new AbortController().signal),
    { n1: null, n2: null, n3: null, n4: null });
  assert.equal(metricas.consultas, 0);
});

test('un error en una tabla no se presenta como cero ni como conteo parcial', async () => {
  const { cliente } = clientePrueba({}, true);
  assert.deepEqual(await contarAsistenciasCicloAnterior(cliente, [nota()], new AbortController().signal), { n1: 'error' });
});

test('limita a veinte solicitudes incluso con cargas solapadas y descarta la carga cancelada', async () => {
  const { cliente, metricas } = clientePrueba();
  const anterior = new AbortController();
  const notas = Array.from({ length: 45 }, (_, i) => nota(`n${i}`));
  const cargaAnterior = contarAsistenciasCicloAnterior(cliente, notas, anterior.signal);
  const rechazo = assert.rejects(cargaAnterior, { name: 'AbortError' });
  anterior.abort();
  const resultado = await contarAsistenciasCicloAnterior(cliente, notas, new AbortController().signal);
  await rechazo;
  assert.equal(Object.keys(resultado).length, 45);
  assert.ok(Object.values(resultado).every(valor => valor === 0));
  assert.equal(metricas.maximo, 20);
});
