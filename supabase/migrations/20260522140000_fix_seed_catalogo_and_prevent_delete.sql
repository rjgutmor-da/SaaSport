-- ==============================================================================
-- SaaSport: Corrección de Catálogo, Auto-seed y Prevención de Borrado
-- Ubicación Oficial: SaaSport/supabase/migrations/20260522140000_fix_seed_catalogo_and_prevent_delete.sql
-- ==============================================================================

-- 1. ELIMINAR LOS CONCEPTOS SIN MOVIMIENTOS EN PLANETA FC
-- Escuela PLANETA FC: '218ea007-49c4-4fa2-9e81-3b6663496f26'
DELETE FROM public.catalogo_items ci
WHERE 
    ci.escuela_id = '218ea007-49c4-4fa2-9e81-3b6663496f26'
    AND NOT EXISTS (SELECT 1 FROM public.cxc_detalle WHERE catalogo_item_id = ci.id)
    AND NOT EXISTS (SELECT 1 FROM public.cxp_detalle WHERE catalogo_item_id = ci.id)
    AND NOT EXISTS (SELECT 1 FROM public.movimientos_stock WHERE catalogo_item_id = ci.id);

-- 2. ELIMINAR LOS CONCEPTOS DE LA ESCUELA 1 (Fundación Inter Stars)
-- Escuela 1: '01934d0c-b334-4e6c-8a90-3c1e400c7118'
-- Como no tiene movimientos, se eliminarán todos los conceptos genéricos anteriores.
DELETE FROM public.catalogo_items ci
WHERE 
    ci.escuela_id = '01934d0c-b334-4e6c-8a90-3c1e400c7118'
    AND NOT EXISTS (SELECT 1 FROM public.cxc_detalle WHERE catalogo_item_id = ci.id)
    AND NOT EXISTS (SELECT 1 FROM public.cxp_detalle WHERE catalogo_item_id = ci.id)
    AND NOT EXISTS (SELECT 1 FROM public.movimientos_stock WHERE catalogo_item_id = ci.id);

-- 3. AGREGAR RESTRICCIÓN ÚNICA PARA EVITAR FUTUROS DUPLICADOS POR NOMBRE
ALTER TABLE public.catalogo_items 
ADD CONSTRAINT catalogo_items_escuela_id_nombre_key UNIQUE (escuela_id, nombre);

-- 4. RECREAR LA FUNCIÓN DE SEED CON LOS 20 CONCEPTOS REALES
CREATE OR REPLACE FUNCTION fn_seed_catalogo_escuela(p_escuela_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO public.catalogo_items
    (escuela_id, nombre, tipo, categoria, tipo_movimiento, precio_venta, activo, es_ingreso, es_gasto)
  VALUES
    (p_escuela_id, 'ACF',                     'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Alquiler de Cancha',      'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Ayuda Social',            'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Gastos de Oficinas',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Gastos de Transporte',    'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Inscripción a Torneos',   'servicio', 'servicio', 'ambos',   150.00, true, true,  true),
    (p_escuela_id, 'Intereses Bancarios',     'servicio', 'servicio', 'ambos',     null, true, true,  true),
    (p_escuela_id, 'Licencias Software',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Limpieza',                'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Mantenimiento Canchas',   'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Material Deportivo',      'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Material Medico',         'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Medias',                  'producto', 'producto', 'ambos',    55.00, true, true,  true),
    (p_escuela_id, 'Mensualidad',             'servicio', 'servicio', 'ingreso',   0.00, true, true,  false),
    (p_escuela_id, 'Refrigerios y Agasajos',  'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Saldo Inicial',           'servicio', 'servicio', 'ambos',     0.00, true, true,  true),
    (p_escuela_id, 'Servicios Básicos',       'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Servicios Profesionales', 'servicio', 'gasto',    'egreso',    null, true, false, true),
    (p_escuela_id, 'Sueldos y Salarios',      'servicio', 'servicio', 'egreso',    null, true, false, true),
    (p_escuela_id, 'Uniformes',               'producto', 'producto', 'ambos',   170.00, true, true,  true)
  ON CONFLICT (escuela_id, nombre) DO NOTHING;
END;
$$;

-- 5. SEMBRAR LA ESCUELA 1 CON LA NUEVA LISTA DE CONCEPTOS
SELECT fn_seed_catalogo_escuela('01934d0c-b334-4e6c-8a90-3c1e400c7118');

-- 6. PREVENCIÓN DE ELIMINACIÓN DE CONCEPTOS CON HISTORIAL
-- Función del trigger
CREATE OR REPLACE FUNCTION fn_prevent_delete_catalogo_item_with_movements()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cxc_detalle WHERE catalogo_item_id = OLD.id) OR
     EXISTS (SELECT 1 FROM public.cxp_detalle WHERE catalogo_item_id = OLD.id) OR
     EXISTS (SELECT 1 FROM public.movimientos_stock WHERE catalogo_item_id = OLD.id) THEN
    RAISE EXCEPTION 'No se puede eliminar el concepto "%" porque tiene movimientos asociados en el historial. Puede desactivarlo en su lugar.', OLD.nombre;
  END IF;
  RETURN OLD;
END;
$$;

-- Creación del trigger BEFORE DELETE
DROP TRIGGER IF EXISTS trg_prevent_delete_catalogo_item ON public.catalogo_items;

CREATE TRIGGER trg_prevent_delete_catalogo_item
BEFORE DELETE ON public.catalogo_items
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_delete_catalogo_item_with_movements();
