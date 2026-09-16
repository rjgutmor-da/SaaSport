// SOLO pruebas locales, sin conexiones de red ni credenciales.
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
const modulePath = process.argv[2];
if (!modulePath) throw new Error('Indique la ruta a @electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
const root = path.dirname(fileURLToPath(import.meta.url));
const notices = [];
const onNotice = n => {
  if (/PASADA|PASARON|INICIANDO/.test(n.message)) {
    notices.push(n.message);
    console.log(n.message);
  }
};
const db = new PGlite();
let stage = '';
try {
  for (const file of [
    'fixtures/inventario_base.sql',
    process.argv[3] || '../migrations/20260915131645_inventario_por_sucursal.sql',
    'test_inventario_suite.sql'
  ]) {
    stage = file;
    await db.exec(await readFile(path.resolve(root, file), 'utf8'), { onNotice });
  }
  const [{ count }] = (await db.query('SELECT count(*) FROM public.escuelas')).rows;
  if (Number(count) !== 0) throw new Error('El ROLLBACK no eliminó los datos de prueba');
  if (!notices.some(n => n.includes('TODAS LAS PRUEBAS'))) {
    throw new Error('No se recibió la confirmación final de la suite');
  }
  console.log('OK: suite ejecutada y ROLLBACK verificado. Avisos de éxito: ' + notices.length);
} catch (error) {
  console.error('FALLO en ' + stage + ': ' + error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
