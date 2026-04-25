---
name: antigravity-data-layer
description: >
  Define dónde deben vivir los cálculos y agregaciones en la app Antigravity (React + Vite + Supabase + PostgreSQL).
  Úsalo SIEMPRE que el usuario pregunte: "¿esto va en el frontend o backend?", "¿debo mover este cálculo?",
  "¿necesito caché para esto?", "¿uso una vista o materialized view?", o cuando el agente esté a punto
  de hacer un `.map()` / `.reduce()` sobre datos que vienen de Supabase, o cuando diseñe queries de
  acumulados, totales, comparaciones de periodos, o estadísticas de ventas/inventario.
  También activar cuando el usuario mencione: "ventas del mes", "acumulado", "vista de inventario",
  "v_inventario", "cálculo pesado en el front", "sumar transacciones", o "¿necesito Redis?".
---

# Antigravity — Data Layer Decision Skill

Guía para decidir **dónde vive cada cálculo** en la app, con criterios calibrados al volumen real del proyecto.

---

## El Principio Central

> **No mandes los ingredientes al comensal para que cocine. Mándale el plato.**

Si el frontend necesita un número (ej: `$847,320` en ventas del mes), no debe recibir 10,000 filas para sumarlo él mismo. La base de datos suma más rápido, transmite menos datos, y no expone registros sensibles.

---

## Árbol de Decisión: ¿Dónde va el cálculo?

```
¿El cálculo necesita datos que ya están en el frontend?
├── SÍ → Calcúlalo en el frontend (sort, filter, format de UI)
└── NO → ¿Cuántos registros involucra?
         ├── < 500 filas → Frontend está bien, pero considera moverlo igual
         │                 si la lógica es compleja o sensible
         └── > 500 filas → Backend / Base de datos obligatorio
                           └── ¿Cambia cada cuánto?
                               ├── Cada segundo → Supabase Realtime
                               ├── Cada minuto/hora → VIEW normal
                               ├── 1-2 veces al día → VIEW normal ✅ suficiente
                               └── Una vez al día o menos → MATERIALIZED VIEW
```

---

## Tabla de Referencia por Tipo de Cálculo

| Cálculo | Dónde | Por qué |
|---|---|---|
| Ordenar una tabla de 20 filas | Frontend | Ya están en memoria, latencia 0 |
| Filtrar por texto (search) | Frontend | Instantáneo sobre datos cargados |
| Formatear fechas / moneda | Frontend | Lógica de presentación, no de datos |
| `SUM` de ventas del mes | **PostgreSQL (VIEW)** | Evita traer N filas al browser |
| Comparar mes actual vs anterior | **PostgreSQL (VIEW)** | 2 agregaciones, 1 viaje de red |
| Top 10 productos más vendidos | **PostgreSQL (VIEW)** | Ordenar + limitar en DB es O(log N) |
| Totales para un dashboard de KPIs | **PostgreSQL (VIEW)** | El front solo recibe los números finales |
| Reporte histórico pesado (años) | **PostgreSQL (MATERIALIZED VIEW)** | Precalculado, refresco programado |

---

## Para Antigravity: Volumen y Reglas Prácticas

Con **~50 transacciones/día**, estas son las reglas calibradas al proyecto:

### ✅ Lo que YA está bien hecho
- `v_inventario` como **VIEW en PostgreSQL** — correcto para este volumen
- Eliminación de `.map()` / `.reduce()` en el frontend
- Datos de acumulados calculados en DB, no en el browser

### ❌ Lo que sería sobreingeniería para este volumen
- **Materialized View**: No necesaria. PostgreSQL suma 50 filas en microsegundos.
- **Redis / caché externo**: No necesario. El overhead de red a Redis > el cálculo mismo.
- **Edge Functions para agregaciones**: Innecesario si la VIEW es suficiente.

> **Regla de oro para Antigravity:** Si el volumen es < 10,000 filas y cambia < 10 veces/hora, una VIEW normal en PostgreSQL + TanStack Query con `staleTime` adecuado es la combinación correcta.

---

## Patrón Recomendado: VIEW + TanStack Query

La combinación que maximiza rendimiento sin complejidad innecesaria:

```sql
-- PostgreSQL: la DB hace el trabajo pesado
CREATE OR REPLACE VIEW v_ventas_resumen AS
SELECT
  producto_id,
  nombre,
  SUM(monto) FILTER (WHERE fecha >= date_trunc('month', now()))  AS ventas_mes_actual,
  SUM(monto) FILTER (WHERE fecha >= date_trunc('month', now() - interval '1 month')
                     AND fecha  <  date_trunc('month', now()))   AS ventas_mes_anterior,
  SUM(monto)                                                     AS ventas_total
FROM movimientos_stock
GROUP BY producto_id, nombre;
```

```tsx
// Frontend: solo consume el número final
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export const useVentasResumen = () =>
  useQuery({
    queryKey: ['ventas-resumen'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_ventas_resumen').select('*')
      if (error) throw error
      return data
    },
    // Cambia 1-2 veces al día → 10 minutos de caché es más que suficiente
    staleTime: 1000 * 60 * 10,
  })
```

---

## Cuándo Escalar (criterios futuros)

Si el proyecto crece, estos son los umbrales para reconsiderar:

| Señal | Acción |
|---|---|
| Queries de VIEW tardan > 500ms | Convertir a MATERIALIZED VIEW con refresh automático |
| Mismos datos pedidos por 100+ usuarios simultáneos | Agregar caché a nivel de API (no aplica aún) |
| Tablas superan 1M de filas | Agregar índices en columnas de fecha/producto |
| Reportes históricos > 2 años de datos | MATERIALIZED VIEW + `pg_cron` para refresh nocturno |

---

## Checklist antes de escribir código

Antes de cualquier query o componente nuevo, responder:

- [ ] ¿Este cálculo necesita datos que no están en el frontend? → ir a DB
- [ ] ¿Cuántas filas involucra? → si > 500, definitivamente en DB
- [ ] ¿Qué le llega al frontend? → debe ser el **resultado**, no los ingredientes
- [ ] ¿Cada cuánto cambia? → determina el `staleTime` de TanStack Query
- [ ] ¿Existe ya una VIEW para esto? → reusar antes de crear nueva

---

## Integración con el skill `antigravity-performance`

Este skill define **dónde vive el cálculo**. El skill `antigravity-performance` define **cómo se cachea en el frontend**. Se usan juntos:

1. Este skill → decidir si el cálculo va en DB, backend o frontend
2. `antigravity-performance` → configurar TanStack Query para no re-fetchear innecesariamente
