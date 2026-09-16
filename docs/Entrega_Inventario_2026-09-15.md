# Entrega del inventario por sucursal — 2026-09-15

## Estado de la entrega

Código de Codex y Antigravity publicado en la rama `codex/inventario-por-sucursal`.
Esta entrega versiona la migración, pero NO la ejecuta en Supabase.
No se integra todavía a `main`: el frontend requiere las nuevas RPC y tablas.
Los temporales de `supabase/.temp` quedan fuera de la entrega.

El plan acordado está en `docs/Plan_Inventarios_SaaSport.md`.
Sus observaciones de revisión son históricas; no sustituyen la validación actual.

## Verificaciones realizadas

- Ocho pruebas JavaScript aprobadas. Importan el módulo de idempotencia real;
  las decisiones de los componentes todavía se simulan, no hay cobertura integral
  de navegador.
- TypeScript validado después del último ajuste de cobros/pagos.
- Vite validado durante el cierre del frontend; advertencia de tamaño de chunk.
- Suite SQL completa aprobada en PGlite 0.5.8 con esquema mínimo y ROLLBACK.
- Diff sin errores de espacios; Git informa normalización LF/CRLF.
- Matriz local de roles idéntica a `../shared-config/roles.ts` al preparar la entrega.

Instrucciones y límites del entorno SQL local:
`supabase/tests/README_inventario_local.md`.

## Pasos pendientes para activar

1. Preparar un Supabase de pruebas con el esquema completo y datos ficticios.
   No conectar una vista previa de esta rama a producción para ejecutar pruebas.
2. Reconciliar el historial de migraciones local/remoto con evidencia de lo ya
   aplicado. La CLI había detectado versiones remotas ausentes localmente y
   otras migraciones pendientes. No ejecutar `db push`, `--include-all` ni
   `migration repair` a ciegas.
3. Aplicar y verificar en pruebas
   `20260915131645_inventario_por_sucursal.sql`.
   Verificar las funciones efectivas, los privilegios y RLS con sesiones reales
   de distintas escuelas/sucursales y roles.
4. Probar con varias conexiones ventas simultáneas, cupo, traslados y reintentos.
   PostgreSQL embebido de una conexión no demuestra esas garantías.
5. Probar las pantallas en escritorio/móvil: notas individuales/mixtas/masivas,
   compras, anulaciones, fallos de conexión, cobros/pagos, apertura e historial.
   Verificar el ciclo completo, no solo la compilación.
6. Preparar copia de seguridad, procedimiento de recuperación y una ventana de
   activación coordinada. Verificar cobertura del plan (incluido cupo ampliado)
   antes de declararlo completo. Aplicar la migración de producción y desplegar
   el frontend de forma coordinada: los triggers nuevos pueden impedir escrituras
   del frontend anterior, y el frontend nuevo necesita las RPC.
7. Integrar la rama a `main` en esa ventana y verificar el despliegue.
8. Cada sucursal confirma su conteo físico real, incluidos los ceros. Hasta
   entonces las nuevas notas con productos requieren apertura. No inventar
   existencias ni reconstruirlas a partir del legado.

## Comprobaciones posteriores

- Venta de 3 con saldo cero deja -3.
- Compra y venta afectan inventario al guardar; cobrar/pagar no lo afecta otra vez.
- El contador se aplica a productos activos de la escuela, no a sus sucursales.
- Historial conserva responsables, referencias y saldos.
- Si un cobro/pago tiene respuesta incierta, consultar los movimientos existentes
  antes de registrarlo manualmente para evitar una duplicación financiera.
