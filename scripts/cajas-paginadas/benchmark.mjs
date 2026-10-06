import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
const runtime=createRequire(path.resolve(process.argv[2],'package.json'));
const {Client}=runtime('pg');
const db=new Client({connectionString:process.env.CAJAS_TEST_POSTGRES});await db.connect();
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const measure=async fn=>{const samples=[];for(let n=0;n<22;n++){const start=performance.now();await fn(n);if(n>1)samples.push(performance.now()-start);}samples.sort((a,b)=>a-b);return {median_ms:+samples[10].toFixed(2),p95_ms:+samples[18].toFixed(2)};};
const old=await fs.readFile('supabase/rollback/20261006002133_saldos_caja_incrementales.sql','utf8');
const fresh=await fs.readFile('supabase/migrations/20261006002133_saldos_caja_incrementales.sql','utf8');
const triggerOnly=sql=>sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.fn_actualizar_saldo_caja_v2'),sql.indexOf('CREATE OR REPLACE FUNCTION public.rpc_eliminar_movimiento_aplicado'));
try {
 await db.query(`CREATE INDEX ON cobros_aplicados(caja_id,fecha DESC,created_at DESC);CREATE INDEX ON pagos_aplicados(caja_id,fecha DESC,created_at DESC);CREATE INDEX ON cxc_detalle(cuenta_cobrar_id);CREATE INDEX ON cxp_detalle(cuenta_pagar_id);`);
 for(const count of [1000,10000]) {
  await db.query(`TRUNCATE cobros_aplicados,pagos_aplicados;UPDATE cajas_bancos SET saldo_actual=0;
   INSERT INTO cobros_aplicados(id,escuela_id,cuenta_cobrar_id,caja_id,fecha,created_at,monto_aplicado,documento_referencia)
   SELECT md5('benchmark-'||i)::uuid,'${id(1)}','${id(51)}','${id(21)}','2026-10-05'::timestamptz-i*interval '1 minute','2026-10-05'::timestamptz-i*interval '1 minute',10,'Efectivo' FROM generate_series(1,${count}) i;
   ANALYZE;`);
  const update=n=>db.query(`UPDATE cobros_aplicados SET monto_aplicado=$1 WHERE id=md5('benchmark-1')::uuid`,[10+n%2]);
  const incremental=await measure(update);
  await db.query(triggerOnly(old));const historical=await measure(update);
  await db.query(triggerOnly(fresh));
  await db.query(`SELECT set_config('request.jwt.claim.sub','${id(101)}',false);SET ROLE authenticated;`);
  const page=await measure(()=>db.query('select rpc_listar_movimientos_caja($1)',[id(21)]));
  const search=await measure(()=>db.query("select rpc_listar_movimientos_caja($1,null,null,'jose mensualidad')",[id(21)]));
  await db.query('RESET ROLE');
  console.log(JSON.stringify({movements:count,update_before:historical,update_after:incremental,page,search}));
 }
} finally {await db.end();}
