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
    ALTER TABLE escuelas ADD COLUMN activa boolean DEFAULT true, ADD COLUMN zona_horaria text;
    ALTER TABLE alumnos ADD COLUMN mensualidad numeric, ADD COLUMN fecha_inicio date;
    ALTER TABLE catalogo_items ADD COLUMN tipo_movimiento text,
      ADD COLUMN es_ingreso boolean, ADD COLUMN es_gasto boolean;
    CREATE TABLE configuracion_facturacion (
      escuela_id uuid, activo boolean, plan_momento_emision text, plan_calculo_monto text,
      asistencias_minimo_completo int, asistencias_minimo_parcial int, porcentaje_monto_parcial numeric
    );
    CREATE TABLE ejecuciones_facturacion (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid, fecha_ejecucion date, facturas_generadas int
    );
    ALTER TABLE cuentas_cobrar ADD COLUMN periodo text, ADD COLUMN ejecucion_facturacion_id uuid;
    CREATE TABLE ciclos_omitidos (
      escuela_id uuid, alumno_id uuid, periodo_estadistico date, motivo text,
      UNIQUE (alumno_id, periodo_estadistico)
    );
    CREATE TABLE asistencias_normales (alumno_id uuid, fecha date, estado text);
    CREATE TABLE asistencias_arqueros (LIKE asistencias_normales);
    CREATE UNIQUE INDEX mensualidad_activa_prueba ON cuentas_cobrar (escuela_id, alumno_id, periodo_estadistico)
    WHERE anulada IS NOT TRUE AND es_anticipo IS NOT TRUE AND estado <> 'borrador';
  `);
  await db.exec(await cargar('../migrations/20261007114500_fix_periodo_estadistico_prorrateo_mismo_mes.sql'));
  const aprobacion = await cargar('../migrations/20260902150000_fix_aprobacion_notas_automaticas_y_limpieza_borradores.sql');
  await db.exec(aprobacion.slice(aprobacion.indexOf('CREATE OR REPLACE FUNCTION')));
  await db.exec(await cargar('../migrations/20261120210553_mensualidad_ingreso_alumno.sql'));

  const [escuela, otra, nuevo, regreso, cubierto, cero, sinTarifa, admin, entrenador] = Array.from({ length: 9 }, randomUUID);
  await consultar("INSERT INTO escuelas(id, zona_horaria) VALUES ($1, 'America/La_Paz'), ($2, 'UTC')", escuela, otra);
  const hoy = (await uno("SELECT timezone('America/La_Paz', now())::date::text AS hoy")).hoy;
  await consultar("INSERT INTO auth.users(id) VALUES ($1), ($2)", admin, entrenador);
  await consultar("INSERT INTO usuarios(id, escuela_id, rol) VALUES ($1,$3,'Administrador'), ($2,$3,'Entrenador')", admin, entrenador, escuela);

  await consultar("DELETE FROM catalogo_items WHERE escuela_id=$1 AND nombre='Mensualidad'", escuela);
  await consultar("INSERT INTO alumnos(id, escuela_id, mensualidad, archivado) VALUES ($1,$4,300,false), ($2,$4,300,true), ($3,$4,300,true)", nuevo, regreso, cubierto, escuela);
  await consultar("INSERT INTO alumnos(id, escuela_id, mensualidad) VALUES ($1,$3,0), ($2,$3,NULL)", cero, sinTarifa, escuela);

  const ingreso = alumno => uno('SELECT cuenta_id, ciclo_inicio::text, ciclo_fin::text, motivo FROM mensualidades_ingreso WHERE alumno_id=$1', alumno);
  const nota = id => uno('SELECT estado, monto_total::int, ciclo_inicio::text, ciclo_fin::text FROM cuentas_cobrar WHERE id=$1', id);
  const login = id => consultar("SELECT set_config('request.jwt.claim.sub', $1, false)", id);
  const editar = (alumno, cuenta, inicio) => consultar('SELECT rpc_editar_ciclo_mensualidad_ingreso($1,$2,$3)', alumno, cuenta, inicio);
  const alta = await ingreso(nuevo);
  assert.equal(alta.ciclo_inicio, hoy);
  assert.deepEqual(await nota(alta.cuenta_id), {
    estado: 'borrador', monto_total: 300, ciclo_inicio: hoy, ciclo_fin: alta.ciclo_fin,
  });
  assert.equal((await ingreso(cero)).motivo, 'tarifa_cero');
  assert.equal((await ingreso(sinTarifa)).motivo, 'sin_tarifa');
  assert.equal(await ingreso(regreso), undefined);

  await login(entrenador);
  await db.exec('SET ROLE authenticated');
  assert.equal((await ingreso(nuevo)).cuenta_id, alta.cuenta_id);
  await assert.rejects(() => editar(nuevo, alta.cuenta_id, hoy), /No autorizado/);
  await db.exec('RESET ROLE');

  await login(admin);
  const pasado = await uno("SELECT ($1::date - interval '3 months')::date::text inicio, ($1::date - interval '2 months' - interval '1 day')::date::text fin", hoy);
  const deuda = (await uno("INSERT INTO cuentas_cobrar(escuela_id, alumno_id, monto_total, estado, descripcion, ciclo_inicio, ciclo_fin) VALUES ($1,$2,180,'pendiente','Mensualidad',$3,$4) RETURNING id", escuela, regreso, pasado.inicio, pasado.fin)).id;
  await consultar("INSERT INTO cobros_aplicados(escuela_id,cuenta_cobrar_id,monto_aplicado) VALUES ($1,$2,80)", escuela, deuda);
  await consultar('UPDATE alumnos SET archivado=false WHERE id=$1', regreso);
  const borrador = await ingreso(regreso);
  assert.equal(borrador.ciclo_inicio, hoy);
  await consultar("UPDATE alumnos SET archivado=false, nombres='Edición' WHERE id=$1", regreso);
  assert.equal((await ingreso(regreso)).cuenta_id, borrador.cuenta_id);

  await consultar("INSERT INTO configuracion_facturacion VALUES ($1,true,'atrasado','asistencia',8,4,50)", escuela);
  await consultar('SELECT rpc_cron_facturacion_diaria($1)', hoy);
  assert.equal((await uno('SELECT count(*)::int n FROM cuentas_cobrar WHERE alumno_id=$1', regreso)).n, 2);
  assert.equal((await uno('SELECT count(*)::int n FROM ciclos_omitidos WHERE alumno_id=$1', regreso)).n, 0);
  assert.equal((await nota(deuda)).monto_total, 180);
  assert.equal((await uno('SELECT monto_aplicado::int FROM cobros_aplicados WHERE cuenta_cobrar_id=$1', deuda)).monto_aplicado, 80);

  const siguiente = (await uno("SELECT ($1::date + 1)::text dia", hoy)).dia;
  await editar(regreso, borrador.cuenta_id, siguiente);
  assert.equal((await nota(borrador.cuenta_id)).estado, 'borrador');
  assert.equal((await ingreso(regreso)).ciclo_inicio, siguiente);
  await consultar('SELECT rpc_aprobar_notas_automaticas(ARRAY[$1::uuid])', borrador.cuenta_id);
  assert.equal((await nota(borrador.cuenta_id)).estado, 'pendiente');
  await assert.rejects(() => editar(regreso, borrador.cuenta_id, siguiente), /ya no está en borrador/);

  await consultar("INSERT INTO cuentas_cobrar(escuela_id, alumno_id, monto_total, estado, descripcion, ciclo_inicio, ciclo_fin, periodo_estadistico) VALUES ($1,$2,180,'pendiente','Mensualidad',$3,$4,calcular_periodo_estadistico($3,$4))", escuela, cubierto, hoy, alta.ciclo_fin);
  await consultar('UPDATE alumnos SET archivado=false WHERE id=$1', cubierto);
  const posterior = await ingreso(cubierto);
  assert.ok(posterior.ciclo_inicio > alta.ciclo_fin);
  await assert.rejects(() => editar(cubierto, posterior.cuenta_id, hoy), /Ya existe una mensualidad/);

  await login(randomUUID());
  await db.exec('SET ROLE authenticated');
  assert.equal(await ingreso(nuevo), undefined);
  console.log('Mensualidades de inscripción y regreso verificadas con PostgreSQL aislado.');
} finally {
  await db.close();
}
