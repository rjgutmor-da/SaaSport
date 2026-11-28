# Plan Comercial y Técnico: SaaSport Lite, Módulo de Alumnos y Tabla de Topes

> Documento guardado el 2026-11-26 para retomar implementación por fases.

---

## 1. Matriz Comercial y Tabla de Precios Acordada

| Detalle | Básico | Crecimiento | Profesional | Completa |
| :--- | :---: | :---: | :---: | :---: |
| **SaaSport Lite** — *Registro de alumnos, mensualidades y cargos básicos (sin cajas ni egresos)* | | | | |
| Usuarios | 2 | 3 | 4 | 5 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 1 | 2 | 3 | 4 |
| **TOTAL** | **USD 6,00** | **USD 10,00** | **USD 15,00** | **USD 20,00** |
| **SaaSport** — *Todo Lite + egresos, cajas/bancos, inventario y estadísticas financieras* | | | | |
| Usuarios | 2 | 3 | 4 | 5 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 2 | 4 | 6 | 8 |
| **TOTAL** | **USD 15,00** | **USD 20,00** | **USD 25,00** | **USD 35,00** |
| **AsiSport** — *Control de asistencias por grupos en cancha* | | | | |
| Usuarios | 3 | 6 | 10 | 15 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 2 | 4 | 6 | 8 |
| **TOTAL** | **USD 15,00** | **USD 20,00** | **USD 30,00** | **USD 35,00** |
| **AsiSport + SaaSport** — *Gestión integral: cancha + finanzas + cobro según asistencias* | | | | |
| Usuarios | 5 | 12 | 20 | 30 |
| Alumnos activos | 100 | 250 | 400 | 600 |
| Sucursales | 3 | 5 | 7 | 9 |
| **TOTAL** | **USD 25,00** | **USD 35,00** | **USD 50,00** | **USD 65,00** |

### Servicios Adicionales (Mensuales)

| Servicio Adicional | Aplica a | Básico | Crecimiento | Profesional | Completa |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Usuarios Adicionales** *(c/u)* | Todos los planes | USD 2,00 | USD 2,00 | USD 2,00 | USD 2,00 |
| **Cobranza Automática por WhatsApp** | SaaSport Lite / SaaSport | USD 10,00 | USD 15,00 | USD 20,00 | USD 25,00 |
| **Fotos de Asistencia Grupal** | Planes con AsiSport | USD 5,00 | USD 5,00 | USD 7,00 | USD 7,00 |
| **Perfil Médico** | Planes con AsiSport | USD 5,00 | USD 5,00 | USD 7,00 | USD 7,00 |
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
> *(Decisiones alineadas el 2026-11-27)*

1. **Alcance y Navegación (`Cuentas por Cobrar` + `Alumnos`):**
   - Disponible en **todos los planes con acceso a SaaSport** (`SaaSport Lite`, `SaaSport` normal y `Combo AsiSport + SaaSport`), operando sobre la misma tabla `public.alumnos`.
   - **Orden en menú lateral (PC):** `Cuentas por Cobrar` (`/` y `/cxc`, renombrado desde *Alumnos (CxC)* y **sin** enlace de `+ Nuevo Alumno` adentro) → `Alumnos` (`/alumnos`) → `Caja y Bancos` (`/cajas-bancos`).
   - **Barra inferior móvil (`MobileNav`):**
     - *SaaSport Lite:* `CXC` + `Alumnos` + `Cajas` (ocultando módulos bloqueados para no saturar).
     - *SaaSport normal y Combo:* `CXC` + `Alumnos` + `CxP` + `Cajas`.
   - Listado paginado estrictamente en servidor (`30` por página) con buscador con *debounce*, filtro `Activos` / `Archivados`, filtro por sucursal/sub y filtro por grupo (solo en *SaaSport normal* y *Combo*; oculto en *SaaSport Lite*).

2. **Formulario de Alumno (`ModalFormularioAlumno.tsx`) y Regla de Grupos por Plan:**
   - *Datos del Alumno:* `Nombres *`, `Apellidos *`, `Fecha de Nacimiento *`, `Carnet de Identidad (Opcional)` + validación de duplicados (`AdvertenciaAlumnoDuplicado`), sin foto ni checkbox de arquero.
   - *Representantes Legales:* Padre y Madre (al menos uno con nombre requerido según regla vigente en BD; teléfonos formateados para WhatsApp), radio de primer contacto, `Colegio` y `Dirección del Domicilio`.
   - *Información Interna:* `Mensualidad`, `Sucursal` (selector visible si tiene >1 sucursal; autoasignada si tiene 1), `Observaciones para Ficha Financiera` (máx. 30 caracteres) y **`Grupo` escalonado por plan**:
     - **SaaSport Lite:** **no maneja Grupos** (se oculta `Grupo` en formulario/filtros y se clasifica solo por Sucursal y Categoría `Sub` automática por fecha de nacimiento; `Grupos y Horarios` queda bloqueado con candado `🔒` en Panel de Escuela).
     - **SaaSport normal (sin AsiSport):** se habilita `Grupos y Horarios` en Panel de Escuela (simplificado sin requerir profesor titular) y `Grupo` aparece como **Opcional** en el formulario de alumno.
     - **Combo (AsiSport + SaaSport):** `Grupos y Horarios` completo (con profesor y horario) y `Grupo *` **Obligatorio** en el formulario de alumno.

3. **Flujo Post-Inscripción y Archivo:**
   - **Al inscribir alumno nuevo en SaaSport:** si tiene `mensualidad > 0`, abre inmediatamente el modal **`Nota de Cargo` (`NotaServicios`)** rellenado con la mensualidad de ingreso listo para guardar (y cobrar si se desea); si el administrador cierra sin guardar, el borrador permanece en `Mensualidades Por Aprobar` como respaldo. Si la mensualidad es `0` o vacía (becado), no se abre la Nota de Cargo.
   - **Al archivar un alumno:** si tiene deuda pendiente en CxC, muestra advertencia informando el monto (aclarando que sigue cobrable en `CxC → Archivados`), libera el cupo activo y elimina automáticamente cualquier borrador automático aún no aprobado.

### Fase 3: Modo `SaaSport Lite`, Bloqueos Comerciales y Transición a `SaaSport`
> *(Decisiones alineadas el 2026-11-27)*

1. **Bloqueo de planes `Solo AsiSport`:**
   - Si la escuela tiene contratado únicamente el plan `AsiSport` (`incluye_saasport_lite = false` e `incluye_saasport_full = false`), se bloquea por completo la entrada a SaaSport redirigiendo a AsiSport *(la migración del Panel de Escuela hacia AsiSport se abordará más adelante)*.

2. **Las 3 secciones principales de `SaaSport Lite` y sus módulos auxiliares:**
   - Secciones operativas base: **`Cuentas por Cobrar`**, **`Alumnos`** y **`Caja y Bancos`**.
   - **`Caja y Bancos` en `SaaSport Lite`:**
     - Se crean por defecto únicamente 2 cajas fijas: **`Efectivo`** y **`Bancos`** (en Lite no se pueden crear nuevas cajas ni editar/cambiar sus nombres; al subir a *SaaSport normal* se desbloquea editarlas, renombrarlas y crear más cuentas conservando todo el historial).
     - Dentro de `Caja y Bancos` en Lite solo se permite **ver movimientos de cobros CxC** y hacer **Transferencias (`Efectivo ↔ Bancos`)**; quedan bloqueados `Ingreso Directo`, `Egresos` (`Pago CxP` y `Gasto Directo`) y `Nueva Caja`.
   - **`Mensualidades Por Aprobar` y `Cuentas` en `SaaSport Lite`:**
     - `Mensualidades Por Aprobar` permanece habilitado.
     - `Cuentas` permanece habilitado pero recortado exclusivamente a **conceptos de ingreso/servicio**, bloqueando *Inventario con stock* y *conceptos de Gasto*.

3. **Patrón Comercial de Candado (`🔒`) en PC vs Celular:**
   - **En PC:** los módulos exclusivos de *SaaSport normal* (`Cuentas por Pagar`, `Estadísticas`, `Inventario`, `Grupos y Horarios`, `Egresos/Nueva Caja`) se muestran atenuados con candado `🔒` y aviso *"Disponible en Plan SaaSport"*. De igual forma, cuando el plan no incluye *AsiSport*, el botón `AsiSport`, `Fotos de Asistencia` y el `Cobro según asistencias` se muestran con candado `🔒` *"Disponible al sumar AsiSport"*.
   - **En Celular:** los módulos no incluidos en el plan se ocultan por completo para mantener limpia la navegación móvil.
   - **Panel de Escuela (`TarjetaPlanCupos.tsx`):** ya implementado con desglose de plan, barra de cupos y alertas de margen/exceso.
