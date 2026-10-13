import test from 'node:test';
import assert from 'node:assert/strict';
import { contarAsistenciasCiclos } from './asistenciasCiclo.ts';

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

test('cuenta ambos extremos y ambas tablas; excluye otros alumnos, fechas y estados', async () => {
  const fila = (fecha, estado = 'Presente', alumno_id = 'a1') => ({ fecha, estado, alumno_id });
  const { cliente } = clientePrueba({
    asistencias_normales: [fila('2026-09-14'), fila('2026-10-13'), fila('2026-09-13'),
      fila('2026-10-14'), fila('2026-09-20', 'Licencia'), fila('2026-09-21', 'Ausente'),
      fila('2026-09-22', 'Presente', 'otro')],
    asistencias_arqueros: [fila('2026-09-14')],
  });
  assert.deepEqual(await contarAsistenciasCiclos(cliente,
    [nota(), nota('n2', '2026-10-14', '2026-11-13'), nota('n3', '2026-12-01', '2026-12-31')],
    new AbortController().signal), { n1: 3, n2: 1, n3: 0 });
});

test('ciclos incompletos o inválidos y alumno ausente no generan consultas', async () => {
  const { cliente, metricas } = clientePrueba();
  const notas = [nota('n1', null), nota('n2', '2026-02-30'),
    nota('n3', '2026-11-01'), { ...nota('n4'), alumnos: null }];
  assert.deepEqual(await contarAsistenciasCiclos(cliente, notas, new AbortController().signal),
    { n1: null, n2: null, n3: null, n4: null });
  assert.equal(metricas.consultas, 0);
});

test('un error en una tabla no se presenta como cero ni como conteo parcial', async () => {
  const { cliente } = clientePrueba({}, true);
  assert.deepEqual(await contarAsistenciasCiclos(cliente, [nota()], new AbortController().signal), { n1: 'error' });
});

test('limita a veinte solicitudes incluso con cargas solapadas y descarta la carga cancelada', async () => {
  const { cliente, metricas } = clientePrueba();
  const anterior = new AbortController();
  const notas = Array.from({ length: 45 }, (_, i) => nota(`n${i}`));
  const cargaAnterior = contarAsistenciasCiclos(cliente, notas, anterior.signal);
  const rechazo = assert.rejects(cargaAnterior, { name: 'AbortError' });
  anterior.abort();
  const resultado = await contarAsistenciasCiclos(cliente, notas, new AbortController().signal);
  await rechazo;
  assert.equal(Object.keys(resultado).length, 45);
  assert.ok(Object.values(resultado).every(valor => valor === 0));
  assert.equal(metricas.maximo, 20);
});
