-- La inscripción o restauración y su borrador se confirman en la misma transacción.
ALTER TABLE public.cuentas_cobrar
  ADD COLUMN es_mensualidad_ingreso boolean NOT NULL DEFAULT false;

CREATE TABLE public.mensualidades_ingreso (
  alumno_id uuid PRIMARY KEY REFERENCES public.alumnos(id) ON DELETE CASCADE,
  cuenta_id uuid UNIQUE REFERENCES public.cuentas_cobrar(id) ON DELETE SET NULL,
  fecha_ingreso date NOT NULL,
  ciclo_inicio date,
  ciclo_fin date,
  monto numeric,
  motivo text CHECK (motivo IN ('sin_tarifa', 'tarifa_cero'))
);

ALTER TABLE public.mensualidades_ingreso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mensualidades_ingreso FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.mensualidades_ingreso TO authenticated;
CREATE POLICY mensualidad_ingreso_lectura ON public.mensualidades_ingreso
FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.alumnos a
          WHERE a.id = alumno_id AND a.escuela_id = (SELECT public.current_user_escuela_id()))
);

CREATE FUNCTION private.fin_ciclo_ingreso(p_inicio date)
RETURNS date LANGUAGE sql IMMUTABLE STRICT SET search_path = '' AS $$
  SELECT (p_inicio + interval '1 month' - interval '1 day')::date
$$;

-- Detecta tanto solapamientos de fechas como periodos estadísticos ya ocupados.
CREATE FUNCTION private.conflicto_ciclo_ingreso(
  p_escuela uuid, p_alumno uuid, p_inicio date, p_fin date, p_excluir uuid
) RETURNS date LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT max(GREATEST(COALESCE(n.ciclo_fin, d.ciclo_fin), p_inicio))
  FROM public.cuentas_cobrar n
  LEFT JOIN public.cxc_detalle d ON d.cuenta_cobrar_id = n.id AND d.ciclo_inicio IS NOT NULL
  WHERE n.escuela_id = p_escuela AND n.alumno_id = p_alumno
    AND n.id IS DISTINCT FROM p_excluir
    AND n.anulada IS NOT TRUE AND n.es_anticipo IS NOT TRUE
    AND (
      n.periodo_estadistico = public.calcular_periodo_estadistico(p_inicio, p_fin)
      OR d.periodo_estadistico = public.calcular_periodo_estadistico(p_inicio, p_fin)
      OR (n.periodo_estadistico IS NULL
          AND public.cxc_legacy_cubre_periodo(n.id, public.calcular_periodo_estadistico(p_inicio, p_fin)))
      OR (COALESCE(d.ciclo_inicio, n.ciclo_inicio) <= p_fin
          AND COALESCE(d.ciclo_fin, n.ciclo_fin) >= p_inicio)
    )
$$;

CREATE FUNCTION private.crear_mensualidad_ingreso()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_hoy date;
  v_inicio date;
  v_fin date;
  v_periodo date;
  v_conflicto date;
  v_item uuid;
  v_cuenta uuid;
BEGIN
  IF NEW.archivado IS TRUE THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.archivado IS NOT TRUE THEN RETURN NEW; END IF;

  SELECT timezone(COALESCE(NULLIF(e.zona_horaria, ''), 'America/La_Paz'), now())::date
  INTO STRICT v_hoy FROM public.escuelas e WHERE e.id = NEW.escuela_id;

  INSERT INTO public.mensualidades_ingreso AS ingreso (alumno_id, fecha_ingreso, motivo)
  VALUES (NEW.id, v_hoy, CASE WHEN NEW.mensualidad IS NULL THEN 'sin_tarifa'
                             WHEN NEW.mensualidad <= 0 THEN 'tarifa_cero' END)
  ON CONFLICT (alumno_id) DO UPDATE
    SET fecha_ingreso = EXCLUDED.fecha_ingreso, motivo = EXCLUDED.motivo,
        cuenta_id = NULL, ciclo_inicio = NULL, ciclo_fin = NULL, monto = NULL;

  IF COALESCE(NEW.mensualidad, 0) <= 0 THEN RETURN NEW; END IF;

  SELECT id INTO v_item FROM public.catalogo_items
  WHERE escuela_id = NEW.escuela_id AND lower(btrim(nombre)) = 'mensualidad'
  ORDER BY activo DESC NULLS LAST, id LIMIT 1;
  IF v_item IS NULL THEN
    INSERT INTO public.catalogo_items
      (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
    VALUES (NEW.escuela_id, 'Mensualidad', 'servicio', 'servicio', 'ingreso', 0, true, true, false)
    ON CONFLICT (escuela_id, nombre) DO NOTHING;
    SELECT id INTO STRICT v_item FROM public.catalogo_items
    WHERE escuela_id = NEW.escuela_id AND nombre = 'Mensualidad';
  END IF;

  v_inicio := v_hoy;
  LOOP
    v_fin := private.fin_ciclo_ingreso(v_inicio);
    v_conflicto := private.conflicto_ciclo_ingreso(NEW.escuela_id, NEW.id, v_inicio, v_fin, NULL);
    EXIT WHEN v_conflicto IS NULL;
    v_inicio := v_conflicto + 1;
  END LOOP;

  v_periodo := public.calcular_periodo_estadistico(v_inicio, v_fin);
  INSERT INTO public.cuentas_cobrar (
    escuela_id, sucursal_id, alumno_id, monto_total, descripcion, periodo,
    periodo_estadistico, ciclo_inicio, ciclo_fin, fecha_emision, fecha_vencimiento,
    estado, es_anticipo, origen_facturacion, es_mensualidad_ingreso
  ) VALUES (
    NEW.escuela_id, NEW.sucursal_id, NEW.id, NEW.mensualidad, 'Mensualidad',
    to_char(v_periodo, 'YYYY-MM'), v_periodo, v_inicio, v_fin, v_hoy, v_inicio,
    'borrador', false, 'automatico', true
  ) RETURNING id INTO v_cuenta;

  INSERT INTO public.cxc_detalle (
    escuela_id, cuenta_cobrar_id, catalogo_item_id, cantidad, precio_unitario,
    periodo_meses, ciclo_inicio, ciclo_fin, periodo_estadistico
  ) VALUES (
    NEW.escuela_id, v_cuenta, v_item, 1, NEW.mensualidad,
    jsonb_build_array((ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
      [extract(month FROM v_periodo)::integer] || '-' || to_char(v_periodo, 'YYYY')),
    v_inicio, v_fin, v_periodo
  );

  UPDATE public.mensualidades_ingreso
  SET cuenta_id = v_cuenta, ciclo_inicio = v_inicio, ciclo_fin = v_fin, monto = NEW.mensualidad
  WHERE alumno_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER crear_mensualidad_ingreso
AFTER INSERT OR UPDATE OF archivado ON public.alumnos
FOR EACH ROW EXECUTE FUNCTION private.crear_mensualidad_ingreso();

CREATE FUNCTION public.rpc_editar_ciclo_mensualidad_ingreso(
  p_alumno uuid, p_cuenta uuid, p_inicio date
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_escuela uuid := (SELECT public.current_user_escuela_id());
  v_ingreso public.mensualidades_ingreso%ROWTYPE;
  v_fin date;
  v_periodo date;
BEGIN
  IF auth.uid() IS NULL OR v_escuela IS NULL OR NOT COALESCE(
    (SELECT public.current_user_rol()) IN ('Administrador', 'SuperAdministrador'), false
  ) THEN
    RAISE EXCEPTION 'No autorizado para editar el ciclo de ingreso.';
  END IF;

  PERFORM 1 FROM public.alumnos
  WHERE id = p_alumno AND escuela_id = v_escuela AND archivado IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'El alumno ya no está activo.'; END IF;

  SELECT * INTO v_ingreso FROM public.mensualidades_ingreso
  WHERE alumno_id = p_alumno AND cuenta_id = p_cuenta;
  IF NOT FOUND THEN RAISE EXCEPTION 'El borrador de ingreso ya no está disponible.'; END IF;
  IF p_inicio IS NULL OR NOT isfinite(p_inicio) OR p_inicio < v_ingreso.fecha_ingreso THEN
    RAISE EXCEPTION 'El ciclo debe iniciar en la fecha de ingreso o después.';
  END IF;

  PERFORM 1 FROM public.cuentas_cobrar
  WHERE id = p_cuenta AND escuela_id = v_escuela AND alumno_id = p_alumno
    AND estado = 'borrador' AND anulada IS NOT TRUE FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La mensualidad ya no está en borrador.'; END IF;

  v_fin := private.fin_ciclo_ingreso(p_inicio);
  v_periodo := public.calcular_periodo_estadistico(p_inicio, v_fin);
  IF private.conflicto_ciclo_ingreso(v_escuela, p_alumno, p_inicio, v_fin, p_cuenta) IS NOT NULL THEN
    RAISE EXCEPTION 'Ya existe una mensualidad para ese ciclo o periodo. Elige otra fecha.';
  END IF;

  UPDATE public.cuentas_cobrar
  SET ciclo_inicio = p_inicio, ciclo_fin = v_fin, periodo = to_char(v_periodo, 'YYYY-MM'),
      periodo_estadistico = v_periodo, fecha_vencimiento = p_inicio
  WHERE id = p_cuenta;

  UPDATE public.cxc_detalle
  SET ciclo_inicio = p_inicio, ciclo_fin = v_fin, periodo_estadistico = v_periodo,
      periodo_meses = jsonb_build_array((ARRAY['Ene','Feb','Mar','Abr','May','Jun',
        'Jul','Ago','Sep','Oct','Nov','Dic'])[extract(month FROM v_periodo)::integer]
        || '-' || to_char(v_periodo, 'YYYY'))
  WHERE cuenta_cobrar_id = p_cuenta;

  UPDATE public.mensualidades_ingreso
  SET ciclo_inicio = p_inicio, ciclo_fin = v_fin WHERE alumno_id = p_alumno;
END;
$$;

REVOKE ALL ON FUNCTION private.fin_ciclo_ingreso(date),
  private.conflicto_ciclo_ingreso(uuid, uuid, date, date, uuid),
  private.crear_mensualidad_ingreso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_editar_ciclo_mensualidad_ingreso(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_editar_ciclo_mensualidad_ingreso(uuid, uuid, date) TO authenticated;

-- El cron comparte el bloqueo del alumno con el flujo de ingreso.
CREATE OR REPLACE FUNCTION public.rpc_cron_facturacion_diaria(p_hoy DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_config         RECORD;
    v_alumno         RECORD;
    v_ultimo_ciclo_fin DATE;
    v_inicio_ingreso DATE;
    v_ciclo_inicio   DATE;
    v_ciclo_fin      DATE;
    v_periodo        DATE;
    v_item_id        UUID;
    v_cxc_id         UUID;
    v_ejecucion_id   UUID;
    v_monto          NUMERIC;
    v_registros      INTEGER;
    v_presentes      INTEGER;
    v_facturas_por_escuela INTEGER;
    v_resumen        JSONB := '{}'::jsonb;
    v_detalle_extra  TEXT;
    v_fecha_emision  DATE;
    v_fecha_vencimiento DATE;
    v_ventana_dias   INTEGER := 7;
    v_iter           INTEGER;
BEGIN
    -- Iterar por cada escuela activa con facturación automática activa
    FOR v_config IN (
        SELECT cf.escuela_id, cf.plan_momento_emision, cf.plan_calculo_monto,
               cf.asistencias_minimo_completo, cf.asistencias_minimo_parcial, cf.porcentaje_monto_parcial
        FROM public.configuracion_facturacion cf
        JOIN public.escuelas e ON e.id = cf.escuela_id
        WHERE cf.activo = TRUE
          AND e.activa = TRUE
          AND cf.plan_momento_emision IN ('adelantado', 'atrasado')
    ) LOOP
        v_facturas_por_escuela := 0;
        v_ejecucion_id := NULL;

        -- Obtener el ítem "Mensualidad" activo del catálogo de la escuela
        SELECT id INTO v_item_id
        FROM public.catalogo_items
        WHERE escuela_id = v_config.escuela_id
          AND lower(nombre) = 'mensualidad'
          AND activo = TRUE
        LIMIT 1;

        IF v_item_id IS NULL THEN
            CONTINUE;
        END IF;

        -- Iterar alumnos elegibles: activos, con mensualidad configurada
        FOR v_alumno IN (
            SELECT id, sucursal_id, mensualidad, fecha_inicio
            FROM public.alumnos
            WHERE escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE
              AND mensualidad IS NOT NULL
              AND mensualidad > 0
              AND (fecha_inicio IS NULL OR p_hoy >= fecha_inicio)
        ) LOOP

            -- Serializar con el alta, la restauración y el ajuste de su borrador.
            SELECT id, sucursal_id, mensualidad, fecha_inicio INTO v_alumno
            FROM public.alumnos
            WHERE id = v_alumno.id AND escuela_id = v_config.escuela_id
              AND archivado IS NOT TRUE AND mensualidad > 0
              AND (fecha_inicio IS NULL OR p_hoy >= fecha_inicio)
            FOR UPDATE SKIP LOCKED;
            IF NOT FOUND THEN CONTINUE; END IF;

            SELECT COALESCE(ciclo_inicio, fecha_ingreso) INTO v_inicio_ingreso
            FROM public.mensualidades_ingreso WHERE alumno_id = v_alumno.id;

            -- Buscar el último ciclo_fin de mensualidad del alumno usando DOS fuentes:
            --   1. cuentas_cobrar con JOIN a cxc_detalle (notas modernas con detalle)
            --   2. cuentas_cobrar.ciclo_fin directamente (notas sin detalle o con detalle tardío)
            -- Se toma el MAYOR de ambos para garantizar que no se regenere un período ya cubierto.
            SELECT GREATEST(
                (
                    SELECT cd.ciclo_fin
                    FROM public.cxc_detalle cd
                    JOIN public.cuentas_cobrar cc ON cc.id = cd.cuenta_cobrar_id
                    JOIN public.catalogo_items ci ON cd.catalogo_item_id = ci.id
                    WHERE cc.alumno_id = v_alumno.id
                      AND cc.escuela_id = v_config.escuela_id
                      AND cc.anulada IS NOT TRUE
                      AND lower(ci.nombre) = 'mensualidad'
                      AND cd.ciclo_fin IS NOT NULL
                    ORDER BY cd.ciclo_fin DESC
                    LIMIT 1
                ),
                (
                    SELECT cc.ciclo_fin
                    FROM public.cuentas_cobrar cc
                    WHERE cc.alumno_id = v_alumno.id
                      AND cc.escuela_id = v_config.escuela_id
                      AND cc.anulada IS NOT TRUE
                      AND cc.es_anticipo IS NOT TRUE
                      AND lower(btrim(cc.descripcion)) = 'mensualidad'
                      AND cc.ciclo_fin IS NOT NULL
                    ORDER BY cc.ciclo_fin DESC
                    LIMIT 1
                )
            ) INTO v_ultimo_ciclo_fin;

            -- Un reingreso corta el encadenamiento con ciclos anteriores a la baja.
            IF v_inicio_ingreso IS NOT NULL THEN
                v_ultimo_ciclo_fin := GREATEST(v_ultimo_ciclo_fin, v_inicio_ingreso - 1);
            END IF;

            -- Sin nota previa ni ingreso registrado, no se genera nada.
            IF v_ultimo_ciclo_fin IS NULL THEN
                CONTINUE;
            END IF;

            -- ============================================================
            -- LOOP DE AVANCE: procesar hasta 12 ciclos atrasados por alumno.
            -- Esto permite al cron "saltar" meses con baja asistencia
            -- en lugar de quedarse bloqueado en ellos.
            -- ============================================================
            FOR v_iter IN 1..12 LOOP
                v_ciclo_inicio := v_ultimo_ciclo_fin + INTERVAL '1 day';
                v_ciclo_fin    := (v_ciclo_inicio + INTERVAL '1 month' - INTERVAL '1 day')::date;

                -- Definir fecha de emisión según la modalidad de la escuela
                IF v_config.plan_momento_emision = 'adelantado' THEN
                    v_fecha_emision     := v_ciclo_inicio;
                    v_fecha_vencimiento := v_ciclo_inicio;
                ELSE
                    v_fecha_emision     := v_ciclo_fin;
                    v_fecha_vencimiento := v_ciclo_fin;
                END IF;

                -- Si la fecha de emisión está en el futuro, ya no hay más por hacer
                IF v_fecha_emision > p_hoy THEN
                    EXIT; -- Sale del LOOP de avance
                END IF;

                v_periodo := public.calcular_periodo_estadistico(v_ciclo_inicio);

                -- Verificar si este periodo fue omitido (borrado/anulado manualmente)
                IF EXISTS (
                    SELECT 1 FROM public.ciclos_omitidos
                    WHERE alumno_id = v_alumno.id
                      AND periodo_estadistico = v_periodo
                ) THEN
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    CONTINUE; -- Avanzar al siguiente ciclo
                END IF;

                -- Evitar duplicados (idempotencia):
                -- No generar si ya existe cualquier nota de mensualidad activa para este periodo
                IF EXISTS (
                    SELECT 1 FROM public.cuentas_cobrar
                    WHERE escuela_id = v_config.escuela_id
                      AND alumno_id = v_alumno.id
                      AND anulada IS NOT TRUE
                      AND es_anticipo IS NOT TRUE
                      AND (
                          periodo_estadistico = v_periodo
                          OR (periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(id, v_periodo))
                      )
                ) THEN
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    CONTINUE; -- Ya existe nota, avanzar
                END IF;

                -- Calcular monto desde la ficha del alumno
                IF v_config.plan_calculo_monto = 'fijo' THEN
                    v_monto := v_alumno.mensualidad;

                ELSIF v_config.plan_calculo_monto = 'asistencia' THEN
                    SELECT count(*)::INTEGER,
                           count(*) FILTER (WHERE x.estado = 'Presente')::INTEGER
                    INTO v_registros, v_presentes
                    FROM (
                        SELECT estado FROM public.asistencias_normales
                        WHERE alumno_id = v_alumno.id
                          AND fecha >= v_ciclo_inicio AND fecha <= v_ciclo_fin
                        UNION ALL
                        SELECT estado FROM public.asistencias_arqueros
                        WHERE alumno_id = v_alumno.id
                          AND fecha >= v_ciclo_inicio AND fecha <= v_ciclo_fin
                    ) x;

                    -- Sin registros de asistencia
                    IF v_registros = 0 THEN
                        -- Si el ciclo ya terminó, omitir definitivamente
                        IF v_ciclo_fin <= p_hoy THEN
                            INSERT INTO public.ciclos_omitidos
                                (escuela_id, alumno_id, periodo_estadistico, motivo)
                            VALUES
                                (v_config.escuela_id, v_alumno.id, v_periodo, 'sin_registros_asistencia')
                            ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                            v_ultimo_ciclo_fin := v_ciclo_fin;
                            CONTINUE; -- Avanzar al siguiente ciclo
                        ELSE
                            EXIT; -- Ciclo aún en curso, esperar a que se registren asistencias
                        END IF;
                    END IF;

                    v_monto := round(CASE
                        WHEN v_presentes >= v_config.asistencias_minimo_completo
                            THEN v_alumno.mensualidad
                        WHEN v_presentes >= v_config.asistencias_minimo_parcial
                            THEN v_alumno.mensualidad * v_config.porcentaje_monto_parcial / 100
                        ELSE 0
                    END, 2);
                ELSE
                    v_monto := NULL;
                END IF;

                -- Si el monto es 0 o NULL (baja asistencia), omitir y avanzar
                IF v_monto IS NULL OR v_monto <= 0 THEN
                    -- Solo omitir si el ciclo ya terminó
                    IF v_ciclo_fin <= p_hoy THEN
                        INSERT INTO public.ciclos_omitidos
                            (escuela_id, alumno_id, periodo_estadistico, motivo)
                        VALUES
                            (v_config.escuela_id, v_alumno.id, v_periodo, 'baja_asistencia')
                        ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                        v_ultimo_ciclo_fin := v_ciclo_fin;
                        CONTINUE; -- Avanzar al siguiente ciclo
                    ELSE
                        EXIT; -- Ciclo aún en curso, las asistencias pueden cambiar
                    END IF;
                END IF;

                -- Si el ciclo está vencido (fuera de ventana de 7 días) pero monto > 0,
                -- omitir en lugar de generar nota retroactiva (solo de aquí para adelante)
                IF v_fecha_emision < (p_hoy - v_ventana_dias) THEN
                    INSERT INTO public.ciclos_omitidos
                        (escuela_id, alumno_id, periodo_estadistico, motivo)
                    VALUES
                        (v_config.escuela_id, v_alumno.id, v_periodo, 'mes_vencido')
                    ON CONFLICT (alumno_id, periodo_estadistico) DO NOTHING;
                    v_ultimo_ciclo_fin := v_ciclo_fin;
                    CONTINUE; -- Avanzar al siguiente ciclo
                END IF;

                -- ========================================
                -- GENERAR NOTA DE MENSUALIDAD (borrador)
                -- ========================================
                IF v_ejecucion_id IS NULL THEN
                    INSERT INTO public.ejecuciones_facturacion (escuela_id, fecha_ejecucion, facturas_generadas)
                    VALUES (v_config.escuela_id, p_hoy, 0)
                    RETURNING id INTO v_ejecucion_id;
                END IF;

                -- detalle_extra: vacío si ciclo es mes completo (día 1)
                IF EXTRACT(DAY FROM v_ciclo_inicio) = 1 THEN
                    v_detalle_extra := '';
                ELSE
                    v_detalle_extra := 'Ciclo ' || to_char(v_ciclo_inicio, 'DD/MM/YYYY')
                                    || ' - ' || to_char(v_ciclo_fin, 'DD/MM/YYYY');
                END IF;

                -- Crear nota en estado 'borrador'
                INSERT INTO public.cuentas_cobrar (
                    escuela_id, sucursal_id, alumno_id, monto_total, descripcion,
                    periodo, periodo_estadistico, ciclo_inicio, ciclo_fin,
                    fecha_emision, fecha_vencimiento, estado, es_anticipo,
                    origen_facturacion, ejecucion_facturacion_id
                ) VALUES (
                    v_config.escuela_id, v_alumno.sucursal_id, v_alumno.id,
                    v_monto, 'Mensualidad',
                    to_char(v_periodo, 'YYYY-MM'), v_periodo,
                    v_ciclo_inicio, v_ciclo_fin,
                    v_fecha_emision, v_fecha_vencimiento, 'borrador', FALSE,
                    'automatico', v_ejecucion_id
                ) RETURNING id INTO v_cxc_id;

                -- Crear detalle con ciclo en cxc_detalle
                INSERT INTO public.cxc_detalle (
                    escuela_id, cuenta_cobrar_id, catalogo_item_id,
                    cantidad, precio_unitario, periodo_meses, detalle_extra,
                    ciclo_inicio, ciclo_fin, periodo_estadistico
                ) VALUES (
                    v_config.escuela_id, v_cxc_id, v_item_id,
                    1, v_monto,
                    jsonb_build_array(
                        (ARRAY['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'])
                            [EXTRACT(MONTH FROM v_periodo)::INTEGER]
                        || '-' || EXTRACT(YEAR FROM v_periodo)::INTEGER::TEXT
                    ),
                    v_detalle_extra,
                    v_ciclo_inicio, v_ciclo_fin, v_periodo
                );

                v_facturas_por_escuela := v_facturas_por_escuela + 1;
                v_ultimo_ciclo_fin := v_ciclo_fin;

            END LOOP; -- Fin LOOP de avance por alumno

        END LOOP; -- Fin loop alumnos

        IF v_ejecucion_id IS NOT NULL THEN
            UPDATE public.ejecuciones_facturacion
            SET facturas_generadas = v_facturas_por_escuela
            WHERE id = v_ejecucion_id;
        END IF;

        v_resumen := jsonb_set(v_resumen, ARRAY[v_config.escuela_id::text], to_jsonb(v_facturas_por_escuela));
    END LOOP; -- Fin loop escuelas

    RETURN v_resumen;
END;
$$;

-- Mantener permisos
REVOKE ALL ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_cron_facturacion_diaria(DATE) TO authenticated, service_role;
