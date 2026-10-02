# Optimización preparada: búsqueda de alumnos en CxC

Fecha: 2026-10-02. Proyecto: AsiSport-MVP (`uqrmmotcbnyazmadzfvd`). **Aplicada a producción** como migración `20261002143957`.

## Cambio

- La migración `20261002143957_optimizar_rpc_buscar_alumnos_cxc_cobros_asistencias.sql` conserva la definición vigente salvo dos cambios en el cuerpo: agrega los cobros de cada cuenta con `LEFT JOIN LATERAL`, filtrando por `cuenta_cobrar_id` y `escuela_id`, y limita la lectura de asistencias desde el inicio del mes anterior a `Presente` y `Licencia`.
- Permanecen las fórmulas de deuda, cobros, anticipos, consumo de anticipos y “Últ. Mes.”, el JSON público, los filtros, la paginación máxima de 50 y los controles de identidad y sucursal. La función sigue siendo `SECURITY INVOKER`; `CREATE OR REPLACE FUNCTION` conserva sus permisos existentes.
- La migración comprueba la huella MD5 de la definición vigente antes de reemplazarla. La reversión restaura exactamente esa definición y comprueba que la optimización esperada esté presente antes de actuar.

## Equivalencia y permisos

Se comparó el JSON completo de la RPC vigente con el de la consulta propuesta dentro de la misma transacción de solo lectura, bajo el rol `authenticated` y con un límite de cinco segundos. Todos los casos permitidos comparados fueron iguales, incluidos `items`, `total_resultados` y `resumen`:

| Cobertura | Resultado |
| --- | --- |
| Fundación Inter Stars, PLANETA FC y Muchachos Unidos; búsqueda vacía con deuda | Igualdad completa |
| Búsqueda de dos caracteres, varias palabras, con acento y sin resultados | Igualdad completa |
| Activos, archivados y todos; con y sin filtro de deuda | Igualdad completa |
| Filtros de sucursal, entrenador, grupo, horario y combinación de filtros | Igualdad completa |
| Primera página, segunda página y página vacía | Igualdad completa |
| SuperAdministrador, Administrador con sucursal y Asistente | Igualdad completa |

Las escuelas comparadas incluyen 23 anticipos, 7 pagos parciales, 8 saldos negativos de cuenta, 249 cuentas anuladas y 9 borradores entre los registros inspeccionados. Los rechazos vigentes dieron SQLSTATE `42501` para un rol no autorizado, una sucursal fuera del alcance del Administrador y una sucursal de otra escuela. La cabecera y esas comprobaciones de la función no cambian en la migración.

## Rendimiento

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` sobre la consulta interna, ejecutado secuencialmente bajo `authenticated`, sin pruebas de carga:

| Caso | Vigente | Propuesta | Bloques compartidos vigentes → propuesta |
| --- | ---: | ---: | ---: |
| Inter Stars, caso amplio: mediana de tres ejecuciones | 1.299 ms | 201 ms | 53.519 → 40.977 |
| PLANETA FC, caso amplio: una ejecución | 661 ms | 146 ms | 64.140 → 29.209 |
| Muchachos Unidos: una ejecución | 22,5 ms | 22,4 ms | 602 → 589 |

La reducción de la mediana principal fue aproximadamente **84,5 %**, superior al objetivo de 50 %. Ninguno de los demás casos medidos superó el umbral de regresión de 20 % o 50 ms. Todas las mediciones registraron cero lecturas físicas compartidas; representan caché caliente y pueden variar con la carga real.
El plan de la propuesta usó los índices existentes `idx_cobros_cxc` y `asistencias_normales_alumno_id_fecha_key`.

## Comprobación después de aplicar

- La validación previa ejecutó el cuerpo SQL propuesto como consulta de solo lectura con identidades autenticadas. Después de aplicar, la **RPC instalada** devolvió el mismo JSON completo que la consulta anterior para los casos amplios de Inter Stars (427 resultados), PLANETA FC (103) y Muchachos Unidos (1).
- La RPC respondió para Administrador de sucursal y Asistente. Un límite solicitado de 500 quedó acotado a 50. Los intentos con rol no autorizado y sucursal ajena siguieron rechazados con SQLSTATE `42501`.
- La función instalada conserva `SECURITY INVOKER` y los permisos `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`. Su huella MD5 posterior es `f9d8985a64a65414efbad12ae0d2e1a3`. Una medición aislada de la RPC completa en Inter Stars registró 346 ms y 44.609 bloques compartidos consultados, sin lecturas físicas.
- En los registros del borde inmediatamente posteriores a la aplicación se observaron 2 solicitudes HTTP a `/rest/v1/rpc/rpc_buscar_alumnos_cxc`, ambas con estado 200. La muestra es demasiado pequeña y los filtros no están identificados; no permite atribuir una mejora o regresión real de latencia. Los 2 errores PostgreSQL `42501` de esa ventana corresponden a las comprobaciones negativas realizadas durante esta validación. Los mensajes de timeout de PostgREST también aparecían antes de la aplicación (5 en una ventana previa de duración comparable y 3 después); no se atribuyen a esta función sin más evidencia.
- El archivo de facturación pendiente `20260930203000_cron_solo_escuelas_activas.sql` no se incluyó en esta aplicación ni se modificó. El archivo local de CxC usa ahora la versión que registró Supabase para evitar una segunda aplicación con `db push`.
- Se programó el seguimiento diario de los próximos siete días para observar errores y latencias durante un período representativo. Queda comprobar la pantalla de CxC con una sesión real del usuario. Para revertir, usar el archivo de `supabase/rollback` correspondiente.
