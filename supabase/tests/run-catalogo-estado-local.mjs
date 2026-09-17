// SOLO pruebas locales, sin conexiones de red ni credenciales.
import { readFile } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const modulePath = process.argv[2];
if (!modulePath) throw new Error('Indique la ruta a @electric-sql/pglite/dist/index.js');
const { PGlite } = await import(pathToFileURL(path.resolve(modulePath)).href);
const root = path.dirname(fileURLToPath(import.meta.url));
const db = new PGlite();
let stage = '';

try {
  for (const file of [
    'fixtures/inventario_base.sql',
    '../migrations/20260915131645_inventario_por_sucursal.sql',
    '../migrations/20260917173145_gestionar_estado_catalogo.sql',
    'test_catalogo_estado.sql',
  ]) {
    stage = file;
    await db.exec(await readFile(path.resolve(root, file), 'utf8'));
  }
  console.log('OK: gestión de catálogo validada en PostgreSQL embebido.');
} catch (error) {
  console.error('FALLO en ' + stage + ': ' + error.message);
  if (error.where) console.error(error.where);
  process.exitCode = 1;
} finally {
  await db.close();
}
