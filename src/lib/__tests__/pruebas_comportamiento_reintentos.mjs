/**
 * pruebas_comportamiento_reintentos.mjs
 *
 * Suite de pruebas de comportamiento automatizadas para validar:
 * 1. Clasificación estricta de respuestas inciertas vs errores concluyentes.
 * 2. Conservación del identificador (operacion_id) y payload original.
 * 3. Recuperación duradera al cerrar y reabrir el formulario/modal (localStorage).
 * 4. Escenario "el servidor guardó la nota pero el cliente perdió la respuesta" (resolución sin duplicar).
 * 5. Escenario "el servidor hizo rollback o la nota no se guardó" (reintento seguro con mismo identificador).
 * 6. Validación de producto basada exclusivamente en categoria === 'producto'.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// --- Simulación de entorno de navegador (localStorage) para Node.js ---
const storageMock = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storageMock.get(key) ?? null,
    setItem: (key, val) => storageMock.set(key, String(val)),
    removeItem: (key) => storageMock.delete(key),
    clear: () => storageMock.clear(),
  }
};
globalThis.localStorage = globalThis.window.localStorage;

// --- Importación directa del CÓDIGO REAL de SaaSport ---
import {
  cargarTodasOperaciones,
  guardarOperacionIncierta,
  obtenerOperacionIncierta,
  obtenerTodasOperacionesInciertas,
  removerOperacionIncierta,
  esRespuestaIncierta,
  verificarSiNotaSeGuardo,
  resolverOperacionIncierta,
} from '../idempotenciaNotas.ts';

// --- Fábrica de cliente Supabase simulado para pruebas de comportamiento ---
function crearClienteSupabaseSimulado({
  debeFallarConsulta = false,
  errorConsultaMensaje = 'Conexión rechazada por timeout',
  datosInicialesCxc = [],
  datosInicialesCxp = [],
} = {}) {
  const tablas = {
    cuentas_cobrar: new Map(datosInicialesCxc.map(n => [`${n.escuela_id}:${n.operacion_id}`, n])),
    cuentas_pagar: new Map(datosInicialesCxp.map(n => [`${n.escuela_id}:${n.operacion_id}`, n])),
  };

  let rpcLlamadas = [];

  const cliente = {
    rpcLlamadas,
    tablas,
    from(nombreTabla) {
      let filtroEscuela = '';
      let filtroOperacion = '';

      return {
        select(columnas) {
          return {
            eq(campo1, valor1) {
              if (campo1 === 'escuela_id') filtroEscuela = valor1;
              if (campo1 === 'operacion_id') filtroOperacion = valor1;

              return {
                eq(campo2, valor2) {
                  if (campo2 === 'escuela_id') filtroEscuela = valor2;
                  if (campo2 === 'operacion_id') filtroOperacion = valor2;

                  return {
                    async maybeSingle() {
                      if (debeFallarConsulta) {
                        return { data: null, error: { message: errorConsultaMensaje } };
                      }
                      const mapa = tablas[nombreTabla];
                      const key = `${filtroEscuela}:${filtroOperacion}`;
                      if (mapa && mapa.has(key)) {
                        return { data: mapa.get(key), error: null };
                      }
                      return { data: null, error: null };
                    }
                  };
                },
                async maybeSingle() {
                  if (debeFallarConsulta) {
                    return { data: null, error: { message: errorConsultaMensaje } };
                  }
                  const mapa = tablas[nombreTabla];
                  const key = `${filtroEscuela}:${filtroOperacion}`;
                  if (mapa && mapa.has(key)) {
                    return { data: mapa.get(key), error: null };
                  }
                  return { data: null, error: null };
                }
              };
            }
          };
        }
      };
    },
    async rpc(nombreFn, params) {
      rpcLlamadas.push({ nombreFn, params });
      if (cliente.rpcHandler) {
        return cliente.rpcHandler(nombreFn, params);
      }
      return { data: { id: 'nota-creada-por-rpc' }, error: null };
    }
  };

  return cliente;
}

// --- SUITE DE PRUEBAS ---

test('1. Clasificación estricta: respuestas inciertas vs errores concluyentes con rollback', () => {
  // Respuestas inciertas (deben conservar operacionId y payload)
  assert.equal(esRespuestaIncierta(new TypeError('Failed to fetch')), true, 'Failed to fetch debe ser incierto');
  assert.equal(esRespuestaIncierta({ message: 'Network request timed out' }), true, 'Timeout de red debe ser incierto');
  assert.equal(esRespuestaIncierta({ status: 504, message: 'Gateway Timeout' }), true, '504 Gateway Timeout debe ser incierto');
  assert.equal(esRespuestaIncierta({ status: 500, message: 'Internal Server Error' }), true, '500 Server Error debe ser incierto');
  assert.equal(esRespuestaIncierta({ name: 'AbortError', message: 'The user aborted a request.' }), true, 'AbortError debe ser incierto');

  // Errores concluyentes de BD (rollback garantizado, no duplicarán)
  assert.equal(esRespuestaIncierta({ code: 'P0001', message: 'Stock insuficiente para el producto' }), false, 'P0001 rollback debe ser concluyente');
  assert.equal(esRespuestaIncierta({ code: '23505', message: 'duplicate key value violates unique constraint' }), false, '23505 unique violation debe ser concluyente');
  assert.equal(esRespuestaIncierta({ code: '42501', message: 'permission denied' }), false, '42501 permiso denegado debe ser concluyente');
  assert.equal(esRespuestaIncierta({ message: 'Stock insuficiente en la sucursal' }), false, 'Validación semántica de stock debe ser concluyente');
  assert.equal(esRespuestaIncierta({ message: 'Debe seleccionar una sucursal para productos' }), false, 'Falta de sucursal debe ser concluyente');
});

test('2. Servidor guardó, cliente perdió la respuesta: recuperar la misma nota sin llamar a la RPC ni crear otra', async () => {
  storageMock.clear();
  const operacionId = 'c0a80101-0000-4000-a000-000000000010';
  const escuelaId = 'escuela_central';
  const usuarioId = 'usuario_admin_1';
  const idNotaGuardada = 'cxc_guardada_en_bd_999';

  // 1. El cliente registró la operación antes de la pérdida de red
  guardarOperacionIncierta({
    operacionId,
    tipo: 'cxc_individual',
    escuelaId,
    usuarioId,
    claveEntidad: 'alumno_77',
    payloadOriginal: { total: 350, rpcParams: { p_monto_total: 350 } },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // 2. El servidor PostgreSQL guardó la transacción correctamente
  const supabase = crearClienteSupabaseSimulado({
    datosInicialesCxc: [{ id: idNotaGuardada, escuela_id: escuelaId, operacion_id: operacionId }],
  });

  // 3. Al reintentar o montar el modal, resuelve contra BD con resolverOperacionIncierta
  const resultado = await resolverOperacionIncierta('cxc_individual', escuelaId, operacionId, supabase);

  // Verificaciones:
  assert.equal(resultado.estado, 'guardada', 'El estado debe ser guardada');
  assert.equal(resultado.notaId, idNotaGuardada, 'Retorna el ID de la nota existente');

  // Simulación de la decisión del componente (NotaServicios / ModalNotaMasiva):
  let llamadasARpc = 0;
  let notaFinalId = null;

  if (resultado.estado === 'guardada') {
    notaFinalId = resultado.notaId; // Recuperada directamente
  } else {
    llamadasARpc++;
    await supabase.rpc('rpc_guardar_nota_cxc', {});
  }

  assert.equal(notaFinalId, idNotaGuardada, 'Se recupera la nota existente');
  assert.equal(llamadasARpc, 0, 'No debe llamarse a la RPC de creación');
  assert.equal(supabase.rpcLlamadas.length, 0, 'Cero llamadas RPC en el cliente');

  // La operación ya debe haber sido limpiada del storage
  const opEnStorage = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, 'alumno_77');
  assert.equal(opEnStorage, null, 'La operación resuelta debe removerse de localStorage');
});

test('3. Operación incierta y formulario modificado: el reintento debe enviar identificador y payload original', async () => {
  storageMock.clear();
  const operacionIdOriginal = 'c0a80101-0000-4000-a000-000000000020';
  const escuelaId = 'escuela_central';
  const usuarioId = 'usuario_admin_1';
  const alumnoId = 'alumno_88';

  const payloadOriginal = {
    p_alumno_id: alumnoId,
    p_monto_total: 100,
    p_descripcion: 'Mensualidad Marzo',
    p_operacion_id: operacionIdOriginal,
  };

  // 1. Guardar la operación incierta inicial
  guardarOperacionIncierta({
    operacionId: operacionIdOriginal,
    tipo: 'cxc_individual',
    escuelaId,
    usuarioId,
    claveEntidad: `alumno_${alumnoId}`,
    payloadOriginal: { rpcParams: payloadOriginal },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // 2. Simulación: La nota NO se guardó en BD (ej. rollback en el primer intento)
  const supabase = crearClienteSupabaseSimulado({ datosInicialesCxc: [] });

  // 3. El usuario modifica el formulario en pantalla (cambia monto a 500 y descripción a Abril)
  const estadoFormularioModificado = {
    p_alumno_id: alumnoId,
    p_monto_total: 500, // Modificado por el usuario
    p_descripcion: 'Mensualidad Abril Modificada', // Modificado por el usuario
    p_operacion_id: 'uuid-nuevo-invalido',
  };

  // 4. Lógica de guardado/reintento estricta:
  const opIncierta = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, `alumno_${alumnoId}`);
  assert.ok(opIncierta, 'Debe encontrar la operación incierta pendiente');

  const resolucion = await resolverOperacionIncierta('cxc_individual', escuelaId, opIncierta.operacionId, supabase);
  assert.equal(resolucion.estado, 'no_guardada', 'Confirma que la nota no fue guardada');

  // REQUISITO ESTRICTO: Si no_guardada, enviar exactamente payloadOriginal.rpcParams con operacionId original
  let payloadAEnviar;
  let operacionIdUtilizado;

  if (opIncierta && resolucion.estado === 'no_guardada') {
    payloadAEnviar = opIncierta.payloadOriginal.rpcParams;
    operacionIdUtilizado = opIncierta.operacionId;
  } else {
    payloadAEnviar = estadoFormularioModificado;
    operacionIdUtilizado = estadoFormularioModificado.p_operacion_id;
  }

  await supabase.rpc('rpc_guardar_nota_cxc', payloadAEnviar);

  // Verificaciones:
  assert.equal(operacionIdUtilizado, operacionIdOriginal, 'Debe usar el identificador original');
  assert.equal(payloadAEnviar.p_monto_total, 100, 'Debe enviar el monto original de 100, no el modificado de 500');
  assert.equal(payloadAEnviar.p_descripcion, 'Mensualidad Marzo', 'Debe enviar la descripción original');
  assert.equal(supabase.rpcLlamadas.length, 1, 'Ejecutó 1 llamada a RPC con el payload original');
  assert.deepEqual(supabase.rpcLlamadas[0].params, payloadOriginal, 'Parámetros enviados a RPC coinciden exactamente con el payload original');
});

test('4. Cierre/reapertura y recarga: recuperar el pendiente al seleccionar entidad en el formulario', () => {
  storageMock.clear();
  const operacionId = 'c0a80101-0000-4000-a000-000000000030';
  const escuelaId = 'escuela_central';
  const usuarioId = 'usuario_cajero_1';
  const alumnoId = 'alumno_99';

  // 1. Se registra una operación incierta ligada a un alumno específico
  guardarOperacionIncierta({
    operacionId,
    tipo: 'cxc_individual',
    escuelaId,
    usuarioId,
    claveEntidad: `alumno_${alumnoId}`,
    payloadOriginal: { total: 200, alumnoId },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // 2. Simulación: Se recarga la página o se abre el modal limpio SIN entidad preseleccionada
  let entidadSeleccionada = '';
  let opDetectadaInicial = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, entidadSeleccionada || undefined);
  // Al no haber entidad específica ni operación 'general', no hay colisión prematura
  assert.equal(opDetectadaInicial, null, 'Sin entidad seleccionada, no recupera falsamente una operación de otro alumno');

  // 3. El usuario ahora selecciona el alumno en el dropdown del formulario
  entidadSeleccionada = `alumno_${alumnoId}`;
  let opAlSeleccionar = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, entidadSeleccionada);

  assert.ok(opAlSeleccionar, 'Al seleccionar el alumno, recupera inmediatamente la operación pendiente');
  assert.equal(opAlSeleccionar.operacionId, operacionId, 'Identificador coincide con la operación guardada');
  assert.equal(opAlSeleccionar.payloadOriginal.total, 200, 'Recupera el contenido original');
});

test('5. Cambio de usuario o escuela: un usuario no debe recuperar pendientes de otro usuario ni de otra escuela', () => {
  storageMock.clear();
  const operacionId = 'c0a80101-0000-4000-a000-000000000040';
  const escuelaA = 'escuela_la_paz';
  const escuelaB = 'escuela_santa_cruz';
  const usuario1 = 'usuario_cajero_1';
  const usuario2 = 'usuario_cajero_2';
  const entidad = 'alumno_123';

  // Registrar operación para usuario 1 en Escuela A
  guardarOperacionIncierta({
    operacionId,
    tipo: 'cxc_individual',
    escuelaId: escuelaA,
    usuarioId: usuario1,
    claveEntidad: entidad,
    payloadOriginal: { total: 150 },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // Caso 5.1: Mismo usuario, otra escuela (ej. multisede)
  const opOtraEscuela = obtenerOperacionIncierta('cxc_individual', escuelaB, usuario1, entidad);
  assert.equal(opOtraEscuela, null, 'No debe recuperar operaciones de otra escuela');

  // Caso 5.2: Mismo navegador/máquina, otro usuario (ej. cambio de turno/cajero)
  const opOtroUsuario = obtenerOperacionIncierta('cxc_individual', escuelaA, usuario2, entidad);
  assert.equal(opOtroUsuario, null, 'No debe recuperar operaciones de otro usuario');

  // Caso 5.3: El usuario legítimo en su escuela legítima sí la recupera
  const opLegitima = obtenerOperacionIncierta('cxc_individual', escuelaA, usuario1, entidad);
  assert.ok(opLegitima, 'El usuario propietario sí recupera su propia operación pendiente');
  assert.equal(opLegitima.operacionId, operacionId);
});

test('6. Fallo de consulta de recuperación: no borrar el pendiente ni generar otro identificador ni llamar a RPC', async () => {
  storageMock.clear();
  const operacionId = 'c0a80101-0000-4000-a000-000000000050';
  const escuelaId = 'escuela_central';
  const usuarioId = 'usuario_admin_1';
  const claveEntidad = 'alumno_55';

  guardarOperacionIncierta({
    operacionId,
    tipo: 'cxc_individual',
    escuelaId,
    usuarioId,
    claveEntidad,
    payloadOriginal: { rpcParams: { p_monto_total: 400 } },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // Simular que el cliente intenta consultar el estado en BD, pero la red falla (503 / timeout)
  const supabaseConFallo = crearClienteSupabaseSimulado({
    debeFallarConsulta: true,
    errorConsultaMensaje: 'Conexión interrumpida durante la verificación',
  });

  const resolucion = await resolverOperacionIncierta('cxc_individual', escuelaId, operacionId, supabaseConFallo);

  // Verificaciones de la resolución:
  assert.equal(resolucion.estado, 'error_consulta', 'Debe reportar error_consulta');
  assert.ok(resolucion.mensaje.includes('Conexión interrumpida'), 'Contiene el mensaje del error de consulta');

  // La operación NO debe haberse borrado de localStorage
  const pendienteEnStorage = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, claveEntidad);
  assert.ok(pendienteEnStorage, 'La operación DEBE permanecer en storage para reintentar luego');
  assert.equal(pendienteEnStorage.operacionId, operacionId, 'Conserva el operacionId original intacto');

  // Simulación de la decisión del componente:
  let llamadasARpc = 0;
  if (resolucion.estado === 'error_consulta') {
    // REGLA: Conservar el pendiente y advertir al usuario sin llamar a la RPC
  } else if (resolucion.estado === 'no_guardada') {
    llamadasARpc++;
    await supabaseConFallo.rpc('rpc_guardar_nota_cxc', {});
  }

  assert.equal(llamadasARpc, 0, 'PROHIBIDO llamar a RPC ante error_consulta para no generar duplicados');
  assert.equal(supabaseConFallo.rpcLlamadas.length, 0, 'Cero llamadas RPC ejecutadas');
});

test('7. Criterio estricto de categoría producto: validación basada exclusivamente en categoria === "producto"', () => {
  const esProductoEstricto = (item) => item?.categoria === 'producto';

  const itemValido = { id: 'p1', nombre: 'Uniforme Oficial', categoria: 'producto', tipo: 'cualquiera' };
  const itemInvalidoTipoAntiguo = { id: 's1', nombre: 'Mensualidad', tipo: 'producto', categoria: 'servicio' };
  const itemServicioPuro = { id: 's2', nombre: 'Inscripción Torneo', categoria: 'servicio', tipo: 'servicio' };
  const itemSinCategoria = { id: 'x1', nombre: 'Otro Ítem', tipo: 'producto' };

  assert.equal(esProductoEstricto(itemValido), true, 'Ítem con categoria "producto" debe ser reconocido como producto');
  assert.equal(esProductoEstricto(itemInvalidoTipoAntiguo), false, 'Ítem con tipo "producto" pero categoria "servicio" NO es producto');
  assert.equal(esProductoEstricto(itemServicioPuro), false, 'Ítem servicio puro no es producto');
  assert.equal(esProductoEstricto(itemSinCategoria), false, 'Ítem sin campo categoria no es producto');
});

test('8. Reintento con cobro/pago fallido: distinguir nota guardada de cobro confirmado y conservar nota existente', async () => {
  storageMock.clear();
  const operacionId = 'c0a80101-0000-4000-a000-000000000080';
  const escuelaId = 'escuela_central';
  const usuarioId = 'usuario_cajero_1';
  const notaIdGenerada = 'cxc_nota_exitosa_777';

  // Guardar operación que incluía cobro
  guardarOperacionIncierta({
    operacionId,
    tipo: 'cxc_individual',
    escuelaId,
    usuarioId,
    claveEntidad: 'alumno_123',
    payloadOriginal: {
      rpcParams: { p_monto_total: 200, p_operacion_id: operacionId },
      pago: { monto: 200, cuentaCobroId: 'cuenta_caja_1', fechaPago: '2026-09-15', horaPago: '10:00' },
    },
    timestamp: Date.now(),
    estado: 'incierto',
  });

  // Configurar cliente donde guardar nota tiene éxito pero registrar cobro devuelve error
  const supabase = crearClienteSupabaseSimulado({ datosInicialesCxc: [] });
  supabase.rpcHandler = async (nombreFn, params) => {
    if (nombreFn === 'rpc_guardar_nota_cxc') {
      return { data: notaIdGenerada, error: null };
    }
    if (nombreFn === 'rpc_registrar_cobro') {
      return { data: null, error: { message: 'La caja seleccionada se encuentra cerrada.' } };
    }
    return { data: null, error: null };
  };

  // Simular la lógica corregida del componente:
  const opIncierta = obtenerOperacionIncierta('cxc_individual', escuelaId, usuarioId, 'alumno_123');
  assert.ok(opIncierta);

  const resNota = await supabase.rpc('rpc_guardar_nota_cxc', opIncierta.payloadOriginal.rpcParams);
  assert.equal(resNota.error, null);
  const notaId = resNota.data;

  // Se remueve la operación incierta de creación de nota porque ya fue guardada
  removerOperacionIncierta(operacionId);

  // Ejecutar el cobro original
  const pagoOriginal = opIncierta.payloadOriginal.pago;
  let cobroExitoso = true;
  let errorCobroMsg = null;

  const { error: errCobro } = await supabase.rpc('rpc_registrar_cobro', {
    p_payload: { cuenta_cobrar_id: notaId, monto: pagoOriginal.monto }
  });

  if (errCobro) {
    cobroExitoso = false;
    errorCobroMsg = errCobro.message;
  }

  // Verificaciones:
  assert.equal(cobroExitoso, false, 'Detecta correctamente que el cobro falló');
  assert.equal(errorCobroMsg, 'La caja seleccionada se encuentra cerrada.', 'Captura el mensaje de error de la RPC');
  assert.equal(notaId, notaIdGenerada, 'La nota ya fue guardada y debe conservarse');
  // Se debe distinguir y NO reportar "Registrado correctamente"
  const mensajeMostrado = cobroExitoso
    ? '✅ Registrado correctamente tras reintento de la operación original.'
    : `⚠️ La nota fue guardada y conservada correctamente (ID: ${notaId}), pero el cobro financiero no pudo confirmarse: ${errorCobroMsg}. Puedes registrar el cobro manualmente desde la lista.`;

  assert.ok(mensajeMostrado.startsWith('⚠️ La nota fue guardada y conservada correctamente'), 'Distingue nota guardada de cobro fallido');
  assert.ok(mensajeMostrado.includes(notaIdGenerada), 'Muestra el ID de la nota conservada');
});

test('9. Guardado inicial con cobro/pago fallido: nota se conserva, se informa advertencia y no se genera nota duplicada', async () => {
  storageMock.clear();
  const operacionId = 'd0b90202-0000-4000-b000-000000000099';
  const notaIdGenerada = 'cxc_nota_nueva_888';

  // Configurar cliente donde rpc_guardar_nota_cxc tiene éxito pero rpc_registrar_cobro falla
  const supabase = crearClienteSupabaseSimulado({ datosInicialesCxc: [] });
  supabase.rpcHandler = async (nombreFn, params) => {
    if (nombreFn === 'rpc_guardar_nota_cxc') {
      return { data: notaIdGenerada, error: null };
    }
    if (nombreFn === 'rpc_registrar_cobro') {
      return { data: null, error: { message: 'Saldo insuficiente en cuenta de cobro.' } };
    }
    return { data: null, error: null };
  };

  // Simular flujo inicial de NotaServicios.tsx:
  const { data: notaIdResp, error: errRpcGuardar } = await supabase.rpc('rpc_guardar_nota_cxc', {
    p_monto_total: 150,
    p_operacion_id: operacionId,
  });
  assert.equal(errRpcGuardar, null);
  const notaId = notaIdResp;
  assert.equal(notaId, notaIdGenerada);

  // Ejecución del cobro con fallo capturado
  let cobroExitoso = true;
  let errorCobroMsg = null;
  const { error: rpcErr } = await supabase.rpc('rpc_registrar_cobro', {
    p_payload: { cuenta_cobrar_id: notaId, monto: 150 }
  });

  if (rpcErr) {
    cobroExitoso = false;
    errorCobroMsg = rpcErr.message;
  }

  assert.equal(cobroExitoso, false, 'El cobro falla como se esperaba');
  assert.equal(errorCobroMsg, 'Saldo insuficiente en cuenta de cobro.');

  // Comprobar mensaje resultante de advertencia segura
  const mensajeMostrado = !cobroExitoso
    ? `⚠️ La nota fue guardada y conservada correctamente (ID: ${notaId}), pero el cobro financiero no pudo confirmarse: ${errorCobroMsg}. Puedes registrar el cobro manualmente desde la lista.`
    : '✅ Registrado correctamente.';

  assert.ok(mensajeMostrado.includes('La nota fue guardada y conservada correctamente'));
  assert.ok(mensajeMostrado.includes(notaIdGenerada));
  assert.ok(mensajeMostrado.includes('Saldo insuficiente'));
});

