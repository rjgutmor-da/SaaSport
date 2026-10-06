# Cajas: paginación y saldos incrementales

La pantalla carga la cuenta predeterminada (o primera activa) y hasta 50 movimientos lógicos. Las transferencias agrupadas permanecen completas. El servidor aplica búsqueda, fechas y cursor antes de devolver la página; el saldo histórico no depende de esos filtros. Copiar y conciliar se limitan a la página visible. El recibo carga cantidades, precios y contacto al solicitarlo.

Las migraciones son independientes: primero la RPC de lectura, después el trigger incremental y la eliminación sin doble ajuste. No hay cambios de cron.

## Verificación del 5 de octubre de 2026 (Bolivia)

- TypeScript y build Vite correctos; advertencia existente de bundle mayor a 500 kB.
- 159 comprobaciones en PostgreSQL 17.6 aislado: agrupación, páginas sin omisiones, filtros, saldo histórico, restricciones de escuela/sucursal/rol, edición del saldo bloqueada, ajustes negativos, cambio de caja y concurrencia con ocho conexiones.
- Navegador con respuestas simuladas: PC 1440×1000 y móvil 390×844, una cuenta consultada, siguiente/anterior, reinicio por cambio de cuenta y búsqueda; sin errores JavaScript.
- Ambas migraciones aplicadas a `uqrmmotcbnyazmadzfvd`.
- RPC real bajo el Administrador afectado: 50 movimientos, siguiente página disponible; una ejecución de base de datos de 124,48 ms (no incluye red ni renderizado).
- Prueba transaccional real, revertida: ajuste de cobro, modificación, conciliación, rechazo de saldo manual y borrado como Administrador, borrado permitido como SuperAdministrador sin doble ajuste.
- Auditoría antes/después: 50 cuentas, cero diferencias contra cobros menos pagos. No se corrigieron saldos ni quedaron movimientos de prueba.

Mediciones locales, 20 muestras después de dos calentamientos, milisegundos:

| Movimientos | Actualización anterior mediana/p95 | Incremental mediana/p95 | Página mediana/p95 | Búsqueda mediana/p95 |
|---|---|---|---|---|
| 1.000 | 3,57 / 4,01 | 1,42 / 1,90 | 68,62 / 121,17 | 116,34 / 220,85 |
| 10.000 | 9,74 / 14,59 | 2,32 / 3,82 | 512,72 / 670,22 | 1284,34 / 1585,47 |

Estas cifras miden SQL en un esquema de pruebas con RLS, no la latencia total del usuario. La página todavía agrupa registros de la cuenta en el servidor; para volúmenes mucho mayores, medir antes de prometer tiempo constante. La mejora de carga del cliente proviene de consultar una cuenta y 50 grupos en vez de todas las cuentas y hasta 200 movimientos por cuenta.

## Reproducir

Las dependencias de prueba quedan en `scratch/`, fuera del package.json de la aplicación:

```powershell
npm install --prefix scratch/cajas-runtime --no-audit --no-fund embedded-postgres@17.6.0-beta.15 pg@8.23.1 playwright@1.63.0
node scripts/cajas-paginadas/postgres.mjs
$env:CAJAS_BENCHMARK='1'; node scripts/cajas-paginadas/postgres.mjs
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174
node scripts/cajas-paginadas/ui.mjs
```

El runner PostgreSQL para Windows abre únicamente 127.0.0.1:55439 y cierra el servidor al terminar. El runner UI usa Edge instalado y simula Supabase; no inicia sesiones ni modifica datos reales. PGlite opcional: `node scripts/cajas-paginadas/test.mjs <directorio-runtime-con-pglite>`.

## Reversión

Revertir primero la interfaz antes de retirar la RPC. Ejecutar los SQL de `supabase/rollback/` en orden inverso: saldos incrementales y luego movimientos paginados. El runner aislado comprueba que ambos scripts se ejecutan. La reversión de saldos restaura las funciones y permisos anteriores; después, volver a auditar saldos. No ejecutar automáticamente ni mezclar la migración de cron ajena a este cambio.
