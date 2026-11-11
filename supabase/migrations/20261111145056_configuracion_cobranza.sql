CREATE TABLE public.configuracion_cobranza (
  escuela_id uuid PRIMARY KEY REFERENCES public.escuelas(id) ON DELETE CASCADE,
  parrafo_final text CHECK (char_length(parrafo_final) <= 600)
);
CREATE FUNCTION public.normalizar_configuracion_cobranza() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.parrafo_final := nullif(regexp_replace(NEW.parrafo_final, '^\s+|\s+$', '', 'g'), '');
  RETURN NEW;
END;
$$;
CREATE TRIGGER normalizar_configuracion_cobranza
BEFORE INSERT OR UPDATE ON public.configuracion_cobranza
FOR EACH ROW EXECUTE FUNCTION public.normalizar_configuracion_cobranza();
REVOKE ALL ON FUNCTION public.normalizar_configuracion_cobranza() FROM PUBLIC;
ALTER TABLE public.configuracion_cobranza ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.configuracion_cobranza FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.configuracion_cobranza TO authenticated;
CREATE POLICY leer_cobranza_propia ON public.configuracion_cobranza FOR SELECT TO authenticated
USING (escuela_id = (SELECT public.current_user_escuela_id()));
CREATE POLICY insertar_cobranza_propia ON public.configuracion_cobranza FOR INSERT TO authenticated
WITH CHECK (escuela_id = (SELECT public.current_user_escuela_id()) AND (SELECT public.current_user_rol()) = 'SuperAdministrador');
CREATE POLICY actualizar_cobranza_propia ON public.configuracion_cobranza FOR UPDATE TO authenticated
USING (escuela_id = (SELECT public.current_user_escuela_id()) AND (SELECT public.current_user_rol()) = 'SuperAdministrador')
WITH CHECK (escuela_id = (SELECT public.current_user_escuela_id()) AND (SELECT public.current_user_rol()) = 'SuperAdministrador');
