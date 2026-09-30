import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = createRequire(path.resolve(process.argv[2] || '../../../outputs/attendance-test-runtime', 'package.json'));
const { PGlite } = runtime('@electric-sql/pglite');
const db = new PGlite();
const migration = await fs.readFile(path.resolve(here, '../../supabase/migrations/20260930132911_grupo_fuente_verdad_alumno.sql'), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
let checks = 0;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); checks++; }
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
const one = async (sql, args = []) => (await rows(sql, args))[0];
const actor = async n => db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [n ? id(n) : '']);
async function rejects(sql, args, text) {
  await assert.rejects(() => db.query(sql, args), error => error.message.includes(text)); checks++;
}
async function group(name, horario = id(30), trainer = id(11)) {
  return (await one('SELECT rpc_guardar_grupo_completo(NULL,$1,$2,$3,$4) result', [name,id(3),horario,trainer])).result.grupo_id;
}
async function save(g, name, horario, trainer) {
  return one('SELECT rpc_guardar_grupo_completo($1,$2,$3,$4,$5) result', [g,name,id(3),horario,trainer]);
}
async function student(n, g, archived = false) {
  await db.query(`INSERT INTO alumnos(id,escuela_id,nombres,apellidos,cancha_id,sucursal_id,archivado)
    VALUES($1,$2,'Alumno',$3,$4,$5,$6)`, [id(n),id(1),String(n),g,id(4),archived]);
}
async function tuple(n) {
  return one('SELECT horario_id,profesor_asignado_id,sucursal_id FROM alumnos WHERE id=$1', [id(n)]);
}
const expected = (h,t) => ({ horario_id:h,profesor_asignado_id:t,sucursal_id:id(4) });
try {
  await db.exec(await fs.readFile(path.join(here,'fixture.sql'),'utf8'));
  await db.exec(await fs.readFile(path.join(here,'funciones-previas.sql'),'utf8'));
  await db.exec(`CREATE TRIGGER trg_sync_alumnos_grupo_cancha BEFORE INSERT OR UPDATE ON alumnos
    FOR EACH ROW EXECUTE FUNCTION fn_sync_alumnos_grupo_cancha();
    CREATE TRIGGER trigger_sync_alumnos_entrenadores AFTER INSERT OR UPDATE OF profesor_asignado_id ON alumnos
    FOR EACH ROW EXECUTE FUNCTION private.sync_alumnos_entrenadores_autorizado();`);
  await db.exec(`INSERT INTO escuelas(id,nombre) VALUES('${id(1)}','A'),('${id(2)}','B');
    INSERT INTO sucursales(id,escuela_id,nombre) VALUES('${id(3)}','${id(1)}','Centro'),('${id(4)}','${id(1)}','Otra');
    INSERT INTO usuarios(id,escuela_id,nombres,apellidos,rol) VALUES
    ('${id(10)}','${id(1)}','Admin','A','SuperAdministrador'),
    ('${id(11)}','${id(1)}','Profe','Uno','Entrenador'),
    ('${id(12)}','${id(1)}','Profe','Dos','Entrenador'),
    ('${id(13)}','${id(2)}','Admin','B','SuperAdministrador'),
    ('${id(14)}','${id(1)}','Asistente','A','Asistente');
    INSERT INTO horarios(id,escuela_id,hora) VALUES('${id(30)}','${id(1)}','16:00'),('${id(31)}','${id(1)}','18:00'),('${id(32)}','${id(2)}','19:00');`);
  await actor(10);
  const g = await group('Grupo');
  const target = await group('Destino',id(31),id(12));
  await student(100,g);
  await db.query('UPDATE alumnos SET horario_id=$1,profesor_asignado_id=$2 WHERE id=$3',[id(30),id(11),id(100)]);
  await student(101,g,true);
  await db.query('UPDATE alumnos SET horario_id=$1,profesor_asignado_id=$2 WHERE id=$3',[id(30),id(11),id(101)]);
  const archivedBefore = await tuple(101);
  await actor(null);
  const foreignGroup = (await one(`INSERT INTO grupos(escuela_id,nombre) VALUES($1,'Extranjero') RETURNING id`,[id(2)])).id;
  await db.query(`INSERT INTO alumnos(id,escuela_id,nombres,apellidos,cancha_id,horario_id,profesor_asignado_id)
    VALUES($1,$2,'Otro','Alumno',$3,$4,$5)`,[id(102),id(2),foreignGroup,id(32),id(13)]);
  const foreignBefore = await one('SELECT * FROM alumnos WHERE id=$1',[id(102)]);
  await actor(10);
  const beforeInstall = await rows('SELECT * FROM alumnos ORDER BY id');
  await db.exec(migration);
  check(await rows('SELECT * FROM alumnos ORDER BY id'),beforeInstall,'La instalación no regulariza datos silenciosamente');
  await student(103,g);
  check(await tuple(103),expected(id(30),id(11)),'Alta deriva ambos campos y conserva sucursal');
  const oldGG = (await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(103)])).grupo_gestion_id;
  await db.query("INSERT INTO asistencias_normales(alumno_id,grupo_gestion_id,entrenador_id,fecha,estado) VALUES($1,$2,$3,'2026-09-01','Presente')",[id(103),oldGG,id(11)]);
  const history = await rows('SELECT * FROM asistencias_normales');
  await save(g,'Grupo',id(31),id(11));
  check(await tuple(103),expected(id(31),id(11)),'Cambiar solo horario propaga');
  check((await one('SELECT horario_id FROM grupos_gestion WHERE id=$1',[oldGG])).horario_id,id(30),'El horario histórico no se reescribe');
  await save(g,'Grupo',id(31),id(12));
  check(await tuple(103),expected(id(31),id(12)),'Cambiar solo profesor propaga');
  check((await one('SELECT entrenador_id FROM alumnos_entrenadores WHERE alumno_id=$1',[id(103)])).entrenador_id,id(12),'Relación del profesor sincronizada');
  await save(g,'Grupo',id(30),id(11));
  check(await tuple(103),expected(id(30),id(11)),'Cambiar ambos propaga');
  await save(g,'Grupo',null,id(12));
  check(await tuple(103),expected(null,id(12)),'Horario vacío se propaga');
  await save(g,'Grupo',id(31),null);
  check(await tuple(103),expected(id(31),null),'Profesor vacío se propaga');
  check((await rows('SELECT * FROM alumnos_entrenadores WHERE alumno_id=$1',[id(103)])).length,0,'Quitar profesor elimina solo relación vigente');
  await save(g,'Grupo',null,null);
  check(await tuple(103),expected(null,null),'Ambos vacíos se propagan');
  await student(104,g);
  check(await tuple(104),expected(null,null),'Alta en grupo incompleto permitida');
  const emptyRead=(await rows('SELECT * FROM rpc_obtener_grupos_con_entrenador($1)',[id(1)])).find(x=>x.id===g);
  check([emptyRead.horario_id,emptyRead.entrenador_id],[null,null],'La lectura no recupera profesor histórico');
  await save(g,'Grupo',id(30),id(11));
  const gg = (await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(103)])).grupo_gestion_id;
  await db.query('SELECT rpc_cambiar_entrenador_grupo($1,$2)',[gg,id(12)]);
  check(await tuple(103),expected(id(30),id(12)),'RPC alternativa propaga');
  check(await tuple(100),expected(id(30),id(12)),'Incluye alumnos que antes carecían de grupo_gestion_id');
  await db.query('SELECT rpc_asignar_entrenador_grupo($1,NULL)',[gg]);
  check(await tuple(103),expected(id(30),null),'RPC alternativa acepta profesor nulo');
  await save(g,'Grupo',id(31),id(12));
  await db.query('UPDATE alumnos SET horario_id=$1,profesor_asignado_id=$2 WHERE id=$3',[id(30),id(11),id(103)]);
  check(await tuple(103),expected(id(31),id(12)),'Formulario antiguo no repone la terna anterior');
  check(await tuple(101),archivedBefore,'Archivado conserva su ficha histórica');
  await db.query('UPDATE alumnos SET archivado=false WHERE id=$1',[id(101)]);
  check(await tuple(101),expected(id(31),id(12)),'Restaurar hereda configuración vigente');
  await db.query('UPDATE alumnos SET cancha_id=$1 WHERE id=$2',[target,id(103)]);
  check(await tuple(103),expected(id(31),id(12)),'Cambio de grupo desde ficha');
  check((await one('SELECT grupo_id FROM alumnos WHERE id=$1',[id(103)])).grupo_id,target,'Alias grupo/cancha consistente');
  const targetGG=(await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(103)])).grupo_gestion_id;
  await save(target,'Destino',null,null);
  const targetEmptyGG=(await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(103)])).grupo_gestion_id;
  await db.query("SELECT rpc_trasladar_alumno($1,$2,'prueba')",[id(104),targetEmptyGG]);
  check(await tuple(104),expected(null,null),'Traslado a grupo sin profesor ni horario');
  await rejects('SELECT rpc_asignar_entrenador_grupo($1,$2)',[targetGG,id(11)],'configuración vigente');
  await db.query('UPDATE alumnos SET cancha_id=NULL WHERE id=$1',[id(104)]);
  check((await one('SELECT grupo_id,horario_id,profesor_asignado_id,grupo_gestion_id FROM alumnos WHERE id=$1',[id(104)])),
    {grupo_id:null,horario_id:null,profesor_asignado_id:null,grupo_gestion_id:null},'Quitar grupo no conserva derivados anteriores');
  await db.query('INSERT INTO alumnos(id,escuela_id,nombres,profesor_asignado_id) VALUES($1,$2,$3,$4)',[id(105),id(1),'Legado',id(11)]);
  check((await one('SELECT cancha_id,profesor_asignado_id FROM alumnos WHERE id=$1',[id(105)])),{cancha_id:null,profesor_asignado_id:id(11)},'No infiere grupo de registros legados');
  await rejects('UPDATE alumnos SET cancha_id=$1 WHERE id=$2',[foreignGroup,id(103)],'no pertenece a la escuela');
  check(await one('SELECT * FROM alumnos WHERE id=$1',[id(102)]),foreignBefore,'Otra escuela intacta');
  check(await rows('SELECT * FROM asistencias_normales'),history,'Asistencias históricas intactas');
  await actor(14);
  await rejects('SELECT rpc_guardar_grupo_completo($1,$2,NULL,NULL,NULL)',[g,'Grupo'],'Solo un Administrador');
  await db.exec('SET ROLE authenticated');
  await student(106,g);
  check(await tuple(106),expected(id(31),id(12)),'Alta de asistente con RLS y trigger autorizado');
  await rejects('SELECT * FROM rpc_obtener_grupos_con_entrenador($1)',[id(2)],'otra escuela');
  check((await rows('SELECT id FROM alumnos WHERE escuela_id=$1',[id(2)])).length,0,'RLS no revela alumnos de otra escuela');
  await rejects('SELECT * FROM private.configuracion_vigente_grupo($1,$2)',[id(1),g],'permission denied');
  await db.exec('RESET ROLE');
  await actor(10);
  await db.exec('SET ROLE anon');
  await rejects('SELECT * FROM rpc_obtener_grupos_con_entrenador($1)',[id(1)],'permission denied');
  await db.exec('RESET ROLE');
  await db.query('UPDATE alumnos SET archivado=true WHERE id=$1',[id(103)]);
  check((await rows("SELECT id FROM alumnos_grupos WHERE alumno_id=$1 AND estado='activa'",[id(103)])).length,0,'Archivar cierra membresía sin borrar historia');
  // La gestión futura no cambia la ficha hasta activarse; NULL también es válido.
  const annualBefore = await tuple(100);
  const archivedAnnualBefore = await one('SELECT * FROM alumnos WHERE id=$1',[id(103)]);
  await db.query("INSERT INTO gestiones_deportivas(id,escuela_id,anio,estado) VALUES($1,$2,2027,'planificacion')",[id(200),id(1)]);
  await db.query("INSERT INTO grupos_gestion(id,escuela_id,gestion_id,grupo_id,sucursal_id,nombre_snapshot) VALUES($1,$2,$3,$4,$5,'Futuro')",[id(201),id(1),id(200),g,id(3)]);
  await db.query('SELECT rpc_asignar_entrenador_grupo($1,$2)',[id(201),id(11)]);
  check(await tuple(100),annualBefore,'Asignar profesor en planificación no cambia alumnos actuales');
  await db.query('SELECT rpc_asignar_entrenador_grupo($1,NULL)',[id(201)]);
  await db.query(`INSERT INTO alumnos_grupos(escuela_id,alumno_id,gestion_id,grupo_gestion_id,estado,decision)
    SELECT escuela_id,id,$1,$2,'planificada','migrara' FROM alumnos WHERE escuela_id=$3 AND archivado IS NOT TRUE`,[id(200),id(201),id(1)]);
  await db.query('SELECT * FROM rpc_activar_gestion($1)',[id(200)]);
  check(await tuple(100),expected(null,null),'Activar gestión sin horario ni entrenador mantiene sucursal');
  check(await one('SELECT * FROM alumnos WHERE id=$1',[id(103)]),archivedAnnualBefore,'Gestión anual conserva ficha archivada');
  check(await one('SELECT * FROM alumnos WHERE id=$1',[id(102)]),foreignBefore,'Gestión anual no modifica otra escuela');
  check(await rows('SELECT * FROM asistencias_normales'),history,'Gestión anual conserva asistencia histórica');
  check((await rows(`SELECT a.id FROM alumnos a WHERE a.escuela_id=$1 AND a.archivado IS NOT TRUE AND
    (a.grupo_gestion_id IS DISTINCT FROM $2 OR a.horario_id IS NOT NULL OR a.profesor_asignado_id IS NOT NULL)`,[id(1),id(201)])).length,0,'Todas las fichas activadas heredan la configuración vacía');
  await actor(null);
  await db.exec('ALTER TABLE alumnos DISABLE TRIGGER trg_sync_grupo_fuente_verdad; ALTER TABLE alumnos DISABLE TRIGGER trg_membresia_grupo_fuente_verdad;');
  await db.query('UPDATE alumnos SET grupo_gestion_id=NULL WHERE id=$1',[id(100)]);
  await db.exec('ALTER TABLE alumnos ENABLE TRIGGER trg_sync_grupo_fuente_verdad; ALTER TABLE alumnos ENABLE TRIGGER trg_membresia_grupo_fuente_verdad;');
  await db.query('UPDATE escuelas SET activa=false WHERE id=$1',[id(2)]);
  await db.exec('BEGIN');
  await db.exec(await fs.readFile(path.join(here,'regularizar.sql'),'utf8'));
  await db.exec('COMMIT');
  check((await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(100)])).grupo_gestion_id,id(201),'Regularización repara enlace vigente');
  check((await one('SELECT count(*)::int n FROM private.respaldo_grupo_20260930')).n,1,'Regularización respalda solo candidatos');
  await db.exec(await fs.readFile(path.join(here,'rollback.sql'),'utf8'));
  check((await one("SELECT count(*)::int n FROM pg_trigger WHERE tgname IN ('trg_sync_grupo_fuente_verdad','trg_membresia_grupo_fuente_verdad','trigger_sync_alumnos_entrenadores_update')")).n,0,'Reversión retira triggers nuevos');
  await db.exec('BEGIN');
  await db.exec(await fs.readFile(path.join(here,'revertir-regularizacion.sql'),'utf8'));
  await db.exec('COMMIT');
  check((await one('SELECT grupo_gestion_id FROM alumnos WHERE id=$1',[id(100)])).grupo_gestion_id,null,'Reversión recupera enlace anterior');
  console.log(`OK: ${checks} verificaciones de grupo como fuente de verdad.`);
} catch (error) {
  console.error({ checks, message: error.message, code: error.code, where: error.where });
  process.exitCode = 1;
} finally { await db.close(); }
