import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

// Ejecuta los componentes reales sin conexiones ni escrituras en producción.
const nota = {
  id: 'compra', escuela_id: 'escuela', sucursal_id: 'sucursal', proveedor_id: 'proveedor',
  tipo_gasto: 'proveedor', estado: 'parcial', monto_total: 5850, monto_pagado: 5820,
  deuda_restante: 30, fecha_emision: '2026-11-10', fecha_vencimiento: '2026-11-10',
};
const producto = { id: 'uniformes', nombre: 'Uniformes', categoria: 'producto', tipo: 'servicio', activo: true };
const detalle = { id: 'linea', catalogo_item_id: 'uniformes', cantidad: 65, precio_unitario: 90,
  subtotal: 5850, descripcion: 'Original', catalogo_items: producto };
const perfil = { id: 'usuario', escuela_id: 'escuela', sucursal_id: 'sucursal', rol: 'SuperAdministrador' };
const evento = { preventDefault() {}, stopPropagation() {} };
const turno = () => new Promise(resolve => setImmediate(resolve));

function entorno(archivo, opciones = {}) {
  const hooks = [], efectos = [], consultas = [], llamadas = [], temporizadores = [];
  let indice = 0, props;
  const react = {
    useState(inicial) {
      const i = indice++;
      if (!(i in hooks)) hooks[i] = typeof inicial === 'function' ? inicial() : inicial;
      return [hooks[i], valor => { hooks[i] = typeof valor === 'function' ? valor(hooks[i]) : valor; }];
    },
    useRef(inicial) {
      const i = indice++;
      return hooks[i] ??= { current: inicial };
    },
    useEffect(fn, deps) {
      const i = indice++, previo = hooks[i];
      if (!previo || deps.some((d, j) => d !== previo.deps[j])) {
        previo?.cleanup?.();
        hooks[i] = { deps };
        efectos.push(() => { hooks[i].cleanup = fn(); });
      }
    },
    useMemo(fn) { indice++; return fn(); },
    createElement(type, attributes, ...children) { return { type, props: { ...attributes, children } }; },
  };
  const supabase = {
    auth: { async getUser() { return { data: { user: { id: 'usuario' } } }; } },
    from(tabla) {
      const operaciones = [];
      const q = new Proxy({}, { get(_, metodo) {
        if (metodo === 'then') return (resolve, reject) => {
          consultas.push({ tabla, operaciones });
          const filtrada = tabla === 'v_estado_cuentas_pagar' && operaciones.some(([m, campo]) => m === 'eq' && campo === 'id');
          let data = tabla === 'usuarios' ? perfil
            : tabla === 'proveedores' ? [{ id: 'proveedor', nombre: 'Textilab' }]
            : tabla === 'catalogo_items' ? (opciones.inactivo ? [] : [producto])
            : tabla === 'cxp_detalle' ? (opciones.detalles || [{ ...detalle, catalogo_items: { ...producto, activo: !opciones.inactivo } }])
            : tabla === 'pagos_aplicados' ? (opciones.pagos || [])
            : tabla === 'v_estado_cuentas_pagar' ? (filtrada ? { ...nota, anulada: opciones.anulada } : (opciones.anticipos?.(operaciones) || [])) : [];
          const error = tabla === opciones.fallar ? { message: 'Fallo de carga' } : null;
          Promise.resolve({ data: error ? null : data, error }).then(resolve, reject);
        };
        return (...args) => { operaciones.push([metodo, ...args]); return q; };
      } });
      return q;
    },
    async rpc(nombre, payload) { llamadas.push({ nombre, payload }); return { data: 'compra', error: null }; },
  };
  const hijos = {};
  const codigo = ts.transpileModule(fs.readFileSync(new URL(archivo, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const exports = {};
  vm.runInNewContext(codigo, {
    exports, console, crypto: webcrypto, setTimeout: fn => temporizadores.push(fn),
    require(nombre) {
      if (nombre === 'react') return react;
      if (nombre.endsWith('/supabaseClient')) return { supabase };
      if (nombre.endsWith('/authHelper')) return { useAuthSaaSport: () => ({ perfil, escuelaId: 'escuela', puedeEliminar: true }) };
      if (nombre.endsWith('/useMasterData')) return { useSucursales: () => ({ data: [] }) };
      if (nombre.endsWith('/moneda')) return { simboloMoneda: () => 'Bs' };
      if (nombre.endsWith('/dateUtils')) return {
        getHoyISO: () => '2026-11-16', formatFecha: x => x, validarFechaMovimientoFinanciero: () => null,
      };
      if (nombre.endsWith('/inventario')) return { obtenerSaldosPorSucursal: async () => new Map(), validarAperturaInventario: async () => {} };
      if (nombre.endsWith('/idempotenciaNotas')) return new Proxy({}, { get: () => () => null });
      if (nombre.endsWith('/auditLogger')) return { logActivity() {} };
      if (nombre.startsWith('./')) return { default: hijos[nombre] ??= function Hijo() {} , __esModule: true };
      return new Proxy({}, { get: () => () => null });
    },
  });
  function render(nuevas = props) {
    props = nuevas; indice = 0;
    const tree = exports.default(props);
    efectos.splice(0).forEach(fn => fn());
    return tree;
  }
  return { render, consultas, llamadas, hijos, temporizadores,
    async cargar(p) { render(p); await turno(); return render(); } };
}
function nodos(tree, cumple) {
  if (Array.isArray(tree)) return tree.flatMap(x => nodos(x, cumple));
  if (!tree || typeof tree !== 'object') return [];
  return [...(cumple(tree) ? [tree] : []), ...nodos(tree.props?.children, cumple)];
}
const texto = tree => Array.isArray(tree) ? tree.map(texto).join(' ')
  : tree && typeof tree === 'object' ? texto(tree.props?.children) : String(tree ?? '');
const boton = (tree, nombre) => nodos(tree, n => n.type === 'button' && texto(n).includes(nombre))[0];
const propsDetalle = { nota, visible: true, onCerrar() {}, onActualizar() {} };
const propsEditor = { visible: true, tipoInicial: 'proveedor', cxpEditar: nota, onCerrar() {}, onCreada() {} };

test('Editar y el lápiz de producto abren la compra completa con la nota y sucursal originales', async () => {
  for (const desdeItem of [false, true]) {
    const e = entorno('./DetalleCxP.tsx');
    const tree = await e.cargar(propsDetalle);
    const abrir = desdeItem ? nodos(tree, n => n.props?.title === 'Editar Ítem')[0] : boton(tree, 'Editar');
    abrir.props.onClick();
    const editor = e.render();
    assert.equal(editor.type, e.hijos['./NotaPago']);
    assert.equal(editor.props.cxpEditar.id, 'compra');
    assert.equal(editor.props.cxpEditar.sucursal_id, 'sucursal');
    editor.props.onCerrar();
    assert.notEqual(e.render().type, e.hijos['./NotaPago']);
  }
});

test('las notas anuladas o con pagos conciliados conservan el bloqueo de edición', async () => {
  for (const caso of [{ anulada: true }, { pagos: [{ id: 'pago', conciliado: true, fecha: '2026-11-10', monto_aplicado: 5820 }] }]) {
    const e = entorno('./DetalleCxP.tsx', caso);
    const tree = await e.cargar({ ...propsDetalle, nota: { ...nota, anulada: caso.anulada } });
    assert.equal(boton(tree, 'Editar'), undefined);
    assert.equal(nodos(tree, n => n.props?.title === 'Editar Ítem').length, 0);
  }
});

test('carga anticipos por escuela y proveedor en lotes de 50 y solicita el siguiente solo al pulsar', async () => {
  const e = entorno('./DetalleCxP.tsx', { anticipos: ops => ops.some(([m, c]) => m === 'gt' && c === 'id')
    ? [{ id: 'a50', deuda_restante: 100 }]
    : Array.from({ length: 50 }, (_, i) => ({ id: `a${String(i).padStart(2, '0')}`, deuda_restante: 100 })) });
  let tree = await e.cargar(propsDetalle);
  const peticiones = () => e.consultas.filter(q => q.tabla === 'v_estado_cuentas_pagar' && q.operaciones.some(([m]) => m === 'limit'));
  assert.equal(peticiones().length, 1);
  const ops = peticiones()[0].operaciones;
  for (const filtro of [['eq', 'escuela_id', 'escuela'], ['eq', 'proveedor_id', 'proveedor'], ['limit', 50]]) {
    assert.ok(ops.some(op => JSON.stringify(op) === JSON.stringify(filtro)));
  }
  nodos(tree, n => n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } });
  tree = e.render();
  await boton(tree, 'Cargar más anticipos').props.onClick();
  tree = e.render();
  assert.equal(peticiones().length, 2);
  assert.ok(peticiones()[1].operaciones.some(op => JSON.stringify(op) === JSON.stringify(['gt', 'id', 'a49'])));
  assert.equal(nodos(tree, n => n.type === 'option').filter(n => n.props.value?.startsWith('a')).length, 51);
  assert.equal(boton(tree, 'Cargar más anticipos'), undefined);
});

test('guarda cantidades, precio y todas las líneas mediante la RPC sin registrar otro pago', async () => {
  const e = entorno('./NotaPago.tsx', { inactivo: true });
  let tree = await e.cargar(propsEditor);
  assert.ok(texto(tree).includes('Editar nota de compra'));
  assert.ok(!texto(tree).includes('¿Registrar pago ahora?'));
  assert.equal(boton(tree, 'Guardar cambios').props.disabled, false);
  const numeros = nodos(tree, n => n.type === 'input' && n.props.type === 'number');
  numeros.find(n => n.props.value === 65).props.onChange({ target: { value: '67' } });
  tree = e.render();
  nodos(tree, n => n.type === 'input' && n.props.type === 'number' && n.props.value === 90)[0].props.onChange({ target: { value: '120' } });
  tree = e.render();
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas.length, 1);
  assert.equal(e.llamadas[0].nombre, 'rpc_guardar_nota_cxp');
  const p = e.llamadas[0].payload;
  assert.equal(p.p_nota_id, 'compra');
  assert.equal(p.p_sucursal_id, 'sucursal');
  assert.equal(p.p_monto_total, 8040);
  assert.equal(p.p_lineas[0].catalogo_item_id, 'uniformes');
  assert.equal(p.p_lineas[0].cantidad, 67);
  assert.equal(p.p_lineas[0].precio_unitario, 120);
  assert.equal(p.p_lineas[0].descripcion, 'Original');
});

test('impide guardar antes de cargar y tras un error al leer el detalle', async () => {
  const e = entorno('./NotaPago.tsx', { fallar: 'cxp_detalle' });
  let tree = e.render(propsEditor);
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas.length, 0);
  await turno(); tree = e.render();
  assert.ok(texto(tree).includes('Fallo de carga'));
  assert.equal(nodos(tree, n => n.type === 'button' && n.props.type === 'submit')[0].props.disabled, true);
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas.length, 0);
});

test('impide cambiar la emisión a una fecha posterior al primer pago', async () => {
  const e = entorno('./NotaPago.tsx', { pagos: [{ fecha: '2026-11-09' }] });
  const tree = await e.cargar(propsEditor);
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas.length, 0);
  assert.ok(texto(e.render()).includes('no puede ser posterior al primer pago'));
});

test('conserva todos los conceptos de una nota mixta y no elimina silenciosamente una línea inválida', async () => {
  const servicio = { id: 'servicio', nombre: 'Estampado', categoria: 'servicio', tipo: 'servicio', activo: false };
  const e = entorno('./NotaPago.tsx', { detalles: [detalle, {
    id: 'linea2', catalogo_item_id: 'servicio', cantidad: 2, precio_unitario: 10,
    descripcion: 'Estampados', catalogo_items: servicio,
  }] });
  let tree = await e.cargar(propsEditor);
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas[0].payload.p_monto_total, 5870);
  assert.equal(e.llamadas[0].payload.p_lineas.length, 2);
  assert.equal(e.llamadas[0].payload.p_lineas[1].catalogo_item_id, 'servicio');
  nodos(tree, n => n.type === 'input' && n.props.type === 'number' && n.props.value === 2)[0]
    .props.onChange({ target: { value: '-1' } });
  tree = e.render();
  await nodos(tree, n => n.type === 'form')[0].props.onSubmit(evento);
  assert.equal(e.llamadas.length, 1);
  assert.ok(texto(e.render()).includes('Revisa las cantidades y precios'));
});
