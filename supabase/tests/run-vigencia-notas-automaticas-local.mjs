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
    GRANT SELECT ON alumnos TO authenticated;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE OR REPLACE FUNCTION public.unaccent(t text)
    RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
      SELECT translate(t, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN');
    $$;
    ALTER TABLE escuelas ADD COLUMN activa boolean DEFAULT true, ADD COLUMN zona_horaria text;
    ALTER TABLE alumnos ADD COLUMN mensualidad numeric, ADD COLUMN fecha_inicio date;
    ALTER TABLE catalogo_items ADD COLUMN tipo_movimiento text,
      ADD COLUMN es_ingreso boolean, ADD COLUMN es_gasto boolean;
    CREATE TABLE configuracion_facturacion (
      escuela_id uuid PRIMARY KEY,
      activo boolean,
      plan_momento_emision text,
      plan_calculo_monto text,
      asistencias_minimo_completo int,
      asistencias_minimo_parcial int,
      porcentaje_monto_parcial numeric,
      updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE ejecuciones_facturacion (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      escuela_id uuid,
      fecha_ejecucion date,
      facturas_generadas int
    );
    ALTER TABLE cuentas_cobrar ADD COLUMN periodo text, ADD COLUMN ejecucion_facturacion_id uuid;
    CREATE TABLE ciclos_omitidos (
      escuela_id uuid,
      alumno_id uuid,
      periodo_estadistico date,
      motivo text,
      UNIQUE (alumno_id, periodo_estadistico)
    );
    CREATE TABLE asistencias_normales (alumno_id uuid, fecha date, estado text);
    CREATE TABLE asistencias_arqueros (LIKE asistencias_normales);
    CREATE TABLE IF NOT EXISTS public.inventario_movimientos (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      escuela_id uuid,
      referencia_tipo text,
      referencia_id uuid
    );
    CREATE UNIQUE INDEX mensualidad_activa_prueba ON cuentas_cobrar (escuela_id, alumno_id, periodo_estadistico)
    WHERE anulada IS NOT TRUE AND es_anticipo IS NOT TRUE AND estado <> 'borrador';
  `);
  await db.exec(await cargar('../migrations/20261007114500_fix_periodo_estadistico_prorrateo_mismo_mes.sql'));
  const aprobacion = await cargar('../migrations/20260902150000_fix_aprobacion_notas_automaticas_y_limpieza_borradores.sql');
  await db.exec(aprobacion.slice(aprobacion.indexOf('CREATE OR REPLACE FUNCTION')));
  await db.exec(await cargar('../migrations/20261120210553_mensualidad_ingreso_alumno.sql'));
  await db.exec(await cargar('../migrations/20261127230000_vigencia_25_dias_notas_automaticas_y_escuelas_inactivas.sql'));

  const [escActiva, escInactiva, sucA, sucB, adminId] = Array.from({ length: 5 }, randomUUID);
  await consultar(
    "INSERT INTO escuelas(id, activa, zona_horaria) VALUES ($1, true, 'America/La_Paz'), ($2, false, 'America/La_Paz')",
    escActiva, escInactiva,
  );
  await consultar("INSERT INTO sucursales(id, escuela_id, nombre) VALUES ($1, $3, 'Norte'), ($2, $3, 'Sur')", sucA, sucB, escActiva);
  await consultar("INSERT INTO auth.users(id) VALUES ($1)", adminId);
  await consultar("INSERT INTO usuarios(id, escuela_id, rol, activo) VALUES ($1, $2, 'SuperAdministrador', true)", adminId, escActiva);
  await consultar(
    "INSERT INTO configuracion_facturacion(escuela_id, activo, plan_momento_emision, plan_calculo_monto) VALUES ($1, true, 'adelantado', 'fijo'), ($2, true, 'adelantado', 'fijo')",
    escActiva, escInactiva,
  );

  // 1. Escuela inactiva no genera borrador de ingreso ni facturación
  const alInactivo = randomUUID();
  await consultar("INSERT INTO alumnos(id, escuela_id, nombres, apellidos, mensualidad, archivado) VALUES ($1, $2, 'Pedro', 'Inactivo', 200, false)", alInactivo, escInactiva);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE escuela_id=$1', escInactiva)).n, 0);
  assert.equal((await uno('SELECT count(*)::int n FROM mensualidades_ingreso WHERE alumno_id=$1', alInactivo)).n, 0);

  // 2. Escuela activa: alumno con borrador de ingreso + 34 alumnos para probar paginación de 30/pág
  const alExpira = randomUUID();
  await consultar("INSERT INTO alumnos(id, escuela_id, sucursal_id, nombres, apellidos, mensualidad, archivado) VALUES ($1, $2, $3, 'Carlos', 'Expira', 250, false)", alExpira, escActiva, sucA);
  const borradorIngreso = await uno('SELECT id, created_at FROM cuentas_cobrar WHERE alumno_id=$1 AND estado=$2', alExpira, 'borrador');
  assert.ok(borradorIngreso?.id);

  // A los 24 días sigue vigente; a los 25 días se elimina y registra ciclos_omitidos
  assert.equal((await uno("SELECT public.fn_limpiar_notas_automaticas_expiradas(25, $1::timestamptz + interval '24 days') AS n", borradorIngreso.created_at)).n, 0);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE id=$1', borradorIngreso.id)).n, 1);
  assert.equal((await uno("SELECT public.fn_limpiar_notas_automaticas_expiradas(25, $1::timestamptz + interval '25 days') AS n", borradorIngreso.created_at)).n, 1);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE id=$1', borradorIngreso.id)).n, 0);
  assert.equal((await uno("SELECT motivo FROM ciclos_omitidos WHERE alumno_id=$1", alExpira)).motivo, 'expirado_25_dias');

  // 3. Nota ya aprobada ('pendiente') no se borra aunque tenga > 25 días
  const alAprobado = randomUUID();
  await consultar("INSERT INTO alumnos(id, escuela_id, sucursal_id, nombres, apellidos, mensualidad, archivado) VALUES ($1, $2, $3, 'María', 'Aprobada', 300, false)", alAprobado, escActiva, sucA);
  const notaAprobada = await uno('SELECT id FROM cuentas_cobrar WHERE alumno_id=$1', alAprobado);
  await consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", adminId);
  await consultar('SELECT rpc_aprobar_notas_automaticas(ARRAY[$1::uuid])', notaAprobada.id);
  await consultar("UPDATE cuentas_cobrar SET created_at = now() - interval '60 days' WHERE id=$1", notaAprobada.id);
  assert.equal((await uno('SELECT public.fn_limpiar_notas_automaticas_expiradas(25, now()) AS n')).n, 0);
  assert.equal((await uno('SELECT estado FROM cuentas_cobrar WHERE id=$1', notaAprobada.id)).estado, 'pendiente');

  // 4. Paginación en servidor de 30 registros por página + búsqueda con acentos
  for (let i = 1; i <= 34; i += 1) {
    const uid = randomUUID();
    await consultar(
      "INSERT INTO alumnos(id, escuela_id, sucursal_id, nombres, apellidos, mensualidad, archivado) VALUES ($1, $2, $3, $4, $5, 180, false)",
      uid, escActiva, i <= 20 ? sucA : sucB, i === 7 ? 'José' : `Alumno${String(i).padStart(2, '0')}`, 'Prueba',
    );
  }

  await db.exec('SET ROLE authenticated');
  const pag1 = (await uno("SELECT public.rpc_listar_notas_automaticas_borrador('', NULL, 1, 30) AS res")).res;
  const pag2 = (await uno("SELECT public.rpc_listar_notas_automaticas_borrador('', NULL, 2, 30) AS res")).res;
  assert.equal(pag1.total_resultados, 34);
  assert.equal(pag1.items.length, 30);
  assert.equal(pag2.items.length, 4);
  assert.equal(pag1.ids_filtrados.length, 34);
  assert.ok(pag1.items[0].dias_restantes >= 1 && pag1.items[0].dias_restantes <= 25);

  const busqAcento = (await uno("SELECT public.rpc_listar_notas_automaticas_borrador('jose', NULL, 1, 30) AS res")).res;
  assert.equal(busqAcento.total_resultados, 1);
  assert.equal(busqAcento.items[0].alumnos.nombres, 'José');
  await db.exec('RESET ROLE');

  // 5. Al archivar un alumno o desactivar la escuela, se limpian sus borradores pendientes
  await consultar('UPDATE alumnos SET archivado = true WHERE escuela_id = $1 AND sucursal_id = $2', escActiva, sucB);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE escuela_id=$1 AND sucursal_id=$2 AND estado=$3', escActiva, sucB, 'borrador')).n, 0);

  await consultar('UPDATE escuelas SET activa = false WHERE id = $1', escActiva);
  assert.equal((await uno('SELECT activo FROM configuracion_facturacion WHERE escuela_id=$1', escActiva)).activo, false);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE escuela_id=$1 AND estado=$2', escActiva, 'borrador')).n, 0);

  console.log('Vigencia de 25 días, escuelas inactivas y paginación 30/pág verificadas en PostgreSQL aislado.');
} finally {
  await db.close();
}
