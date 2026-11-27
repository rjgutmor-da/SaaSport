// Ejecutar con la ruta a dist/index.js de @electric-sql/pglite. Base desechable.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
const cargar = ruta => readFile(new URL(ruta, import.meta.url), 'utf8');
const consultar = async (sql, ...params) => (await db.query(sql, params)).rows;
const uno = async (...args) => (await consultar(...args))[0];

try {
  await db.exec(await cargar('fixtures/inventario_base.sql'));
  await db.exec(`
    CREATE ROLE service_role;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    ALTER TABLE escuelas
      ADD COLUMN IF NOT EXISTS ficha_medica_habilitada boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS ficha_tecnica_habilitada boolean NOT NULL DEFAULT false;
    ALTER TABLE alumnos
      ADD COLUMN IF NOT EXISTS estado varchar DEFAULT 'Pendiente';
    CREATE TABLE public.cajas_bancos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      escuela_id uuid NOT NULL REFERENCES public.escuelas(id) ON DELETE CASCADE,
      sucursal_id uuid REFERENCES public.sucursales(id) ON DELETE SET NULL,
      cuenta_contable_id uuid,
      nombre varchar NOT NULL,
      tipo varchar NOT NULL CHECK (tipo IN ('caja_chica', 'cuenta_bancaria')),
      activo boolean DEFAULT true,
      saldo_actual numeric DEFAULT 0,
      orden integer DEFAULT 0,
      es_predeterminada boolean DEFAULT false,
      created_at timestamptz DEFAULT now()
    );
  `);

  // Escuelas preexistentes para validar backfill automático
  const escBackfill = randomUUID();
  const escInterStars = randomUUID();
  const escLite = randomUUID();
  await consultar(
    "INSERT INTO escuelas(id, nombre, ficha_medica_habilitada) VALUES ($1, 'Club Prueba Backfill', true), ($2, 'Fundación Inter Stars', false)",
    escBackfill,
    escInterStars,
  );
  const suc1 = randomUUID();
  const suc2 = randomUUID();
  await consultar('INSERT INTO sucursales(id, escuela_id, nombre) VALUES ($1, $3, $4), ($2, $3, $5)', suc1, suc2, escBackfill, 'Sede 1', 'Sede 2');
  for (let i = 0; i < 12; i += 1) {
    const uid = randomUUID();
    await consultar('INSERT INTO auth.users(id) VALUES ($1)', uid);
    await consultar(
      "INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, $3, 'Usr', $4, 'Administrador', true)",
      uid,
      escBackfill,
      `u${i}@test.bo`,
      `${i}`,
    );
  }
  for (let i = 0; i < 165; i += 1) {
    await consultar(
      "INSERT INTO alumnos(escuela_id, sucursal_id, nombres, apellidos, archivado) VALUES ($1, $2, 'Al', $3, false)",
      escBackfill,
      i % 2 === 0 ? suc1 : suc2,
      `${i}`,
    );
  }

  // Ejecutar migración completa
  await db.exec(await cargar('../migrations/20261127110000_tabla_topes_planes_escuelas.sql'));

  // 1. Validar catálogo de 16 planes
  const planesCount = await uno('SELECT count(*)::int AS total FROM public.catalogo_planes');
  assert.equal(planesCount.total, 16);

  // 2. Validar backfill
  const planBackfill = await uno('SELECT * FROM public.escuelas_plan WHERE escuela_id = $1', escBackfill);
  assert.equal(planBackfill.plan_id, 'combo_crecimiento');
  assert.equal(planBackfill.addon_perfil_medico, true);
  assert.equal(planBackfill.usuarios_adicionales, 0);
  assert.equal(planBackfill.alumnos_adicionales, 0);

  const planInter = await uno('SELECT * FROM public.escuelas_plan WHERE escuela_id = $1', escInterStars);
  assert.equal(planInter.addon_fotos_asistencia, true);

  // 3. Crear nueva escuela y cambiarla a SaaSport Lite Básico
  await consultar("INSERT INTO escuelas(id, nombre) VALUES ($1, 'Escuela Lite Nueva')", escLite);
  const planNuevoDefault = await uno('SELECT plan_id FROM public.escuelas_plan WHERE escuela_id = $1', escLite);
  assert.equal(planNuevoDefault.plan_id, 'combo_basico');

  await consultar("UPDATE public.escuelas_plan SET plan_id = 'saasport_lite_basico' WHERE escuela_id = $1", escLite);
  const cajasLite = await consultar('SELECT nombre, tipo, es_predeterminada FROM public.cajas_bancos WHERE escuela_id = $1 ORDER BY orden', escLite);
  assert.deepEqual(cajasLite, [
    { nombre: 'Efectivo', tipo: 'caja_chica', es_predeterminada: true },
    { nombre: 'QR / Transferencia', tipo: 'cuenta_bancaria', es_predeterminada: false },
  ]);

  // 4. Validar topes de roles y usuarios en SaaSport Lite Básico (max_usuarios = 2)
  const adminLite = randomUUID();
  const asistLite = randomUUID();
  const coachLite = randomUUID();
  const extraLite = randomUUID();
  await consultar('INSERT INTO auth.users(id) VALUES ($1), ($2), ($3), ($4)', adminLite, asistLite, coachLite, extraLite);

  await assert.rejects(
    () => consultar(
      "INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'coach@lite.bo', 'Profe', 'Uno', 'Entrenador', true)",
      coachLite,
      escLite,
    ),
    /no incluye AsiSport/,
  );

  await consultar(
    "INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $3, 'admin@lite.bo', 'Admin', 'Uno', 'SuperAdministrador', true), ($2, $3, 'asist@lite.bo', 'Asist', 'Uno', 'Asistente', true)",
    adminLite,
    asistLite,
    escLite,
  );

  await assert.rejects(
    () => consultar(
      "INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'extra@lite.bo', 'Extra', 'Uno', 'Administrador', true)",
      extraLite,
      escLite,
    ),
    /límite de 2 usuarios activos/,
  );

  // Usuario inactivo no consume cupo; al sumar usuarios_adicionales = 1 permite activarlo
  await consultar(
    "INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'extra@lite.bo', 'Extra', 'Uno', 'Administrador', false)",
    extraLite,
    escLite,
  );
  await consultar('UPDATE public.escuelas_plan SET usuarios_adicionales = 1 WHERE escuela_id = $1', escLite);
  await consultar('UPDATE public.usuarios SET activo = true WHERE id = $1', extraLite);

  // 5. Validar tope de sucursales (max_sucursales = 1)
  const sucLite1 = randomUUID();
  await consultar("INSERT INTO sucursales(id, escuela_id, nombre) VALUES ($1, $2, 'Única Sede')", sucLite1, escLite);
  await assert.rejects(
    () => consultar("INSERT INTO sucursales(escuela_id, nombre) VALUES ($1, 'Segunda Sede')", escLite),
    /límite de 1 sucursal/,
  );

  // 6. Validar tope de alumnos activos (max_alumnos = 100), edición, archivo y restauración
  let primerAlumnoId = null;
  for (let i = 1; i <= 100; i += 1) {
    const row = await uno(
      "INSERT INTO alumnos(escuela_id, sucursal_id, nombres, apellidos, archivado) VALUES ($1, $2, 'Jugador', $3, false) RETURNING id",
      escLite,
      sucLite1,
      `${i}`,
    );
    if (!primerAlumnoId) primerAlumnoId = row.id;
  }

  // Alumno #101 debe fallar
  await assert.rejects(
    () => consultar("INSERT INTO alumnos(escuela_id, sucursal_id, nombres, apellidos, archivado) VALUES ($1, $2, 'Jugador', '101', false)", escLite, sucLite1),
    /límite de 100 alumnos activos/,
  );

  // Editar un alumno activo sigue funcionando incluso al 100%
  await consultar("UPDATE alumnos SET nombres = 'Jugador Editado' WHERE id = $1", primerAlumnoId);

  // Archivar libera cupo para otro alumno nuevo, pero no permite restaurar hasta ampliar cupo
  await consultar('UPDATE alumnos SET archivado = true WHERE id = $1', primerAlumnoId);
  await consultar("INSERT INTO alumnos(escuela_id, sucursal_id, nombres, apellidos, archivado) VALUES ($1, $2, 'Jugador', '101', false)", escLite, sucLite1);
  await assert.rejects(
    () => consultar('UPDATE alumnos SET archivado = false WHERE id = $1', primerAlumnoId),
    /límite de 100 alumnos activos/,
  );
  await consultar('UPDATE public.escuelas_plan SET alumnos_adicionales = 1 WHERE escuela_id = $1', escLite);
  await consultar('UPDATE alumnos SET archivado = false WHERE id = $1', primerAlumnoId);

  // 7. Validar RPC consolidado y aislamiento entre escuelas
  await consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", adminLite);
  await db.exec('SET ROLE authenticated');
  const resumenRpc = await uno('SELECT public.rpc_obtener_plan_y_cupos_escuela($1) AS res', escLite);
  assert.equal(resumenRpc.res.plan.id, 'saasport_lite_basico');
  assert.equal(resumenRpc.res.cupos.alumnos.usados, 101);
  assert.equal(resumenRpc.res.cupos.alumnos.limite, 101);
  assert.equal(resumenRpc.res.cupos.usuarios.usados, 3);
  assert.equal(resumenRpc.res.cupos.usuarios.limite, 3);
  assert.equal(resumenRpc.res.cupos.sucursales.usados, 1);
  assert.equal(resumenRpc.res.resumen_escuela.alumnos_por_sucursal[0].count, 101);

  await assert.rejects(
    () => consultar('SELECT public.rpc_obtener_plan_y_cupos_escuela($1)', escBackfill),
    /No autorizado/,
  );
  await db.exec('RESET ROLE');

  console.log('OK: pruebas locales de tabla de topes, triggers y RPC aprobadas.');
} finally {
  await db.close();
}
