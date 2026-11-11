import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Ejecuta el componente real con consultas controlables, sin conectarse a producción.
function entorno() {
  let efecto;
  const escrituras = [];
  const pendientes = [];
  let indice = 0;
  const react = {
    useState(inicial) { const i = indice++; return [inicial, valor => escrituras.push({ i, valor })]; },
    useEffect(fn) { efecto = fn; },
    createElement(type, props) { return { type, props }; },
  };
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: 'usuario' } } }; } },
    from(tabla) {
      const q = new Proxy({}, { get(_, propiedad) {
        if (propiedad === 'then') return (resolve, reject) => {
          if (tabla === 'v_cuentas_cobrar') pendientes.push(resolve);
          else Promise.resolve({ data: tabla === 'usuarios' ? { rol: 'SuperAdministrador', escuela_id: 'escuela' } : [], error: null }).then(resolve, reject);
        };
        return () => q;
      } });
      return q;
    },
  };
  function compilar(ruta, extra = '') {
    const codigo = ts.transpileModule(fs.readFileSync(new URL(ruta, import.meta.url), 'utf8') + extra,
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const exports = {};
    vm.runInNewContext(codigo, { exports, console, require(nombre) {
      if (nombre === 'react') return react;
      if (nombre.endsWith('/supabaseClient')) return { supabase };
      if (nombre.endsWith('/authHelper')) return { useAuthSaaSport: () => ({ escuelaId: 'escuela' }) };
      if (nombre.endsWith('/useConfiguracionCobranza')) return { useConfiguracionCobranza: () => ({ isSuccess: true, data: null }) };
      if (nombre.endsWith('/useIsMobile')) return { useIsMobile: () => true };
      if (nombre === './useCobroMultiple') return { useCobroMultiple: () => ({ seleccionadas: new Set() }) };
      for (const lib of ['dateUtils', 'moneda', 'cobranzaWhatsApp']) {
        if (nombre.endsWith('/' + lib)) return compilar(`../../lib/${lib}.ts`);
      }
      return new Proxy({}, { get: () => () => null });
    } });
    return exports;
  }
  const modulo = compilar('./DetalleAlumnoCxc.tsx', '\nexport { obtenerUrlCobranzaWhatsApp };');
  return { modulo, pendientes, escrituras, iniciar(props) {
    const elemento = modulo.default(props);
    elemento.type(elemento.props);
    return efecto();
  } };
}
const alumno = id => ({ alumno_id: id, escuela_id: 'escuela', nombres: id, telefono_padre: '70000000', nombre_padre: 'Por Definir' });
const cuenta = (id, monto, inicio, fin) => ({ id, alumno_id: id, escuela_id: 'escuela', saldo_pendiente: monto,
  descripcion: 'Mensualidad', ciclo_inicio: inicio, ciclo_fin: fin });
const props = id => ({ visible: true, alumno: alumno(id), onCerrar() {}, onActualizar() {} });
const turno = () => new Promise(resolve => setImmediate(resolve));

test('rechaza el cruce Hadif/Gael y conserva monto y ciclo de Hadif', () => {
  const { modulo } = entorno();
  const generar = modulo.obtenerUrlCobranzaWhatsApp;
  const hadif = cuenta('Hadif', 140, '2026-11-01', '2026-11-30');
  const gael = cuenta('Gael', 120, '2026-11-06', '2026-12-05');
  const detalles = { Hadif: [{ item_nombre: 'Mensualidad', ciclo_inicio: hadif.ciclo_inicio, ciclo_fin: hadif.ciclo_fin }] };
  assert.equal(generar(alumno('Hadif'), [gael], {}, null), null);
  assert.equal(generar(alumno('Hadif'), [hadif, gael], detalles, null), null);
  assert.equal(generar(alumno('Hadif'), [{ ...hadif, escuela_id: 'otra' }], detalles, null), null);
  const mensaje = decodeURIComponent(generar(alumno('Hadif'), [hadif], detalles, null));
  assert.match(mensaje, /Hadif/);
  assert.match(mensaje, /140,00/);
  assert.match(mensaje, /1 Nov a 30 Nov de 2026/);
  assert.doesNotMatch(mensaje, /120,00|5 Dic/);
});

test('cambiar alumno cambia identidad de ficha; cerrar la desmonta', () => {
  const { modulo } = entorno();
  assert.notEqual(modulo.default(props('Hadif')).props.key, modulo.default(props('Gael')).props.key);
  assert.equal(modulo.default({ ...props('Hadif'), visible: false }), null);
});

test('una respuesta atrasada tras cerrar o cambiar alumno no publica datos', async () => {
  const e = entorno();
  const limpiar = e.iniciar(props('Gael'));
  await turno();
  assert.equal(e.pendientes.length, 1);
  limpiar();
  const antes = e.escrituras.length;
  e.pendientes[0]({ data: [cuenta('Gael', 120, '2026-11-06', '2026-12-05')], error: null });
  await turno();
  assert.equal(e.escrituras.length, antes);
});

