-- Agrega soporte para símbolo de moneda por escuela (sin multimoneda)
ALTER TABLE public.escuelas
  ADD COLUMN IF NOT EXISTS simbolo_moneda text NOT NULL DEFAULT 'Bs'
  CONSTRAINT escuelas_simbolo_moneda_valido
  CHECK (simbolo_moneda IN ('$','Bs','S/','R$','Gs'));
