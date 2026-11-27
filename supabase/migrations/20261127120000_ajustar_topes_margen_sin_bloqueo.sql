-- Migración: Alinear sucursales al Google Sheet (2/5/8/11), retirar bloqueos duros de cupos numéricos,
-- aplicar margen gratuito del 15% en alumnos, optimizar asignación de usuarios adicionales ($2) vs salto de tramo,
-- y enriquecer rpc_obtener_plan_y_cupos_escuela con alertas y recomendación automática.

-- 1. Actualizar topes de sucursales según fuente de verdad (Google Sheet: 2 / 5 / 8 / 11)
UPDATE public.catalogo_planes SET max_sucursales = 2  WHERE tramo = 'basico';
UPDATE public.catalogo_planes SET max_sucursales = 5  WHERE tramo = 'crecimiento';
UPDATE public.catalogo_planes SET max_sucursales = 8  WHERE tramo = 'profesional';
UPDATE public.catalogo_planes SET max_sucursales = 11 WHERE tramo = 'completa';

-- 2. Retirar bloqueos duros de cupos numéricos (nunca bloquear alumnos, usuarios ni sucursales)
DROP TRIGGER IF EXISTS trg_validar_tope_alumnos ON public.alumnos;
DROP TRIGGER IF EXISTS trg_validar_tope_sucursales ON public.sucursales;

-- Conservar únicamente la validación de roles incompatibles con el plan/adicionales
CREATE OR REPLACE FUNCTION private.fn_validar_tope_usuarios()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private, pg_temp
AS $$
DECLARE
  v_plan record;
  v_validar_rol boolean := false;
BEGIN
  IF NEW.activo IS NOT TRUE OR NEW.escuela_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_validar_rol := true;
  ELSIF OLD.activo IS NOT TRUE
     OR OLD.rol IS DISTINCT FROM NEW.rol
     OR OLD.escuela_id IS DISTINCT FROM NEW.escuela_id THEN
    v_validar_rol := true;
  END IF;

  IF NOT v_validar_rol THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_plan FROM private.obtener_plan_bloqueado(NEW.escuela_id);

  IF NEW.rol IN ('Entrenador', 'Entrenarqueros', 'Medico') AND NOT v_plan.incluye_asisport THEN
    RAISE EXCEPTION 'El rol % no está disponible porque tu plan (% - %) no incluye AsiSport.',
      NEW.rol, v_plan.nombre_producto, v_plan.nombre_tramo
      USING ERRCODE = '23514';
  END IF;

  IF NEW.rol = 'Medico' AND NOT v_plan.addon_perfil_medico THEN
    RAISE EXCEPTION 'El rol de Médico requiere activar el servicio adicional de Perfil Médico en tu escuela.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Recalcular escuelas_plan actual con la regla óptima (margen 15% alumnos + $2/usuario adicional vs salto de tramo)
DO $$
DECLARE
  v_escuela record;
  v_alumnos integer;
  v_usuarios integer;
  v_sucursales integer;
  v_candidato record;
  v_mejor_plan_id text;
  v_mejor_usr_extra integer;
  v_mejor_costo numeric;
  v_costo_candidato numeric;
  v_usr_extra integer;
BEGIN
  FOR v_escuela IN
    SELECT e.id, ep.plan_id, cp.producto
    FROM public.escuelas e
    JOIN public.escuelas_plan ep ON ep.escuela_id = e.id
    JOIN public.catalogo_planes cp ON cp.id = ep.plan_id
  LOOP
    SELECT count(*)::integer INTO v_alumnos
    FROM public.alumnos a
    WHERE a.escuela_id = v_escuela.id
      AND a.archivado IS NOT TRUE
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

    SELECT count(*)::integer INTO v_usuarios
    FROM public.usuarios u
    WHERE u.escuela_id = v_escuela.id
      AND u.activo IS TRUE;

    SELECT count(*)::integer INTO v_sucursales
    FROM public.sucursales s
    WHERE s.escuela_id = v_escuela.id;

    v_mejor_plan_id := NULL;
    v_mejor_usr_extra := 0;
    v_mejor_costo := NULL;

    -- Evaluar todos los tramos del mismo producto que cubran sucursales y alumnos (con 15% de margen gratis)
    FOR v_candidato IN
      SELECT cp.*
      FROM public.catalogo_planes cp
      WHERE cp.producto = v_escuela.producto
        AND cp.max_sucursales >= v_sucursales
        AND floor(cp.max_alumnos * 1.15)::integer >= v_alumnos
      ORDER BY cp.orden ASC
    LOOP
      v_usr_extra := GREATEST(0, v_usuarios - v_candidato.max_usuarios);
      v_costo_candidato := v_candidato.precio_mensual_usd + (v_usr_extra * 2.00);

      -- Si el costo es menor o igual al mejor encontrado, preferir el tramo superior en empate
      IF v_mejor_costo IS NULL OR v_costo_candidato <= v_mejor_costo THEN
        v_mejor_costo := v_costo_candidato;
        v_mejor_plan_id := v_candidato.id;
        v_mejor_usr_extra := v_usr_extra;
      END IF;
    END LOOP;

    -- Fallback al tramo más alto del producto si supera incluso Completa + 15%
    IF v_mejor_plan_id IS NULL THEN
      SELECT cp.id, GREATEST(0, v_usuarios - cp.max_usuarios)
      INTO v_mejor_plan_id, v_mejor_usr_extra
      FROM public.catalogo_planes cp
      WHERE cp.producto = v_escuela.producto
      ORDER BY cp.orden DESC
      LIMIT 1;
    END IF;

    UPDATE public.escuelas_plan
    SET plan_id = v_mejor_plan_id,
        usuarios_adicionales = v_mejor_usr_extra,
        alumnos_adicionales = 0,
        sucursales_adicionales = 0
    WHERE escuela_id = v_escuela.id;
  END LOOP;
END;
$$;

-- 4. Actualizar RPC consolidado con margen del 15%, estado de alerta y recomendación económica
CREATE OR REPLACE FUNCTION public.rpc_obtener_plan_y_cupos_escuela(p_escuela_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor public.usuarios%ROWTYPE;
  v_escuela_id uuid;
  v_plan_escuela public.escuelas_plan%ROWTYPE;
  v_catalogo public.catalogo_planes%ROWTYPE;
  v_siguiente public.catalogo_planes%ROWTYPE;
  v_tiene_siguiente boolean := false;
  v_alumnos_activos integer;
  v_usuarios_activos integer;
  v_entrenadores_activos integer;
  v_sucursales_usadas integer;
  v_alumnos_por_sucursal jsonb;
  v_sin_sucursal integer;
  v_limite_alumnos integer;
  v_limite_alumnos_margen integer;
  v_limite_usuarios integer;
  v_limite_sucursales integer;
  v_en_margen_alumnos boolean;
  v_excede_alumnos boolean;
  v_excede_usuarios boolean;
  v_excede_sucursales boolean;
  v_requiere_atencion boolean;
  v_usuarios_faltantes integer;
  v_costo_con_extras numeric(10,2);
  v_costo_extras_nuevos numeric(10,2);
  v_rec_tipo text := NULL;
  v_rec_mensaje text := NULL;
BEGIN
  SELECT * INTO v_actor
  FROM public.usuarios
  WHERE id = auth.uid()
    AND activo IS TRUE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE = '42501';
  END IF;

  v_escuela_id := COALESCE(p_escuela_id, v_actor.escuela_id);
  IF v_escuela_id IS DISTINCT FROM v_actor.escuela_id THEN
    RAISE EXCEPTION 'No autorizado para consultar otra escuela.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_plan_escuela
  FROM public.escuelas_plan
  WHERE escuela_id = v_escuela_id;

  SELECT * INTO v_catalogo
  FROM public.catalogo_planes
  WHERE id = COALESCE(v_plan_escuela.plan_id, 'combo_basico');

  SELECT * INTO v_siguiente
  FROM public.catalogo_planes cp
  WHERE cp.producto = v_catalogo.producto
    AND cp.orden > v_catalogo.orden
  ORDER BY cp.orden ASC
  LIMIT 1;
  v_tiene_siguiente := FOUND;

  SELECT count(*)::integer INTO v_alumnos_activos
  FROM public.alumnos a
  WHERE a.escuela_id = v_escuela_id
    AND a.archivado IS NOT TRUE
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE u.rol IN ('Entrenador', 'Entrenarqueros'))::integer
  INTO v_usuarios_activos, v_entrenadores_activos
  FROM public.usuarios u
  WHERE u.escuela_id = v_escuela_id
    AND u.activo IS TRUE;

  SELECT count(*)::integer INTO v_sucursales_usadas
  FROM public.sucursales s
  WHERE s.escuela_id = v_escuela_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object('id', sub.id, 'nombre', sub.nombre, 'count', sub.total)
      ORDER BY sub.nombre
    ),
    '[]'::jsonb
  )
  INTO v_alumnos_por_sucursal
  FROM (
    SELECT s.id, s.nombre, count(a.id)::integer AS total
    FROM public.sucursales s
    JOIN public.alumnos a ON a.sucursal_id = s.id
    WHERE s.escuela_id = v_escuela_id
      AND a.escuela_id = v_escuela_id
      AND a.archivado IS NOT TRUE
      AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA'
    GROUP BY s.id, s.nombre
    HAVING count(a.id) > 0
  ) sub;

  SELECT count(*)::integer INTO v_sin_sucursal
  FROM public.alumnos a
  WHERE a.escuela_id = v_escuela_id
    AND a.sucursal_id IS NULL
    AND a.archivado IS NOT TRUE
    AND COALESCE(a.estado, '') <> 'ELIMINADO SISTEMA';

  IF v_sin_sucursal > 0 THEN
    v_alumnos_por_sucursal := v_alumnos_por_sucursal || jsonb_build_array(
      jsonb_build_object('id', 'sin-sucursal', 'nombre', 'Sin sucursal', 'count', v_sin_sucursal)
    );
  END IF;

  v_limite_alumnos := v_catalogo.max_alumnos + COALESCE(v_plan_escuela.alumnos_adicionales, 0);
  v_limite_alumnos_margen := floor(v_limite_alumnos * 1.15)::integer;
  v_limite_usuarios := v_catalogo.max_usuarios + COALESCE(v_plan_escuela.usuarios_adicionales, 0);
  v_limite_sucursales := v_catalogo.max_sucursales + COALESCE(v_plan_escuela.sucursales_adicionales, 0);

  v_en_margen_alumnos := (v_alumnos_activos > v_limite_alumnos AND v_alumnos_activos <= v_limite_alumnos_margen);
  v_excede_alumnos := (v_alumnos_activos > v_limite_alumnos_margen);
  v_excede_usuarios := (v_usuarios_activos > v_limite_usuarios);
  v_excede_sucursales := (v_sucursales_usadas > v_limite_sucursales);
  v_requiere_atencion := (v_excede_alumnos OR v_excede_usuarios OR v_excede_sucursales);

  v_usuarios_faltantes := GREATEST(0, v_usuarios_activos - v_limite_usuarios);
  v_costo_extras_nuevos := (v_usuarios_faltantes * 2.00)::numeric(10,2);
  v_costo_con_extras := (
    v_catalogo.precio_mensual_usd
    + ((COALESCE(v_plan_escuela.usuarios_adicionales, 0) + v_usuarios_faltantes) * 2.00)
  )::numeric(10,2);

  IF v_requiere_atencion THEN
    -- Si el único exceso son usuarios, verificar si conviene USD 2 por usuario antes de saltar de tramo
    IF v_excede_usuarios AND NOT v_excede_alumnos AND NOT v_excede_sucursales THEN
      IF NOT v_tiene_siguiente OR v_costo_con_extras < v_siguiente.precio_mensual_usd THEN
        v_rec_tipo := 'usuarios_adicionales';
        v_rec_mensaje := format(
          'Superaste tu cupo de usuarios por %s. Te conviene habilitar %s usuario(s) adicional(es) (+USD %s/mes, total base USD %s/mes)%s.',
          v_usuarios_faltantes,
          v_usuarios_faltantes,
          to_char(v_costo_extras_nuevos, 'FM999990.00'),
          to_char(v_costo_con_extras, 'FM999990.00'),
          CASE WHEN v_tiene_siguiente
            THEN format(' en lugar de subir al Plan %s (USD %s/mes)', v_siguiente.nombre_tramo, to_char(v_siguiente.precio_mensual_usd, 'FM999990.00'))
            ELSE ''
          END
        );
      ELSE
        v_rec_tipo := 'subir_plan';
        v_rec_mensaje := format(
          'Agregar %s usuario(s) adicional(es) elevaría tu base a USD %s/mes. Te conviene habilitar el Plan %s (USD %s/mes), que incluye hasta %s usuarios y %s alumnos.',
          v_usuarios_faltantes,
          to_char(v_costo_con_extras, 'FM999990.00'),
          v_siguiente.nombre_tramo,
          to_char(v_siguiente.precio_mensual_usd, 'FM999990.00'),
          v_siguiente.max_usuarios,
          v_siguiente.max_alumnos
        );
      END IF;
    ELSIF v_tiene_siguiente THEN
      v_rec_tipo := 'subir_plan';
      v_rec_mensaje := format(
        'Superaste los límites habilitados (incluyendo el 15%% de margen gratis en alumnos). Corresponde habilitar %s — Plan %s (USD %s/mes).',
        v_siguiente.nombre_producto,
        v_siguiente.nombre_tramo,
        to_char(v_siguiente.precio_mensual_usd, 'FM999990.00')
      );
    ELSE
      v_rec_tipo := 'plan_a_medida';
      v_rec_mensaje := 'Superaste el tope del Plan Completa (incluyendo el 15% de margen gratis en alumnos). Corresponde configurar un plan a medida o cupos adicionales.';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'plan', jsonb_build_object(
      'id', v_catalogo.id,
      'producto', v_catalogo.producto,
      'tramo', v_catalogo.tramo,
      'nombre_producto', v_catalogo.nombre_producto,
      'nombre_tramo', v_catalogo.nombre_tramo,
      'precio_mensual_usd', v_catalogo.precio_mensual_usd,
      'incluye_saasport_lite', v_catalogo.incluye_saasport_lite,
      'incluye_saasport_full', v_catalogo.incluye_saasport_full,
      'incluye_asisport', v_catalogo.incluye_asisport
    ),
    'addons', jsonb_build_object(
      'fotos_asistencia', COALESCE(v_plan_escuela.addon_fotos_asistencia, false),
      'perfil_medico', COALESCE(v_plan_escuela.addon_perfil_medico, false),
      'ficha_deportiva', COALESCE(v_plan_escuela.addon_ficha_deportiva, false),
      'cobranza_automatica', COALESCE(v_plan_escuela.addon_cobranza_automatica, false),
      'suscripcion_anual', COALESCE(v_plan_escuela.suscripcion_anual, false),
      'usuarios_adicionales', COALESCE(v_plan_escuela.usuarios_adicionales, 0),
      'alumnos_adicionales', COALESCE(v_plan_escuela.alumnos_adicionales, 0),
      'sucursales_adicionales', COALESCE(v_plan_escuela.sucursales_adicionales, 0)
    ),
    'cupos', jsonb_build_object(
      'alumnos', jsonb_build_object(
        'usados', v_alumnos_activos,
        'base', v_catalogo.max_alumnos,
        'adicionales', COALESCE(v_plan_escuela.alumnos_adicionales, 0),
        'limite', v_limite_alumnos,
        'margen_porcentaje', 15,
        'limite_con_margen', v_limite_alumnos_margen,
        'en_margen_gracia', v_en_margen_alumnos
      ),
      'usuarios', jsonb_build_object(
        'usados', v_usuarios_activos,
        'base', v_catalogo.max_usuarios,
        'adicionales', COALESCE(v_plan_escuela.usuarios_adicionales, 0),
        'limite', v_limite_usuarios
      ),
      'sucursales', jsonb_build_object(
        'usados', v_sucursales_usadas,
        'base', v_catalogo.max_sucursales,
        'adicionales', COALESCE(v_plan_escuela.sucursales_adicionales, 0),
        'limite', v_limite_sucursales
      )
    ),
    'alerta', jsonb_build_object(
      'requiere_atencion', v_requiere_atencion,
      'en_margen_gracia_alumnos', v_en_margen_alumnos,
      'excede_alumnos', v_excede_alumnos,
      'excede_usuarios', v_excede_usuarios,
      'excede_sucursales', v_excede_sucursales,
      'siguiente_plan', CASE WHEN v_tiene_siguiente THEN jsonb_build_object(
        'id', v_siguiente.id,
        'nombre_producto', v_siguiente.nombre_producto,
        'nombre_tramo', v_siguiente.nombre_tramo,
        'precio_mensual_usd', v_siguiente.precio_mensual_usd,
        'max_alumnos', v_siguiente.max_alumnos,
        'max_usuarios', v_siguiente.max_usuarios,
        'max_sucursales', v_siguiente.max_sucursales
      ) ELSE NULL END,
      'recomendacion', CASE WHEN v_rec_tipo IS NOT NULL THEN jsonb_build_object(
        'tipo', v_rec_tipo,
        'usuarios_faltantes', v_usuarios_faltantes,
        'costo_usuarios_extra_usd', v_costo_extras_nuevos,
        'mensaje', v_rec_mensaje
      ) ELSE NULL END
    ),
    'resumen_escuela', jsonb_build_object(
      'entrenadores_activos', v_entrenadores_activos,
      'alumnos_por_sucursal', v_alumnos_por_sucursal
    )
  );
END;
$$;
