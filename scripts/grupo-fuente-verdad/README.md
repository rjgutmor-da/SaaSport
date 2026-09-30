# Grupo como fuente de verdad

Aplicado a producción el 30-09-2026 mediante las migraciones `grupo_fuente_verdad_alumno`, `permitir_entrenador_vacio_desde_grupo` y `regularizar_enlaces_grupo_alumnos`.

El grupo determina horario y profesor, incluso NULL. Se sincronizan fichas no archivadas y membresías de la gestión activa; no se propaga la sucursal ni se infieren grupos. La restauración normaliza la ficha. Los cambios de horario conservan los grupos de gestión anteriores y las referencias de asistencia. La planificación futura no modifica la ficha hasta activarse.

## Validación

Desde SaaSport: `node scripts/grupo-fuente-verdad/test.mjs ../outputs/attendance-test-runtime` (runtime local con `@electric-sql/pglite`). Ejecuta 45 comprobaciones con funciones SQL reales y esquema reducido, incluyendo NULL, altas, traslado, restauración, formularios antiguos, gestión anual, aislamiento, regularización y reversión. `prueba-live.sql` comprueba operaciones permitidas y denegadas con rol authenticated y revierte todos sus cambios.

La prueba en producción descubrió `check_min_entrenadores`, que bloqueaba la eliminación del último vínculo incluso al vaciar el profesor del grupo. La migración complementaria conserva esa validación cuando la ficha sigue teniendo profesor principal; permite quitarlo cuando la ficha ya tiene profesor NULL.

Regularización verificada: 277 alumnos, 13 escuelas; 276 enlaces de gestión y 209 membresías (con solapamiento). Cero diferencias posteriores en escuelas activas. Conservados por hash los archivados, sucursales, asistencias normales y alumnos sin grupo. Respaldo en `private.respaldo_grupo_20260930`, sin permisos de clientes y con RLS. La ausencia de políticas en este respaldo es deliberada (acceso administrativo exclusivo).

## Reversión

Aplicar `rollback.sql` como migración transaccional de reversión del código. Restaura las funciones previas y el trigger anterior; no revierte modificaciones de negocio realizadas desde la instalación. Se mantiene revocado el acceso anónimo a la consulta de grupos.

Para deshacer además la regularización, ejecutar **en la misma transacción, después de rollback.sql**, `revertir-regularizacion.sql`. Comprueba primero que fichas y membresías sigan coincidiendo con el estado respaldado posterior; ante ediciones posteriores aborta y exige reconciliación individual. Conserva el respaldo y las fechas de actualización reflejan la reversión administrativa. No ejecutar con clientes escribiendo durante la reversión.

## Límites comprobados

La configuración actual debe tener un solo horario por grupo y un único grupo de gestión correspondiente; las ambigüedades se rechazan en vez de elegir asignaciones históricas arbitrarias. Ante edición concurrente del grupo, un guardado de ficha puede devolver un error de reintento (40001) para evitar una combinación desactualizada. No se realizó una prueba de concurrencia multisesión en producción.

Supabase advisors conserva avisos ajenos a esta modificación (vistas SECURITY DEFINER y funciones antiguas sin search_path fijo). Referencia: https://supabase.com/docs/guides/database/database-linter. No se modificaron esas políticas o vistas.
