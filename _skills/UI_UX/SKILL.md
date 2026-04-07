---
name: "SaaSport UI/UX Guidelines"
description: "Guías de diseño de interfaz de usuario y experiencia de usuario basadas en AsiSport, adaptadas con toques de azul y verde para el proyecto SaaSport."
---

# Skill de UI/UX para SaaSport

Esta skill documenta las reglas, tokens y componentes principales para asegurar que el diseño y experiencia de usuario en **SaaSport** mantenga el estilo premium y profesional de AsiSport, pero con su propia personalidad, incorporando detalles en azul y verde.

## 1. Tokens de Diseño (Variables CSS/Tailwind)

Para mantener la coherencia térmica de modo oscuro (Dark Mode), reutilizaremos las bases oscuras pero adaptaremos los colores principales.

### Colores Principales
- **Fondo Principal (Background):** `#0A0A0A` (Gris casi negro puro).
- **Superficie (Surface):** `#1A1A1A` (Usado para tarjetas y barras laterales).
- **Primario (Primary):** `#FF6B35` (Naranja característico de AsiSport). Usar este color para mantener la identidad visual de la familia de soluciones, ideal para llamadas a la acción principales y hover de tarjetas base.
- **Detalles o Acentos (Accent 1 y 2):** `#0A84FF` (Azul vibrante) y `#00D26A` (Verde vibrante). Útiles para reflejar la personalidad propia del nuevo proyecto, destacar métricas, dar toques de color en iconos secundarios y bordes alternativos.

### Colores de Borde
- **Borde Inactivo:** `#2D2D2D`
- **Borde Activo / Hover:** Usar color Primario (`#FF6B35`), o bien los tonos de acento Azul (`#0A84FF`) o Verde (`#00D26A`) según el contexto de la tarjeta.

### Texto
- **Primario:** `#FFFFFF` (Blanco puro para asegurar contraste).
- **Secundario:** `#A0A0A0` (Gris para textos descriptivos y subtítulos).

## 2. Tipografía

Seguimos una tipografía muy limpia y legible, usando tipografía sin serifa para todo, con variaciones ocasionales si se requiere estilo "Display".

- **Primaria:** `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;`
- **Fuente Decorativa (Brush/Display):** Conservamos la idea de `Permanent Marker` o una fuente audaz moderna para títulos especiales (marcador de puntuación, logos).

### Comportamiento y Estilo de Componentes (Tarjetas / Cards)

Las tarjetas (como HeroCard, CxP, y Finanzas) son la pieza central de navegación y presentación de datos. Tienen un diseño de "Borde Blanco Fuerte" que se ilumina con acentos exclusivos en Hover, para amalgamar la limpieza de UI con el esquema de SaaSport.

Las clases de Tailwind recomendadas para una tarjeta estándar:

```jsx
// Ejemplo de Tarjeta Reactiva
<button
    className="
        bg-surface 
        border-[3px] border-[#FFFFFF] /* Todas las tarjetas deben ser blancas incialmente */
        rounded-md 
        p-8 md:p-14 /* Tienen que ser altas para ocupar más espacio */
        min-h-[280px]
        flex flex-col items-center justify-center gap-4
        hover:border-[#FF6B35] /* Naranja (Opciones: #0A84FF Azul o #00D26A Verde) */
        active:scale-[0.98]
        hover:-translate-y-[1px]
        hover:shadow-lg
        transition-all duration-300 ease-in-out
        cursor-pointer
    "
>
    {/* Contenido de la Tarjeta */}
</button>
```

### Características Clave de las Interacciones:
1. **Transiciones:** `transition-all duration-300 ease-in-out`. Todas las tarjetas e ítems clickeables deben tener animaciones suaves.
2. **Efecto de Presión (Active):** `active:scale-[0.98]`. Las tarjetas deben achicarse ligeramente cuando el usuario hace clic.
3. **Efecto de Flotación (Hover):** `hover:-translate-y-[1px] hover:shadow-lg`. Simula que la tarjeta se levanta al poner el ratón encima.
4. **Iluminación del borde estricta (Hover Border):** El borde grueso de `#FFFFFF` transiciona **ESTRICTAMENTE** a uno de estos 3 colores: Naranja (`#FF6B35`), Azul (`#0A84FF`), o Verde (`#00D26A`). Quedan prohibidos colores como fucsia, rojo y amarillo en el hover principal.
5. **Menú Superior (Navbar):** Los enlaces de la barra superior son más grandes (+20%), de color completamente blanco y se colorean de manera congruente (ej. Naranja) al pasar el cursor por encima.

## 4. Patrones de Diseño a Replicar en SaaSport

- **Oscuridad Rica:** No usar grises claros en el contenido oscuro, siempre quedarse en el espectro del `#0A0A0A` a `#1A1A1A`.
- **Botones Dinámicos:** Los botones primarios principales deben mantener el fondo naranja (`#FF6B35`), pero se pueden generar variantes secundarias u hover con gradientes sutiles que incorporen el azul y el verde para acciones de SaaSport.
- **Glassmorfismo Leve:** Para modales y menús sobrepuestos emparejado con un leve `backdrop-blur`.
- **Textura y Consistencia:** Usar consistencia estricta en radios de bordes (`rounded-md` como estándar base).

## 5. Menú Superior (Navbar)

El menú superior en escritorio utiliza un estilo tipográfico audaz y minimalista que facilita la navegación rápida.

### Tipografía y Tamaños
- **Logo / Título de App:** `text-[39px]` con `font-black`. Color base: Primario (`#FF6B35`).
- **Items de Navegación:** `text-[23px]`. 
  - **Item Activo:** `text-white` con `font-bold`.
  - **Item Inactivo:** `text-text-secondary` (`#A0A0A0`) con `font-medium`.

### Efectos y Transiciones
1. **Hover en Navegación:** `hover:text-primary`. Al pasar el ratón, el texto cambia suavemente al color naranja primario.
2. **Transición de Color:** `transition-colors`. Asegura que el cambio entre el gris secundario y el naranja sea fluido.
3. **Distribución:** Gap de `8` (`32px`) entre el logo y el grupo de navegación, y gap de `6` (`24px`) entre los items de navegación.

### Configuración (Settings)
- El botón de ajustes usa un icono de tamaño `32` (`Settings size={32}`) en color blanco, con un efecto de hover sutil: `hover:bg-surface` y `transition-fast`.

## Resumen de Integración
Copia los colores aquí mencionados a las variables del `index.css` de tu proyecto hermano de SaaSport, asegurándote de usar Tailwind para mapear esos colores como `primary` y `accent`. Las interacciones de estado `hover:` y `active:` son no negociables para alcanzar la experiencia de alta gama (premium).
