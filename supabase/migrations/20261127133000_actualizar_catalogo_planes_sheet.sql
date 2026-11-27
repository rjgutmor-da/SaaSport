-- Migración: Actualizar la tabla maestra public.catalogo_planes con los topes y precios vigentes del Google Sheet.

INSERT INTO public.catalogo_planes (
  id, producto, tramo, nombre_producto, nombre_tramo, precio_mensual_usd,
  max_usuarios, max_alumnos, max_sucursales,
  incluye_saasport_lite, incluye_saasport_full, incluye_asisport, orden
) VALUES
  -- SaaSport Lite
  ('saasport_lite_basico',      'saasport_lite', 'basico',      'SaaSport Lite', 'Básico',       6.00,  2, 100, 1, true,  false, false, 1),
  ('saasport_lite_crecimiento', 'saasport_lite', 'crecimiento', 'SaaSport Lite', 'Crecimiento', 10.00,  3, 250, 2, true,  false, false, 2),
  ('saasport_lite_profesional', 'saasport_lite', 'profesional', 'SaaSport Lite', 'Profesional', 15.00,  4, 400, 3, true,  false, false, 3),
  ('saasport_lite_completa',    'saasport_lite', 'completa',    'SaaSport Lite', 'Completa',    20.00,  5, 600, 4, true,  false, false, 4),
  -- SaaSport
  ('saasport_basico',      'saasport', 'basico',      'SaaSport', 'Básico',      15.00, 2, 100, 2, false, true, false, 5),
  ('saasport_crecimiento', 'saasport', 'crecimiento', 'SaaSport', 'Crecimiento', 20.00, 3, 250, 4, false, true, false, 6),
  ('saasport_profesional', 'saasport', 'profesional', 'SaaSport', 'Profesional', 25.00, 4, 400, 6, false, true, false, 7),
  ('saasport_completa',    'saasport', 'completa',    'SaaSport', 'Completa',    35.00, 5, 600, 8, false, true, false, 8),
  -- AsiSport
  ('asisport_basico',      'asisport', 'basico',      'AsiSport', 'Básico',      15.00,  3, 100, 2, false, false, true,  9),
  ('asisport_crecimiento', 'asisport', 'crecimiento', 'AsiSport', 'Crecimiento', 20.00,  6, 250, 4, false, false, true, 10),
  ('asisport_profesional', 'asisport', 'profesional', 'AsiSport', 'Profesional', 30.00, 10, 400, 6, false, false, true, 11),
  ('asisport_completa',    'asisport', 'completa',    'AsiSport', 'Completa',    35.00, 15, 600, 8, false, false, true, 12),
  -- AsiSport + SaaSport (Combo)
  ('combo_basico',      'combo', 'basico',      'AsiSport + SaaSport', 'Básico',      25.00,  5, 100, 3, false, true, true, 13),
  ('combo_crecimiento', 'combo', 'crecimiento', 'AsiSport + SaaSport', 'Crecimiento', 35.00, 12, 250, 5, false, true, true, 14),
  ('combo_profesional', 'combo', 'profesional', 'AsiSport + SaaSport', 'Profesional', 50.00, 20, 400, 7, false, true, true, 15),
  ('combo_completa',    'combo', 'completa',    'AsiSport + SaaSport', 'Completa',    65.00, 30, 600, 9, false, true, true, 16)
ON CONFLICT (id) DO UPDATE SET
  producto              = EXCLUDED.producto,
  tramo                 = EXCLUDED.tramo,
  nombre_producto       = EXCLUDED.nombre_producto,
  nombre_tramo          = EXCLUDED.nombre_tramo,
  precio_mensual_usd    = EXCLUDED.precio_mensual_usd,
  max_usuarios          = EXCLUDED.max_usuarios,
  max_alumnos           = EXCLUDED.max_alumnos,
  max_sucursales        = EXCLUDED.max_sucursales,
  incluye_saasport_lite = EXCLUDED.incluye_saasport_lite,
  incluye_saasport_full = EXCLUDED.incluye_saasport_full,
  incluye_asisport      = EXCLUDED.incluye_asisport,
  orden                 = EXCLUDED.orden;
