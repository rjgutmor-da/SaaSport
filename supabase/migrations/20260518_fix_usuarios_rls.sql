-- Corrige la vulnerabilidad en public.usuarios donde cualquier usuario
-- autenticado de cualquier escuela podía ver los usuarios de todas las escuelas.
ALTER POLICY "Allow authenticated read access" ON public.usuarios 
USING (escuela_id = current_user_escuela_id());
