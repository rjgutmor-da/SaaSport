# Reglas de Workspace — SaaSport

## Rendimiento y Consultas Masivas a la Base de Datos

1. **Protección contra Consultas Masivas / Intervalos "Total"**:
   - Si el usuario solicita implementar una consulta, botón o filtro masivo (como el intervalo "Total" sin acotar por fechas o sin paginación estricta), el asistente **NO debe implementarlo directamente**.
   - El asistente debe **advertir del impacto de rendimiento** en la base de datos y en la interfaz, y **preguntar dos veces al usuario** para confirmar explícitamente antes de proceder.

2. **Detección y Aviso Proactivo**:
   - Si durante el análisis, depuración o desarrollo el asistente detecta consultas a la base de datos que recuperen datos históricos sin rango de fechas (`periodo`, `fecha_emision`, etc.) o sin paginación, debe **avisar proactivamente al usuario** sugiriendo acotar la consulta con filtros por mes, año o paginación en lotes.

## Navegación Móvil y Nuevas Pestañas (`MobileNav`)

1. **Restricción de nuevas pestañas móviles**:
   - Si una tarea o requerimiento involucra la creación o adición de nuevas pestañas en la barra inferior (`MobileNav.tsx`) o habilitar nuevas rutas generales para dispositivos móviles (`isMobile`), el asistente **NO debe incorporarlas automáticamente**.
   - El asistente debe **consultar primero al usuario** si desea incluir dicha pestaña/sección en la versión móvil o si debe permanecer exclusiva para PC/escritorio.
