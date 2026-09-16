# Prompt para Antigravity: cierre del frontend de inventario

Trabaja en el proyecto:

`C:\Users\Public\Documents\EcosistemaSasport\SaaSport`

Estamos dividiendo la implementación del inventario por sucursal. Codex se
encarga exclusivamente de la migración, las funciones de PostgreSQL, RLS y las
pruebas SQL. Tu responsabilidad es cerrar y verificar únicamente el frontend
React/TypeScript.

## Antes de modificar

1. Lee todos los `AGENTS.md` aplicables.
2. Revisa `docs/Plan_Inventarios_SaaSport.md`.
3. Revisa el diff actual porque ya existen cambios sin confirmar.
4. Conserva los cambios correctos existentes y corrige solo lo necesario.
5. No modifiques archivos dentro de `supabase/migrations` ni `supabase/tests`.
6. No ejecutes migraciones, SQL remoto, `supabase db push`, commit, push ni deploy.

## Archivos principales bajo tu responsabilidad

- `src/components/cuentas/InventarioProductos.tsx`
- `src/pages/cuentas/Cuentas.tsx`
- `src/components/cxc/NotaServicios.tsx`
- `src/components/cxp/NotaPago.tsx`
- `src/components/cxc/ModalNotaMasiva.tsx`
- `src/components/cajas-bancos/ModalMovimientoDirecto.tsx`
- `src/components/MobileNav.tsx`
- `src/App.tsx`
- `src/hooks/useMasterData.ts`
- `src/lib/inventario.ts`
- `src/config/roles.ts`
- `../shared-config/roles.ts`, solo si la matriz compartida realmente lo requiere.

Revisa también estos escritores secundarios de detalles:

- `src/components/cxp/ModalEditarItemCxP.tsx`
- `src/components/cxp/ModalPagoRapidoCxP.tsx`
- `src/components/cxp/ModalSaldoInicialCxP.tsx`
- `src/components/cxc/ModalCobroRapido.tsx`
- `src/components/cxc/DetalleAlumnoCxc.tsx`
- `src/components/cajas-bancos/ModalTransferencia.tsx`
- `src/pages/finanzas/NotasAutomaticas.tsx`

## 1. Inventario en Cuentas > Productos

Verifica y completa:

- Selector de sucursal para SuperAdministrador.
- Administrador limitado a su sucursal.
- Administrador sin sucursal sin apertura, regalos ni ajustes.
- Contador `Productos activos: X de Y`.
- Existencias por producto en la sucursal elegida.
- Saldos negativos en rojo como advertencia.
- Acciones Ver movimientos, Registrar regalo y Ajustar existencias.
- Acción Trasladar solo para SuperAdministrador.
- Conteo inicial cuando la sucursal todavía no abrió inventario.
- Historial con Fecha y hora, Operación, Entrada, Salida, Saldo resultante,
  Responsable, Observación y Referencia.
- Mes actual por defecto, filtros por periodo y operación y páginas de 50 filas.
- Formularios utilizables en escritorio y móvil.
- Producto, cantidad y observación obligatorios en regalos y ajustes.
- Ajustes con dirección de entrada o salida.
- Traslados con producto, cantidad, origen, destino y observación.

## 2. Notas de venta y compra

- Toda nota nueva con productos requiere sucursal.
- Los usuarios restringidos usan su sucursal.
- El SuperAdministrador elige explícitamente la sucursal cuando hay productos;
  no selecciones silenciosamente la primera.
- Al editar, conserva la sucursal original.
- Muestra existencias en ventas como información.
- Permite ventas con saldo cero, insuficiente o negativo, sin confirmación extra.
- Compras y ventas con productos usan las RPC transaccionales nuevas.
- Cobrar o pagar una nota no vuelve a mover inventario.
- Elimina escrituras a `stock_productos` y `movimientos_stock`.
- Conserva un `operacion_id` estable ante doble clic o reintento.
- Genera otro identificador solo para una operación realmente nueva o después de
  confirmar el éxito de la anterior.
- No confíes en usuario, escuela o rol enviados por el navegador.

## 3. Generación masiva

### Prioridad al retomar el 15 de septiembre de 2026

Revisa conjuntamente `ModalNotaMasiva.tsx` y
`src/pages/cxc/CuentasCobrar.tsx`: el callback `onCreada()` del padre cierra
el modal y borra los alumnos seleccionados. Si se llama tras un éxito parcial,
se pierden los pendientes y sus identificadores para reintentar.

- Separa refrescar los datos de cerrar y limpiar la selección.
- El refresco del padre no debe reiniciar el formulario por cambiar la identidad
  del arreglo de alumnos.
- Mantén el resultado visible hasta el cierre explícito; elimina cierres temporizados.
- Durante el procesamiento bloquea también Cancelar, la X y cualquier otra vía de cierre.
- Una mensualidad sin precio para un alumno debe fallar solo para ese alumno.
- Si un reintento conserva su identificador, debe conservar también el payload
  original; no lo reutilices con un formulario modificado tras un resultado incierto.
- Para notas nuevas con productos, el SuperAdministrador debe elegir sucursal;
  no uses su sucursal de perfil como fallback silencioso. Revisa también
  `NotaServicios.tsx` y `NotaPago.tsx`.
- Detecta productos por `categoria === 'producto'`, no por `tipo`.
- Codex está corrigiendo la anulación SQL y los periodos de notas mixtas;
  las firmas de las RPC se conservan.

Corrige especialmente el manejo del primer error en
`ModalNotaMasiva.tsx`:

- Procesa cada alumno como una operación independiente.
- Un error no detiene a los demás.
- Acumula completados y fallidos, con el error real por alumno.
- Muestra un resumen final claro con nombres y resultados.
- Permite reintentar únicamente los fallidos.
- No vuelve a crear notas completadas.
- Mantén un `operacion_id` estable por alumno pendiente o reintentado.
- Elimina ese identificador solo después de éxito confirmado.
- Deshabilita la acción mientras procesa.
- No ocultes resultados parciales.

## 4. Escritores secundarios

- Los flujos que crean o editan notas normales y pueden contener productos deben
  usar `rpc_guardar_nota_cxc` o `rpc_guardar_nota_cxp`.
- Los flujos especiales que solo manejan servicios, anticipos, saldos iniciales
  o transferencias financieras deben filtrar y validar que el concepto no sea
  producto.
- Las notas automáticas y borradores de mensualidad siguen como servicios,
  conservan `periodo_estadistico` y no generan inventario.
- Si una operación exige una RPC adicional, informa el archivo, flujo y firma
  requerida sin modificar SQL.
- Repite una búsqueda global de escrituras directas a `cxc_detalle`,
  `cxp_detalle`, `stock_productos` y `movimientos_stock`.

## 5. Caja y Bancos

- No ofrezcas productos en movimientos directos nuevos.
- Indica que deben registrarse con una nota de compra o venta.
- Mantén visibles las referencias históricas.
- Conserva movimientos directos permitidos para servicios y otros conceptos.

## 6. Rutas, menú y permisos

- Verifica menú de escritorio y móvil, ruta directa y componente.
- SuperAdministrador: todas las sucursales y acciones.
- Administrador: consulta, apertura, regalos y ajustes de su sucursal.
- Asistente: sus ventas afectan inventario, sin movimientos manuales.
- Otros roles: sin acceso al inventario.
- El acceso del Administrador al inventario no habilita la edición general del
  catálogo.
- Revisa la configuración local y compartida de roles para que el prebuild no
  sobrescriba el cambio.

## 7. Compatibilidad y verificación

- No alteres mensualidades, servicios, anticipos, cobros ni pagos.
- Conserva `periodo_estadistico` y `periodo_meses`.
- No cambies firmas RPC.
- No uses datos simulados ni escribas directamente saldos derivados.
- Mantén el estilo visual actual.

Ejecuta:

```powershell
npm.cmd run build
git diff --check
```

Revisa los flujos de venta sin stock, venta negativa, compra posterior, edición
de venta, pago sin segundo movimiento, selección de sucursal, Administrador con
y sin sucursal, reintento masivo parcial y navegación móvil.

## Entrega

No hagas commit ni push. Devuelve:

1. Archivos modificados.
2. Resumen de correcciones.
3. Resultado de `npm.cmd run build`.
4. Resultado de `git diff --check`.
5. Dependencias pendientes del SQL de Codex.
6. Limitaciones o flujos no verificados.
7. Confirmación de que no tocaste migraciones, pruebas SQL ni producción.
