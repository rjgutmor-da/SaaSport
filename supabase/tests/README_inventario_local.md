# Verificación local del inventario

## Alcance

`run-inventario-local.mjs` carga en una base PostgreSQL embebida, nueva y en
memoria, el esquema mínimo de `fixtures/inventario_base.sql`, la migración real
y `test_inventario_suite.sql`. No utiliza credenciales, conexión remota ni datos
de usuarios. Comprueba también que el ROLLBACK retiró las escuelas de prueba.

La fixture reproduce las tablas necesarias y cuatro funciones de mensualidad y
validación de detalles consultadas en modo lectura el 2026-09-15. No reproduce
el esquema completo, todas sus políticas ni todos sus triggers. La semilla del
catálogo está simplificada. Este archivo es una fixture de prueba, no una migración.

## Ejecución en PowerShell

Desde la raíz de SaaSport:

```powershell
$inventoryTestRuntime = Join-Path $env:TEMP 'saasport-inventario-pglite-058'
New-Item -ItemType Directory -Path $inventoryTestRuntime -Force | Out-Null
npm.cmd install --prefix $inventoryTestRuntime --no-audit --no-fund --ignore-scripts --save-exact @electric-sql/pglite@0.5.8
node supabase/tests/run-inventario-local.mjs "$inventoryTestRuntime/node_modules/@electric-sql/pglite/dist/index.js"
```

La dependencia queda fuera del repositorio; no modifica package.json ni su lockfile.
Requiere Node.js. Solo la instalación del paquete necesita acceso a Internet.

## Resultado del 2026-09-15

Se reprodujeron dos errores antes de corregirlos:

1. Anular una nota fallaba con `record "d" is not assigned yet`: la variable
   del bucle y el alias de los detalles compartían nombre.
2. Crear una nota mixta fallaba con
   `Solo una linea de Mensualidad puede tener ciclo.`: se copiaba el periodo de
   cabecera a productos y servicios.

Después de las correcciones, la suite completa pasa en PGlite 0.5.8.
La nueva prueba 16 cubre mensualidad + producto + servicio, herencia del ciclo
solo para mensualidad, rechazo atómico de mensualidad duplicada, edición por
diferencias, cambio de precio sin movimiento y anulación conservando el detalle.
La suite existente cubre ventas negativas, compras, pagos/cobros, operaciones
manuales, traslados, cupo, reintento secuencial, restricciones de RPC e históricos.

## Pendiente antes de producción

- Ejecutar sobre un entorno Supabase aislado con el esquema completo.
- Verificar RLS y privilegios con conexiones autenticadas reales por rol/escuela.
  Las comprobaciones actuales de permisos simulan auth.uid() dentro de una
  conexión privilegiada y comprueban restricciones de RPC, no todas las políticas.
- Probar concurrencia con varias conexiones: PGlite usa una sola conexión.
  Un reintento secuencial no demuestra ausencia de carreras.
- Integración con frontend y pruebas en escritorio/móvil, responsabilidad de
  Antigravity en esta división.
- Revisar el historial remoto de migraciones y preparar la activación coordinada.

No se aplicó esta migración a producción ni se crearon conteos reales.
Nunca ejecutar la fixture en una base compartida o de producción.

## Sucursal del alumno en notas CxC (2026-09-16)

La prueba adicional carga ambas migraciones en PostgreSQL embebido:

```powershell
node supabase/tests/run-nota-sucursal-alumno.mjs "$env:TEMP/saasport-inventario-pglite-058/node_modules/@electric-sql/pglite/dist/index.js"
```

Cubre sucursal automática para servicios, origen alternativo autorizado para
productos, alumnos sin sucursal, edición sin cambio de sucursal, alcance de
Administrador/Asistente fijo y sin sucursal fija, aislamiento entre escuelas,
conteo inicial, ventas negativas e idempotencia. También bloquea notas mixtas
en otra sucursal al crear y editar, sin alterar stock ni detalles; permite
mezclar en la sucursal del alumno. Las 44 comprobaciones pasan.
Usa la fixture mínima; no sustituye una prueba autenticada del flujo completo.

Activación: aplicar `20260916135117_nota_cxc_sucursal_alumno.sql` y después
publicar el frontend. La migración reemplaza `rpc_guardar_nota_cxc` y ajusta
solo las políticas SELECT de `inventario_aperturas` e `inventario_saldos`.
No modifica notas ni saldos existentes. Verificar servicios y productos con
administrador fijo, administrador sin sucursal fija y SuperAdministrador.

Reversión: restaurar el frontend anterior y la definición anterior de
`rpc_guardar_nota_cxc` y de esas dos políticas (se encuentran en la migración
`20260915131645_inventario_por_sucursal.sql`). No ejecutar de nuevo esa
migración completa. Las notas creadas durante la activación conservan sus datos.
