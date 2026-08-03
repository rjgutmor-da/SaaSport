-- Impide registrar movimientos financieros con fecha anterior al 01/01/2020.
--
-- La restricción se deja NOT VALID porque ya existen movimientos históricos
-- anteriores a 2020 que deben revisarse/corregirse por separado. Aun así,
-- PostgreSQL aplica el CHECK a todos los INSERT y UPDATE nuevos.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cobros_aplicados_fecha_min_2020'
      AND conrelid = 'public.cobros_aplicados'::regclass
  ) THEN
    ALTER TABLE public.cobros_aplicados
      ADD CONSTRAINT cobros_aplicados_fecha_min_2020
      CHECK (
        fecha IS NULL
        OR fecha >= TIMESTAMPTZ '2020-01-01 00:00:00 America/La_Paz'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pagos_aplicados_fecha_min_2020'
      AND conrelid = 'public.pagos_aplicados'::regclass
  ) THEN
    ALTER TABLE public.pagos_aplicados
      ADD CONSTRAINT pagos_aplicados_fecha_min_2020
      CHECK (
        fecha IS NULL
        OR fecha >= TIMESTAMPTZ '2020-01-01 00:00:00 America/La_Paz'
      ) NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT cobros_aplicados_fecha_min_2020 ON public.cobros_aplicados IS
  'Los cobros nuevos o editados no pueden tener fecha anterior al 01/01/2020.';

COMMENT ON CONSTRAINT pagos_aplicados_fecha_min_2020 ON public.pagos_aplicados IS
  'Los pagos nuevos o editados no pueden tener fecha anterior al 01/01/2020.';
