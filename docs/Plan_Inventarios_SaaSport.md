# Plan para Antigravity: inventario sencillo por sucursal en SaaSport

> Plan acordado en la conversación del 15 de septiembre de 2026. Este documento define los requisitos; no certifica que estén implementados. La implementación local recibida es parcial y debe revisarse y probarse antes de aplicar la migración. La sección final conserva las observaciones de revisión posteriores al plan.

## 1. Objetivo y reglas acordadas

Implementar inventario dentro de **Cuentas → Productos**, integrado con las notas de compra y venta existentes.

**Las ventas estarán permitidas con existencias cero o negativas, y podrán dejar el saldo negativo.** Mostrar el saldo negativo como advertencia visual, sin bloquear la venta ni pedir confirmación adicional.

### Alcance

- Todos los ítems de categoría **Producto** llevarán inventario.
- Existencias independientes por sucursal.
- Cantidades enteras, sin tallas, variantes, lotes ni valoración monetaria.
- Cada escuela dispondrá de **10 productos activos incluidos**.
- Un mismo producto utilizado en varias sucursales contará como un solo producto.
- Las notas moverán inventario al guardarse, independientemente de su pago.

| Operación | Efecto | Condiciones |
|---|---|---|
| Compra | Entrada automática | Al guardar la nota, aunque quede pendiente de pago |
| Venta | Salida automática | Permitida con saldo cero, negativo o insuficiente |
| Regalo | Salida manual | Observación obligatoria y existencias suficientes |
| Ajuste de entrada | Entrada manual | Observación obligatoria |
| Ajuste de salida | Salida manual | Observación obligatoria y existencias suficientes |
| Traslado | Salida en origen y entrada en destino | Existencias suficientes en origen |
| Apertura | Establece existencias iniciales | Conteo físico confirmado por sucursal |

Pagar o cobrar una nota no moverá nuevamente las existencias. Regalos, ajustes y traslados no generarán deudas ni movimientos de caja.

## 2. Interfaz y permisos

### Cuentas → Productos

Mantener el catálogo existente y agregar:

- Selector de sucursal.
- Contador **“Productos activos: 7 de 10”**.
- Existencias por producto en la sucursal seleccionada.
- Saldo negativo destacado en rojo.
- Acciones **Ver movimientos**, **Registrar regalo** y **Ajustar existencias**.
- Acción **Trasladar** para el SuperAdministrador.
- Acceso al **Conteo inicial** cuando la sucursal todavía no haya abierto su inventario.

En regalos y ajustes solicitar producto, cantidad y observación. En ajustes seleccionar entrada o salida. En traslados solicitar producto, cantidad, sucursal de origen, destino y observación.

El historial mostrará:

**Fecha y hora | Operación | Entrada | Salida | Saldo resultante | Responsable | Observación | Referencia**

La referencia permitirá identificar la nota, traslado o corrección correspondiente. Abrir el historial en el mes actual, con filtros por período y operación y paginación de 50 registros.

### Permisos

| Rol | Acceso |
|---|---|
| SuperAdministrador | Todas las sucursales; catálogo, apertura, regalos, ajustes y traslados |
| Administrador | Consulta, apertura, regalos y ajustes de su sucursal |
| Asistente | Sus ventas autorizadas afectan inventario; sin acceso a movimientos manuales |
| Otros roles | Sin acceso al inventario |

Agregar permisos específicos para que el Administrador acceda al inventario desde Cuentas sin habilitarle la edición general del catálogo.

Un Administrador sin sucursal asignada no podrá realizar movimientos manuales hasta tenerla asignada. Las restricciones deben aplicarse en menú, rutas, componentes y servidor.

### Notas y Caja y Bancos

- Toda nota nueva con productos requerirá una sucursal.
- Usuarios restringidos utilizarán su sucursal; el SuperAdministrador podrá elegirla.
- Al editar, conservar la sucursal original y no reemplazarla por la del usuario que edita.
- En ventas mostrar las existencias disponibles como información, sin impedir guardar por falta de stock.
- En los movimientos directos de **Caja y Bancos**, dejar de ofrecer productos e indicar que deben registrarse mediante una nota de compra o venta.
- Mantener visibles las referencias de movimientos directos históricos.

## 3. Cupo y ampliación de pago

- Contar los productos activos de toda la escuela, independientemente de sus sucursales.
- Validar el cupo al crear, reactivar o convertir un ítem a categoría Producto.
- Al superar el límite mostrar: **“Alcanzaste el límite de productos. Solicita una ampliación a SaaSport.”**
- La administración de SaaSport podrá configurar un cupo mayor después de verificar el pago.
- Ningún usuario de la escuela, incluido su SuperAdministrador, podrá modificar su propio cupo.
- Registrar los cambios de cupo para auditoría.
- No implementar pasarela de pago, tarifas ni vencimientos automáticos en esta versión.

Archivar un producto liberará cupo únicamente cuando tenga saldo **exactamente cero en todas las sucursales**. Un saldo negativo también impedirá archivarlo.

Conservar su historial; reactivarlo volverá a consumir cupo. Impedir eliminar productos con historial o cambiar su categoría para eludir el límite.

Una reducción administrativa del cupo solo será válida si los productos activos ya caben en el nuevo límite. Controlar estas reglas en la base de datos, incluyendo solicitudes simultáneas.

## 4. Implementación e integración

### Base existente verificada al preparar el plan

En el proyecto `C:\Users\Public\Documents\EcosistemaSasport\SaaSport`:

- `catalogo_items` contiene el catálogo y su categoría.
- `stock_productos` y `movimientos_stock` existen, pero no tienen sucursal.
- Cuentas obtiene actualmente el saldo desde `stock_productos`.
- `NotaPago.tsx` intenta registrar entradas de productos únicamente al pagar una nota nueva.
- No se encontró un mecanismo que actualice los saldos a partir de esos movimientos.
- Las notas utilizan `cuentas_cobrar`, `cxc_detalle`, `cuentas_pagar` y `cxp_detalle`.
- Existen ventas individuales, notas mixtas con mensualidades y generación masiva.
- Caja y Bancos permite actualmente registrar productos con cantidad 1 en movimientos directos.

La revisión inicial encontró 40 productos, 10 registros de saldo —todos en cero— y 5 movimientos antiguos. Ninguna escuela superaba los 10 productos. **Volver a comprobar estos datos antes de migrar.** Esta descripción corresponde a la base previa al desarrollo, no constituye una comprobación del estado actual.

### Estructura de datos

Crear las estructuras de inventario por sucursal y conservar las tablas antiguas como legado, desconectando sus escrituras del funcionamiento nuevo.

Incorporar:

- Configuración de cupo por escuela, con valor inicial 10.
- Apertura por sucursal, con fecha y responsable.
- Saldo único por escuela, sucursal y producto.
- Historial inmutable de movimientos.
- Referencias a notas, revisiones, traslados y reversiones.
- Identificadores de operación para evitar duplicados por reintentos.

Cada movimiento guardará escuela, sucursal, producto, dirección, origen, cantidad positiva, saldo resultante, responsable, fecha de registro y observación.

**El saldo debe admitir valores negativos. No agregar una restricción general de saldo mayor o igual a cero.** La disponibilidad se comprobará según el tipo de operación.

Validar que sucursal, producto y documento pertenezcan a la misma escuela. Proteger el historial frente a eliminaciones en cascada.

### Operaciones de servidor

Implementar funciones para:

- Consultar saldos e historial paginado.
- Confirmar apertura.
- Registrar regalos y ajustes.
- Registrar traslados.
- Guardar y modificar notas con su efecto de inventario.
- Revertir movimientos al anular notas.
- Administrar el cupo desde un acceso exclusivo de SaaSport.

El servidor obtendrá la identidad y permisos desde la sesión autenticada. No confiar en el usuario, escuela o rol enviados por el navegador.

Los saldos y movimientos derivados no podrán editarse directamente desde el cliente. Aplicar aislamiento por escuela y sucursal tanto en las funciones como en las políticas de acceso.

### Consistencia de las notas

- Guardar nota, detalles y efecto de inventario en una misma transacción.
- Aplicar la misma integración a notas individuales, notas mixtas y generación masiva.
- En generación masiva, cada nota será una transacción independiente; informar cuáles se completaron y permitir reintentar sin duplicarlas.
- Excluir anticipos, borradores y líneas que no sean productos.
- Retirar la entrada de inventario actualmente ligada al pago en Compras.
- Los cambios exclusivamente financieros, como pagos o precios, no alterarán cantidades.

Al editar una nota, calcular la diferencia entre su efecto anterior y el nuevo:

- **Venta:** permitir la diferencia aunque deje saldo negativo.
- **Anulación de venta:** devolver las unidades, aunque el saldo siga siendo negativo.
- **Compra:** sumar aumentos de cantidad; bloquear reducciones o anulaciones si no existen unidades suficientes para retirar lo que se revierte.
- Registrar las correcciones vinculadas, conservando los movimientos originales.
- Impedir eliminar físicamente notas con movimientos; utilizar su anulación.

Proteger contra doble clic, reintentos y concurrencia. Dos ventas simultáneas deben descontarse correctamente aunque el resultado sea negativo. Un traslado debe actualizar origen y destino conjuntamente o no registrar nada.

## 5. Apertura, pruebas y entrega

### Apertura y compatibilidad

- Cada sucursal confirmará un conteo físico de sus productos, incluyendo ceros, antes de registrar nuevas notas con productos.
- Las cantidades iniciales serán enteros no negativos.
- Los productos creados después de la apertura comenzarán en cero.
- Conservar los movimientos antiguos como historial legado; no reconstruir automáticamente existencias desde ellos.
- Las notas anteriores a la apertura no se reprocesarán.
- Editar o anular una nota anterior no alterará automáticamente el conteo inicial. Mostrar un aviso cuando una devolución física requiera un ajuste manual.
- Usar el momento de registro para ordenar movimientos; una fecha de nota anterior no debe reescribir los saldos históricos.

### Pruebas de aceptación

1. **Venta sin stock:** saldo 0, venta de 3 → saldo −3; operación exitosa.
2. **Venta con saldo negativo:** saldo −3, venta de 2 → saldo −5.
3. **Compra posterior:** saldo −5, compra de 8 → saldo 3.
4. **Cobro o pago posterior:** no modifica existencias.
5. **Edición de venta:** cambiar una venta de 2 a 5 descuenta únicamente 3 adicionales, aunque produzca saldo negativo.
6. **Anulación de venta:** repone exactamente sus unidades.
7. **Regalo, ajuste de salida y traslado:** se bloquean si falta disponibilidad.
8. **Entradas:** pueden mejorar un saldo negativo aunque no alcancen a llevarlo a cero.
9. **Traslado:** conserva el total de la escuela y no admite resultados parciales.
10. **Cupo:** producto 11 bloqueado; ampliación permite crearlo; archivo y reactivación respetan el límite.
11. **Concurrencia y reintentos:** sin movimientos perdidos, saldos incorrectos ni duplicados.
12. **Seguridad:** sin acceso a otras escuelas o sucursales, ni modificación del cupo por usuarios de la escuela.
13. **Regresión:** mensualidades, servicios, anticipos, cobros y pagos mantienen su funcionamiento.
14. **Interfaz:** verificar apertura, formularios, historial y saldos negativos en escritorio y móvil.

### Entrega esperada de Antigravity

Preparar código, migración y verificaciones como una entrega coordinada, siguiendo los `AGENTS.md` aplicables. Validar primero en un entorno de prueba y documentar resultados, procedimiento de activación por sucursal y cualquier limitación encontrada.

El desarrollo no incluye habilitar ampliaciones comerciales ni modificar inventarios reales mediante conteos supuestos.

## 6. Observaciones de revisión y despliegue posteriores al plan

Estas observaciones acompañan el plan original y aclaran el estado de la entrega local. No sustituyen los requisitos anteriores.

### Archivos de referencia

- Repositorio: `C:\Users\Public\Documents\EcosistemaSasport\SaaSport`.
- Migración local preparada: `SaaSport\supabase\migrations\20260915131645_inventario_por_sucursal.sql`.
- Componente nuevo: `SaaSport\src\components\cuentas\InventarioProductos.tsx`.
- Validación previa del navegador: `SaaSport\src\lib\inventario.ts`.
- Matriz de permisos fuente: `shared-config\roles.ts`. El prebuild la sincroniza hacia las aplicaciones.

### Revisión requerida de la implementación parcial

1. Guardado de cabecera, detalles e inventario en una sola transacción para compras, ventas, notas mixtas y cada nota masiva. La validación previa del navegador no sustituye esa transacción.
2. Ediciones mediante diferencias de cantidades. Cambiar solamente precios o pagos no debe generar movimientos ni exigir disponibilidad.
3. Identificadores persistentes de operación y protección real contra doble clic, reintentos y concurrencia, incluyendo regalos, ajustes, traslados y notas masivas.
4. Las notas anteriores a la apertura deben conservar su condición histórica al editarse: borrar y recrear detalles no debe descontar ni sumar inventario.
5. Selector de sucursal para SuperAdministrador en notas nuevas; conservar la sucursal original al editar. Mostrar existencias en ventas sin bloquear saldos negativos.
6. Restricciones en servidor y RLS por rol, escuela y sucursal. Impedir cambios directos de detalles que evadan el inventario, eliminación física de notas con historial y modificación del cupo por usuarios escolares.
7. Archivo y reactivación de productos, cupo concurrente y ampliaciones exclusivamente administrativas.
8. Acceso y funcionamiento en móvil: en la entrega revisada, la ruta Cuentas estaba dentro del bloque exclusivo de escritorio.
9. Desconectar las lecturas y escrituras operativas del stock heredado y conservar su historial.
10. Verificar todas las pruebas de aceptación del plan original.

### Estado reportado antes de guardar este documento

- El build local pasó, pero eso no certifica la corrección del inventario.
- La CLI de Supabase está instalada. No había PostgreSQL local en ejecución en el puerto 54322 durante la verificación.
- Según el informe de Antigravity aportado por el usuario, no se aplicó ninguna migración; el proyecto activo de producción es `uqrmmotcbnyazmadzfvd`, no se identificó un entorno de pruebas activo y el historial remoto difiere del directorio local.
- El informe señaló como pendientes/desincronizadas, entre otras, `20260912181000_permitir_asistente_sin_sucursal.sql`, `20260915131645_inventario_por_sucursal.sql` y `99999999999999_enable_rls.sql`.
- El intento de `supabase db push --dry-run` reportó `Remote migration versions not found in local migrations directory.`

Revisar el estado actual antes de actuar. Preparar pruebas reproducibles en PostgreSQL/Supabase local si el entorno lo permite. Si falta infraestructura, documentar exactamente qué se necesita y cuáles pruebas quedan pendientes.

Durante esta revisión no ejecutar `db push`, `migration repair` ni SQL de modificación contra producción. No marcar versiones como aplicadas sin comprobar su equivalencia. Entregar código corregido, migración revisada, resultados de pruebas y procedimiento de despliegue aislado. La aplicación en producción se decidirá después de revisar esos resultados.
