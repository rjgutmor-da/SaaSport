-- Historial acotado a una caja. Los detalles conservan RLS; el auxiliar privado
-- solo calcula importes de una caja cuyo saldo el usuario ya puede consultar.
CREATE OR REPLACE FUNCTION private.movimientos_caja_base(p_caja_id uuid, p_escuela_id uuid)
RETURNS TABLE(id uuid, origen text, fecha timestamptz, registro timestamptz,
              dia date, monto numeric, grupo text, nota_id uuid)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT c.id, 'cobro'::text, COALESCE(c.fecha,c.created_at),
         COALESCE(c.created_at,c.fecha,'epoch'::timestamptz),
         COALESCE((COALESCE(c.fecha,c.created_at) AT TIME ZONE 'UTC')::date,DATE '1970-01-01'),
         c.monto_aplicado,
         CASE WHEN btrim(COALESCE(c.documento_referencia,cc.nro_recibo,'')) <> ''
                   AND btrim(COALESCE(c.documento_referencia,cc.nro_recibo,'')) !~* '^(efectivo|transferencia|qr|transferencia bancaria|pago qr)$'
              THEN 'g:' || md5(jsonb_build_array(cc.alumno_id,
                   CASE WHEN cc.alumno_id IS NULL THEN cc.descripcion END,
                   CASE WHEN cc.alumno_id IS NULL THEN cc.sucursal_id END,
                   lower(btrim(COALESCE(c.documento_referencia,cc.nro_recibo,''))),c.fecha,c.created_at)::text)
              ELSE 'c:' || c.id::text END,
         c.cuenta_cobrar_id
  FROM public.cobros_aplicados c
  LEFT JOIN public.cuentas_cobrar cc ON cc.id=c.cuenta_cobrar_id AND cc.escuela_id=c.escuela_id
  WHERE c.caja_id=p_caja_id AND c.escuela_id=p_escuela_id
  UNION ALL
  SELECT p.id,'pago'::text,COALESCE(p.fecha,p.created_at),
         COALESCE(p.created_at,p.fecha,'epoch'::timestamptz),
         COALESCE((COALESCE(p.fecha,p.created_at) AT TIME ZONE 'UTC')::date,DATE '1970-01-01'),
         -p.monto_aplicado,'p:' || p.id::text,p.cuenta_pagar_id
  FROM public.pagos_aplicados p
  WHERE p.caja_id=p_caja_id AND p.escuela_id=p_escuela_id;
$$;
REVOKE ALL ON FUNCTION private.movimientos_caja_base(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.movimientos_caja_base(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.saldos_movimientos_caja(p_caja_id uuid,p_cortes jsonb)
RETURNS TABLE(grupo text,saldo numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_escuela uuid; v_saldo numeric;
BEGIN
  SELECT u.escuela_id INTO v_escuela FROM public.usuarios u
  WHERE u.id=(SELECT auth.uid()) AND u.activo IS TRUE
    AND u.rol IN ('SuperAdministrador','Administrador','Asistente');
  SELECT cb.saldo_actual INTO v_saldo FROM public.cajas_bancos cb
  WHERE cb.id=p_caja_id AND cb.escuela_id=v_escuela;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta fuera de su escuela o usuario no autorizado' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(p_cortes) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cortes)>50 THEN
    RAISE EXCEPTION 'Se permiten hasta 50 cortes';
  END IF;
  RETURN QUERY
  WITH grupos AS MATERIALIZED (
    SELECT b.grupo,b.origen,b.dia,b.registro,max(b.id::text) id,sum(b.monto) monto
    FROM private.movimientos_caja_base(p_caja_id,v_escuela) b
    GROUP BY b.grupo,b.origen,b.dia,b.registro
  ), acumulados AS (
    SELECT g.grupo,COALESCE(v_saldo,0)-COALESCE(sum(g.monto) OVER (
      ORDER BY g.dia DESC,g.registro DESC,g.id DESC,g.origen DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) saldo
    FROM grupos g
  ), cortes AS (
    SELECT * FROM jsonb_to_recordset(p_cortes) AS x(grupo text,dia date,registro timestamptz,id text,origen text)
  )
  SELECT c.grupo,a.saldo FROM cortes c JOIN acumulados a ON a.grupo=c.grupo;
END;
$$;
REVOKE ALL ON FUNCTION private.saldos_movimientos_caja(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.saldos_movimientos_caja(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_listar_movimientos_caja(
  p_caja_id uuid,p_desde timestamptz DEFAULT NULL,p_hasta timestamptz DEFAULT NULL,
  p_busqueda text DEFAULT NULL,p_cursor jsonb DEFAULT NULL,p_limite integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_escuela uuid; v_result jsonb; v_grupos jsonb; v_cortes jsonb;
  v_limite integer:=LEAST(GREATEST(COALESCE(p_limite,50),1),50);
  v_filtro text:=md5(jsonb_build_array(p_caja_id,p_desde,p_hasta,btrim(COALESCE(p_busqueda,'')))::text);
BEGIN
  SELECT u.escuela_id INTO v_escuela FROM public.usuarios u
  WHERE u.id=(SELECT auth.uid()) AND u.activo IS TRUE
    AND u.rol IN ('SuperAdministrador','Administrador','Asistente');
  IF v_escuela IS NULL OR NOT EXISTS(SELECT 1 FROM public.cajas_bancos cb WHERE cb.id=p_caja_id AND cb.escuela_id=v_escuela) THEN
    RAISE EXCEPTION 'Cuenta fuera de su escuela o usuario no autorizado' USING ERRCODE='42501';
  END IF;
  IF (p_desde IS NULL) <> (p_hasta IS NULL) OR p_desde>=p_hasta THEN RAISE EXCEPTION 'Rango de fechas invalido'; END IF;
  IF length(COALESCE(p_busqueda,''))>200 THEN RAISE EXCEPTION 'Busqueda demasiado larga'; END IF;
  IF p_cursor IS NOT NULL AND (p_cursor->>'filtro') IS DISTINCT FROM v_filtro THEN RAISE EXCEPTION 'Cursor incompatible con los filtros'; END IF;
  WITH base AS MATERIALIZED (
    SELECT * FROM private.movimientos_caja_base(p_caja_id,v_escuela) b
    WHERE (p_desde IS NULL OR b.fecha>=p_desde) AND (p_hasta IS NULL OR b.fecha<p_hasta)
  ), grupos AS (
    SELECT b.grupo,b.origen,b.dia,b.registro,max(b.id::text) id,
           array_agg(b.id ORDER BY b.id DESC) ids
    FROM base b GROUP BY b.grupo,b.origen,b.dia,b.registro
  ), textos AS MATERIALIZED (
    SELECT b.grupo,lower(translate(string_agg(concat_ws(' ',
      ca.documento_referencia,cc.nro_recibo,pa.referencia,a.nombres,a.apellidos,
      CASE WHEN cc.alumno_id IS NULL THEN cc.descripcion END,pr.nombre,pe.nombres,pe.apellidos,
      CASE WHEN cp.proveedor_id IS NULL AND cp.personal_id IS NULL THEN cp.descripcion END,
      CASE WHEN b.origen='cobro' THEN (SELECT string_agg(ci.nombre,' ') FROM public.cxc_detalle d JOIN public.catalogo_items ci ON ci.id=d.catalogo_item_id WHERE d.cuenta_cobrar_id=cc.id AND d.escuela_id=v_escuela)
      ELSE (SELECT string_agg(ci.nombre,' ') FROM public.cxp_detalle d JOIN public.catalogo_items ci ON ci.id=d.catalogo_item_id WHERE d.cuenta_pagar_id=cp.id AND d.escuela_id=v_escuela) END
    ),' '),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')) texto
        FROM base b
        LEFT JOIN public.cobros_aplicados ca ON b.origen='cobro' AND ca.id=b.id
        LEFT JOIN public.cuentas_cobrar cc ON cc.id=ca.cuenta_cobrar_id AND cc.escuela_id=v_escuela
        LEFT JOIN public.alumnos a ON a.id=cc.alumno_id AND a.escuela_id=v_escuela
        LEFT JOIN public.pagos_aplicados pa ON b.origen='pago' AND pa.id=b.id
        LEFT JOIN public.cuentas_pagar cp ON cp.id=pa.cuenta_pagar_id AND cp.escuela_id=v_escuela
        LEFT JOIN public.proveedores pr ON pr.id=cp.proveedor_id
        LEFT JOIN public.personal pe ON pe.id=cp.personal_id
    WHERE btrim(COALESCE(p_busqueda,''))<>''
    GROUP BY b.grupo
  ), candidatos AS (
    SELECT g.* FROM grupos g
    LEFT JOIN textos tx ON tx.grupo=g.grupo
    WHERE (p_cursor IS NULL OR (g.dia,g.registro,g.id,g.origen)<
      ((p_cursor->>'dia')::date,(p_cursor->>'registro')::timestamptz,p_cursor->>'id',p_cursor->>'origen'))
    AND (btrim(COALESCE(p_busqueda,''))='' OR NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(translate(btrim(p_busqueda),'áéíóúüñÁÉÍÓÚÜÑ','aeiouunAEIOUUN')),'\s+') t(token)
      WHERE strpos(COALESCE(tx.texto,''),t.token)=0
    ))
    ORDER BY g.dia DESC,g.registro DESC,g.id DESC,g.origen DESC LIMIT v_limite+1
  ) SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.dia DESC,c.registro DESC,c.id DESC,c.origen DESC),'[]'::jsonb)
    INTO v_grupos FROM candidatos c;
  SELECT COALESCE(jsonb_agg(x.value ORDER BY x.ordinality),'[]'::jsonb) INTO v_cortes
    FROM jsonb_array_elements(v_grupos) WITH ORDINALITY x WHERE x.ordinality<=v_limite;
  SELECT COALESCE(jsonb_agg(x.value || jsonb_build_object('saldo_historico',s.saldo::text) ORDER BY x.ordinality),'[]'::jsonb)
    INTO v_result FROM jsonb_array_elements(v_cortes) WITH ORDINALITY x
    JOIN private.saldos_movimientos_caja(p_caja_id,v_cortes) s ON s.grupo=x.value->>'grupo';
  RETURN jsonb_build_object('grupos',v_result,'hay_mas',jsonb_array_length(v_grupos)>v_limite,
    'cursor_siguiente',CASE WHEN jsonb_array_length(v_grupos)>v_limite THEN
      (v_cortes->(jsonb_array_length(v_cortes)-1)) - 'ids' || jsonb_build_object('filtro',v_filtro) ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_listar_movimientos_caja(uuid,timestamptz,timestamptz,text,jsonb,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_listar_movimientos_caja(uuid,timestamptz,timestamptz,text,jsonb,integer) TO authenticated;
