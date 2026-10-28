import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = stripTypeScriptTypes(readFileSync(new URL('./index.ts', import.meta.url), 'utf8').replace(/^import .*;\r?\n/, ''));
const actorId = '11111111-1111-4111-8111-111111111111';
const targetId = '22222222-2222-4222-8222-222222222222';

async function run({ relation, queryError = false, foreignSchool = false, authError = false, deletionError = false } = {}) {
  let handler;
  let deleted = false;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: actorId } }, error: authError }),
      admin: { deleteUser: async () => { deleted = true; return { error: deletionError }; } },
    },
    from(table) {
      let column;
      let userId;
      return {
        select(value) { column = value; return this; },
        eq(key, value) { userId = value; return this; },
        async maybeSingle() {
          return { data: { id: userId, escuela_id: foreignSchool && userId === targetId ? 'other' : 'school', rol: userId === actorId ? 'SuperAdministrador' : 'Entrenador', activo: true } };
        },
        async limit(value) {
          assert.equal(value, 1);
          assert.notEqual(column, 'id', 'history checks must not assume a generic primary key');
          return { data: table === relation ? [{ [column]: targetId }] : [], error: queryError ? { code: 'test_error' } : null };
        },
      };
    },
  };
  vm.runInNewContext(source, { createClient: () => client, Deno: { env: { get: () => 'configured' }, serve: fn => { handler = fn; } }, Request, Response, console: { error() {} } });
  const response = await handler(new Request('https://test/delete-user', { method: 'POST', headers: { Authorization: 'Bearer test' }, body: JSON.stringify({ userId: targetId }) }));
  return { status: response.status, body: await response.json(), deleted };
}

test('allows an authorized deletion with no history', async () => {
  const result = await run();
  assert.equal(result.status, 200);
  assert.equal(result.deleted, true);
});
for (const relation of ['alumnos_entrenadores', 'entrenadores_grupos', 'asistencias_normales']) {
  test(`preserves history in ${relation}`, async () => {
    const result = await run({ relation });
    assert.equal(result.status, 409);
    assert.equal(result.deleted, false);
    assert.ok(result.body.blockingRelations.length);
    assert.ok(result.body.error.includes(result.body.blockingRelations[0]));
  });
}
for (const [name, options, status] of [
  ['query failure', { queryError: true }, 500],
  ['different school', { foreignSchool: true }, 403],
  ['invalid session', { authError: true }, 401],
]) {
  test(`does not delete on ${name}`, async () => {
    const result = await run(options);
    assert.equal(result.status, status);
    assert.equal(result.deleted, false);
  });
}
test('reports an Auth refusal without claiming success', async () => {
  const result = await run({ deletionError: { code: 'unexpected_failure', status: 500 } });
  assert.equal(result.status, 409);
  assert.ok(result.body.error.includes('archivos'));
});
