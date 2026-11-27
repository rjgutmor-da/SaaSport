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

  const escInter = randomUUID();
  const escCanito = randomUUID();
  const escGolden = randomUUID();
  await consultar(
    "INSERT INTO escuelas(id, nombre) VALUES ($1, 'Fundación Inter Stars'), ($2, 'El Cañito'), ($3, '@ Golden club')",
    escInter, escCanito, escGolden,
  );

  // Inter Stars: 447 alumnos (debe mantenerse en Completa = $72, jamás sugerir bajar)
  const uInter = randomUUID();
  await consultar('INSERT INTO auth.users(id) VALUES ($1)', uInter);
  await consultar("INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'i@t.bo', 'A', 'B', 'SuperAdministrador', true)", uInter, escInter);

  // El Cañito: 13 usuarios en Crecimiento ($35) → debe resaltar $37 (+1 usuario)
  let uCanito = null;
  for (let i = 0; i < 13; i += 1) {
    const uid = randomUUID();
    if (!uCanito) uCanito = uid;
    await consultar('INSERT INTO auth.users(id) VALUES ($1)', uid);
    await consultar("INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, $3, 'U', $4, 'Administrador', true)", uid, escCanito, `c${i}@t.bo`, `${i}`);
  }

  // Golden: 316 alumnos en Crecimiento ($35) → debe resaltar $50 (Profesional)
  const uGolden = randomUUID();
  await consultar('INSERT INTO auth.users(id) VALUES ($1)', uGolden);
  await consultar("INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'g@t.bo', 'G', '1', 'SuperAdministrador', true)", uGolden, escGolden);
  for (let i = 0; i < 316; i += 1) {
    await consultar("INSERT INTO alumnos(escuela_id, nombres, apellidos, archivado) VALUES ($1, 'Al', $2, false)", escGolden, `${i}`);
  }

  // Aplicar las 3 migraciones en orden
  await db.exec(await cargar('../migrations/20261127110000_tabla_topes_planes_escuelas.sql'));
  await db.exec(await cargar('../migrations/20261127120000_ajustar_topes_margen_sin_bloqueo.sql'));
  await db.exec(await cargar('../migrations/20261127123000_planes_contratados_y_bloqueos_manuales.sql'));

  // 1. Inter Stars queda en Completa = $72 (contratado y correspondiente = 72)
  await consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", uInter);
  await db.exec('SET ROLE authenticated');
  let rpc = (await uno('SELECT public.rpc_obtener_plan_y_cupos_escuela($1) AS res', escInter)).res;
  assert.equal(rpc.plan.id, 'combo_completa');
  assert.equal(Number(rpc.plan.monto_contratado_usd), 72);
  assert.equal(Number(rpc.plan.monto_correspondiente_usd), 72);
  assert.equal(rpc.alerta.requiere_atencion, false);
  await db.exec('RESET ROLE');

  // 2. El Cañito: contratado $35, correspondiente $37 (+1 usuario adicional)
  await consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", uCanito);
  await db.exec('SET ROLE authenticated');
  rpc = (await uno('SELECT public.rpc_obtener_plan_y_cupos_escuela($1) AS res', escCanito)).res;
  assert.equal(Number(rpc.plan.monto_contratado_usd), 35);
  assert.equal(Number(rpc.plan.monto_correspondiente_usd), 37);
  assert.equal(rpc.alerta.requiere_atencion, true);
  assert.equal(rpc.alerta.recomendacion.tipo, 'usuarios_adicionales');
  await db.exec('RESET ROLE');

  // 3. Golden: contratado $35, correspondiente $50 (Profesional)
  await consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", uGolden);
  await db.exec('SET ROLE authenticated');
  rpc = (await uno('SELECT public.rpc_obtener_plan_y_cupos_escuela($1) AS res', escGolden)).res;
  assert.equal(Number(rpc.plan.monto_contratado_usd), 35);
  assert.equal(Number(rpc.plan.monto_correspondiente_usd), 50);
  assert.equal(rpc.alerta.requiere_atencion, true);
  assert.equal(rpc.alerta.recomendacion.tipo, 'subir_plan');
  await db.exec('RESET ROLE');

  // 4. Probar tabla manual public.escuelas_bloqueos (los 3 interruptores en false permiten todo; en true bloquean solo esa acción)
  await consultar("INSERT INTO alumnos(escuela_id, nombres, apellidos, archivado) VALUES ($1, 'Libre', '1', false)", escGolden);
  await consultar("UPDATE public.escuelas_bloqueos SET bloquear_creacion_alumnos = true, motivo_bloqueo = 'Regularizar mensualidad' WHERE escuela_id = $1", escGolden);
  await assert.rejects(
    () => consultar("INSERT INTO alumnos(escuela_id, nombres, apellidos, archivado) VALUES ($1, 'Bloqueado', '2', false)", escGolden),
    /Regularizar mensualidad/,
  );

  await consultar("INSERT INTO sucursales(escuela_id, nombre) VALUES ($1, 'Sede Libre')", escGolden);
  await consultar("UPDATE public.escuelas_bloqueos SET bloquear_creacion_sucursales = true, motivo_bloqueo = NULL WHERE escuela_id = $1", escGolden);
  await assert.rejects(
    () => consultar("INSERT INTO sucursales(escuela_id, nombre) VALUES ($1, 'Sede Bloqueada')", escGolden),
    /creación de sucursales está pausada/,
  );

  const uExtra = randomUUID();
  await consultar('INSERT INTO auth.users(id) VALUES ($1)', uExtra);
  await consultar("UPDATE public.escuelas_bloqueos SET bloquear_creacion_usuarios = true WHERE escuela_id = $1", escGolden);
  await assert.rejects(
    () => consultar("INSERT INTO usuarios(id, escuela_id, email, nombres, apellidos, rol, activo) VALUES ($1, $2, 'x@g.bo', 'X', 'Y', 'Administrador', true)", uExtra, escGolden),
    /creación y activación de usuarios está pausada/,
  );

  console.log('OK: pruebas locales de planes contratados, monto correspondiente y bloqueos manuales aprobadas.');
} finally {
  await db.close();
}
