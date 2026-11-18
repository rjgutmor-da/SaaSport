import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clasificarCumpleanosPersonal,
  construirUrlWhatsAppCumpleanos,
  formatearTelefonoWhatsApp,
  obtenerEstadoCumpleanos,
} from './cumpleanosPersonalUtils.ts';

const crearEntidadBase = (overrides) => ({
  id: 'id-base',
  tipo: 'personal',
  nombre: 'Empleado Prueba',
  categoria: 'personal',
  cargo: 'Entrenador',
  telefono: '71234567',
  saldo_pendiente: 0,
  notas_pendientes: 0,
  fecha_mas_antigua: null,
  fecha_nacimiento: null,
  ...overrides,
});

test('clasifica exactamente hoy, ayer y mañana sin desfase horario', () => {
  // Referencia: 18 de noviembre de 2026 a las 23:45 hora local (borde nocturno)
  const fechaRef = new Date(2026, 10, 18, 23, 45, 0);

  const entidades = [
    crearEntidadBase({
      id: 'p-hoy',
      nombre: 'Carlos Hoy',
      fecha_nacimiento: '1992-11-18',
    }),
    crearEntidadBase({
      id: 'p-ayer',
      nombre: 'Ana Ayer',
      fecha_nacimiento: '1990-11-17',
    }),
    crearEntidadBase({
      id: 'p-manana',
      nombre: 'Luis Mañana',
      fecha_nacimiento: '1988-11-19',
    }),
    crearEntidadBase({
      id: 'p-hace-2-dias',
      nombre: 'Fuera Pasado',
      fecha_nacimiento: '1991-11-16',
    }),
    crearEntidadBase({
      id: 'p-en-2-dias',
      nombre: 'Fuera Futuro 2',
      fecha_nacimiento: '1995-11-20',
    }),
    crearEntidadBase({
      id: 'p-en-3-dias',
      nombre: 'Fuera Futuro 3',
      fecha_nacimiento: '1995-11-21',
    }),
  ];

  const resumen = clasificarCumpleanosPersonal(entidades, fechaRef);

  assert.equal(resumen.totalConFecha, 6);
  assert.deepEqual(resumen.hoy.map((e) => e.id), ['p-hoy']);
  assert.deepEqual(resumen.ayer.map((e) => e.id), ['p-ayer']);
  assert.deepEqual(resumen.manana.map((e) => e.id), ['p-manana']);
  assert.equal(resumen.hoy[0].edadCumplida, 34);
  assert.equal(resumen.ayer[0].edadCumplida, 36);
  assert.equal(resumen.manana[0].edadCumplida, 38);
});

test('excluye entidades de tipo proveedor aunque tengan fecha_nacimiento', () => {
  const fechaRef = new Date(2026, 10, 18, 10, 0, 0);

  const entidades = [
    crearEntidadBase({
      id: 'prov-1',
      tipo: 'proveedor',
      categoria: 'uniforme',
      nombre: 'Textilab Proveedor',
      fecha_nacimiento: '1985-11-18',
    }),
    crearEntidadBase({
      id: 'emp-1',
      tipo: 'personal',
      nombre: 'Marco Entrenador',
      fecha_nacimiento: '1985-11-18',
    }),
  ];

  const resumen = clasificarCumpleanosPersonal(entidades, fechaRef);

  assert.equal(resumen.totalConFecha, 1);
  assert.deepEqual(resumen.hoy.map((e) => e.id), ['emp-1']);
  assert.equal(resumen.ayer.length, 0);
  assert.equal(resumen.manana.length, 0);
});

test('maneja cumpleaños de 29 de febrero en año no bisiesto y en año bisiesto', () => {
  // Año no bisiesto (2026): el 29 de febrero se celebra el 28 de febrero
  const feb28NoBisiesto = new Date(2026, 1, 28, 12, 0, 0);
  assert.equal(obtenerEstadoCumpleanos('2000-02-29', feb28NoBisiesto), 'hoy');

  // El 1 de marzo de 2026, el 28 de febrero fue ayer
  const mar01NoBisiesto = new Date(2026, 2, 1, 12, 0, 0);
  assert.equal(obtenerEstadoCumpleanos('2000-02-29', mar01NoBisiesto), 'ayer');

  // Año bisiesto (2028): el 28 de febrero tiene al 29 de febrero como mañana y el 29 como hoy
  const feb28Bisiesto = new Date(2028, 1, 28, 12, 0, 0);
  const feb29Bisiesto = new Date(2028, 1, 29, 12, 0, 0);
  assert.equal(obtenerEstadoCumpleanos('2000-02-29', feb28Bisiesto), 'manana');
  assert.equal(obtenerEstadoCumpleanos('2000-02-29', feb29Bisiesto), 'hoy');
});

test('genera enlaces de WhatsApp con prefijo 591 para celulares bolivianos de 8 dígitos', () => {
  assert.equal(formatearTelefonoWhatsApp('7654-3210'), '59176543210');
  assert.equal(formatearTelefonoWhatsApp('6835 6845'), '59168356845');
  assert.equal(formatearTelefonoWhatsApp('+591 71234567'), '59171234567');

  const url = construirUrlWhatsAppCumpleanos('Shariel Romina Cardozo', '68780814');
  assert.ok(url);
  assert.ok(url.startsWith('https://wa.me/59168780814?text='));
  assert.ok(decodeURIComponent(url).includes('Shariel'));

  assert.equal(construirUrlWhatsAppCumpleanos('Sin Teléfono', ''), null);
  assert.equal(construirUrlWhatsAppCumpleanos('Corto', '12345'), null);
});
