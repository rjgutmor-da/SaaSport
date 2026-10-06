import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';
const runtime = createRequire(path.resolve(process.argv[2] || '../outputs/attendance-test-runtime', 'package.json'));
let db;
if (process.env.CAJAS_TEST_POSTGRES) {
  const { Client } = runtime('pg');
  db = new Client({connectionString:process.env.CAJAS_TEST_POSTGRES});
  await db.connect();
  db.exec = sql => db.query(sql);
  db.close = () => db.end();
} else {
  const { PGlite } = runtime('@electric-sql/pglite');
  db = new PGlite();
}
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const rows = async (sql,args=[]) => (await db.query(sql,args)).rows;
let checks=0;
const check = (a,b,label) => {assert.deepEqual(a,b,label); checks++;};
const actor = async n => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${id(n)}',false); SET ROLE authenticated;`);
const rejected = async (sql,args=[]) => {await assert.rejects(()=>db.query(sql,args)); checks++;};
const read = name => fs.readFile(`supabase/migrations/${name}`,'utf8');
const page = async (cursor=null, search=null, caja=id(21), desde=null,hasta=null) =>
  (await rows('select rpc_listar_movimientos_caja($1,$2,$3,$4,$5,50) p',[caja,desde,hasta,search,cursor]))[0].p;
try {
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
      $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE usuarios(id uuid primary key,escuela_id uuid,activo boolean,rol text,sucursal_id uuid);
    CREATE TABLE cajas_bancos(id uuid primary key,escuela_id uuid,sucursal_id uuid,cuenta_contable_id uuid,
      nombre text,tipo text,activo boolean default true,responsable text,orden int,es_predeterminada boolean,saldo_actual numeric default 0);
    CREATE TABLE alumnos(id uuid primary key,escuela_id uuid,sucursal_id uuid,nombres text,apellidos text);
    CREATE TABLE proveedores(id uuid primary key,nombre text);
    CREATE TABLE personal(id uuid primary key,nombres text,apellidos text);
    CREATE TABLE catalogo_items(id uuid primary key,nombre text);
    CREATE TABLE cuentas_cobrar(id uuid primary key,escuela_id uuid,sucursal_id uuid,alumno_id uuid,
      descripcion text,nro_recibo text,monto_total numeric default 100000,estado text);
    CREATE TABLE cuentas_pagar(id uuid primary key,escuela_id uuid,proveedor_id uuid,personal_id uuid,
      descripcion text,monto_total numeric default 100000,estado text);
    CREATE TABLE cxc_detalle(id uuid primary key,escuela_id uuid,cuenta_cobrar_id uuid,catalogo_item_id uuid);
    CREATE TABLE cxp_detalle(id uuid primary key,escuela_id uuid,cuenta_pagar_id uuid,catalogo_item_id uuid);
    CREATE TABLE cobros_aplicados(id uuid primary key,escuela_id uuid,cuenta_cobrar_id uuid,caja_id uuid,
      fecha timestamptz,created_at timestamptz,monto_aplicado numeric(12,2),documento_referencia text,es_aplicacion_anticipo boolean,conciliado boolean);
    CREATE TABLE pagos_aplicados(id uuid primary key,escuela_id uuid,cuenta_pagar_id uuid,caja_id uuid,
      fecha timestamptz,created_at timestamptz,monto_aplicado numeric(12,2),referencia text,es_aplicacion_anticipo boolean,conciliado boolean);
    INSERT INTO usuarios VALUES('${id(101)}','${id(1)}',true,'SuperAdministrador',null),
      ('${id(102)}','${id(1)}',true,'Administrador','${id(11)}'),
      ('${id(103)}','${id(2)}',true,'SuperAdministrador',null),
      ('${id(104)}','${id(1)}',false,'Administrador','${id(11)}'),
      ('${id(105)}','${id(1)}',true,'Entrenador','${id(11)}');
    INSERT INTO cajas_bancos(id,escuela_id,nombre) VALUES('${id(21)}','${id(1)}','Caja uno'),('${id(22)}','${id(1)}','Caja dos'),('${id(23)}','${id(2)}','Ajena');
    INSERT INTO alumnos VALUES('${id(31)}','${id(1)}','${id(11)}','José','Pérez'),('${id(32)}','${id(1)}','${id(12)}','Otra','Sucursal');
    INSERT INTO catalogo_items VALUES('${id(41)}','Mensualidad'),('${id(42)}','Uniforme');
    INSERT INTO cuentas_cobrar(id,escuela_id,sucursal_id,alumno_id,descripcion) VALUES
      ('${id(51)}','${id(1)}','${id(11)}','${id(31)}','Cuota'),('${id(52)}','${id(1)}','${id(12)}','${id(32)}','Cuota');
    INSERT INTO cuentas_pagar(id,escuela_id,descripcion) VALUES('${id(61)}','${id(1)}','Alquiler');
    INSERT INTO cxc_detalle VALUES('${id(71)}','${id(1)}','${id(51)}','${id(41)}');
    GRANT USAGE ON SCHEMA public,private,auth TO authenticated,anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    CREATE FUNCTION private.escuela() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT escuela_id FROM public.usuarios WHERE id=auth.uid()$$;
    CREATE FUNCTION private.sucursal() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT sucursal_id FROM public.usuarios WHERE id=auth.uid()$$;
    ALTER TABLE cajas_bancos ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cajas ON cajas_bancos USING(escuela_id=(select private.escuela()));
    ALTER TABLE cuentas_cobrar ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notas ON cuentas_cobrar USING(escuela_id=(select private.escuela()) AND ((select private.sucursal()) IS NULL OR sucursal_id=(select private.sucursal())));
    ALTER TABLE cobros_aplicados ENABLE ROW LEVEL SECURITY;
    CREATE POLICY cobros ON cobros_aplicados USING(escuela_id=(select private.escuela()) AND EXISTS(select 1 from cuentas_cobrar cc where cc.id=cuenta_cobrar_id));
    ALTER TABLE pagos_aplicados ENABLE ROW LEVEL SECURITY;
    CREATE POLICY pagos ON pagos_aplicados USING(escuela_id=(select private.escuela()));
  `);
  await db.exec(await read('20261006002131_movimientos_caja_paginados.sql'));
  await db.exec(await read('20261006002133_saldos_caja_incrementales.sql'));
  await db.exec(`CREATE TRIGGER saldo_c AFTER INSERT OR UPDATE OR DELETE ON cobros_aplicados FOR EACH ROW EXECUTE FUNCTION fn_actualizar_saldo_caja_v2();
    CREATE TRIGGER saldo_p AFTER INSERT OR UPDATE OR DELETE ON pagos_aplicados FOR EACH ROW EXECUTE FUNCTION fn_actualizar_saldo_caja_v2();
    INSERT INTO cobros_aplicados(id,escuela_id,cuenta_cobrar_id,caja_id,fecha,created_at,monto_aplicado,documento_referencia)
    SELECT ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'${id(1)}','${id(51)}','${id(21)}',
      '2026-10-05 12:00Z'::timestamptz - n*interval '1 minute','2026-10-05 12:00Z'::timestamptz - n*interval '1 minute',10,'QR'
    FROM generate_series(1001,1120) n;
    INSERT INTO cobros_aplicados VALUES('${id(2001)}','${id(1)}','${id(51)}','${id(21)}','2026-10-04 18:55:30Z','2026-10-04 18:55:30Z',20,'RECIBO-MULTIPLE',false,false),
      ('${id(2002)}','${id(1)}','${id(51)}','${id(21)}','2026-10-04 18:55:30Z','2026-10-04 18:55:30Z',30,'RECIBO-MULTIPLE',false,false),
      ('${id(2003)}','${id(1)}','${id(52)}','${id(21)}','2026-10-05 20:00Z','2026-10-05 20:00Z',100,'OTRA-SUCURSAL',false,false);
    INSERT INTO pagos_aplicados VALUES('${id(3001)}','${id(1)}','${id(61)}','${id(21)}','2026-10-04 19:00Z','2026-10-04 19:00Z',25,'PAGO',false,false);
  `);
  const verifyBalances=async()=>{
    const bad=await rows(`SELECT id FROM cajas_bancos cb WHERE cb.saldo_actual IS DISTINCT FROM
      (COALESCE((select sum(monto_aplicado) from cobros_aplicados where caja_id=cb.id),0)-COALESCE((select sum(monto_aplicado) from pagos_aplicados where caja_id=cb.id),0))`);
    check(bad.length,0,'saldo exacto contra historial completo');
  };
  await verifyBalances();
  await actor(101);
  let cursor=null,all=[],pages=0;
  do {const p=await page(cursor); check(p.grupos.length<=50,true,'limite estricto'); all.push(...p.grupos); cursor=p.cursor_siguiente; pages++;} while(cursor);
  check(pages,3,'tres paginas');
  check(all.length,123,'agrupacion antes de paginar');
  const rawIds=all.flatMap(g=>g.ids);
  check(new Set(rawIds).size,124,'sin omisiones ni duplicados');
  let expected=1325;
  for(const g of all){
    check(Number(g.saldo_historico),expected,'saldo de cada fila entre paginas');
    const table=g.origen==='cobro'?'cobros_aplicados':'pagos_aplicados';
    const amount=Number((await rows(`select sum(monto_aplicado) n from ${table} where id=any($1::uuid[])`,[g.ids]))[0].n);
    expected-=g.origen==='cobro'?amount:-amount;
  }
  check(expected,0,'saldo de apertura');
  const search=await page(null,'jose mensualidad');
  check(search.grupos.length,50,'busqueda normalizada antes de paginacion');
  const group=await page(null,'recibo-multiple');
  check(group.grupos[0].ids.length,2,'grupo completo');
  check(group.grupos[0].saldo_historico,all.find(g=>g.ids.includes(id(2001))).saldo_historico,'buscar no modifica saldo');
  await rejected('select rpc_listar_movimientos_caja($1,null,null,$2,$3,50)',[id(21),'otro',search.cursor_siguiente]);
  const ranged=await page(null,null,id(21),'2026-10-04 18:55:29Z','2026-10-04 18:55:31Z');
  check(ranged.grupos.length,1,'rango exacto');
  check(ranged.grupos[0].saldo_historico,group.grupos[0].saldo_historico,'rango no reinicia saldo');
  await actor(102);
  const limited=await page();
  check(limited.grupos.some(g=>g.ids.includes(id(2003))),false,'RLS sucursal');
  check(limited.grupos[0].saldo_historico,all[1].saldo_historico,'saldo completo sin revelar detalle oculto');
  await rejected('select rpc_listar_movimientos_caja($1)',[id(23)]);
  await rejected('select * from private.saldos_movimientos_caja($1,$2)',[id(23),[]]);
  await rejected('update cajas_bancos set saldo_actual=999 where id=$1',[id(21)]);
  await rejected("insert into cajas_bancos(id,escuela_id,saldo_actual) values($1,$2,100)",[id(25),id(1)]);
  for (const n of [103,104,105]) {await actor(n); await rejected('select rpc_listar_movimientos_caja($1)',[id(21)]);}
  await db.exec('RESET ROLE; SET ROLE anon;');
  await rejected('select rpc_listar_movimientos_caja($1)',[id(21)]);
  await db.exec('RESET ROLE');
  await db.exec(`UPDATE cobros_aplicados SET monto_aplicado=-5 WHERE id='${id(1001)}';`);
  await verifyBalances();
  await db.exec(`UPDATE cobros_aplicados SET caja_id='${id(22)}',monto_aplicado=15 WHERE id='${id(1001)}';`);
  await verifyBalances();
  await db.exec(`UPDATE pagos_aplicados SET monto_aplicado=3000 WHERE id='${id(3001)}';`);
  await verifyBalances();
  const before=(await rows(`SELECT saldo_actual FROM cajas_bancos WHERE id='${id(21)}'`))[0].saldo_actual;
  await db.exec(`UPDATE cobros_aplicados SET conciliado=true,fecha='2026-09-01' WHERE id='${id(1002)}';`);
  check((await rows(`SELECT saldo_actual FROM cajas_bancos WHERE id='${id(21)}'`))[0].saldo_actual,before,'conciliacion y fecha sin efecto monetario');
  await actor(101);
  await db.query('select rpc_eliminar_movimiento_aplicado($1,$2)',[id(3001),'pago']);
  await db.exec('RESET ROLE');
  await verifyBalances();
  await actor(101);
  await db.query('select rpc_eliminar_movimiento_aplicado($1,$2)',[id(1001),'cobro']);
  await db.exec('RESET ROLE');
  await verifyBalances();
  await db.exec(`BEGIN; DELETE FROM cobros_aplicados; ROLLBACK;`);
  await verifyBalances();
  if (process.env.CAJAS_TEST_POSTGRES) {
    const { Client } = runtime('pg');
    const connections = await Promise.all(Array.from({length:8}, async () => {
      const client = new Client({connectionString:process.env.CAJAS_TEST_POSTGRES});
      await client.connect(); return client;
    }));
    try {
      await Promise.all(connections.map((client,n) => client.query(`
        INSERT INTO cobros_aplicados(id,escuela_id,cuenta_cobrar_id,caja_id,fecha,created_at,monto_aplicado)
        SELECT md5('concurrent-${n}-'||i)::uuid,'${id(1)}','${id(51)}','${id(21)}',now(),now(),1.25 FROM generate_series(1,30) i;
      `)));
      await verifyBalances();
      check((await rows("SELECT count(*)::int n FROM cobros_aplicados WHERE monto_aplicado=1.25"))[0].n,240,'concurrent inserts');
      await Promise.all(connections.map((client,n) => client.query(`
        UPDATE cobros_aplicados SET caja_id='${id(22)}' WHERE id=md5('concurrent-${n}-1')::uuid;
      `)));
      await verifyBalances();
      await Promise.all(connections.map((client,n) => client.query(`
        UPDATE cobros_aplicados SET caja_id=CASE WHEN caja_id='${id(21)}' THEN '${id(22)}'::uuid ELSE '${id(21)}'::uuid END
        WHERE id=md5('concurrent-${n}-${n % 2 ? 1 : 2}')::uuid;
      `)));
      await verifyBalances();
      await Promise.all(connections.map((client,n) => client.query(`DELETE FROM cobros_aplicados WHERE id=md5('concurrent-${n}-3')::uuid;`)));
      await verifyBalances();
    } finally { await Promise.all(connections.map(c=>c.end())); }
  }
  console.log(JSON.stringify({engine:process.env.CAJAS_TEST_POSTGRES ? 'PostgreSQL' : 'PGlite',checks,status:'passed'}));
} catch(error) { console.error(error.message, error.detail || '', error.where || '', error.stack?.split('\n').slice(1,3).join('\n') || ''); process.exitCode=1; } finally {await db.close();}
