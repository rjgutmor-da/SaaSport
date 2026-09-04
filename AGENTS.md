# Reglas de Workspace — SaaSport

## Rendimiento y Consultas Masivas a la Base de Datos

1. **Protección contra Consultas Masivas / Intervalos "Total"**:
   - Si el usuario solicita implementar una consulta, botón o filtro masivo (como el intervalo "Total" sin acotar por fechas o sin paginación estricta), el asistente **NO debe implementarlo directamente**.
   - El asistente debe **advertir del impacto de rendimiento** en la base de datos y en la interfaz, y **preguntar dos veces al usuario** para confirmar explícitamente antes de proceder.

2. **Detección y Aviso Proactivo**:
   - Si durante el análisis, depuración o desarrollo el asistente detecta consultas a la base de datos que recuperen datos históricos sin rango de fechas (`periodo`, `fecha_emision`, etc.) o sin paginación, debe **avisar proactivamente al usuario** sugiriendo acotar la consulta con filtros por mes, año o paginación en lotes.
