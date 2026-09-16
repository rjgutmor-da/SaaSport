-- Esquema mínimo SOLO para PostgreSQL embebido. No aplicar a Supabase.
-- Reproduce dependencias necesarias; NO es una copia completa de producción.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY, instance_id uuid, aud text, role text, email text,
 encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb,
 raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
CREATE TABLE public.escuelas (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nombre text);
CREATE TABLE public.sucursales (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas, nombre text
);
CREATE TABLE public.usuarios (
 id uuid PRIMARY KEY REFERENCES auth.users, escuela_id uuid REFERENCES escuelas,
 email text, nombres text, apellidos text, rol text, activo boolean DEFAULT true,
 sucursal_id uuid REFERENCES sucursales
);
CREATE FUNCTION public.current_user_escuela_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 AS $$ SELECT escuela_id FROM public.usuarios WHERE id = auth.uid() $$;
CREATE FUNCTION public.current_user_rol() RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
 AS $$ SELECT rol FROM public.usuarios WHERE id = auth.uid() $$;
CREATE FUNCTION private.current_user_sucursal_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
 AS $$ SELECT sucursal_id FROM public.usuarios WHERE id = auth.uid() $$;
CREATE TABLE public.alumnos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 sucursal_id uuid REFERENCES sucursales, nombres text, apellidos text,
 fecha_nacimiento date, archivado boolean DEFAULT false
);
CREATE TABLE public.proveedores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 nombre text, activo boolean DEFAULT true
);
CREATE TABLE public.personal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas
);
CREATE TABLE public.catalogo_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 nombre text, tipo text, categoria text, precio_venta numeric, activo boolean DEFAULT true,
 UNIQUE (escuela_id, nombre)
);
CREATE TABLE public.cuentas_cobrar (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 sucursal_id uuid REFERENCES sucursales, alumno_id uuid REFERENCES alumnos,
 monto_total numeric NOT NULL, descripcion text, observaciones text,
 fecha_emision date, fecha_vencimiento date, es_anticipo boolean DEFAULT false,
 estado text DEFAULT 'pendiente', nro_recibo text, ciclo_inicio date, ciclo_fin date,
 periodo_estadistico date, origen_facturacion text DEFAULT 'manual',
 created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
 editado boolean DEFAULT false, editado_por uuid, editado_at timestamptz,
 anulada boolean DEFAULT false, es_ingreso_directo boolean DEFAULT false
);
CREATE TABLE public.cuentas_pagar (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 sucursal_id uuid REFERENCES sucursales, proveedor_id uuid REFERENCES proveedores,
 personal_id uuid REFERENCES personal, monto_total numeric NOT NULL,
 descripcion text, observaciones text, fecha_emision date, fecha_vencimiento date,
 es_anticipo boolean DEFAULT false, estado text DEFAULT 'pendiente',
 tipo_gasto text, periodo text, created_at timestamptz DEFAULT now(),
 updated_at timestamptz DEFAULT now(), editado boolean DEFAULT false,
 editado_por uuid, editado_at timestamptz, anulada boolean DEFAULT false
);
CREATE TABLE public.cxc_detalle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 cuenta_cobrar_id uuid REFERENCES cuentas_cobrar ON DELETE CASCADE,
 catalogo_item_id uuid REFERENCES catalogo_items,
 cantidad integer, precio_unitario numeric, periodo_meses jsonb,
 detalle_extra text, ciclo_inicio date, ciclo_fin date, periodo_estadistico date,
 CHECK ((ciclo_inicio IS NULL AND ciclo_fin IS NULL AND periodo_estadistico IS NULL)
 OR (ciclo_inicio IS NOT NULL AND ciclo_fin IS NOT NULL AND periodo_estadistico IS NOT NULL
 AND ciclo_fin >= ciclo_inicio))
);
CREATE TABLE public.cxp_detalle (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 cuenta_pagar_id uuid REFERENCES cuentas_pagar ON DELETE CASCADE,
 catalogo_item_id uuid REFERENCES catalogo_items, cantidad integer,
 precio_unitario numeric, descripcion text
);
CREATE TABLE public.cobros_aplicados (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 cuenta_cobrar_id uuid REFERENCES cuentas_cobrar, monto_aplicado numeric, usuario_id uuid
);
CREATE TABLE public.pagos_aplicados (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 cuenta_pagar_id uuid REFERENCES cuentas_pagar, monto_aplicado numeric, usuario_id uuid
);
CREATE TABLE public.movimientos_stock (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), escuela_id uuid REFERENCES escuelas,
 catalogo_item_id uuid REFERENCES catalogo_items
);
-- Semilla mínima equivalente a los conceptos que necesita la suite.
CREATE FUNCTION public.fixture_sembrar_catalogo() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO public.catalogo_items (escuela_id, nombre, tipo, categoria, precio_venta)
 VALUES (NEW.id,'Mensualidad','servicio','servicio',100),
        (NEW.id,'Medias','producto','producto',10),
        (NEW.id,'Uniformes','producto','producto',50);
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_sembrar_catalogo AFTER INSERT ON public.escuelas
 FOR EACH ROW EXECUTE FUNCTION public.fixture_sembrar_catalogo();
-- Definiciones existentes verificadas mediante lectura el 2026-09-15.
CREATE OR REPLACE FUNCTION public.calcular_periodo_estadistico(p_fecha_inicio date)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE STRICT
 SET search_path TO ''
AS $function$
    SELECT CASE
        WHEN EXTRACT(DAY FROM p_fecha_inicio) <= 16
            THEN date_trunc('month', p_fecha_inicio)::date
        ELSE (date_trunc('month', p_fecha_inicio) + INTERVAL '1 month')::date
    END;
$function$
;

CREATE OR REPLACE FUNCTION public.cxc_legacy_cubre_periodo(p_cuenta_cobrar_id uuid, p_periodo date)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.cuentas_cobrar cc
        JOIN public.cxc_detalle cd ON cd.cuenta_cobrar_id = cc.id
        JOIN public.catalogo_items ci ON ci.id = cd.catalogo_item_id
        CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(cd.periodo_meses, '[]'::jsonb)) mes(valor)
        WHERE cc.id = p_cuenta_cobrar_id
          AND lower(ci.nombre) = 'mensualidad'
          AND lower(left(mes.valor, 3)) =
              (ARRAY['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'])
                  [EXTRACT(MONTH FROM p_periodo)::INTEGER]
          AND CASE
              WHEN mes.valor ~ '-[0-9]{4}$' THEN right(mes.valor, 4)::INTEGER
              ELSE EXTRACT(YEAR FROM cc.fecha_emision)::INTEGER
          END = EXTRACT(YEAR FROM p_periodo)::INTEGER
    );
$function$
;

CREATE OR REPLACE FUNCTION public.validar_total_detalle_cxc()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_monto_total numeric;
  v_escuela_id uuid;
  v_total_existente numeric;
BEGIN
  SELECT cc.monto_total, cc.escuela_id
    INTO v_monto_total, v_escuela_id
  FROM public.cuentas_cobrar cc
  WHERE cc.id = NEW.cuenta_cobrar_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La Nota de Servicio indicada no existe.'
      USING ERRCODE = '23503';
  END IF;

  IF NEW.escuela_id IS DISTINCT FROM v_escuela_id THEN
    RAISE EXCEPTION 'El detalle debe pertenecer a la misma escuela que la Nota de Servicio.'
      USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(cd.cantidad * cd.precio_unitario), 0)
    INTO v_total_existente
  FROM public.cxc_detalle cd
  WHERE cd.cuenta_cobrar_id = NEW.cuenta_cobrar_id
    AND cd.id IS DISTINCT FROM NEW.id;

  IF v_total_existente + (NEW.cantidad * NEW.precio_unitario) > v_monto_total THEN
    RAISE EXCEPTION 'El detalle excede el total de la Nota de Servicio (Bs %).', v_monto_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.validar_ciclo_mensualidad_detalle()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_nombre_item TEXT; v_alumno_id UUID; v_nota_anulada BOOLEAN; v_es_anticipo BOOLEAN; v_es_ingreso_directo BOOLEAN; v_ciclo_inicio_nota DATE; v_ciclo_fin_nota DATE; v_periodo DATE;
BEGIN
  SELECT lower(btrim(ci.nombre)) INTO v_nombre_item FROM public.catalogo_items ci WHERE ci.id = NEW.catalogo_item_id AND ci.escuela_id = NEW.escuela_id;
  IF v_nombre_item IS DISTINCT FROM 'mensualidad' THEN
    IF NEW.ciclo_inicio IS NOT NULL OR NEW.ciclo_fin IS NOT NULL OR NEW.periodo_estadistico IS NOT NULL THEN RAISE EXCEPTION 'Solo una linea de Mensualidad puede tener ciclo.'; END IF;
    RETURN NEW;
  END IF;
  SELECT cc.alumno_id, cc.anulada, cc.es_anticipo, cc.es_ingreso_directo, cc.ciclo_inicio, cc.ciclo_fin INTO v_alumno_id, v_nota_anulada, v_es_anticipo, v_es_ingreso_directo, v_ciclo_inicio_nota, v_ciclo_fin_nota FROM public.cuentas_cobrar cc WHERE cc.id = NEW.cuenta_cobrar_id AND cc.escuela_id = NEW.escuela_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida.'; END IF;
  IF v_alumno_id IS NULL AND v_es_ingreso_directo IS TRUE THEN NEW.ciclo_inicio := NULL; NEW.ciclo_fin := NULL; NEW.periodo_estadistico := NULL; RETURN NEW; END IF;
  IF v_alumno_id IS NULL THEN RAISE EXCEPTION 'La mensualidad no pertenece a una cuenta valida del alumno.'; END IF;
  IF v_es_anticipo IS TRUE THEN NEW.ciclo_inicio := NULL; NEW.ciclo_fin := NULL; NEW.periodo_estadistico := NULL; RETURN NEW; END IF;
  NEW.ciclo_inicio := COALESCE(NEW.ciclo_inicio, v_ciclo_inicio_nota); NEW.ciclo_fin := COALESCE(NEW.ciclo_fin, v_ciclo_fin_nota);
  IF NEW.ciclo_inicio IS NULL OR NEW.ciclo_fin IS NULL OR NEW.ciclo_fin < NEW.ciclo_inicio THEN RAISE EXCEPTION 'Cada mensualidad debe tener un ciclo valido.'; END IF;
  v_periodo := public.calcular_periodo_estadistico(NEW.ciclo_inicio); NEW.periodo_estadistico := v_periodo;
  IF v_nota_anulada IS NOT TRUE THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.escuela_id::TEXT || ':' || v_alumno_id::TEXT || ':' || v_periodo::TEXT, 0));
    IF EXISTS (SELECT 1 FROM public.cxc_detalle otro JOIN public.cuentas_cobrar cc ON cc.id = otro.cuenta_cobrar_id JOIN public.catalogo_items ci ON ci.id = otro.catalogo_item_id WHERE otro.escuela_id = NEW.escuela_id AND cc.alumno_id = v_alumno_id AND cc.anulada IS NOT TRUE AND cc.es_anticipo IS NOT TRUE AND cc.estado <> 'borrador' AND lower(btrim(ci.nombre)) = 'mensualidad' AND otro.periodo_estadistico = v_periodo AND otro.id IS DISTINCT FROM NEW.id) OR EXISTS (SELECT 1 FROM public.cuentas_cobrar cc WHERE cc.escuela_id = NEW.escuela_id AND cc.alumno_id = v_alumno_id AND cc.id <> NEW.cuenta_cobrar_id AND cc.anulada IS NOT TRUE AND cc.es_anticipo IS NOT TRUE AND cc.estado <> 'borrador' AND (cc.periodo_estadistico = v_periodo OR (cc.periodo_estadistico IS NULL AND public.cxc_legacy_cubre_periodo(cc.id, v_periodo))) AND NOT EXISTS (SELECT 1 FROM public.cxc_detalle migrado WHERE migrado.cuenta_cobrar_id = cc.id AND migrado.periodo_estadistico IS NOT NULL)) THEN RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'Ya existe una mensualidad activa para el alumno y periodo.'; END IF;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE TRIGGER trg_validar_ciclo_mensualidad_detalle
 BEFORE INSERT OR UPDATE ON public.cxc_detalle
 FOR EACH ROW EXECUTE FUNCTION public.validar_ciclo_mensualidad_detalle();
CREATE TRIGGER trg_validar_total_detalle_cxc
 BEFORE INSERT OR UPDATE ON public.cxc_detalle
 FOR EACH ROW EXECUTE FUNCTION public.validar_total_detalle_cxc();
