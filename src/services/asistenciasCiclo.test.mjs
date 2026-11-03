import test from 'node:test';
import assert from 'node:assert/strict';
import { contarAsistenciasCicloAnterior, obtenerCicloAnterior } from './asistenciasCiclo.ts';

const nota = (id = 'n1', inicio = '2026-09-14', fin = '2026-10-13', alumno = 'a1') => ({
  id, alumnos: { id: alumno }, ciclo_inicio: inicio, ciclo_fin: fin,
});

/** Simula el cliente de Supabase; `limiteServidor` imita el máximo de filas por respuesta. */
function clientePrueba(filas = {}, { fallo = false, limiteServidor = Infinity } = {}) {
  const metricas = { activas: 0, maximo: 0, consultas: 0 };
  const cliente = {
    from(tabla) {
      const filtros = [];
      let conteo = false;
      let desde = 0;
      let hasta = Infinity;
      return {
        select(columnas, opciones) {
          assert.equal(columnas, 'alumno_id, fecha');
          conteo = opciones?.count === 'exact';
          return this;
        },
        in(campo, valores) { filtros.push(fila => valores.includes(fila[campo])); return this; },
        eq(campo, valor) { filtros.push(fila => fila[campo] === valor); return this; },
        gte(campo, valor) { filtros.push(fila => fila[campo] >= valor); return this; },
        lte(campo, valor) { filtros.push(fila => fila[campo] <= valor); return this; },
        order() { return this; },
        range(inicio, fin) { desde = inicio; hasta = fin; return this; },
        async abortSignal(signal) {
          metricas.consultas++;
          metricas.activas++;
          metricas.maximo = Math.max(metricas.maximo, metricas.activas);
          try {
            await new Promise(resolve => setTimeout(resolve, 5));
            signal.throwIfAborted();
            if (fallo && tabla === 'asistencias_arqueros') return { error: new Error('Sin acceso'), data: null, count: null };
            const coincidentes = (filas[tabla] || []).filter(fila => filtros.every(f => f(fila)))
              .sort((a, b) => a.alumno_id.localeCompare(b.alumno_id) || a.fecha.localeCompare(b.fecha));
            const pagina = coincidentes.slice(desde, Math.min(hasta + 1, desde + limiteServidor));
            return { error: null, data: pagina.map(({ alumno_id, fecha }) => ({ alumno_id, fecha })),
              count: conteo ? coincidentes.length : null };
          } finally {
            metricas.activas--;
          }
        },
      };
    },
  };
  return { cliente, metricas };
}

const fila = (fecha, estado = 'Presente', alumno_id = 'a1') => ({ fecha, estado, alumno_id });

test('cuenta el ciclo anterior en ambas tablas; excluye el facturado, otros alumnos y estados', async () => {
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
  const { cliente } = clientePrueba({ asistencias_normales: [fila('2026-08-20')] }, { fallo: true });
  assert.deepEqual(await contarAsistenciasCicloAnterior(cliente, [nota()], new AbortController().signal), { n1: 'error' });
});

test('agrupa cientos de notas en pocas consultas y respeta el límite de concurrencia', async () => {
  const { cliente, metricas } = clientePrueba({
    asistencias_normales: [fila('2026-10-10', 'Presente', 'a7'), fila('2026-10-11', 'Presente', 'a7')],
  });
  const notas = Array.from({ length: 450 }, (_, i) => nota(`n${i}`, '2026-11-03', '2026-12-02', `a${i}`));
  const resultado = await contarAsistenciasCicloAnterior(cliente, notas, new AbortController().signal);
  assert.equal(Object.keys(resultado).length, 450);
  assert.equal(resultado.n7, 2);
  assert.equal(resultado.n8, 0);
  // 450 alumnos / 80 por lote = 6 lotes × 2 tablas = 12 consultas (antes eran 900).
  assert.equal(metricas.consultas, 12);
  assert.ok(metricas.maximo <= 6);
});

test('pagina correctamente aunque el servidor devuelva menos filas que las solicitadas', async () => {
  const fechas = Array.from({ length: 25 }, (_, i) => `2026-10-${String(i + 3).padStart(2, '0')}`);
  const { cliente } = clientePrueba({
    asistencias_normales: [...fechas.map(f => fila(f)), ...fechas.map(f => fila(f, 'Presente', 'a2'))],
  }, { limiteServidor: 7 });
  const resultado = await contarAsistenciasCicloAnterior(cliente,
    [nota('n1', '2026-11-03', '2026-12-02'), nota('n2', '2026-11-03', '2026-12-02', 'a2')],
    new AbortController().signal);
  assert.deepEqual(resultado, { n1: 25, n2: 25 });
});

test('descarta la carga cancelada', async () => {
  const { cliente } = clientePrueba();
  const anterior = new AbortController();
  const carga = contarAsistenciasCicloAnterior(cliente, [nota()], anterior.signal);
  anterior.abort();
  await assert.rejects(carga, { name: 'AbortError' });
});
