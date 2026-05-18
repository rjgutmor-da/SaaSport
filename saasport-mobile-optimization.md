# SaaSport — Plan de Optimización Móvil

## Contexto y objetivo

SaaSport tiene un problema de rendimiento en dispositivos móviles causado por tres factores:

1. **Imports estáticos** en `App.tsx` — el navegador descarga todo el JavaScript (incluyendo gráficos pesados de Estadísticas y AuditLog) antes de mostrar cualquier pantalla.
2. **CSS masivo** — `index.css` supera 3,000 líneas y 82KB, enfoque desktop-first.
3. **Sidebar fijo de 260px** — consume espacio crítico en pantallas pequeñas.

**Meta:** reducir la carga inicial en móvil y ofrecer una navegación adaptada a pantallas pequeñas.

**Módulos esenciales en móvil:**
- Alumnos / CxC (gestión de deudas y cobros)
- Cajas y Bancos (saldos y movimientos)

**Módulos ocultos en móvil:** Configuraciones, AuditLog, PanelEscuela, Estadísticas, RegistroActividad, CxP, Cuentas.

---

## Archivos a crear o modificar

| Acción | Archivo |
|--------|---------|
| CREAR  | `src/hooks/useIsMobile.ts` |
| CREAR  | `src/components/MobileNav.tsx` |
| MODIFICAR | `src/App.tsx` |
| MODIFICAR | `src/index.css` |

---

## Paso 1 — Crear `src/hooks/useIsMobile.ts`

Crea este archivo desde cero. Detecta si el dispositivo tiene pantalla ≤767px usando `matchMedia`, que es más eficiente que escuchar `resize` sobre `window.innerWidth`.

```ts
import { useState, useEffect } from 'react';

export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth < breakpoint
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}
```

**Por qué `matchMedia` y no `window.innerWidth` con listener:** el navegador ya tiene el cálculo del media query optimizado internamente. El listener de `change` solo se dispara cuando el breakpoint se cruza, no en cada pixel de resize. El `return` del `useEffect` elimina el listener cuando el componente se desmonta, evitando memory leaks.

---

## Paso 2 — Modificar `src/App.tsx` — reemplazar imports estáticos

### 2a. Localizar y eliminar los imports actuales (líneas ~20–30)

Busca y elimina este bloque exacto:

```tsx
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CuentasPagar from './pages/cxp/CuentasPagar';
import Cuentas from './pages/cuentas/Cuentas';
import Configuraciones from './pages/config/Configuraciones';
import AuditLog from './pages/config/AuditLog';
import PanelEscuela from './pages/config/PanelEscuela';
import CajasBancos from './pages/cajas-bancos/CajasBancos';
import Estadisticas from './pages/finanzas/estadisticas/Estadisticas';
import RegistroActividad from './pages/finanzas/RegistroActividad';
```

### 2b. Reemplazar con imports inteligentes

```tsx
import React, { Suspense } from 'react';
import { useIsMobile } from './hooks/useIsMobile';
import { MobileNav } from './components/MobileNav';

// Estáticos — siempre en el bundle (móvil los necesita)
import Dashboard     from './pages/Dashboard';
import Login         from './pages/Login';
import CuentasCobrar from './pages/cxc/CuentasCobrar';
import CajasBancos   from './pages/cajas-bancos/CajasBancos';

// Lazy — solo se descargan cuando el usuario navega a esa ruta
const CuentasPagar      = React.lazy(() => import('./pages/cxp/CuentasPagar'));
const Cuentas           = React.lazy(() => import('./pages/cuentas/Cuentas'));
const Configuraciones   = React.lazy(() => import('./pages/config/Configuraciones'));
const AuditLog          = React.lazy(() => import('./pages/config/AuditLog'));
const PanelEscuela      = React.lazy(() => import('./pages/config/PanelEscuela'));
const Estadisticas      = React.lazy(() => import('./pages/finanzas/estadisticas/Estadisticas'));
const RegistroActividad = React.lazy(() => import('./pages/finanzas/RegistroActividad'));
```

### 2c. Modificar el componente `App`

Localiza el componente principal (probablemente `const App = () => { ... }` o `function App()`) y aplica estos cambios:

**Agregar al inicio del componente:**
```tsx
const isMobile = useIsMobile();
```

**Ocultar el Sidebar en móvil.** Busca donde se renderiza `<Sidebar .../>` y condicionarlo:
```tsx
{/* ANTES */}
<Sidebar />

{/* DESPUÉS */}
{!isMobile && <Sidebar />}
```

**Agregar MobileNav justo después del Sidebar:**
```tsx
{isMobile && <MobileNav />}
```

**Envolver las rutas existentes con `Suspense` y condicionar las de desktop:**

```tsx
<Suspense fallback={
  <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
    Cargando...
  </div>
}>
  <Routes>
    {/* Rutas siempre disponibles (móvil y desktop) */}
    <Route path="/"              element={<Dashboard />} />
    <Route path="/login"         element={<Login />} />
    <Route path="/cxc"           element={<CuentasCobrar />} />
    <Route path="/cajas-bancos"  element={<CajasBancos />} />

    {/* Rutas solo para desktop — el celular nunca descarga estos módulos */}
    {!isMobile && (
      <>
        <Route path="/cxp"                element={<CuentasPagar />} />
        <Route path="/cuentas"            element={<Cuentas />} />
        <Route path="/estadisticas"       element={<Estadisticas />} />
        <Route path="/registro-actividad" element={<RegistroActividad />} />
        <Route path="/configuraciones"    element={<Configuraciones />} />
        <Route path="/audit-log"          element={<AuditLog />} />
        <Route path="/panel-escuela"      element={<PanelEscuela />} />
      </>
    )}

    {/* Si un móvil intenta acceder a una ruta de desktop, redirigir al inicio */}
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
</Suspense>
```

> **Nota:** si el `App.tsx` ya tiene un `<Suspense>` existente, no crear uno nuevo — agregar el `{!isMobile && ...}` dentro del bloque de rutas existente.

---

## Paso 3 — Crear `src/components/MobileNav.tsx`

Crea este archivo desde cero. Es una barra de navegación fija en la parte inferior, visible solo en móvil (su visibilidad ya está controlada desde `App.tsx` con `{isMobile && <MobileNav />}`).

```tsx
import { NavLink, useLocation } from 'react-router-dom';
import { Home, Users, Landmark } from 'lucide-react';

const tabs = [
  { to: '/',             icon: Home,     label: 'Inicio'  },
  { to: '/cxc',          icon: Users,    label: 'Alumnos' },
  { to: '/cajas-bancos', icon: Landmark, label: 'Cajas'   },
] as const;

export function MobileNav() {
  const location = useLocation();

  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        height: '64px',
        display: 'flex',
        borderTop: '1px solid var(--color-border, #e5e7eb)',
        backgroundColor: 'var(--color-background, #ffffff)',
        paddingBottom: 'env(safe-area-inset-bottom)', // soporte para notch en iPhone
      }}
    >
      {tabs.map(({ to, icon: Icon, label }) => {
        const isActive = to === '/'
          ? location.pathname === '/'
          : location.pathname.startsWith(to);

        return (
          <NavLink
            key={to}
            to={to}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              fontSize: '11px',
              fontWeight: isActive ? 600 : 400,
              textDecoration: 'none',
              color: isActive
                ? 'var(--color-primary, #2563eb)'
                : 'var(--color-text-secondary, #6b7280)',
              transition: 'color 0.15s ease',
            }}
          >
            <Icon
              size={22}
              strokeWidth={isActive ? 2.5 : 1.8}
            />
            {label}
          </NavLink>
        );
      })}
    </nav>
  );
}
```

> **Nota sobre `env(safe-area-inset-bottom)`:** agrega espacio automático en iPhones con notch (como iPhone X en adelante) para que los íconos no queden debajo del home indicator del sistema.

---

## Paso 4 — Modificar `src/index.css`

Agrega al **final del archivo** (no reemplazar nada existente):

```css
/* ============================================
   MOBILE OVERRIDES — agregado para optimización
   ============================================ */

@media (max-width: 767px) {

  /* Ocultar sidebar en móvil */
  .sidebar,
  [class*="sidebar"],
  aside {
    display: none !important;
  }

  /* Eliminar el margen/padding que el sidebar empujaba al contenido */
  .main-content,
  [class*="main-content"],
  main {
    margin-left: 0 !important;
    padding-left: 0 !important;
    width: 100% !important;
  }

  /* Espacio inferior para que el contenido no quede detrás del MobileNav */
  #root main,
  #root .content,
  #root [class*="content"] {
    padding-bottom: calc(64px + env(safe-area-inset-bottom));
  }

}
```

> **Nota importante:** si el sidebar usa un nombre de clase específico (por ejemplo `"w-64"` de Tailwind o una clase custom), ajustar el selector `.sidebar` al nombre real que aparece en el DOM. Inspeccionar con DevTools si hay duda.

---

## Verificación por pasos

Después de implementar cada paso, verificar lo siguiente:

### Paso 1 — Hook
```
✓ En consola del navegador (móvil o DevTools modo móvil):
  import { useIsMobile } from './hooks/useIsMobile'
  → debe devolver true en pantalla < 768px
```

### Paso 2 — Lazy imports
```
✓ Abrir DevTools → Network → filtrar por JS
✓ Al cargar la app en móvil NO deben aparecer chunks de:
  - estadisticas
  - configuraciones  
  - audit-log
✓ Solo deben cargar al navegar explícitamente a esas rutas (desde desktop)
```

### Paso 3 — MobileNav
```
✓ En móvil: barra inferior visible con 3 íconos
✓ En desktop: barra inferior NO visible, sidebar normal
✓ El ícono activo cambia de color al navegar
✓ El contenido NO queda tapado detrás del nav
```

### Paso 4 — CSS
```
✓ En móvil: no hay scroll horizontal
✓ El contenido ocupa el 100% del ancho
✓ No hay espacio vacío a la izquierda (donde estaba el sidebar)
```

---

## Resultado esperado

| Métrica | Antes | Después |
|---------|-------|---------|
| JS descargado en móvil al inicio | ~100% del bundle | Solo módulos esenciales |
| Sidebar en móvil | 260px fijos | Oculto |
| Navegación en móvil | Sidebar (inutilizable) | Bottom nav con 3 tabs |
| Rutas de desktop en móvil | Accesibles (pero lentas) | Redirigen a `/` |
| Soporte rotación | Estático | Reactivo via matchMedia |

---

## Dependencias requeridas

Estas dependencias ya deben estar instaladas en SaaSport. Si alguna falta, instalar:

```bash
# lucide-react para los íconos del MobileNav
npm install lucide-react

# react-router-dom para NavLink y useLocation (probablemente ya instalado)
npm install react-router-dom
```

---

## Notas para el agente de codificación

1. **No borrar** ninguna ruta existente del `App.tsx` — solo condicionarlas con `{!isMobile && ...}`.
2. **No modificar** los componentes individuales (`CuentasCobrar`, `CajasBancos`, etc.) — todos los cambios son en `App.tsx`, el hook y el nuevo componente de navegación.
3. Si `App.tsx` ya usa `React.lazy` en algún lugar, mantener esos lazy imports y solo agregar los nuevos.
4. Si el proyecto usa un sistema de variables CSS diferente al estándar (por ejemplo variables de Tailwind o un tema custom), ajustar los `var(--color-*)` en `MobileNav.tsx` a las variables reales del proyecto.
5. El `<Navigate>` en la ruta `*` requiere importar `Navigate` de `react-router-dom`. Verificar que el import exista.
