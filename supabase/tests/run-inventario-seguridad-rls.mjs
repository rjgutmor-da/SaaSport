// ==============================================================================
// Validación de Seguridad y RLS para Inventario por Sucursal (SaaSport)
// Ejecuta en PGlite (PostgreSQL aislado) verificaciones con roles autenticados,
// aislamiento multi-escuela, aislamiento por sucursal y bloqueo de mutaciones directas.
// ==============================================================================

import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const modulePath = process.argv[2];
if (!modulePath) {
  throw new Error('Indique la ruta a @electric-sql/pglite/dist/index.js');
}

const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
const root = path.dirname(fileURLToPath(import.meta.url));

const db = new PGlite();

try {
  console.log('--- CARGANDO ESQUEMA Y MIGRACIÓN ---');
  await db.exec(await readFile(path.resolve(root, 'fixtures/inventario_base.sql'), 'utf8'));
  await db.exec(await readFile(path.resolve(root, '../migrations/20260915131645_inventario_por_sucursal.sql'), 'utf8'));
  console.log('✅ Esquema base y migración de inventario cargados.');

  console.log('--- CONFIGURANDO DATOS DE PRUEBA MULTI-TENANT ---');
  // Crear Escuela A y Escuela B
  const idEscuelaA = '11111111-1111-1111-1111-111111111111';
  const idEscuelaB = '22222222-2222-2222-2222-222222222222';
  await db.query(`
    INSERT INTO public.escuelas (id, nombre, limite_productos_inventario) VALUES
    ('${idEscuelaA}', 'Escuela Titanes A', 10),
    ('${idEscuelaB}', 'Escuela Halcones B', 10);
  `);

  // Crear Sucursales A1, A2 y B1
  const idSucursalA1 = 'aaaa1111-0000-0000-0000-000000000001';
  const idSucursalA2 = 'aaaa1111-0000-0000-0000-000000000002';
  const idSucursalB1 = 'bbbb2222-0000-0000-0000-000000000001';
  await db.query(`
    INSERT INTO public.sucursales (id, escuela_id, nombre) VALUES
    ('${idSucursalA1}', '${idEscuelaA}', 'Sucursal Central A'),
    ('${idSucursalA2}', '${idEscuelaA}', 'Sucursal Norte A'),
    ('${idSucursalB1}', '${idEscuelaB}', 'Sucursal Única B');
  `);

  // Crear Usuarios
  const idSuperA = '00000000-0000-0000-0000-000000000001';
  const idAdminA1 = '00000000-0000-0000-0000-000000000002';
  const idAsistenteA1 = '00000000-0000-0000-0000-000000000003';
  const idSuperB = '00000000-0000-0000-0000-000000000004';

  await db.exec(`
    INSERT INTO auth.users (id, aud, role, email) VALUES
    ('${idSuperA}', 'authenticated', 'authenticated', 'super_a@prueba.com'),
    ('${idAdminA1}', 'authenticated', 'authenticated', 'admin_a1@prueba.com'),
    ('${idAsistenteA1}', 'authenticated', 'authenticated', 'asistente_a1@prueba.com'),
    ('${idSuperB}', 'authenticated', 'authenticated', 'super_b@prueba.com');

    INSERT INTO public.usuarios (id, escuela_id, email, nombres, apellidos, rol, activo, sucursal_id) VALUES
    ('${idSuperA}', '${idEscuelaA}', 'super_a@prueba.com', 'Super', 'A', 'SuperAdministrador', true, '${idSucursalA1}'),
    ('${idAdminA1}', '${idEscuelaA}', 'admin_a1@prueba.com', 'Admin', 'A1', 'Administrador', true, '${idSucursalA1}'),
    ('${idAsistenteA1}', '${idEscuelaA}', 'asistente_a1@prueba.com', 'Asistente', 'A1', 'Asistente', true, '${idSucursalA1}'),
    ('${idSuperB}', '${idEscuelaB}', 'super_b@prueba.com', 'Super', 'B', 'SuperAdministrador', true, '${idSucursalB1}');
  `);

  // Obtener producto de Escuela A y de Escuela B
  const resProdA = await db.query(`SELECT id FROM public.catalogo_items WHERE escuela_id = '${idEscuelaA}' AND categoria = 'producto' LIMIT 1;`);
  const idProdA = resProdA.rows[0].id;
  const resProdB = await db.query(`SELECT id FROM public.catalogo_items WHERE escuela_id = '${idEscuelaB}' AND categoria = 'producto' LIMIT 1;`);
  const idProdB = resProdB.rows[0].id;

  // Apertura formal de Escuela A (Sucursal A1 y A2) y Escuela B (Sucursal B1)
  await db.exec(`
    INSERT INTO public.inventario_aperturas (escuela_id, sucursal_id, abierto_por) VALUES
    ('${idEscuelaA}', '${idSucursalA1}', '${idSuperA}'),
    ('${idEscuelaA}', '${idSucursalA2}', '${idSuperA}'),
    ('${idEscuelaB}', '${idSucursalB1}', '${idSuperB}');

    INSERT INTO public.inventario_saldos (escuela_id, sucursal_id, catalogo_item_id, cantidad_disponible) VALUES
    ('${idEscuelaA}', '${idSucursalA1}', '${idProdA}', 15),
    ('${idEscuelaA}', '${idSucursalA2}', '${idProdA}', 8),
    ('${idEscuelaB}', '${idSucursalB1}', '${idProdB}', 50);

    INSERT INTO public.inventario_movimientos (escuela_id, sucursal_id, catalogo_item_id, tipo, cantidad, direccion, saldo_resultante, observacion, creado_por) VALUES
    ('${idEscuelaA}', '${idSucursalA1}', '${idProdA}', 'apertura', 15, 'entrada', 15, 'Apertura A1', '${idSuperA}'),
    ('${idEscuelaA}', '${idSucursalA2}', '${idProdA}', 'apertura', 8, 'entrada', 8, 'Apertura A2', '${idSuperA}'),
    ('${idEscuelaB}', '${idSucursalB1}', '${idProdB}', 'apertura', 50, 'entrada', 50, 'Apertura B1', '${idSuperB}');
  `);

  console.log('✅ Datos base multi-tenant configurados.');

  // ============================================================================
  // TEST 1: Imposibilidad de Mutación Directa en inventario_saldos (REVOKE / Privilegios)
  // ============================================================================
  console.log('\n--- PRUEBA DE SEGURIDAD 1: Mutación directa en inventario_saldos ---');
  let errInsertSaldos = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      INSERT INTO public.inventario_saldos (escuela_id, sucursal_id, catalogo_item_id, cantidad_disponible)
      VALUES ('${idEscuelaA}', '${idSucursalA1}', '${idProdA}', 999);
    `);
  } catch (err) {
    errInsertSaldos = true;
    assert.match(err.message, /permission denied|denied/i);
  } finally {
    await db.exec('RESET ROLE;');
  }
  assert.equal(errInsertSaldos, true, 'Debe fallar con error de permiso al intentar INSERT directo');

  let errUpdateSaldos = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      UPDATE public.inventario_saldos SET cantidad_disponible = 999 WHERE escuela_id = '${idEscuelaA}';
    `);
  } catch (err) {
    errUpdateSaldos = true;
    assert.match(err.message, /permission denied|denied/i);
  } finally {
    await db.exec('RESET ROLE;');
  }
  assert.equal(errUpdateSaldos, true, 'Debe fallar con error de permiso al intentar UPDATE directo');
  console.log('PASADA: inventario_saldos es estrictamente inmune a INSERT/UPDATE directo desde sesiones autenticadas.');

  // ============================================================================
  // TEST 2: Inmutabilidad e Imposibilidad de Mutación Directa en inventario_movimientos
  // ============================================================================
  console.log('\n--- PRUEBA DE SEGURIDAD 2: Mutación directa en inventario_movimientos ---');
  let errInsertMovs = false;
  try {
    await db.exec(`
      SET ROLE authenticated;
      INSERT INTO public.inventario_movimientos (escuela_id, sucursal_id, catalogo_item_id, tipo, cantidad, direccion, saldo_resultante)
      VALUES ('${idEscuelaA}', '${idSucursalA1}', '${idProdA}', 'ajuste_entrada', 100, 'entrada', 115);
    `);
  } catch (err) {
    errInsertMovs = true;
    assert.match(err.message, /permission denied|denied/i);
  } finally {
    await db.exec('RESET ROLE;');
  }
  assert.equal(errInsertMovs, true, 'Debe fallar con error de permiso al intentar INSERT directo en movimientos');

  let errDeleteMovs = false;
  try {
    await db.exec(`
      DELETE FROM public.inventario_movimientos WHERE escuela_id = '${idEscuelaA}';
    `);
  } catch (err) {
    errDeleteMovs = true;
    assert.match(err.message, /inmutable/i);
  }
  assert.equal(errDeleteMovs, true, 'El trigger de inmutabilidad debe bloquear DELETE incluso con privilegios de tabla');
  console.log('PASADA: inventario_movimientos es estrictamente inmutable.');

  // ============================================================================
  // TEST 3: Protección del Cupo en Escuelas
  // ============================================================================
  console.log('\n--- PRUEBA DE SEGURIDAD 3: Protección y Auditoría del Cupo ---');
  let errCupoUsuario = false;
  try {
    await db.exec(`
      SET request.jwt.claim.sub = '${idSuperA}';
      UPDATE public.escuelas SET limite_productos_inventario = 50 WHERE id = '${idEscuelaA}';
    `);
  } catch (err) {
    errCupoUsuario = true;
    assert.match(err.message, /solo puede ser modificado por la administración de SaaSport/i);
  } finally {
    await db.exec("SET request.jwt.claim.sub = '';");
  }
  assert.equal(errCupoUsuario, true, 'El SuperAdmin de la escuela no puede aumentar su propio cupo');

  // Actualización administrativa externa (sin usuario escolar)
  await db.exec(`
    UPDATE public.escuelas SET limite_productos_inventario = 25 WHERE id = '${idEscuelaA}';
  `);
  const resAuditoria = await db.query(`
    SELECT limite_anterior, limite_nuevo FROM public.inventario_cambios_cupo WHERE escuela_id = '${idEscuelaA}';
  `);
  assert.equal(resAuditoria.rows.length, 1);
  assert.equal(resAuditoria.rows[0].limite_anterior, 10);
  assert.equal(resAuditoria.rows[0].limite_nuevo, 25);
  console.log('PASADA: Modificación administrativa de cupo permitida y debidamente auditada en inventario_cambios_cupo.');

  // Reducción inválida por debajo de activos
  let errReduccionInvalida = false;
  try {
    await db.exec(`
      UPDATE public.escuelas SET limite_productos_inventario = 0 WHERE id = '${idEscuelaA}';
    `);
  } catch (err) {
    errReduccionInvalida = true;
    assert.match(err.message, /menor que los productos activos/i);
  }
  assert.equal(errReduccionInvalida, true, 'No se puede reducir cupo por debajo de los productos activos');
  console.log('PASADA: Reducción de cupo bloqueada si no caben los productos activos.');

  // ============================================================================
  // TEST 4: RLS Multi-Tenant (Aislamiento entre escuelas)
  // ============================================================================
  console.log('\n--- PRUEBA DE SEGURIDAD 4: Aislamiento RLS Multi-Tenant ---');
  // Sesión SuperAdmin Escuela A
  await db.exec(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${idSuperA}';
  `);
  const saldosSuperA = await db.query(`SELECT * FROM public.inventario_saldos;`);
  assert.equal(saldosSuperA.rows.length, 2, 'SuperAdmin A debe ver solo sus 2 sucursales');
  assert.ok(saldosSuperA.rows.every(r => r.escuela_id === idEscuelaA), 'No debe haber filas de Escuela B');

  const movsSuperA = await db.query(`SELECT * FROM public.inventario_movimientos;`);
  assert.equal(movsSuperA.rows.length, 2, 'SuperAdmin A debe ver solo movimientos de su escuela');
  assert.ok(movsSuperA.rows.every(r => r.escuela_id === idEscuelaA));

  // ============================================================================
  // TEST 5: RLS por Sucursal (Administrador y Asistente)
  // ============================================================================
  console.log('\n--- PRUEBA DE SEGURIDAD 5: Aislamiento RLS por Sucursal ---');
  // Sesión Admin Sucursal A1
  await db.exec(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${idAdminA1}';
  `);
  const saldosAdminA1 = await db.query(`SELECT * FROM public.inventario_saldos;`);
  assert.equal(saldosAdminA1.rows.length, 1, 'Admin A1 solo debe ver sucursal A1');
  assert.equal(saldosAdminA1.rows[0].sucursal_id, idSucursalA1);

  const movsAdminA1 = await db.query(`SELECT * FROM public.inventario_movimientos;`);
  assert.equal(movsAdminA1.rows.length, 1, 'Admin A1 solo debe ver movimientos de sucursal A1');
  assert.equal(movsAdminA1.rows[0].sucursal_id, idSucursalA1);

  // Sesión Asistente Sucursal A1
  await db.exec(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${idAsistenteA1}';
  `);
  const saldosAsistenteA1 = await db.query(`SELECT * FROM public.inventario_saldos;`);
  assert.equal(saldosAsistenteA1.rows.length, 1, 'Asistente puede ver saldos de su sucursal');
  assert.equal(saldosAsistenteA1.rows[0].sucursal_id, idSucursalA1);

  const movsAsistenteA1 = await db.query(`SELECT * FROM public.inventario_movimientos;`);
  assert.equal(movsAsistenteA1.rows.length, 0, 'Asistente NO tiene política para consultar historial de movimientos');

  // Sesión SuperAdmin Escuela B
  await db.exec(`
    SET ROLE authenticated;
    SET request.jwt.claim.sub = '${idSuperB}';
  `);
  const saldosSuperB = await db.query(`SELECT * FROM public.inventario_saldos;`);
  assert.equal(saldosSuperB.rows.length, 1, 'SuperAdmin B ve su propia sucursal');
  assert.equal(saldosSuperB.rows[0].escuela_id, idEscuelaB);

  await db.exec(`
    RESET ROLE;
    SET request.jwt.claim.sub = '';
  `);

  console.log('PASADA: Políticas RLS aplicadas con éxito con aislamiento estricto por escuela, sucursal y rol.');

  console.log('\n=============================================================');
  console.log('🎉 TODAS LAS VERIFICACIONES DE SEGURIDAD Y RLS PASARON CON ÉXITO');
  console.log('=============================================================');
} catch (err) {
  console.error('❌ FALLO EN PRUEBA DE SEGURIDAD:', err);
  process.exitCode = 1;
} finally {
  await db.close();
}
