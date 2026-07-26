import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.100.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RelationCheck = { table: string; column: string; label: string };

// Any relation is treated as history. This prevents deleting a user while
// silently removing or detaching operational and financial records.
const relationChecks: RelationCheck[] = [
  { table: 'alumnos', column: 'created_by', label: 'alumnos creados' },
  { table: 'alumnos', column: 'profesor_asignado_id', label: 'alumnos asignados' },
  { table: 'alumnos_entrenadores', column: 'entrenador_id', label: 'asignaciones de alumnos' },
  { table: 'asistencias_arqueros', column: 'entrenador_id', label: 'asistencias de arqueros' },
  { table: 'asistencias_normales', column: 'entrenador_id', label: 'asistencias' },
  { table: 'audit_log', column: 'usuario_id', label: 'registros de auditoría' },
  { table: 'cobros_aplicados', column: 'usuario_id', label: 'cobros' },
  { table: 'cobros_aplicados', column: 'editado_por', label: 'ediciones de cobros' },
  { table: 'configuracion_facturacion', column: 'updated_by', label: 'configuración de facturación' },
  { table: 'convocatorias', column: 'created_by', label: 'convocatorias' },
  { table: 'cuentas_pagar', column: 'anulada_por', label: 'anulaciones de cuentas por pagar' },
  { table: 'cuentas_pagar', column: 'editado_por', label: 'ediciones de cuentas por pagar' },
  { table: 'evaluaciones_medicas', column: 'medico_id', label: 'evaluaciones médicas' },
  { table: 'fichas_medicas', column: 'created_by', label: 'fichas médicas creadas' },
  { table: 'fichas_medicas', column: 'updated_by', label: 'ediciones de fichas médicas' },
  { table: 'fotos_asistencia_grupal', column: 'entrenador_id', label: 'fotos de asistencia' },
  { table: 'pagos_aplicados', column: 'usuario_id', label: 'pagos' },
  { table: 'pagos_aplicados', column: 'editado_por', label: 'ediciones de pagos' },
  { table: 'personal', column: 'usuario_id', label: 'registros de personal' },
];

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

const getBearerToken = (request: Request) => {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

  const token = getBearerToken(request);
  if (!token) return json({ error: 'Sesión requerida.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Configuración segura incompleta.' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return json({ error: 'La sesión no es válida.' }, 401);

  let payload: { userId?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Solicitud inválida.' }, 400);
  }

  const targetId = payload.userId;
  if (!targetId || typeof targetId !== 'string') return json({ error: 'El usuario a eliminar es requerido.' }, 400);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(targetId)) {
    return json({ error: 'El identificador del usuario no es válido.' }, 400);
  }
  if (targetId === authData.user.id) return json({ error: 'No puedes eliminar tu propio usuario.' }, 403);

  const [{ data: actor, error: actorError }, { data: target, error: targetError }] = await Promise.all([
    admin.from('usuarios').select('id, escuela_id, rol, activo').eq('id', authData.user.id).maybeSingle(),
    admin.from('usuarios').select('id, escuela_id, rol, activo, email, nombres, apellidos').eq('id', targetId).maybeSingle(),
  ]);

  if (actorError || !actor) return json({ error: 'No se pudo validar el perfil del administrador.' }, 403);
  if (actor.rol !== 'SuperAdministrador' || !actor.activo) return json({ error: 'Solo un SuperAdministrador activo puede eliminar usuarios.' }, 403);
  if (targetError || !target) return json({ error: 'El usuario no existe.' }, 404);
  if (target.escuela_id !== actor.escuela_id) return json({ error: 'No puedes eliminar usuarios de otra escuela.' }, 403);

  if (target.rol === 'SuperAdministrador' && target.activo) {
    const { count } = await admin
      .from('usuarios')
      .select('id', { count: 'exact', head: true })
      .eq('escuela_id', actor.escuela_id)
      .eq('rol', 'SuperAdministrador')
      .eq('activo', true);
    if ((count || 0) <= 1) return json({ error: 'No puedes eliminar el último SuperAdministrador de la escuela.' }, 409);
  }

  const blockingRelations: string[] = [];
  for (const relation of relationChecks) {
    const { count, error } = await admin
      .from(relation.table)
      .select('id', { count: 'exact', head: true })
      .eq(relation.column, targetId);
    if (error) return json({ error: 'No se pudo verificar el historial del usuario.' }, 500);
    if ((count || 0) > 0) blockingRelations.push(relation.label);
  }

  const { count: ownedFiles, error: storageError } = await admin
    .schema('storage')
    .from('objects')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', targetId);
  if (storageError) return json({ error: 'No se pudo verificar los archivos del usuario.' }, 500);
  if ((ownedFiles || 0) > 0) blockingRelations.push('archivos almacenados');

  if (blockingRelations.length > 0) {
    return json({
      error: 'No se puede eliminar porque tiene historial o asignaciones. Desactiva el usuario o reasigna primero.',
      blockingRelations,
    }, 409);
  }

  const { error: deleteError } = await admin.auth.admin.deleteUser(targetId);
  if (deleteError) return json({ error: 'No se pudo eliminar la cuenta de acceso. Intenta nuevamente.' }, 500);

  return json({ success: true });
});
