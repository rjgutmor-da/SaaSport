import test from 'node:test';
import assert from 'node:assert/strict';
import { ordenarGruposPorSucursalYNombre } from './ordenGrupos.ts';

test('ordena primero por sucursal y luego por nombre del grupo de forma natural', () => {
  const entrada = [
    { id: '1', nombre: 'Turno Mañana', sucursal: { nombre: 'Zona Sur' } },
    { id: '2', nombre: 'Sub 10-11', sucursal: { nombre: 'Central' } },
    { id: '3', nombre: 'sub 5-6', sucursal: { nombre: 'Panenka' } },
    { id: '4', nombre: 'Sub 4-5', sucursal: { nombre: 'Central' } },
    { id: '5', nombre: 'Sub 2y3', sucursal: { nombre: 'Jaguaru' } },
    { id: '6', nombre: 'sub 2-4', sucursal: { nombre: 'La Pampa' } },
    { id: '7', nombre: 'Sub 12-13-14', sucursal: { nombre: 'Central' } },
    { id: '8', nombre: 'Sub 6-7', sucursal: { nombre: 'Central' } },
    { id: '9', nombre: 'Sub 2-3 B', sucursal: { nombre: 'Zona Sur' } },
    { id: '10', nombre: 'Sub 2-3 A', sucursal: { nombre: 'Zona Sur' } },
    { id: '11', nombre: 'Sub 8-9', sucursal: { nombre: 'Panenka' } },
    { id: '12', nombre: 'Sub 4-6', sucursal: { nombre: 'Zona Sur' } },
  ];

  const resultado = ordenarGruposPorSucursalYNombre(entrada);

  assert.deepEqual(
    resultado.map((g) => `${g.sucursal?.nombre} - ${g.nombre}`),
    [
      'Central - Sub 4-5',
      'Central - Sub 6-7',
      'Central - Sub 10-11',
      'Central - Sub 12-13-14',
      'Jaguaru - Sub 2y3',
      'La Pampa - sub 2-4',
      'Panenka - sub 5-6',
      'Panenka - Sub 8-9',
      'Zona Sur - Sub 2-3 A',
      'Zona Sur - Sub 2-3 B',
      'Zona Sur - Sub 4-6',
      'Zona Sur - Turno Mañana',
    ]
  );
});

test('ubica los grupos sin sucursal al final ordenados por nombre', () => {
  const entrada = [
    { id: '1', nombre: 'Zeta', sucursal: null },
    { id: '2', nombre: 'Alfa', sucursal: { nombre: 'Norte' } },
    { id: '3', nombre: 'Beta', sucursal: undefined },
    { id: '4', nombre: 'Omega', sucursal: { nombre: '   ' } },
  ];

  const resultado = ordenarGruposPorSucursalYNombre(entrada);

  assert.deepEqual(
    resultado.map((g) => g.nombre),
    ['Alfa', 'Beta', 'Omega', 'Zeta']
  );
});

test('ignora mayúsculas, minúsculas y espacios en sucursal y nombre sin mutar la entrada', () => {
  const entrada = [
    { id: '1', nombre: 'sub 2-4', sucursal: { nombre: 'central' } },
    { id: '2', nombre: 'Sub 2-3 A', sucursal: { nombre: ' Central ' } },
    { id: '3', nombre: 'Grupo B', sucursal: { nombre: 'Aranjuez' } },
  ];
  const copiaOriginal = entrada.map((item) => ({ ...item }));

  const resultado = ordenarGruposPorSucursalYNombre(entrada);

  assert.deepEqual(
    resultado.map((g) => g.id),
    ['3', '2', '1']
  );
  assert.deepEqual(entrada, copiaOriginal);
});
