import {createRequire} from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const runtime=createRequire(path.resolve('scratch/cajas-runtime/package.json'));
const {chromium}=runtime('playwright');
const browser=await chromium.launch({channel:'msedge',headless:true});
const origin='https://127.0.0.1:5174';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const session={access_token:'fixture-token',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user:{id:id(101),email:'fixture@example.test',aud:'authenticated',role:'authenticated'}};
await fs.mkdir('scratch/cajas-ui',{recursive:true});
try {
 for(const [name,width,height] of [['desktop',1440,1000],['mobile',390,844]]) {
  const context=await browser.newContext({viewport:{width,height},ignoreHTTPSErrors:true});
  await context.addCookies([{name:'saasport-auth',value:encodeURIComponent(JSON.stringify(session)),url:origin}]);
  const page=await context.newPage(); const calls=[]; const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*.supabase.co/**',async route=> {
    const url=new URL(route.request().url());const endpoint=url.pathname.split('/').at(-1);
    let data=[];
    if(endpoint==='session-gate') data={ok:true};
    else if(endpoint==='usuarios') data={...session.user,nombres:'Prueba',apellidos:'Local',escuela_id:id(1),sucursal_id:null,rol:'SuperAdministrador',activo:true};
    else if(endpoint==='escuelas') data={id:id(1),nombre:'Escuela de prueba',activa:true,zona_horaria:'America/La_Paz'};
    else if(endpoint==='user') data=session.user;
    else if(endpoint==='cajas_bancos') data=[{id:id(21),nombre:'Banco Principal',saldo_actual:1200,activo:true,es_predeterminada:true,orden:1},{id:id(22),nombre:'Caja Secundaria',saldo_actual:300,activo:true,orden:2}];
    else if(endpoint==='rpc_listar_movimientos_caja') {
      const body=route.request().postDataJSON(); calls.push(body);
      const offset=body.p_cursor ? 50 : 0; const count=body.p_busqueda ? 1 : offset ? 10 : 50;
      data={grupos:Array.from({length:count},(_,n)=>({ids:[id(1000+offset+n)],origen:'cobro',saldo_historico:String(1200-offset-n)})),hay_mas:!offset&&!body.p_busqueda,cursor_siguiente:!offset?{dia:'2026-10-05',registro:'2026-10-05T12:00:00Z',id:id(1049),origen:'cobro',filtro:'fixture'}:null};
    } else if(endpoint==='cobros_aplicados') {
      const ids=url.searchParams.get('id').replace(/^in\.\(|\)$/g,'').split(',').map(s=>s.replaceAll('"',''));
      data=ids.map((key,n)=>({id:key,monto_aplicado:1,fecha:'2026-10-05T12:00:00Z',created_at:`2026-10-05T12:00:${String(n).padStart(2,'0')}Z`,caja_id:url.searchParams.get('caja_id').slice(3),documento_referencia:'Efectivo',conciliado:false,cuentas_cobrar:{id:id(51),descripcion:'Ingreso',es_ingreso_directo:true,cxc_detalle:[{catalogo_items:{nombre:'Alquiler'}}]}}));
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin+'/cajas-bancos');
  try {
    await page.getByText('Página 1 · 50 movimientos',{exact:true}).waitFor({timeout:20000});
    assert(calls.every(c=>c.p_caja_id===id(21)),'only default account requested');
    await page.getByRole('button',{name:'Siguiente',exact:true}).click();
    await page.getByText('Página 2 · 10 movimientos',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Anterior',exact:true}).click();
    await page.getByText('Página 1 · 50 movimientos',{exact:true}).waitFor();
    await page.getByRole('button',{name:/Caja Secundaria/}).click();
    await page.waitForFunction(()=>document.querySelector('[aria-pressed="true"]')?.textContent.includes('Caja Secundaria'));
    await page.getByText('Página 1 · 50 movimientos',{exact:true}).waitFor();
    assert(calls.some(c=>c.p_caja_id===id(22)&&c.p_cursor===null),'account resets cursor');
    if(name==='desktop') {
      await page.getByRole('button',{name:'Siguiente',exact:true}).click();
      await page.getByText('Página 2 · 10 movimientos',{exact:true}).waitFor();
      await page.getByPlaceholder('Buscar por cuenta, alumno, proveedor...').fill('Jose');
      await page.getByText('Página 1 · 1 movimientos',{exact:true}).waitFor();
      assert(calls.at(-1).p_cursor===null&&calls.at(-1).p_busqueda==='Jose','search resets cursor and reaches server');
      assert(await page.getByRole('button',{name:'Siguiente',exact:true}).isDisabled());
      await page.getByPlaceholder('Buscar por cuenta, alumno, proveedor...').fill('');
      await page.getByText('Página 1 · 50 movimientos',{exact:true}).waitFor();
    }
    await page.screenshot({path:`scratch/cajas-ui/${name}.png`,fullPage:true});
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({viewport:name,status:'passed',rpcCalls:calls.length}));
  } catch(e) {await page.screenshot({path:`scratch/cajas-ui/${name}-error.png`,fullPage:true});console.error((await page.locator('body').innerText()).slice(0,1500));throw e;}
  await context.close();
 }
} finally {await browser.close();}
