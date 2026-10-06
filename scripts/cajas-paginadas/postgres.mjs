// Isolated PostgreSQL integration test. Runtime dependencies live outside the app.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
const runtimePath = path.resolve(process.argv[2] || 'scratch/cajas-runtime');
const runtime = createRequire(path.join(runtimePath,'package.json'));
const binaries = await import(pathToFileURL(runtime.resolve('@embedded-postgres/windows-x64')));
const data = path.join(runtimePath,`db-${Date.now()}`);
const port = 55439;
const run = (file,args) => new Promise((resolve,reject) => {
  const child=spawn(file,args,{windowsHide:true}); let output='';
  child.stdout.on('data',d=>output+=d); child.stderr.on('data',d=>output+=d);
  child.on('error',reject); child.on('exit',code=>code===0 ? resolve(output) : reject(new Error(output)));
});
await fs.mkdir(data,{recursive:true});
await run(binaries.initdb,['-D',data,'-U','postgres','-A','trust','--encoding=UTF8','--no-locale']);
let started=false;
try {
  await run(binaries.pg_ctl,['-D',data,'-l',path.join(data,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
  started=true;
  process.env.CAJAS_TEST_POSTGRES=`postgresql://postgres@127.0.0.1:${port}/postgres`;
  process.argv[2]=runtimePath;
  await import('./test.mjs');
  if (!process.exitCode && process.env.CAJAS_BENCHMARK) await import('./benchmark.mjs');
  if (!process.exitCode) {
    const {Client}=runtime('pg');
    const client=new Client({connectionString:process.env.CAJAS_TEST_POSTGRES});
    await client.connect();
    try {
      await client.query(await fs.readFile('supabase/rollback/20261006002133_saldos_caja_incrementales.sql','utf8'));
      await client.query(await fs.readFile('supabase/rollback/20261006002131_movimientos_caja_paginados.sql','utf8'));
      const result=await client.query("SELECT to_regprocedure('public.rpc_listar_movimientos_caja(uuid,timestamptz,timestamptz,text,jsonb,integer)') IS NULL ok");
      if(!result.rows[0].ok) throw new Error('Rollback did not remove page RPC');
      console.log(JSON.stringify({rollback:'passed'}));
    } finally {await client.end();}
  }
} finally { if(started) await run(binaries.pg_ctl,['-D',data,'-m','fast','-w','stop']); }
