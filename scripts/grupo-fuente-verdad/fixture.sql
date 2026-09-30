-- Esquema reducido para ejecutar las funciones reales en PostgreSQL/PGlite.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE escuelas(id uuid PRIMARY KEY,nombre text,activa boolean DEFAULT true,zona_horaria text DEFAULT 'America/La_Paz');
CREATE TABLE sucursales(id uuid PRIMARY KEY,escuela_id uuid REFERENCES escuelas,nombre text);
CREATE TABLE usuarios(id uuid PRIMARY KEY,escuela_id uuid REFERENCES escuelas,nombres text,apellidos text,
 rol text,activo boolean DEFAULT true,sucursal_id uuid REFERENCES sucursales);
CREATE TABLE grupos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 nombre varchar,sucursal_id uuid REFERENCES sucursales,activo boolean DEFAULT true,updated_at timestamptz DEFAULT now());
CREATE TABLE horarios(id uuid PRIMARY KEY,escuela_id uuid REFERENCES escuelas,hora varchar,activo boolean DEFAULT true);
CREATE TABLE grupos_horarios(grupo_id uuid REFERENCES grupos,horario_id uuid REFERENCES horarios,PRIMARY KEY(grupo_id,horario_id));
CREATE TABLE gestiones_deportivas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 anio smallint,estado varchar,activada_por uuid REFERENCES usuarios,activada_en timestamptz,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX gestion_activa_unica ON gestiones_deportivas(escuela_id) WHERE estado='activa';
CREATE TABLE grupos_gestion(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 gestion_id uuid REFERENCES gestiones_deportivas,grupo_id uuid REFERENCES grupos,horario_id uuid REFERENCES horarios,
 sucursal_id uuid REFERENCES sucursales,nombre_snapshot varchar,hora_snapshot varchar,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(gestion_id,grupo_id,horario_id));
CREATE TABLE alumnos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 nombres text,apellidos text,grupo_id uuid REFERENCES grupos,cancha_id uuid REFERENCES grupos,
 grupo_gestion_id uuid REFERENCES grupos_gestion,profesor_asignado_id uuid REFERENCES usuarios,
 horario_id uuid REFERENCES horarios,sucursal_id uuid REFERENCES sucursales,
 archivado boolean DEFAULT false,archivado_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE entrenadores_grupos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 gestion_id uuid REFERENCES gestiones_deportivas,grupo_gestion_id uuid REFERENCES grupos_gestion,
 entrenador_id uuid NOT NULL REFERENCES usuarios,estado varchar CHECK(estado IN ('activa','planificada','cerrada')),
 vigente_desde timestamptz,vigente_hasta timestamptz,motivo varchar,creado_por uuid REFERENCES usuarios,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX ux_titular ON entrenadores_grupos(grupo_gestion_id) WHERE estado IN ('activa','planificada');
CREATE TABLE alumnos_grupos(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),escuela_id uuid REFERENCES escuelas,
 alumno_id uuid REFERENCES alumnos,gestion_id uuid REFERENCES gestiones_deportivas,
 grupo_gestion_id uuid REFERENCES grupos_gestion,estado varchar CHECK(estado IN ('activa','planificada','cerrada')),
 decision varchar,vigente_desde timestamptz,vigente_hasta timestamptz,motivo varchar,creado_por uuid REFERENCES usuarios,
 created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX ux_membresia ON alumnos_grupos(alumno_id,gestion_id) WHERE estado IN ('activa','planificada');
CREATE UNIQUE INDEX ux_membresia_activa ON alumnos_grupos(alumno_id) WHERE estado='activa';
CREATE TABLE alumnos_entrenadores(alumno_id uuid REFERENCES alumnos,entrenador_id uuid NOT NULL REFERENCES usuarios,
 PRIMARY KEY(alumno_id,entrenador_id));
CREATE TABLE audit_log(escuela_id uuid,usuario_id uuid,usuario_nombre text,accion text,modulo text,entidad_id text,detalle jsonb);
CREATE TABLE asistencias_normales(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),alumno_id uuid REFERENCES alumnos,
 grupo_gestion_id uuid REFERENCES grupos_gestion,entrenador_id uuid REFERENCES usuarios,fecha date,estado text);
CREATE FUNCTION fn_seed_gestion_escuela(p_escuela_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
 SELECT id INTO v_id FROM gestiones_deportivas WHERE escuela_id=p_escuela_id AND estado='activa';
 IF v_id IS NULL THEN
   INSERT INTO gestiones_deportivas(escuela_id,anio,estado) VALUES(p_escuela_id,2026,'activa') RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END; $$;
-- RLS mínima reproducible; la validación en producción debe comprobar las políticas reales.
ALTER TABLE alumnos ENABLE ROW LEVEL SECURITY;
CREATE POLICY misma_escuela ON alumnos TO authenticated USING (
 escuela_id=(SELECT u.escuela_id FROM usuarios u WHERE u.id=auth.uid())
) WITH CHECK (escuela_id=(SELECT u.escuela_id FROM usuarios u WHERE u.id=auth.uid()));
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
