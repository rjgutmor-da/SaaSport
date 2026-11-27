-- Migración:
-- 1) Agregar dia_pago y monto_actual_usd en escuelas_plan y cargar los planes contratados reales de las escuelas activas.
-- 2) Crear tabla dedicada public.escuelas_bloqueos para controlar manualmente bloqueos de creación de alumnos, usuarios y sucursales.
-- 3) Actualizar rpc_obtener_plan_y_cupos_escuela para devolver monto_contratado_usd, monto_correspondiente_usd (nunca menor al contratado) y estado de bloqueos manuales.

-- 1. Campos comerciales en escuelas_plan
ALTER TABLE public.escuelas_plan
  ADD COLUMN IF NOT EXISTS dia_pago smallint CHECK (dia_pago BETWEEN 1 AND 31),
  ADD COLUMN IF NOT EXISTS monto_actual_usd numeric(10,2) CHECK (monto_actual_usd >= 0);

-- 2. Tabla dedicada de control manual de bloqueos por escuela
CREATE TABLE IF NOT EXISTS public.escuelas_bloqueos (
  escuela_id uuid PRIMARY KEY REFERENCES public.escuelas(id) ON DELETE CASCADE,
  escuela_nombre text NOT NULL,
  bloquear_creacion_alumnos boolean NOT NULL DEFAULT false,
  bloquear_creacion_usuarios boolean NOT NULL DEFAULT false,
  bloquear_creacion_sucursales boolean NOT NULL DEFAULT false,
  motivo_bloqueo text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.escuelas_bloqueos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.escuelas_bloqueos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.escuelas_bloqueos TO authenticated;

DROP POLICY IF EXISTS escuelas_bloqueos_lectura_mi_escuela ON public.escuelas_bloqueos;
CREATE POLICY escuelas_bloqueos_lectura_mi_escuela
  ON public.escuelas_bloqueos
  FOR SELECT
  TO authenticated
  USING (escuela_id = (SELECT public.current_user_escuela_id()));

-- Sembrar todas las escuelas actuales con los 3 interruptores en false
INSERT INTO public.escuelas_bloqueos (escuela_id, escuela_nombre)
SELECT id, nombre FROM public.escuelas
ON CONFLICT (escuela_id) DO UPDATE SET escuela_nombre = EXCLUDED.escuela_nombre;

-- Mantener sincronizada la tabla de bloqueos al crear o renombrar una escuela
CREATE OR REPLACE FUNCTION private.fn_sync_escuelas_bloqueos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.escuelas_bloqueos (escuela_id, escuela_nombre)
  VALUES (NEW.id, NEW.nombre)
  ON CONFLICT (escuela_id) DO UPDATE SET escuela_nombre = EXCLUDED.escuela_nombre;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_escuelas_bloqueos ON public.escuelas;
CREATE TRIGGER trg_sync_escuelas_bloqueos
  AFTER INSERT OR UPDATE OF nombre ON public.escuelas
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_sync_escuelas_bloqueos();

CREATE OR REPLACE FUNCTION private.fn_updated_at_escuelas_bloqueos()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_escuelas_bloqueos ON public.escuelas_bloqueos;
CREATE TRIGGER trg_updated_at_escuelas_bloqueos
  BEFORE UPDATE ON public.escuelas_bloqueos
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_updated_at_escuelas_bloqueos();

-- 3. Triggers de control manual de bloqueos (solo actúan cuando el administrador activa el boolean en true)
CREATE OR REPLACE FUNCTION private.fn_check_bloqueo_manual_alumnos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bloqueo public.escuelas_bloqueos%ROWTYPE;
  v_es_activacion boolean := false;
BEGIN
  IF NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_es_activacion := (NEW.archivado IS NOT TRUE);
  ELSIF OLD.archivado IS TRUE AND NEW.archivado IS NOT TRUE THEN
    v_es_activacion := true;
  END IF;

  IF NOT v_es_activacion THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bloqueo
  FROM public.escuelas_bloqueos
  WHERE escuela_id = NEW.escuela_id;

  IF FOUND AND v_bloqueo.bloquear_creacion_alumnos IS TRUE THEN
    RAISE EXCEPTION '%',
      COALESCE(NULLIF(btrim(v_bloqueo.motivo_bloqueo), ''),
        'La creación y restauración de alumnos está pausada temporalmente para tu escuela. Comunícate con soporte para regularizar tu plan.')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueo_manual_alumnos ON public.alumnos;
CREATE TRIGGER trg_bloqueo_manual_alumnos
  BEFORE INSERT OR UPDATE OF archivado ON public.alumnos
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_check_bloqueo_manual_alumnos();

CREATE OR REPLACE FUNCTION private.fn_check_bloqueo_manual_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bloqueo public.escuelas_bloqueos%ROWTYPE;
  v_es_activacion boolean := false;
BEGIN
  IF NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_es_activacion := (NEW.activo IS TRUE);
  ELSIF OLD.activo IS NOT TRUE AND NEW.activo IS TRUE THEN
    v_es_activacion := true;
  END IF;

  IF NOT v_es_activacion THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bloqueo
  FROM public.escuelas_bloqueos
  WHERE escuela_id = NEW.escuela_id;

  IF FOUND AND v_bloqueo.bloquear_creacion_usuarios IS TRUE THEN
    RAISE EXCEPTION '%',
      COALESCE(NULLIF(btrim(v_bloqueo.motivo_bloqueo), ''),
        'La creación y activación de usuarios está pausada temporalmente para tu escuela. Comunícate con soporte para regularizar tu plan.')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueo_manual_usuarios ON public.usuarios;
CREATE TRIGGER trg_bloqueo_manual_usuarios
  BEFORE INSERT OR UPDATE OF activo ON public.usuarios
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_check_bloqueo_manual_usuarios();

CREATE OR REPLACE FUNCTION private.fn_check_bloqueo_manual_sucursales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_bloqueo public.escuelas_bloqueos%ROWTYPE;
BEGIN
  IF NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_bloqueo
  FROM public.escuelas_bloqueos
  WHERE escuela_id = NEW.escuela_id;

  IF FOUND AND v_bloqueo.bloquear_creacion_sucursales IS TRUE THEN
    RAISE EXCEPTION '%',
      COALESCE(NULLIF(btrim(v_bloqueo.motivo_bloqueo), ''),
        'La creación de sucursales está pausada temporalmente para tu escuela. Comunícate con soporte para regularizar tu plan.')
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueo_manual_sucursales ON public.sucursales;
CREATE TRIGGER trg_bloqueo_manual_sucursales
  BEFORE INSERT ON public.sucursales
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_check_bloqueo_manual_sucursales();

REVOKE ALL ON FUNCTION private.fn_sync_escuelas_bloqueos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_updated_at_escuelas_bloqueos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_check_bloqueo_manual_alumnos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_check_bloqueo_manual_usuarios() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_check_bloqueo_manual_sucursales() FROM PUBLIC, anon, authenticated;

-- 4. Cargar los planes contratados actuales y días de pago de las 16 escuelas activas
UPDATE public.escuelas_plan ep
SET plan_id = cfg.plan_id,
    usuarios_adicionales = 0,
    alumnos_adicionales = 0,
    sucursales_adicionales = 0,
    dia_pago = cfg.dia_pago,
    monto_actual_usd = cfg.monto_actual_usd
FROM (
  VALUES
    ('Fundación Inter Stars',                   'combo_completa',    1,  72.00),
    ('El Cañito',                               'combo_crecimiento', 1,  35.00),
    ('Proyecto Halcones C.A.S.S.',              'combo_crecimiento', 1,  40.00),
    ('2 de Abril',                              'combo_basico',      1,  25.00),
    ('Escuela de Futbol San Luis',              'combo_basico',      1,  25.00),
    ('Muchachos Unidos (MU2)',                  'combo_basico',      1,  25.00),
    ('ADB CALLAO',                              'combo_basico',      1,  25.00),
    ('Olegol / Escuela de fútbol El Semillero', 'combo_basico',      4,  25.00),
    ('Pasion Futbolera',                        'combo_basico',      6,  25.00),
    ('PLANETA FC',                              'combo_crecimiento', 10, 30.00),
    ('Planeta FC Fabriles',                     'combo_crecimiento', 10, 30.00),
    ('@ Golden club',                           'combo_crecimiento', 12, 35.00),
    ('Lokillos FC',                             'combo_basico',      12, 25.00),
    ('Real FC',                                 'combo_basico',      15, 25.00),
    ('ILLIMANI Fútbol Club',                    'combo_crecimiento', 15, 35.00),
    ('Club Deportivo Águia Brasil',             'combo_crecimiento', 18, 35.00)
) AS cfg(nombre_escuela, plan_id, dia_pago, monto_actual_usd)
JOIN public.escuelas e ON btrim(e.nombre) = cfg.nombre_escuela
WHERE ep.escuela_id = e.id;

-- 5. Actualizar RPC consolidado: nunca sugerir bajar el precio contratado actual; resaltar monto que corresponde pagar y exponer bloqueos manuales
CREATE OR REPLACE FUNCTION public.rpc_obtener_plan_y_cupos_escuela(p_escuela_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_escuela_id uuid;
  v_plan_escuela public.escuelas_plan%ROWTYPE;
  v_catalogo public.catalogo_planes%ROWTYPE;
  v_siguiente public.catalogo_planes%ROWTYPE;
  v_bloqueo public.escuelas_bloqueos%ROWTYPE;
  v_tiene_siguiente boolean := false;
  v_alumnos_activos integer;
  v_usuarios_activos integer;
  v_entrenadores_activos integer;
  v_sucursales_usadas integer;
  v_alumnos_por_sucursal jsonb;
  v_sin_sucursal integer;
  v_limite_alumnos integer;
  v_limite_alumnos_margen integer;
  v_limite_usuarios integer;
  v_limite_sucursales integer;
  v_en_margen_alumnos boolean;
  v_excede_alumnos boolean;
  v_excede_usuarios boolean;
  v_excede_sucursales boolean;
  v_requiere_atencion boolean;
  v_usuarios_faltantes integer;
  v_costo_addons_actual numeric(10,2);
  v_costo_addons_siguiente numeric(10,2);
  v_precio_lista_actual numeric(10,2);
  v_monto_contratado numeric(10,2);
  v_monto_con_extras numeric(10,2);
  v_monto_siguiente_total numeric(10,2);
  v_monto_correspondiente numeric(10,2);
  v_costo_extras_nuevos numeric(10,2);
  v_rec_tipo text := NULL;
  v_rec_mensaje text := NULL;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;

  v_escuela_id := COALESCE(p_escuela_id, v_actor.escuela_id);
  IF v_escuela_id IS DISTINCT FROM v_actor.escuela_id THEN
    RAISE EXCEPTION 'No autorizado para consultar otra escuela.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plan_escuela
  FROM public.escuelas_plan
  WHERE escuela_id = v_escuela_id;

  SELECT * INTO v_catalogo
  FROM public.catalogo_planes
  WHERE id = COALESCE(v_plan_escuela.plan_id, 'combo_basico');

  SELECT * INTO v_siguiente
  FROM public.catalogo_planes cp
  WHERE cp.producto = v_catalogo.producto
    AND cp.orden > v_catalogo.orden
  ORDER BY cp.orden ASC
  LIMIT 1;
  v_tiene_siguiente := FOUND;

  SELECT * INTO v_bloqueo
  FROM public.escuelas_bloqueos
  WHERE escuela_id = v_escuela_id;

  SELECT count(*)::integer INTO v_alumnos_activos
  FROM public.alumnos a
  WHERE a.escuela_id = v_escuela_id
    AND a.archivado IS NOT TRUE
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE u.rol IN ('Entrenador', 'Entrenarqueros'))::integer
  INTO v_usuarios_activos, v_entrenadores_activos
  FROM public.usuarios u
  WHERE u.escuela_id = v_escuela_id
    AND u.activo IS TRUE;

  SELECT count(*)::integer INTO v_sucursales_usadas
  FROM public.sucursales s
  WHERE s.escuela_id = v_escuela_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', sub.id, 'nombre', sub.nombre, 'count', sub.total)
      ORDER BY sub.nombre
    ),
    '[]'::jsonb
  )
  INTO v_alumnos_por_sucursal
  FROM (
    SELECT s.id, s.nombre, count(a.id)::integer AS total
    FROM public.sucursales s
    JOIN public.alumnos a ON a.sucursal_id = s.id
    WHERE s.escuela_id = v_escuela_id
      AND a.escuela_id = v_escuela_id
      AND a.archivado IS NOT TRUE
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
    GROUP BY s.id, s.nombre
    HAVING count(a.id) > 0
  ) sub;

  SELECT count(*)::integer INTO v_sin_sucursal
  FROM public.alumnos a
  WHERE a.escuela_id = v_escuela_id
    AND a.sucursal_id IS NULL
    AND a.archivado IS NOT TRUE
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

  IF v_sin_sucursal > 0 THEN
    v_alumnos_por_sucursal := v_alumnos_por_sucursal || jsonb_build_array(
      jsonb_build_object('id', 'sin-sucursal', 'nombre', 'Sin sucursal', 'count', v_sin_sucursal)
    );
  END IF;

  v_limite_alumnos := v_catalogo.max_alumnos + COALESCE(v_plan_escuela.alumnos_adicionales, 0);
  v_limite_alumnos_margen := floor(v_limite_alumnos * 1.15)::integer;
  v_limite_usuarios := v_catalogo.max_usuarios + COALESCE(v_plan_escuela.usuarios_adicionales, 0);
  v_limite_sucursales := v_catalogo.max_sucursales + COALESCE(v_plan_escuela.sucursales_adicionales, 0);

  v_en_margen_alumnos := (v_alumnos_activos > v_limite_alumnos AND v_alumnos_activos <= v_limite_alumnos_margen);
  v_excede_alumnos := (v_alumnos_activos > v_limite_alumnos_margen);
  v_excede_usuarios := (v_usuarios_activos > v_limite_usuarios);
  v_excede_sucursales := (v_sucursales_usadas > v_limite_sucursales);

  -- Costo de adicionales en el tramo actual y en el siguiente tramo
  v_costo_addons_actual := (
    (CASE WHEN COALESCE(v_plan_escuela.addon_fotos_asistencia, false) THEN CASE WHEN v_catalogo.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
    + (CASE WHEN COALESCE(v_plan_escuela.addon_perfil_medico, false) THEN CASE WHEN v_catalogo.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
    + (CASE WHEN COALESCE(v_plan_escuela.addon_ficha_deportiva, false) THEN CASE WHEN v_catalogo.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
    + (CASE WHEN COALESCE(v_plan_escuela.addon_cobranza_automatica, false) THEN CASE v_catalogo.tramo WHEN 'basico' THEN 10.00 WHEN 'crecimiento' THEN 15.00 WHEN 'profesional' THEN 20.00 ELSE 25.00 END ELSE 0.00 END)
  )::numeric(10,2);

  v_precio_lista_actual := ROUND((
    v_catalogo.precio_mensual_usd
    + (COALESCE(v_plan_escuela.usuarios_adicionales, 0) * 2.00)
    + v_costo_addons_actual
  ) * CASE WHEN COALESCE(v_plan_escuela.suscripcion_anual, false) THEN 0.85 ELSE 1.00 END, 2);

  v_monto_contratado := COALESCE(v_plan_escuela.monto_actual_usd, v_precio_lista_actual);
  v_monto_correspondiente := GREATEST(v_monto_contratado, v_precio_lista_actual);

  v_usuarios_faltantes := GREATEST(0, v_usuarios_activos - v_limite_usuarios);
  v_costo_extras_nuevos := (v_usuarios_faltantes * 2.00)::numeric(10,2);

  IF v_tiene_siguiente THEN
    v_costo_addons_siguiente := (
      (CASE WHEN COALESCE(v_plan_escuela.addon_fotos_asistencia, false) THEN CASE WHEN v_siguiente.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
      + (CASE WHEN COALESCE(v_plan_escuela.addon_perfil_medico, false) THEN CASE WHEN v_siguiente.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
      + (CASE WHEN COALESCE(v_plan_escuela.addon_ficha_deportiva, false) THEN CASE WHEN v_siguiente.tramo IN ('basico','crecimiento') THEN 5.00 ELSE 7.00 END ELSE 0.00 END)
      + (CASE WHEN COALESCE(v_plan_escuela.addon_cobranza_automatica, false) THEN CASE v_siguiente.tramo WHEN 'basico' THEN 10.00 WHEN 'crecimiento' THEN 15.00 WHEN 'profesional' THEN 20.00 ELSE 25.00 END ELSE 0.00 END)
    )::numeric(10,2);

    v_monto_siguiente_total := ROUND((
      v_siguiente.precio_mensual_usd
      + v_costo_addons_siguiente
    ) * CASE WHEN COALESCE(v_plan_escuela.suscripcion_anual, false) THEN 0.85 ELSE 1.00 END, 2);
  END IF;

  v_monto_con_extras := ROUND((
    v_catalogo.precio_mensual_usd
    + ((COALESCE(v_plan_escuela.usuarios_adicionales, 0) + v_usuarios_faltantes) * 2.00)
    + v_costo_addons_actual
  ) * CASE WHEN COALESCE(v_plan_escuela.suscripcion_anual, false) THEN 0.85 ELSE 1.00 END, 2);

  v_requiere_atencion := (v_excede_alumnos OR v_excede_usuarios OR v_excede_sucursales);

  IF v_requiere_atencion THEN
    IF v_excede_usuarios AND NOT v_excede_alumnos AND NOT v_excede_sucursales THEN
      IF NOT v_tiene_siguiente OR v_monto_con_extras < v_monto_siguiente_total THEN
        v_rec_tipo := 'usuarios_adicionales';
        v_monto_correspondiente := GREATEST(v_monto_contratado, v_monto_con_extras);
        v_rec_mensaje := format(
          'Superaste tu cupo de usuarios por %s. Te conviene habilitar %s usuario(s) adicional(es) (+USD %s/mes) -> Total mensual correspondiente: USD %s%s.',
          v_usuarios_faltantes,
          v_usuarios_faltantes,
          to_char(v_costo_extras_nuevos, 'FM999990.00'),
          to_char(v_monto_correspondiente, 'FM999990.00'),
          CASE WHEN v_tiene_siguiente
            THEN format(' (más económico que subir al Plan %s de USD %s/mes)', v_siguiente.nombre_tramo, to_char(v_monto_siguiente_total, 'FM999990.00'))
            ELSE ''
          END
        );
      ELSE
        v_rec_tipo := 'subir_plan';
        v_monto_correspondiente := GREATEST(v_monto_contratado, v_monto_siguiente_total);
        v_rec_mensaje := format(
          'Agregar %s usuario(s) adicional(es) elevaría tu mensualidad a USD %s. Te conviene habilitar el Plan %s (USD %s/mes), que incluye hasta %s usuarios y %s alumnos.',
          v_usuarios_faltantes,
          to_char(v_monto_con_extras, 'FM999990.00'),
          v_siguiente.nombre_tramo,
          to_char(v_monto_correspondiente, 'FM999990.00'),
          v_siguiente.max_usuarios,
          v_siguiente.max_alumnos
        );
      END IF;
    ELSIF v_tiene_siguiente THEN
      v_rec_tipo := 'subir_plan';
      v_monto_correspondiente := GREATEST(v_monto_contratado, v_monto_siguiente_total);
      v_rec_mensaje := format(
        'Superaste los límites habilitados (incluyendo el 15%% de margen gratis en alumnos). Corresponde habilitar %s — Plan %s (USD %s/mes).',
        v_siguiente.nombre_producto,
        v_siguiente.nombre_tramo,
        to_char(v_monto_correspondiente, 'FM999990.00')
      );
    ELSE
      v_rec_tipo := 'plan_a_medida';
      v_rec_mensaje := 'Superaste el tope del Plan Completa (incluyendo el 15% de margen gratis en alumnos). Corresponde configurar un plan a medida o cupos adicionales.';
    END IF;
  ELSIF v_precio_lista_actual > v_monto_contratado THEN
    v_rec_tipo := 'ajuste_tarifa';
    v_rec_mensaje := format(
      'Tu suscripción mantiene una tarifa preferencial actual de USD %s/mes. La tarifa vigente del plan %s — %s es USD %s/mes.',
      to_char(v_monto_contratado, 'FM999990.00'),
      v_catalogo.nombre_producto,
      v_catalogo.nombre_tramo,
      to_char(v_precio_lista_actual, 'FM999990.00')
    );
  END IF;

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_catalogo.id,
      'producto', v_catalogo.producto,
      'tramo', v_catalogo.tramo,
      'nombre_producto', v_catalogo.nombre_producto,
      'nombre_tramo', v_catalogo.nombre_tramo,
      'precio_mensual_usd', v_catalogo.precio_mensual_usd,
      'dia_pago', v_plan_escuela.dia_pago,
      'monto_contratado_usd', v_monto_contratado,
      'monto_correspondiente_usd', v_monto_correspondiente,
      'incluye_saasport_lite', v_catalogo.incluye_saasport_lite,
      'incluye_saasport_full', v_catalogo.incluye_saasport_full,
      'incluye_asisport', v_catalogo.incluye_asisport
    ),
    'addons', jsonb_build_object(
      'fotos_asistencia', COALESCE(v_plan_escuela.addon_fotos_asistencia, false),
      'perfil_medico', COALESCE(v_plan_escuela.addon_perfil_medico, false),
      'ficha_deportiva', COALESCE(v_plan_escuela.addon_ficha_deportiva, false),
      'cobranza_automatica', COALESCE(v_plan_escuela.addon_cobranza_automatica, false),
      'suscripcion_anual', COALESCE(v_plan_escuela.suscripcion_anual, false),
      'usuarios_adicionales', COALESCE(v_plan_escuela.usuarios_adicionales, 0),
      'alumnos_adicionales', COALESCE(v_plan_escuela.alumnos_adicionales, 0),
      'sucursales_adicionales', COALESCE(v_plan_escuela.sucursales_adicionales, 0)
    ),
    'cupos', jsonb_build_object(
      'alumnos', jsonb_build_object(
        'usados', v_alumnos_activos,
        'base', v_catalogo.max_alumnos,
        'adicionales', COALESCE(v_plan_escuela.alumnos_adicionales, 0),
        'limite', v_limite_alumnos,
        'margen_porcentaje', 15,
        'limite_con_margen', v_limite_alumnos_margen,
        'en_margen_gracia', v_en_margen_alumnos
      ),
      'usuarios', jsonb_build_object(
        'usados', v_usuarios_activos,
        'base', v_catalogo.max_usuarios,
        'adicionales', COALESCE(v_plan_escuela.usuarios_adicionales, 0),
        'limite', v_limite_usuarios
      ),
      'sucursales', jsonb_build_object(
        'usados', v_sucursales_usadas,
        'base', v_catalogo.max_sucursales,
        'adicionales', COALESCE(v_plan_escuela.sucursales_adicionales, 0),
        'limite', v_limite_sucursales
      )
    ),
    'bloqueos_manuales', jsonb_build_object(
      'bloquear_creacion_alumnos', COALESCE(v_bloqueo.bloquear_creacion_alumnos, false),
      'bloquear_creacion_usuarios', COALESCE(v_bloqueo.bloquear_creacion_usuarios, false),
      'bloquear_creacion_sucursales', COALESCE(v_bloqueo.bloquear_creacion_sucursales, false),
      'motivo_bloqueo', v_bloqueo.motivo_bloqueo
    ),
    'alerta', jsonb_build_object(
      'requiere_atencion', v_requiere_atencion,
      'en_margen_gracia_alumnos', v_en_margen_alumnos,
      'excede_alumnos', v_excede_alumnos,
      'excede_usuarios', v_excede_usuarios,
      'excede_sucursales', v_excede_sucursales,
      'siguiente_plan', CASE WHEN v_tiene_siguiente THEN jsonb_build_object(
        'id', v_siguiente.id,
        'nombre_producto', v_siguiente.nombre_producto,
        'nombre_tramo', v_siguiente.nombre_tramo,
        'precio_mensual_usd', v_siguiente.precio_mensual_usd,
        'max_alumnos', v_siguiente.max_alumnos,
        'max_usuarios', v_siguiente.max_usuarios,
        'max_sucursales', v_siguiente.max_sucursales
      ) ELSE NULL END,
      'recomendacion', CASE WHEN v_rec_tipo IS NOT NULL THEN jsonb_build_object(
        'tipo', v_rec_tipo,
        'usuarios_faltantes', v_usuarios_faltantes,
        'costo_usuarios_extra_usd', v_costo_extras_nuevos,
        'monto_correspondiente_usd', v_monto_correspondiente,
        'mensaje', v_rec_mensaje
      ) ELSE NULL END
    ),
    'resumen_escuela', jsonb_build_object(
      'entrenadores_activos', v_entrenadores_activos,
      'alumnos_por_sucursal', v_alumnos_por_sucursal
    )
  );
END;
$$;
