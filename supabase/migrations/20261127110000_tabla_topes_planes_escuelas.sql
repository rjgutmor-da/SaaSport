-- Migración Fase 1: Tabla maestra de planes (catalogo_planes), asignación y extras por escuela (escuelas_plan),
-- triggers estrictos de validación de topes (alumnos, usuarios, sucursales) y RPC de consulta consolidada.

CREATE SCHEMA IF NOT EXISTS private;

-- 1. Tabla maestra de planes y topes base
CREATE TABLE IF NOT EXISTS public.catalogo_planes (
  id text PRIMARY KEY,
  producto text NOT NULL CHECK (producto IN ('saasport_lite', 'saasport', 'asisport', 'combo')),
  tramo text NOT NULL CHECK (tramo IN ('basico', 'crecimiento', 'profesional', 'completa')),
  nombre_producto text NOT NULL,
  nombre_tramo text NOT NULL,
  precio_mensual_usd numeric(10,2) NOT NULL CHECK (precio_mensual_usd >= 0),
  max_usuarios integer NOT NULL CHECK (max_usuarios > 0),
  max_alumnos integer NOT NULL CHECK (max_alumnos > 0),
  max_sucursales integer NOT NULL CHECK (max_sucursales > 0),
  incluye_saasport_lite boolean NOT NULL DEFAULT false,
  incluye_saasport_full boolean NOT NULL DEFAULT false,
  incluye_asisport boolean NOT NULL DEFAULT false,
  orden smallint NOT NULL,
  UNIQUE (producto, tramo)
);

ALTER TABLE public.catalogo_planes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.catalogo_planes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.catalogo_planes TO authenticated;

DROP POLICY IF EXISTS catalogo_planes_lectura_autenticados ON public.catalogo_planes;
CREATE POLICY catalogo_planes_lectura_autenticados
  ON public.catalogo_planes
  FOR SELECT
  TO authenticated
  USING (true);

-- Seed de las 16 combinaciones oficiales
INSERT INTO public.catalogo_planes (
  id, producto, tramo, nombre_producto, nombre_tramo, precio_mensual_usd,
  max_usuarios, max_alumnos, max_sucursales,
  incluye_saasport_lite, incluye_saasport_full, incluye_asisport, orden
) VALUES
  -- SaaSport Lite
  ('saasport_lite_basico',      'saasport_lite', 'basico',      'SaaSport Lite', 'Básico',       6.00,  2, 100, 1, true,  false, false, 1),
  ('saasport_lite_crecimiento', 'saasport_lite', 'crecimiento', 'SaaSport Lite', 'Crecimiento', 10.00,  4, 250, 3, true,  false, false, 2),
  ('saasport_lite_profesional', 'saasport_lite', 'profesional', 'SaaSport Lite', 'Profesional', 15.00,  6, 400, 4, true,  false, false, 3),
  ('saasport_lite_completa',    'saasport_lite', 'completa',    'SaaSport Lite', 'Completa',    20.00,  8, 600, 6, true,  false, false, 4),
  -- SaaSport
  ('saasport_basico',      'saasport', 'basico',      'SaaSport', 'Básico',      15.00,  2, 100, 1, false, true, false, 5),
  ('saasport_crecimiento', 'saasport', 'crecimiento', 'SaaSport', 'Crecimiento', 20.00,  6, 250, 3, false, true, false, 6),
  ('saasport_profesional', 'saasport', 'profesional', 'SaaSport', 'Profesional', 30.00, 10, 400, 4, false, true, false, 7),
  ('saasport_completa',    'saasport', 'completa',    'SaaSport', 'Completa',    35.00, 15, 600, 6, false, true, false, 8),
  -- AsiSport
  ('asisport_basico',      'asisport', 'basico',      'AsiSport', 'Básico',      15.00,  3, 100, 1, false, false, true,  9),
  ('asisport_crecimiento', 'asisport', 'crecimiento', 'AsiSport', 'Crecimiento', 20.00,  6, 250, 3, false, false, true, 10),
  ('asisport_profesional', 'asisport', 'profesional', 'AsiSport', 'Profesional', 30.00, 10, 400, 4, false, false, true, 11),
  ('asisport_completa',    'asisport', 'completa',    'AsiSport', 'Completa',    35.00, 15, 600, 6, false, false, true, 12),
  -- AsiSport + SaaSport (Combo)
  ('combo_basico',      'combo', 'basico',      'AsiSport + SaaSport', 'Básico',      25.00,  5, 100, 1, false, true, true, 13),
  ('combo_crecimiento', 'combo', 'crecimiento', 'AsiSport + SaaSport', 'Crecimiento', 35.00, 12, 250, 3, false, true, true, 14),
  ('combo_profesional', 'combo', 'profesional', 'AsiSport + SaaSport', 'Profesional', 50.00, 20, 400, 4, false, true, true, 15),
  ('combo_completa',    'combo', 'completa',    'AsiSport + SaaSport', 'Completa',    65.00, 30, 600, 6, false, true, true, 16)
ON CONFLICT (id) DO UPDATE SET
  producto              = EXCLUDED.producto,
  tramo                 = EXCLUDED.tramo,
  nombre_producto       = EXCLUDED.nombre_producto,
  nombre_tramo          = EXCLUDED.nombre_tramo,
  precio_mensual_usd    = EXCLUDED.precio_mensual_usd,
  max_usuarios          = EXCLUDED.max_usuarios,
  max_alumnos           = EXCLUDED.max_alumnos,
  max_sucursales        = EXCLUDED.max_sucursales,
  incluye_saasport_lite = EXCLUDED.incluye_saasport_lite,
  incluye_saasport_full = EXCLUDED.incluye_saasport_full,
  incluye_asisport      = EXCLUDED.incluye_asisport,
  orden                 = EXCLUDED.orden;

-- 2. Tabla de plan contratado y adicionales por escuela
CREATE TABLE IF NOT EXISTS public.escuelas_plan (
  escuela_id uuid PRIMARY KEY REFERENCES public.escuelas(id) ON DELETE CASCADE,
  plan_id text NOT NULL REFERENCES public.catalogo_planes(id),
  usuarios_adicionales integer NOT NULL DEFAULT 0 CHECK (usuarios_adicionales >= 0),
  alumnos_adicionales integer NOT NULL DEFAULT 0 CHECK (alumnos_adicionales >= 0),
  sucursales_adicionales integer NOT NULL DEFAULT 0 CHECK (sucursales_adicionales >= 0),
  addon_fotos_asistencia boolean NOT NULL DEFAULT false,
  addon_perfil_medico boolean NOT NULL DEFAULT false,
  addon_ficha_deportiva boolean NOT NULL DEFAULT false,
  addon_cobranza_automatica boolean NOT NULL DEFAULT false,
  suscripcion_anual boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.escuelas_plan ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.escuelas_plan FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.escuelas_plan TO authenticated;

DROP POLICY IF EXISTS escuelas_plan_lectura_mi_escuela ON public.escuelas_plan;
CREATE POLICY escuelas_plan_lectura_mi_escuela
  ON public.escuelas_plan
  FOR SELECT
  TO authenticated
  USING (escuela_id = (SELECT public.current_user_escuela_id()));

-- 3. Funciones privadas de soporte y sincronización
CREATE OR REPLACE FUNCTION private.asegurar_cajas_por_defecto_lite(p_escuela_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_escuela_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cajas_bancos cb
    WHERE cb.escuela_id = p_escuela_id
      AND cb.activo IS TRUE
  ) THEN
    INSERT INTO public.cajas_bancos (
      escuela_id, nombre, tipo, activo, saldo_actual, orden, es_predeterminada
    ) VALUES
      (p_escuela_id, 'Efectivo', 'caja_chica', true, 0, 1, true),
      (p_escuela_id, 'QR / Transferencia', 'cuenta_bancaria', true, 0, 2, false);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.fn_set_updated_at_escuelas_plan()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_updated_at_escuelas_plan ON public.escuelas_plan;
CREATE TRIGGER trg_updated_at_escuelas_plan
  BEFORE UPDATE ON public.escuelas_plan
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_set_updated_at_escuelas_plan();

CREATE OR REPLACE FUNCTION private.fn_after_upsert_escuelas_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_es_lite boolean := false;
BEGIN
  -- Sincronizar flags de módulos heredados únicamente cuando opera administración de plataforma
  IF auth.uid() IS NULL THEN
    UPDATE public.escuelas
    SET ficha_medica_habilitada = NEW.addon_perfil_medico,
        ficha_tecnica_habilitada = NEW.addon_ficha_deportiva
    WHERE id = NEW.escuela_id
      AND (
        ficha_medica_habilitada IS DISTINCT FROM NEW.addon_perfil_medico
        OR ficha_tecnica_habilitada IS DISTINCT FROM NEW.addon_ficha_deportiva
      );
  END IF;

  SELECT cp.incluye_saasport_lite
  INTO v_es_lite
  FROM public.catalogo_planes cp
  WHERE cp.id = NEW.plan_id;

  IF COALESCE(v_es_lite, false) THEN
    PERFORM private.asegurar_cajas_por_defecto_lite(NEW.escuela_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_upsert_escuelas_plan ON public.escuelas_plan;
CREATE TRIGGER trg_after_upsert_escuelas_plan
  AFTER INSERT OR UPDATE ON public.escuelas_plan
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_after_upsert_escuelas_plan();

CREATE OR REPLACE FUNCTION private.fn_seed_plan_nueva_escuela()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.escuelas_plan (
    escuela_id, plan_id, addon_perfil_medico, addon_ficha_deportiva
  ) VALUES (
    NEW.id,
    'combo_basico',
    COALESCE(NEW.ficha_medica_habilitada, false),
    COALESCE(NEW.ficha_tecnica_habilitada, false)
  )
  ON CONFLICT (escuela_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_plan_nueva_escuela ON public.escuelas;
CREATE TRIGGER trg_seed_plan_nueva_escuela
  AFTER INSERT ON public.escuelas
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_seed_plan_nueva_escuela();

-- 4. Backfill seguro para escuelas ya existentes en producción
DO $$
DECLARE
  v_escuela record;
  v_alumnos integer;
  v_usuarios integer;
  v_sucursales integer;
  v_plan record;
BEGIN
  FOR v_escuela IN
    SELECT id, nombre, ficha_medica_habilitada, ficha_tecnica_habilitada
    FROM public.escuelas
  LOOP
    SELECT count(*)::integer INTO v_alumnos
    FROM public.alumnos a
    WHERE a.escuela_id = v_escuela.id
      AND a.archivado IS NOT TRUE
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

    SELECT count(*)::integer INTO v_usuarios
    FROM public.usuarios u
    WHERE u.escuela_id = v_escuela.id
      AND u.activo IS TRUE;

    SELECT count(*)::integer INTO v_sucursales
    FROM public.sucursales s
    WHERE s.escuela_id = v_escuela.id;

    SELECT cp.* INTO v_plan
    FROM public.catalogo_planes cp
    WHERE cp.producto = 'combo'
      AND cp.max_alumnos >= v_alumnos
      AND cp.max_usuarios >= v_usuarios
      AND cp.max_sucursales >= v_sucursales
    ORDER BY cp.orden ASC
    LIMIT 1;

    IF NOT FOUND THEN
      SELECT cp.* INTO v_plan
      FROM public.catalogo_planes cp
      WHERE cp.id = 'combo_completa';
    END IF;

    INSERT INTO public.escuelas_plan (
      escuela_id,
      plan_id,
      usuarios_adicionales,
      alumnos_adicionales,
      sucursales_adicionales,
      addon_fotos_asistencia,
      addon_perfil_medico,
      addon_ficha_deportiva
    ) VALUES (
      v_escuela.id,
      v_plan.id,
      GREATEST(0, v_usuarios - v_plan.max_usuarios),
      GREATEST(0, v_alumnos - v_plan.max_alumnos),
      GREATEST(0, v_sucursales - v_plan.max_sucursales),
      (btrim(v_escuela.nombre) = 'Fundación Inter Stars'),
      COALESCE(v_escuela.ficha_medica_habilitada, false),
      COALESCE(v_escuela.ficha_tecnica_habilitada, false)
    )
    ON CONFLICT (escuela_id) DO NOTHING;
  END LOOP;
END;
$$;

-- 5. Triggers SQL de validación estricta de topes (serializados por escuela)
CREATE OR REPLACE FUNCTION private.obtener_plan_bloqueado(p_escuela_id uuid)
RETURNS TABLE (
  escuela_id uuid,
  plan_id text,
  usuarios_adicionales integer,
  alumnos_adicionales integer,
  sucursales_adicionales integer,
  addon_fotos_asistencia boolean,
  addon_perfil_medico boolean,
  addon_ficha_deportiva boolean,
  addon_cobranza_automatica boolean,
  nombre_producto text,
  nombre_tramo text,
  max_usuarios integer,
  max_alumnos integer,
  max_sucursales integer,
  incluye_saasport_lite boolean,
  incluye_saasport_full boolean,
  incluye_asisport boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ep.escuela_id,
    ep.plan_id,
    ep.usuarios_adicionales,
    ep.alumnos_adicionales,
    ep.sucursales_adicionales,
    ep.addon_fotos_asistencia,
    ep.addon_perfil_medico,
    ep.addon_ficha_deportiva,
    ep.addon_cobranza_automatica,
    cp.nombre_producto,
    cp.nombre_tramo,
    cp.max_usuarios,
    cp.max_alumnos,
    cp.max_sucursales,
    cp.incluye_saasport_lite,
    cp.incluye_saasport_full,
    cp.incluye_asisport
  FROM public.escuelas_plan ep
  JOIN public.catalogo_planes cp ON cp.id = ep.plan_id
  WHERE ep.escuela_id = p_escuela_id
  FOR NO KEY UPDATE OF ep;

  IF NOT FOUND THEN
    INSERT INTO public.escuelas_plan (escuela_id, plan_id)
    VALUES (p_escuela_id, 'combo_basico')
    ON CONFLICT (escuela_id) DO NOTHING;

    RETURN QUERY
    SELECT
      ep.escuela_id,
      ep.plan_id,
      ep.usuarios_adicionales,
      ep.alumnos_adicionales,
      ep.sucursales_adicionales,
      ep.addon_fotos_asistencia,
      ep.addon_perfil_medico,
      ep.addon_ficha_deportiva,
      ep.addon_cobranza_automatica,
      cp.nombre_producto,
      cp.nombre_tramo,
      cp.max_usuarios,
      cp.max_alumnos,
      cp.max_sucursales,
      cp.incluye_saasport_lite,
      cp.incluye_saasport_full,
      cp.incluye_asisport
    FROM public.escuelas_plan ep
    JOIN public.catalogo_planes cp ON cp.id = ep.plan_id
    WHERE ep.escuela_id = p_escuela_id
    FOR NO KEY UPDATE OF ep;
  END IF;
END;
$$;

-- Trigger 1: Tope de alumnos activos
CREATE OR REPLACE FUNCTION private.fn_validar_tope_alumnos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_nuevo_activo boolean;
  v_anterior_activo boolean;
  v_plan record;
  v_usados integer;
  v_limite integer;
BEGIN
  v_nuevo_activo := (NEW.archivado IS NOT TRUE AND COALESCE(NEW.estado, '') <> 'ELIMINADO SISTEMA');
  IF NOT v_nuevo_activo OR NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    v_anterior_activo := (OLD.archivado IS NOT TRUE AND COALESCE(OLD.estado, '') <> 'ELIMINADO SISTEMA');
    IF v_anterior_activo AND OLD.escuela_id IS NOT DISTINCT FROM NEW.escuela_id THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT * INTO v_plan FROM private.obtener_plan_bloqueado(NEW.escuela_id);
  v_limite := v_plan.max_alumnos + v_plan.alumnos_adicionales;

  SELECT count(*)::integer INTO v_usados
  FROM public.alumnos a
  WHERE a.escuela_id = NEW.escuela_id
    AND a.archivado IS NOT TRUE
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
    AND a.id IS DISTINCT FROM NEW.id;

  IF v_usados >= v_limite THEN
    RAISE EXCEPTION 'Has alcanzado el límite de % alumnos activos de tu plan (% - %). Archiva alumnos inactivos o mejora tu plan para habilitar más cupos.',
      v_limite, v_plan.nombre_producto, v_plan.nombre_tramo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_tope_alumnos ON public.alumnos;
CREATE TRIGGER trg_validar_tope_alumnos
  BEFORE INSERT OR UPDATE OF archivado, estado, escuela_id ON public.alumnos
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_validar_tope_alumnos();

-- Trigger 2: Tope de usuarios activos y roles habilitados por plan
CREATE OR REPLACE FUNCTION private.fn_validar_tope_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_plan record;
  v_usados integer;
  v_limite integer;
  v_validar_rol boolean := false;
  v_validar_cupo boolean := false;
BEGIN
  IF NEW.activo IS NOT TRUE OR NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_validar_rol := true;
    v_validar_cupo := true;
  ELSE
    IF OLD.activo IS NOT TRUE
       OR OLD.rol IS DISTINCT FROM NEW.rol
       OR OLD.escuela_id IS DISTINCT FROM NEW.escuela_id THEN
      v_validar_rol := true;
    END IF;
    IF OLD.activo IS NOT TRUE
       OR OLD.escuela_id IS DISTINCT FROM NEW.escuela_id THEN
      v_validar_cupo := true;
    END IF;
  END IF;

  IF NOT v_validar_rol AND NOT v_validar_cupo THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM private.obtener_plan_bloqueado(NEW.escuela_id);

  IF v_validar_rol THEN
    IF NEW.rol IN ('Entrenador', 'Entrenarqueros', 'Medico') AND NOT v_plan.incluye_asisport THEN
      RAISE EXCEPTION 'El rol % no está disponible porque tu plan (% - %) no incluye AsiSport.',
        NEW.rol, v_plan.nombre_producto, v_plan.nombre_tramo
        USING ERRCODE = '23514';
    END IF;

    IF NEW.rol = 'Medico' AND NOT v_plan.addon_perfil_medico THEN
      RAISE EXCEPTION 'El rol de Médico requiere activar el servicio adicional de Perfil Médico en tu escuela.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF v_validar_cupo THEN
    v_limite := v_plan.max_usuarios + v_plan.usuarios_adicionales;

    SELECT count(*)::integer INTO v_usados
    FROM public.usuarios u
    WHERE u.escuela_id = NEW.escuela_id
      AND u.activo IS TRUE
      AND u.id IS DISTINCT FROM NEW.id;

    IF v_usados >= v_limite THEN
      RAISE EXCEPTION 'Has alcanzado el límite de % usuarios activos de tu plan (% - %). Desactiva un usuario o adquiere usuarios adicionales.',
        v_limite, v_plan.nombre_producto, v_plan.nombre_tramo
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_tope_usuarios ON public.usuarios;
CREATE TRIGGER trg_validar_tope_usuarios
  BEFORE INSERT OR UPDATE OF activo, rol, escuela_id ON public.usuarios
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_validar_tope_usuarios();

-- Trigger 3: Tope de sucursales
CREATE OR REPLACE FUNCTION private.fn_validar_tope_sucursales()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_plan record;
  v_usados integer;
  v_limite integer;
BEGIN
  IF NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.escuela_id IS NOT DISTINCT FROM NEW.escuela_id THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM private.obtener_plan_bloqueado(NEW.escuela_id);
  v_limite := v_plan.max_sucursales + v_plan.sucursales_adicionales;

  SELECT count(*)::integer INTO v_usados
  FROM public.sucursales s
  WHERE s.escuela_id = NEW.escuela_id
    AND s.id IS DISTINCT FROM NEW.id;

  IF v_usados >= v_limite THEN
    RAISE EXCEPTION 'Has alcanzado el límite de % sucursal(es) de tu plan (% - %). Mejora tu plan para registrar más sucursales.',
      v_limite, v_plan.nombre_producto, v_plan.nombre_tramo
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validar_tope_sucursales ON public.sucursales;
CREATE TRIGGER trg_validar_tope_sucursales
  BEFORE INSERT OR UPDATE OF escuela_id ON public.sucursales
  FOR EACH ROW
  EXECUTE FUNCTION private.fn_validar_tope_sucursales();

-- Revocar ejecución directa de funciones privadas
REVOKE ALL ON FUNCTION private.asegurar_cajas_por_defecto_lite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_set_updated_at_escuelas_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_after_upsert_escuelas_plan() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_seed_plan_nueva_escuela() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.obtener_plan_bloqueado(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_validar_tope_alumnos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_validar_tope_usuarios() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.fn_validar_tope_sucursales() FROM PUBLIC, anon, authenticated;

-- 6. RPC consolidado para consultar plan, adicionales, cupos y resumen de la escuela en PostgreSQL
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
  v_alumnos_activos integer;
  v_usuarios_activos integer;
  v_entrenadores_activos integer;
  v_sucursales_usadas integer;
  v_alumnos_por_sucursal jsonb;
  v_sin_sucursal integer;
  v_limite_alumnos integer;
  v_limite_usuarios integer;
  v_limite_sucursales integer;
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
  v_limite_usuarios := v_catalogo.max_usuarios + COALESCE(v_plan_escuela.usuarios_adicionales, 0);
  v_limite_sucursales := v_catalogo.max_sucursales + COALESCE(v_plan_escuela.sucursales_adicionales, 0);

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_catalogo.id,
      'producto', v_catalogo.producto,
      'tramo', v_catalogo.tramo,
      'nombre_producto', v_catalogo.nombre_producto,
      'nombre_tramo', v_catalogo.nombre_tramo,
      'precio_mensual_usd', v_catalogo.precio_mensual_usd,
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
        'limite', v_limite_alumnos
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
    'resumen_escuela', jsonb_build_object(
      'entrenadores_activos', v_entrenadores_activos,
      'alumnos_por_sucursal', v_alumnos_por_sucursal
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_obtener_plan_y_cupos_escuela(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_obtener_plan_y_cupos_escuela(uuid) TO authenticated;
