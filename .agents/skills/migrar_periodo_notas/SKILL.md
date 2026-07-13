---
name: migrar_periodo_notas
description: Migra el periodo especifico/detalle_extra a fechas de ciclo y recalcula el periodo estadístico para la última nota de mensualidad de los alumnos de una escuela.
---

# Instrucciones

Cuando el usuario te pida migrar o trasladar el "Periodo Especifico" a "Inicio y Fin de Ciclo" para las Notas de Servicio de otra escuela, sigue estos pasos:

1. **Obtén el ID de la Escuela:** Usa la herramienta `execute_sql` (de `supabase`) para buscar el `id` de la escuela (ej. `SELECT id, nombre FROM public.escuelas WHERE nombre ILIKE '%NombreEscuela%';`).
2. **Ejecuta el Script SQL de Migración:** Utiliza `execute_sql` con la siguiente transacción. Recuerda reemplazar el valor de `escuela_id` en la cláusula `WHERE` del CTE `cxc_alumno_orden` por el ID de la escuela objetivo. El script asume que el año de facturación a usar será `2026` y omitirá cualquier texto en el detalle que no sea un rango de fechas.

## Script SQL

```sql
BEGIN;

-- 1. Crear tabla temporal con los cambios calculados para validación previa
CREATE TEMP TABLE temp_actualizaciones AS
WITH cxc_alumno_orden AS (
    SELECT cc.id, cc.fecha_emision, cc.periodo, cc.periodo_estadistico, cc.ciclo_inicio, cc.ciclo_fin, cc.alumno_id,
           a.nombres, a.apellidos, cd.detalle_extra,
           ROW_NUMBER() OVER (PARTITION BY cc.alumno_id ORDER BY cc.fecha_emision DESC, cc.periodo DESC) as rn
    FROM public.cuentas_cobrar cc
    JOIN public.cxc_detalle cd ON cd.cuenta_cobrar_id = cc.id
    JOIN public.alumnos a ON a.id = cc.alumno_id
    JOIN public.catalogo_items ci ON ci.id = cd.catalogo_item_id
    WHERE cc.escuela_id = 'AQUI_PONES_EL_ID_DE_LA_ESCUELA'
      AND lower(ci.nombre) = 'mensualidad'
      AND cc.anulada IS NOT TRUE
      AND cc.es_anticipo IS NOT TRUE
),
candidatos AS (
    SELECT id, nombres, apellidos, detalle_extra, fecha_emision,
           regexp_match(detalle_extra, '^(\d+)\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)\s+(?:a|al)\s+(\d+)\s+([a-zA-ZáéíóúÁÉÍÓÚ]+)$') as partes
    FROM cxc_alumno_orden
    WHERE rn = 1 AND detalle_extra IS NOT NULL AND detalle_extra <> ''
),
mapeo_meses AS (
    SELECT id, nombres, apellidos, detalle_extra, fecha_emision,
           partes[1]::integer as dia_ini,
           CASE lower(partes[2])
               WHEN 'ene' THEN 1 WHEN 'enero' THEN 1
               WHEN 'feb' THEN 2 WHEN 'febrero' THEN 2
               WHEN 'mar' THEN 3 WHEN 'marzo' THEN 3
               WHEN 'abr' THEN 4 WHEN 'abril' THEN 4
               WHEN 'may' THEN 5 WHEN 'mayo' THEN 5
               WHEN 'jun' THEN 6 WHEN 'junio' THEN 6
               WHEN 'jul' THEN 7 WHEN 'julio' THEN 7
               WHEN 'ago' THEN 8 WHEN 'agosto' THEN 8
               WHEN 'sep' THEN 9 WHEN 'septiembre' THEN 9
               WHEN 'oct' THEN 10 WHEN 'octubre' THEN 10
               WHEN 'nov' THEN 11 WHEN 'noviembre' THEN 11
               WHEN 'dic' THEN 12 WHEN 'diciembre' THEN 12
           END as mes_ini,
           partes[3]::integer as dia_fin,
           CASE lower(partes[4])
               WHEN 'ene' THEN 1 WHEN 'enero' THEN 1
               WHEN 'feb' THEN 2 WHEN 'febrero' THEN 2
               WHEN 'mar' THEN 3 WHEN 'marzo' THEN 3
               WHEN 'abr' THEN 4 WHEN 'abril' THEN 4
               WHEN 'may' THEN 5 WHEN 'mayo' THEN 5
               WHEN 'jun' THEN 6 WHEN 'junio' THEN 6
               WHEN 'jul' THEN 7 WHEN 'julio' THEN 7
               WHEN 'ago' THEN 8 WHEN 'agosto' THEN 8
               WHEN 'sep' THEN 9 WHEN 'septiembre' THEN 9
               WHEN 'oct' THEN 10 WHEN 'octubre' THEN 10
               WHEN 'nov' THEN 11 WHEN 'noviembre' THEN 11
               WHEN 'dic' THEN 12 WHEN 'diciembre' THEN 12
           END as mes_fin
    FROM candidatos
    WHERE partes IS NOT NULL
),
fechas_calculadas AS (
    SELECT id, nombres, apellidos, detalle_extra, fecha_emision,
           make_date(2026, mes_ini, dia_ini) as nuevo_ciclo_inicio,
           make_date(2026, mes_fin, dia_fin) as nuevo_ciclo_fin
    FROM mapeo_meses
    WHERE mes_ini IS NOT NULL AND mes_fin IS NOT NULL
)
SELECT id, nombres, apellidos, detalle_extra, fecha_emision,
       nuevo_ciclo_inicio, nuevo_ciclo_fin,
       public.calcular_periodo_estadistico(nuevo_ciclo_inicio) as nuevo_periodo_estadistico,
       to_char(public.calcular_periodo_estadistico(nuevo_ciclo_inicio), 'YYYY-MM') as nuevo_periodo
FROM fechas_calculadas;

-- 2. Ejecutar la actualización masiva
UPDATE public.cuentas_cobrar cc
SET ciclo_inicio = t.nuevo_ciclo_inicio,
    ciclo_fin = t.nuevo_ciclo_fin,
    periodo_estadistico = t.nuevo_periodo_estadistico,
    periodo = t.nuevo_periodo
FROM temp_actualizaciones t
WHERE cc.id = t.id;

-- 3. Reportar los cambios efectuados
SELECT nombres, apellidos, detalle_extra, nuevo_ciclo_inicio, nuevo_ciclo_fin, nuevo_periodo_estadistico, nuevo_periodo
FROM temp_actualizaciones;

COMMIT;
```

3. **Verifica los Cambios:** Analiza la salida de la transacción SQL para confirmar cuántos registros fueron modificados e infórmalo al usuario. Si no hay modificaciones o existe algún problema, comunícaselo.
