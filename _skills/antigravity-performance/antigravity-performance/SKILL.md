---
name: antigravity-performance
description: >
  Optimiza el rendimiento de apps React + Vite + Supabase eliminando peticiones redundantes,
  waterfalls y falta de caché entre navegaciones. Úsalo SIEMPRE que el usuario mencione:
  carga lenta, peticiones repetidas a Supabase, falta de caché, módulos que re-fetchean datos,
  TanStack Query, React Query, optimización de queries, staleTime, prefetch, o cualquier
  problema de performance en su SPA con Supabase. También activar cuando el usuario diga
  "el dashboard es lento", "se vuelven a pedir los datos", "cada módulo hace su propia query",
  "Promise.all que saturan", o "los datos se pierden al cambiar de ruta".
---

# Antigravity Performance Skill
## React + Vite + Supabase — Eliminación de peticiones redundantes

### Diagnóstico rápido

Antes de aplicar soluciones, confirma cuál de estos patrones tiene el proyecto:

| Síntoma | Causa raíz | Solución |
|---|---|---|
| Cada módulo re-pide `alumnos`, `profesores`, etc. | Sin caché global | TanStack Query + `staleTime` alto |
| Dashboard dispara 5+ fetches simultáneos | Waterfall / Promise.all no coordinado | `useQueries` + prefetch al login |
| Volver a un módulo descarga datos otra vez | Estado en componente, no en caché | Mover estado a QueryClient global |

---

## Paso 1 — Instalación

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

---

## Paso 2 — Configurar QueryClient global en `main.tsx`

```tsx
// main.tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Datos maestros: 10 minutos sin re-fetch
      staleTime: 1000 * 60 * 10,
      // Mantener en caché 30 minutos tras desmontar
      gcTime: 1000 * 60 * 30,
      // No re-fetch al re-enfocar ventana (evita sorpresas)
      refetchOnWindowFocus: false,
      // Reintentar solo 1 vez en error
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
    <ReactQueryDevtools initialIsOpen={false} />
  </QueryClientProvider>
)
```

> **Por qué `staleTime: 10min`?** Los datos maestros (alumnos, profesores, canchas, horarios)
> no cambian cada segundo. Sin `staleTime`, TanStack Query re-fetchea en cada mount aunque
> los datos sean idénticos.

---

## Paso 3 — Hooks centralizados para datos maestros

Crear `/src/hooks/useMasterData.ts`:

```ts
import { useQuery, useQueries } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ─── Query Keys (centralizados para invalidación precisa) ───
export const queryKeys = {
  alumnos: ['alumnos'] as const,
  profesores: ['profesores'] as const,
  canchas: ['canchas'] as const,
  horarios: ['horarios'] as const,
  estadisticas: (filtros?: object) => ['estadisticas', filtros] as const,
}

// ─── Fetchers ───
const fetchAlumnos = async () => {
  const { data, error } = await supabase.from('alumnos').select('*')
  if (error) throw error
  return data
}

const fetchProfesores = async () => {
  const { data, error } = await supabase.from('profesores').select('*')
  if (error) throw error
  return data
}

const fetchCanchas = async () => {
  const { data, error } = await supabase.from('canchas').select('*')
  if (error) throw error
  return data
}

const fetchHorarios = async () => {
  const { data, error } = await supabase.from('horarios').select('*')
  if (error) throw error
  return data
}

// ─── Hooks individuales ───
export const useAlumnos = () =>
  useQuery({ queryKey: queryKeys.alumnos, queryFn: fetchAlumnos })

export const useProfesores = () =>
  useQuery({ queryKey: queryKeys.profesores, queryFn: fetchProfesores })

export const useCanchas = () =>
  useQuery({ queryKey: queryKeys.canchas, queryFn: fetchCanchas })

export const useHorarios = () =>
  useQuery({ queryKey: queryKeys.horarios, queryFn: fetchHorarios })

// ─── Hook combinado (reemplaza Promise.all en dashboard) ───
// Dispara TODAS las queries en paralelo, sin waterfall
export const useMasterData = () => {
  const results = useQueries({
    queries: [
      { queryKey: queryKeys.alumnos, queryFn: fetchAlumnos },
      { queryKey: queryKeys.profesores, queryFn: fetchProfesores },
      { queryKey: queryKeys.canchas, queryFn: fetchCanchas },
      { queryKey: queryKeys.horarios, queryFn: fetchHorarios },
    ],
  })

  const [alumnos, profesores, canchas, horarios] = results

  return {
    alumnos: alumnos.data,
    profesores: profesores.data,
    canchas: canchas.data,
    horarios: horarios.data,
    isLoading: results.some(r => r.isLoading),
    isError: results.some(r => r.isError),
  }
}
```

---

## Paso 4 — Prefetch al iniciar sesión (elimina latencia en primer módulo)

En el componente de login o en el router root, disparar prefetch una vez autenticado:

```tsx
// src/components/AuthProvider.tsx (o donde manejes el auth)
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/useMasterData'
import { supabase } from '@/lib/supabase'

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()

  const prefetchMasterData = async () => {
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: queryKeys.alumnos,
        queryFn: () => supabase.from('alumnos').select('*').then(r => r.data),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.profesores,
        queryFn: () => supabase.from('profesores').select('*').then(r => r.data),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.canchas,
        queryFn: () => supabase.from('canchas').select('*').then(r => r.data),
      }),
      queryClient.prefetchQuery({
        queryKey: queryKeys.horarios,
        queryFn: () => supabase.from('horarios').select('*').then(r => r.data),
      }),
    ])
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        prefetchMasterData()
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  return <>{children}</>
}
```

---

## Paso 5 — Migrar módulos existentes

### Patrón antes (problemático):
```tsx
// ❌ Estadísticas.tsx — re-fetchea cada vez que monta
const [alumnos, setAlumnos] = useState([])
useEffect(() => {
  supabase.from('alumnos').select('*').then(({ data }) => setAlumnos(data))
}, [])
```

### Patrón después (con caché):
```tsx
// ✅ Estadísticas.tsx — usa caché, 0 peticiones si ya se cargó
import { useAlumnos } from '@/hooks/useMasterData'

const { data: alumnos, isLoading } = useAlumnos()
```

---

## Paso 6 — Invalidación selectiva al mutar datos

Cuando el usuario registra un alumno nuevo, invalida **solo** esa query:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/hooks/useMasterData'

const queryClient = useQueryClient()

const registrarAlumno = async (nuevoAlumno) => {
  await supabase.from('alumnos').insert(nuevoAlumno)
  // Solo re-fetchea alumnos, no todo lo demás
  queryClient.invalidateQueries({ queryKey: queryKeys.alumnos })
}
```

---

## Checklist de migración

- [ ] Instalar `@tanstack/react-query`
- [ ] Configurar `QueryClient` en `main.tsx` con `staleTime` y `gcTime`
- [ ] Crear `/src/hooks/useMasterData.ts` con hooks centralizados
- [ ] Agregar prefetch en `AuthProvider` al `SIGNED_IN`
- [ ] Reemplazar `useEffect + fetch` en cada módulo con hooks centralizados
- [ ] Agregar `invalidateQueries` en mutaciones (insert/update/delete)
- [ ] Verificar con **React Query Devtools** que el caché funciona (los requests deben aparecer solo 1 vez)
- [ ] Crear `useAlumnosRealtime` y montarlo en el layout raíz (no en el módulo)
- [ ] Habilitar Replication para tabla `alumnos` en Supabase Dashboard → Database → Replication

---

## Referencia rápida de `staleTime` por tipo de dato

| Tipo de dato | `staleTime` recomendado | `gcTime` recomendado |
|---|---|---|
| Datos maestros (alumnos, profesores) | 10 minutos | 30 minutos |
| Horarios / canchas | 5 minutos | 15 minutos |
| Estadísticas del día | 2 minutos | 10 minutos |
| Datos en tiempo real | 0 (+ Supabase Realtime) | 5 minutos |

---

## Paso 7 — Supabase Realtime (solo `alumnos`, actualización silenciosa)

**Patrón:** el admin agrega un alumno → Realtime lo detecta → invalida caché silenciosamente
→ el entrenador ve datos frescos la próxima vez que navega a "Lista de Alumnos". Sin toasts, sin interrupciones.

Crear `/src/hooks/useAlumnosRealtime.ts`:

```ts
import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { queryKeys } from '@/hooks/useMasterData'

export const useAlumnosRealtime = () => {
  const queryClient = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('alumnos-changes')
      .on(
        'postgres_changes',
        {
          event: '*',        // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'alumnos',
        },
        () => {
          // Silencioso: solo marca el caché como stale
          // TanStack Query re-fetchea cuando el entrenador navegue al módulo
          queryClient.invalidateQueries({ queryKey: queryKeys.alumnos })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient])
}
```

Activar **una sola vez** en el layout raíz (no en cada módulo):

```tsx
// src/layouts/AppLayout.tsx
import { useAlumnosRealtime } from '@/hooks/useAlumnosRealtime'

export function AppLayout({ children }) {
  useAlumnosRealtime() // ← una instancia global, siempre activa
  return <>{children}</>
}
```

> ⚠️ **Por qué en el layout raíz y no en `ListaAlumnos.tsx`?**
> Si lo pones en el componente del módulo, el canal se destruye cuando el entrenador navega a otra pantalla — justo cuando el admin podría estar agregando alumnos. En el layout, el canal vive toda la sesión.

> ⚠️ **Prerequisito Supabase:** Habilitar Replication para la tabla `alumnos` en
> Supabase Dashboard → Database → Replication → `supabase_realtime` publication → añadir `alumnos`.

---

### Flujo completo al agregar un alumno

```
Admin inserta alumno en Supabase
        ↓
Supabase Realtime emite evento INSERT
        ↓
useAlumnosRealtime detecta el evento
        ↓
invalidateQueries({ queryKey: ['alumnos'] })
        ↓
Caché marcado como stale (sin re-fetch inmediato)
        ↓
Entrenador navega a "Lista de Alumnos"
        ↓
TanStack Query detecta stale → re-fetch automático
        ↓
Lista actualizada ✅ (sin interrupciones previas)
```
