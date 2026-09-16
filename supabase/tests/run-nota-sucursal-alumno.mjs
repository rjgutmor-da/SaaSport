// PostgreSQL aislado: no conecta a Supabase ni escribe datos reales.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const { PGlite } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const db = new PGlite();
let checks = 0;
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const rejects = async (fn, pattern) => { await assert.rejects(fn, pattern); checks++; };
try {
  for (const file of ['fixtures/inventario_base.sql','../migrations/20260915131645_inventario_por_sucursal.sql','../migrations/20260916135117_nota_cxc_sucursal_alumno.sql']) {
    await db.exec(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  const [school, other, a, b, foreign, studentA, studentB, studentNone, studentOther, superId, adminMulti, adminA, assistantA, assistantMulti] = Array.from({length:14},randomUUID);
  await q('insert into escuelas(id,nombre) values ($1,$2),($3,$4)',[school,'Prueba',other,'Otra']);
  await q('insert into sucursales(id,escuela_id,nombre) values ($1,$2,$3),($4,$2,$5),($6,$7,$8)',[a,school,'A',b,'B',foreign,other,'Externa']);
  for (const [id,role,branch] of [[superId,'SuperAdministrador',a],[adminMulti,'Administrador',null],[adminA,'Administrador',a],[assistantA,'Asistente',a],[assistantMulti,'Asistente',null]]) {
    await q('insert into auth.users(id) values ($1)',[id]);
    await q('insert into usuarios(id,escuela_id,rol,sucursal_id,activo) values ($1,$2,$3,$4,true)',[id,school,role,branch]);
  }
  for (const [id,sch,branch] of [[studentA,school,a],[studentB,school,b],[studentNone,school,null],[studentOther,other,foreign]]) {
    await q('insert into alumnos(id,escuela_id,sucursal_id,nombres) values ($1,$2,$3,$4)',[id,sch,branch,'Prueba']);
  }
  const product = randomUUID(), service = randomUUID();
  await q("update catalogo_items set activo=false where escuela_id=$1 and categoria='producto'",[school]);
  await q("insert into catalogo_items(id,escuela_id,nombre,tipo,categoria,precio_venta) values ($1,$2,'Producto prueba','producto','producto',10),($3,$2,'Servicio prueba','servicio','servicio',10)",[product,school,service]);
  const login = id => q("select set_config('request.jwt.claim.sub',$1,false)",[id]);
  // Datos de otra escuela para que las pruebas RLS detecten filtraciones reales.
  const foreignActor = randomUUID();
  await q('insert into auth.users(id) values ($1)',[foreignActor]);
  await q("insert into usuarios(id,escuela_id,rol,activo) values ($1,$2,'SuperAdministrador',true)",[foreignActor,other]);
  await q('insert into inventario_aperturas(escuela_id,sucursal_id,abierto_por) values ($1,$2,$3)',[other,foreign,foreignActor]);
  const foreignProduct = (await q("select id from catalogo_items where escuela_id=$1 and categoria='producto' limit 1",[other]))[0].id;
  await q('insert into inventario_saldos(escuela_id,sucursal_id,catalogo_item_id,cantidad_disponible) values ($1,$2,$3,99)',[other,foreign,foreignProduct]);
  await login(superId);
  for (const branch of [a,b]) await q('select rpc_confirmar_apertura_inventario($1,$2::jsonb)',[branch,JSON.stringify([{catalogo_item_id:product,cantidad:0}])]);
  const save = async ({student=studentA,branch=null,item=service,note=null,op=randomUUID(),quantity=1,mixed=false}={}) => (await q('select rpc_guardar_nota_cxc(p_nota_id:=$1,p_alumno_id:=$2,p_sucursal_id:=$3,p_monto_total:=$6,p_lineas:=$4::jsonb,p_operacion_id:=$5) id',[note,student,branch,JSON.stringify([{catalogo_item_id:item,cantidad:quantity,precio_unitario:10},...(mixed ? [{catalogo_item_id:service,cantidad:1,precio_unitario:10}] : [])]),op,10 * quantity + (mixed ? 10 : 0)]))[0].id;
  const branchOf = async id => (await q('select sucursal_id from cuentas_cobrar where id=$1',[id]))[0].sucursal_id;
  for (const actor of [superId,adminMulti,assistantMulti]) {
    await login(actor);
    eq(await branchOf(await save({student:studentB})),b,'Usa sucursal del alumno sin enviar sucursal');
    eq(await branchOf(await save({student:studentB,branch:a})),b,'Servicios no aceptan cambiar sucursal del alumno');
  }
  await login(adminMulti);
  const operation = randomUUID();
  const sale = await save({branch:b,item:product,op:operation});
  eq(await branchOf(sale),b,'Administrador multisucursal elige origen de productos');
  eq((await q('select cantidad_disponible from inventario_saldos where sucursal_id=$1 and catalogo_item_id=$2',[b,product]))[0].cantidad_disponible,-1,'Permite venta negativa en sucursal elegida');
  eq(await save({branch:b,item:product,op:operation}),sale,'Reintento conserva nota');
  eq((await q('select count(*)::int n from inventario_movimientos where referencia_id=$1',[sale]))[0].n,1,'No duplica stock en reintento');
  await save({note:sale,branch:a,item:product});
  eq(await branchOf(sale),b,'Editar conserva sucursal original');
  const stockBefore = (await q('select cantidad_disponible from inventario_saldos where sucursal_id=$1 and catalogo_item_id=$2',[b,product]))[0].cantidad_disponible;
  const notesBefore = (await q('select count(*)::int n from cuentas_cobrar'))[0].n;
  for (const actor of [superId,adminMulti,assistantMulti]) {
    await login(actor);
    await rejects(()=>save({branch:b,item:product,mixed:true}),/No se pueden mezclar servicios y productos/);
  }
  await login(adminMulti);
  await rejects(()=>save({note:sale,branch:a,item:product,mixed:true}),/No se pueden mezclar servicios y productos/);
  eq((await q('select count(*)::int n from cuentas_cobrar'))[0].n,notesBefore,'Rechazo mixto no crea notas');
  eq((await q('select cantidad_disponible from inventario_saldos where sucursal_id=$1 and catalogo_item_id=$2',[b,product]))[0].cantidad_disponible,stockBefore,'Rechazo mixto no altera stock');
  eq((await q('select count(*)::int n from cxc_detalle where cuenta_cobrar_id=$1',[sale]))[0].n,1,'Rechazo al editar conserva detalle original');
  eq(await branchOf(await save({branch:a,item:product,mixed:true})),a,'Permite nota mixta en sucursal del alumno');
  eq(await branchOf(await save({student:studentNone,branch:a,item:product,mixed:true})),a,'Alumno sin sucursal puede usar una sucursal común elegida');
  await rejects(()=>save({note:sale,student:studentB,item:product}),/No se puede cambiar el alumno/);
  await rejects(()=>save({student:studentOther}),/Alumno inválido/);
  await rejects(()=>save({branch:foreign,item:product}),/Sucursal inválida/);
  await rejects(()=>save({student:studentNone}),/Selecciona una sucursal/);
  eq(await branchOf(await save({student:studentNone,branch:b})),b,'Alumno sin sucursal usa selección explícita');
  eq(await branchOf(await save({student:studentB,item:product})),b,'Producto sin origen explícito usa sucursal del alumno');
  await rejects(()=>save({student:studentNone,item:product}),/Selecciona una sucursal/);
  const unopened = randomUUID();
  await q('insert into sucursales(id,escuela_id,nombre) values ($1,$2,$3)',[unopened,school,'Sin apertura']);
  await rejects(()=>save({branch:unopened,item:product}),/conteo inicial/);
  const historic = randomUUID();
  await q('insert into cuentas_cobrar(id,escuela_id,alumno_id,monto_total) values ($1,$2,$3,10)',[historic,school,studentA]);
  await save({note:historic,branch:b});
  eq(await branchOf(historic),null,'Edición histórica conserva sucursal nula');
  for (const actor of [adminA,assistantA]) {
    await login(actor);
    eq(await branchOf(await save()),a,'Usuario fijo toma sucursal de alumno autorizado');
    await rejects(()=>save({student:studentB}),/No autorizado/);
    await rejects(()=>save({branch:b,item:product}),/No autorizado/);
  }
  // RLS real en PostgreSQL local: alcance por escuela y sucursal.
  await db.exec('grant usage on schema public,private,auth to authenticated;');
  for (const [actor,expected] of [[adminMulti,2],[assistantMulti,2],[adminA,1],[assistantA,1]]) {
    await login(actor);
    await db.exec('set role authenticated');
    eq((await q('select count(*)::int n from inventario_aperturas'))[0].n,expected,'Aperturas visibles por alcance');
    eq((await q('select count(distinct sucursal_id)::int n from inventario_saldos'))[0].n,expected,'Saldos visibles por alcance');
    await db.exec('reset role');
  }
  await q('update usuarios set activo=false where id=$1',[adminMulti]);
  await login(adminMulti);
  await rejects(()=>save(),/No autorizado/);
  console.log(`OK: ${checks} comprobaciones de sucursal, permisos, inventario e idempotencia.`);
} catch (error) {
  console.error(error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally { await db.close(); }
