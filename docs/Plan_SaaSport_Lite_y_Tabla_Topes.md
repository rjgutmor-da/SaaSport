# Plan Comercial y Técnico: SaaSport Lite, Módulo de Alumnos y Tabla de Topes

> Documento guardado el 2026-11-26 para retomar implementación por fases.

---

## 1. Matriz Comercial y Tabla de Precios Acordada

| Detalle | Básico | Crecimiento | Profesional | Completa |
| :--- | :---: | :---: | :---: | :---: |
| **SaaSport Lite** — *Registro de alumnos, mensualidades y cargos básicos (sin cajas ni egresos)* | | | | |
| Usuarios | 2 | 4 | 6 | 8 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 1 | 3 | 4 | 6 |
| **TOTAL** | **USD 6,00** | **USD 10,00** | **USD 15,00** | **USD 20,00** |
| **SaaSport** — *Todo Lite + egresos, cajas/bancos, inventario y estadísticas financieras* | | | | |
| Usuarios | 2 | 6 | 10 | 15 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 1 | 3 | 4 | 6 |
| **TOTAL** | **USD 15,00** | **USD 20,00** | **USD 30,00** | **USD 35,00** |
| **AsiSport** — *Control de asistencias por grupos en cancha* | | | | |
| Usuarios | 3 | 6 | 10 | 15 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 1 | 3 | 4 | 6 |
| **TOTAL** | **USD 15,00** | **USD 20,00** | **USD 30,00** | **USD 35,00** |
| **AsiSport + SaaSport** — *Gestión integral: cancha + finanzas + cobro según asistencias* | | | | |
| Usuarios | 5 | 12 | 20 | 30 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 1 | 3 | 4 | 6 |
| **TOTAL** | **USD 25,00** | **USD 35,00** | **USD 50,00** | **USD 65,00** |

### Servicios Adicionales (Mensuales)

| Servicio Adicional | Aplica a | Básico | Crecimiento | Profesional | Completa |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Usuarios Adicionales** *(c/u)* | Todos los planes | USD 2,00 | USD 2,00 | USD 2,00 | USD 2,00 |
| **Cobranza Automática por WhatsApp** | SaaSport Lite / SaaSport | USD 10,00 | USD 15,00 | USD 20,00 | USD 25,00 |
| **Fotos de Asistencia** | Planes con AsiSport | USD 5,00 | USD 5,00 | USD 7,00 | USD 7,00 |
| **Perfil Médico** | Planes con AsiSport | USD 4,00 | USD 4,00 | USD 6,00 | USD 6,00 |
| **Ficha Deportiva** | Planes con AsiSport | USD 5,00 | USD 5,00 | USD 7,00 | USD 7,00 |

- **15% de descuento** en suscripciones anuales.
- El cupo de alumnos cuenta únicamente **alumnos activos** (`archivado = false`).
- **Escuelas de +600 alumnos activos:** consultar plan a medida o paquetes adicionales.

---

## 2. Plan de Implementación por Fases

### Fase 1: Tabla de Topes y Control de Planes en Base de Datos (Supabase)
1. **Migración SQL (`catalogo_planes` + `escuelas_plan`):**
   - `catalogo_planes`: las 16 combinaciones oficiales (`saasport_lite`, `saasport`, `asisport`, `combo` × `basico`, `crecimiento`, `profesional`, `completa`) con topes base y flags de acceso por app.
   - `escuelas_plan`: asignación 1:1 por escuela con campos para extras (`usuarios_adicionales`, `alumnos_adicionales`, `sucursales_adicionales`, `addon_fotos_asistencia`, `addon_perfil_medico`, `addon_ficha_deportiva`, `addon_cobranza_automatica`, `suscripcion_anual`).
   - **Backfill automático sin interrupciones:** auto-asignar a cada escuela actual el tramo `combo` que cubra su operación actual (más cupo adicional si alguna excede 600 alumnos / 30 usuarios / 6 sucursales, conservando Ficha Médica y Fotos de Asistencia en Fundación Inter Stars).
2. **Triggers SQL de Topes:**
   - Validación automática en `public.alumnos` (`archivado = false`), `public.usuarios` (`activo = true` + roles permitidos por plan) y `public.sucursales`.
3. **RPC `rpc_obtener_plan_y_cupos_escuela`:**
   - Devuelve en una sola llamada el plan, módulos, topes efectivos y conteos precalculados en PostgreSQL (reemplazando también la descarga masiva de alumnos detectada en `PanelEscuela.tsx`).

### Fase 2: Módulo de Registro, Edición y Archivo de Alumnos en SaaSport
1. **Pestaña dedicada `Registro de Alumnos` (`/alumnos`) en Escritorio y Móvil (`MobileNav`):**
   - En móvil: *SaaSport Lite* mostrará `Alumnos` + `CXC`; *SaaSport* normal mostrará `Alumnos` + `CXC` + `CxP` + `Cajas`.
   - Listado paginado en servidor (`30` por página) con buscador con debounce, filtro Activos/Archivados y sucursal/grupo.
2. **Formulario de Alumno (`ModalFormularioAlumno.tsx`):**
   - *Datos del Alumno:* `Nombres *`, `Apellidos *`, `Fecha de Nacimiento *`, `Carnet de Identidad (Opcional)` + validación de duplicados (`AdvertenciaAlumnoDuplicado`), sin foto ni checkbox de arquero.
   - *Representantes Legales:* Padre y Madre (nombre + teléfono, al menos uno requerido), radio de primer contacto, `Colegio` y `Dirección del Domicilio`.
   - *Información Interna:* `Mensualidad`, `Sucursal` (solo visible si tiene >1 sucursal), `Grupo (Opcional)` y `Observaciones para Ficha Financiera` (máx. 30 caracteres), más modal post-inscripción `MensualidadIngresoModal`.

### Fase 3: Modo `SaaSport Lite` y Tarjeta de Cupos en Panel de Escuela
1. **Adaptación de vistas para `SaaSport Lite`:**
   - Ocultar `Cajas y Bancos`, `Cuentas por Pagar`, `Estadísticas` y botón `AsiSport` (si no tienen AsiSport).
   - Mantener `Registro de Alumnos`, `Cuentas por Cobrar`, `Mensualidades Por Aprobar`, `Cuentas` (filtrado solo a conceptos de ingreso sin inventario/stock) y `Panel de Escuela`.
   - En cobros de `SaaSport Lite`: usar cuentas internas automáticas (`Efectivo` y `QR / Transferencia`) como selector de método de pago, ocultando saldos de cajas y totalizadores globales recaudados.
2. **Panel de Escuela (`TarjetaPlanCupos.tsx`):**
   - Barras visuales permanentes de consumo (`Alumnos activos`, `Usuarios`, `Sucursales`) frente a los topes del plan contratado.
