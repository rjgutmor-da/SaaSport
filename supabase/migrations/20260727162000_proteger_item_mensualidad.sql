-- Mensualidad identifica flujos financieros y no debe poder cambiarse ni eliminarse.
UPDATE public.catalogo_items
SET nombre = 'Mensualidad'
WHERE escuela_id = 'c6de66fd-d265-4fd3-bdec-51588315da3b'
  AND lower(btrim(nombre)) = 'mensualidad gold';

CREATE OR REPLACE FUNCTION public.proteger_item_mensualidad()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    lower(btrim(OLD.nombre)) = 'mensualidad'
    OR lower(btrim(NEW.nombre)) = 'mensualidad'
  ) THEN
    RAISE EXCEPTION 'El ítem Mensualidad está protegido y no puede editarse.';
  END IF;

  IF TG_OP = 'DELETE' AND lower(btrim(OLD.nombre)) = 'mensualidad' THEN
    RAISE EXCEPTION 'El ítem Mensualidad está protegido y no puede eliminarse.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_proteger_item_mensualidad ON public.catalogo_items;

CREATE TRIGGER trg_proteger_item_mensualidad
BEFORE UPDATE OR DELETE ON public.catalogo_items
FOR EACH ROW
EXECUTE FUNCTION public.proteger_item_mensualidad();
