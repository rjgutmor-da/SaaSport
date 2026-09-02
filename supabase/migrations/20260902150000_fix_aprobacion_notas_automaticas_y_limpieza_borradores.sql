-- Migración: Fix aprobación de notas automáticas y limpieza automática de borradores
-- Corrige el conflicto de unicidad 'cuentas_cobrar_mensualidad_periodo_activo_key'

-- 1. Limpiar el borrador huérfano y duplicado de Andre Galviz Moscoso
DELETE FROM public.cuentas_cobrar
WHERE id = '68f57e95-e925-410f-8ff7-099bae7c91ef'
  AND estado = 'borrador';

-- 2. Función trigger para limpiar borradores automáticos al crear o activar una mensualidad manual
CREATE OR REPLACE FUNCTION public.fn_limpiar_borradores_al_activar_mensualidad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Solo actuar si la nota pasa a ser una mensualidad activa válida (no borrador, no anulada, no anticipo)
  IF NEW.estado <> 'borrador'
     AND NEW.anulada IS NOT TRUE
     AND NEW.es_anticipo IS NOT TRUE
     AND NEW.alumno_id IS NOT NULL
     AND NEW.periodo_estadistico IS NOT NULL THEN

    -- Eliminar notas borrador previas para el mismo alumno y periodo estadístico
    -- (cxc_detalle se elimina automáticamente en cascada)
    DELETE FROM public.cuentas_cobrar
    WHERE escuela_id = NEW.escuela_id
      AND alumno_id = NEW.alumno_id
      AND estado = 'borrador'
      AND periodo_estadistico = NEW.periodo_estadistico
      AND id <> NEW.id;

  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_limpiar_borradores_al_activar_mensualidad ON public.cuentas_cobrar;

CREATE TRIGGER trg_limpiar_borradores_al_activar_mensualidad
AFTER INSERT OR UPDATE OF estado, periodo_estadistico, anulada
ON public.cuentas_cobrar
FOR EACH ROW
EXECUTE FUNCTION public.fn_limpiar_borradores_al_activar_mensualidad();

-- 3. RPC segura para aprobar notas automáticas en lote o individuales
CREATE OR REPLACE FUNCTION public.rpc_aprobar_notas_automaticas(p_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_escuela_id UUID := (SELECT public.current_user_escuela_id());
  v_user_rol TEXT := (SELECT public.current_user_rol());
  v_nota RECORD;
  v_aprobadas_count INTEGER := 0;
  v_descartadas_count INTEGER := 0;
  v_descartadas_info JSONB := '[]'::jsonb;
  v_existe_activa BOOLEAN;
BEGIN
  -- Validar autorización
  IF v_escuela_id IS NULL OR NOT COALESCE(
    v_user_rol IN ('Administrador', 'SuperAdministrador', 'Asistente'),
    FALSE
  ) THEN
    RAISE EXCEPTION 'No autorizado para aprobar notas automáticas.';
  END IF;

  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL OR array_length(p_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'aprobadas', 0,
      'descartadas', 0,
      'detalles_descartadas', '[]'::jsonb
    );
  END IF;

  -- Procesar cada nota solicitada
  FOR v_nota IN (
    SELECT cc.id, cc.alumno_id, cc.periodo_estadistico,
           COALESCE(a.nombres || ' ' || a.apellidos, 'Alumno no identificado') AS nombre_completo
    FROM public.cuentas_cobrar cc
    LEFT JOIN public.alumnos a ON a.id = cc.alumno_id
    WHERE cc.id = ANY(p_ids)
      AND cc.escuela_id = v_escuela_id
      AND cc.estado = 'borrador'
  ) LOOP
    -- Verificar si ya existe otra nota activa para este mismo alumno y periodo
    v_existe_activa := FALSE;
    IF v_nota.periodo_estadistico IS NOT NULL AND v_nota.alumno_id IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.cuentas_cobrar act
        WHERE act.escuela_id = v_escuela_id
          AND act.alumno_id = v_nota.alumno_id
          AND act.periodo_estadistico = v_nota.periodo_estadistico
          AND act.id <> v_nota.id
          AND act.estado <> 'borrador'
          AND act.anulada IS NOT TRUE
          AND act.es_anticipo IS NOT TRUE
      ) INTO v_existe_activa;
    END IF;

    IF v_existe_activa THEN
      -- Descartar / eliminar el borrador obsoleto
      DELETE FROM public.cuentas_cobrar WHERE id = v_nota.id;
      v_descartadas_count := v_descartadas_count + 1;
      v_descartadas_info := v_descartadas_info || jsonb_build_array(
        jsonb_build_object(
          'id', v_nota.id,
          'alumno', v_nota.nombre_completo,
          'periodo', v_nota.periodo_estadistico
        )
      );
    ELSE
      -- Aprobar pasando a estado 'pendiente'
      UPDATE public.cuentas_cobrar
      SET estado = 'pendiente'
      WHERE id = v_nota.id;
      v_aprobadas_count := v_aprobadas_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'aprobadas', v_aprobadas_count,
    'descartadas', v_descartadas_count,
    'detalles_descartadas', v_descartadas_info
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_aprobar_notas_automaticas(uuid[]) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.rpc_aprobar_notas_automaticas(uuid[]) TO authenticated, service_role;
