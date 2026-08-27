-- Automatiza la asignación del escuela_id en las inserciones 
-- utilizando la función de contexto del usuario autenticado.

ALTER TABLE public.sucursales ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.grupos ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.horarios ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.alumnos ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.convocatorias ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cajas_bancos ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.proveedores ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.personal ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.catalogo_items ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cuentas_cobrar ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cuentas_pagar ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cobros_aplicados ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.pagos_aplicados ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cxc_detalle ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
ALTER TABLE public.cxp_detalle ALTER COLUMN escuela_id SET DEFAULT current_user_escuela_id();
