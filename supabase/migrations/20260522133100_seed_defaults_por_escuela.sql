-- ==============================================================================
-- SaaSport: Auto-seed de Torneos y Conceptos del Catálogo por Escuela
-- Ubicación Oficial: SaaSport/supabase/migrations/20260522133100_seed_defaults_por_escuela.sql
--
-- Objetivo: Garantizar que TODA escuela (nueva o existente) tenga precargados
-- los torneos y conceptos predeterminados, asociados a su escuela_id específico.
-- Si los datos ya existen (ON CONFLICT DO NOTHING) no se duplicarán.
-- ==============================================================================


-- ==============================================================================
-- PARTE 1: FUNCIÓN PARA SEMBRAR TORNEOS DE UNA ESCUELA
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_seed_torneos_escuela(p_escuela_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.torneos (escuela_id, nombre, activo)
  VALUES
    (p_escuela_id, 'Atletico Junior', true),
    (p_escuela_id, 'Blooming Cup',    true),
    (p_escuela_id, 'Cañito',          true),
    (p_escuela_id, 'JMP',             true),
    (p_escuela_id, 'Leones',          true),
    (p_escuela_id, 'Milton Melgar',   true),
    (p_escuela_id, 'Planeta',         true),
    (p_escuela_id, 'Semillero',       true),
    (p_escuela_id, 'Sucha Suarez',    true),
    (p_escuela_id, 'Super Campeones', true),
    (p_escuela_id, 'Taquito',         true),
    (p_escuela_id, 'Torito Garcia',   true)
  ON CONFLICT (escuela_id, nombre) DO NOTHING;
END;
$$;


-- ==============================================================================
-- PARTE 2: FUNCIÓN PARA SEMBRAR CONCEPTOS DEL CATÁLOGO DE UNA ESCUELA
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_seed_catalogo_escuela(p_escuela_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.catalogo_items
    (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
  VALUES
    -- Ingresos principales
    (p_escuela_id, 'Mensualidad',            'servicio', 'servicio', 'ingreso', 150.00, true, true,  false),
    (p_escuela_id, 'Inscripción a Torneos',  'servicio', 'servicio', 'ingreso', 150.00, true, true,  false),
    (p_escuela_id, 'Matrícula / Inscripción','servicio', 'servicio', 'ingreso', 100.00, true, true,  false),
    (p_escuela_id, 'Uniforme Completo',      'producto', 'producto', 'ingreso', 250.00, true, true,  false),
    (p_escuela_id, 'Polera',                 'producto', 'producto', 'ingreso', 100.00, true, true,  false),
    (p_escuela_id, 'Short',                  'producto', 'producto', 'ingreso',  80.00, true, true,  false),
    (p_escuela_id, 'Medias',                 'producto', 'producto', 'ingreso',  30.00, true, true,  false),
    (p_escuela_id, 'Buzo / Casaca',          'producto', 'producto', 'ingreso', 150.00, true, true,  false),
    (p_escuela_id, 'Balón',                  'producto', 'producto', 'ingreso', 200.00, true, true,  false),
    (p_escuela_id, 'Saldo Inicial',          'servicio', 'servicio', 'ingreso',   0.00, true, true,  false),
    -- Gastos principales
    (p_escuela_id, 'Sueldo Entrenador',      'servicio', 'gasto',   'egreso',    0.00, true, false, true),
    (p_escuela_id, 'Alquiler Cancha',        'servicio', 'gasto',   'egreso',    0.00, true, false, true),
    (p_escuela_id, 'Materiales Deportivos',  'servicio', 'gasto',   'egreso',    0.00, true, false, true),
    (p_escuela_id, 'Gastos Administrativos', 'servicio', 'gasto',   'egreso',    0.00, true, false, true),
    (p_escuela_id, 'Servicios Básicos',      'servicio', 'gasto',   'egreso',    0.00, true, false, true)
  ON CONFLICT DO NOTHING;
END;
$$;


-- ==============================================================================
-- PARTE 3: TRIGGER — Ejecutar seed automáticamente al crear una escuela nueva
-- ==============================================================================

CREATE OR REPLACE FUNCTION fn_after_insert_escuela()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM fn_seed_torneos_escuela(NEW.id);
  PERFORM fn_seed_catalogo_escuela(NEW.id);
  RETURN NEW;
END;
$$;

-- Eliminar trigger anterior si existía (idempotente)
DROP TRIGGER IF EXISTS trg_seed_defaults_nueva_escuela ON public.escuelas;

CREATE TRIGGER trg_seed_defaults_nueva_escuela
AFTER INSERT ON public.escuelas
FOR EACH ROW
EXECUTE FUNCTION fn_after_insert_escuela();


-- ==============================================================================
-- PARTE 4: SEED INMEDIATO PARA TODAS LAS ESCUELAS EXISTENTES
-- Aplica las funciones sobre cada escuela ya registrada en la base de datos.
-- ON CONFLICT DO NOTHING garantiza que no se dupliquen registros existentes.
-- ==============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.escuelas LOOP
    PERFORM fn_seed_torneos_escuela(r.id);
    PERFORM fn_seed_catalogo_escuela(r.id);
  END LOOP;
END;
$$;
