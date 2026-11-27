-- Campo opcional: texto para conservar ceros iniciales, letras y separadores.
ALTER TABLE public.cajas_bancos
  ADD COLUMN IF NOT EXISTS numero_cuenta text;

COMMENT ON COLUMN public.cajas_bancos.numero_cuenta IS
  'Número de cuenta opcional de la caja o banco. NULL cuando no corresponde.';
