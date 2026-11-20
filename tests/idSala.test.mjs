import test from 'node:test';
import assert from 'node:assert/strict';
import { esIdSalaValido } from '../dist/Salas/Domain/idSala.js';
test('acepta códigos nuevos y los IDs existentes', () => {
  for (const id of ['Ab3_xY-9', '12345678', 'ABCDEFGHIJKLMNOPQRST']) assert.equal(esIdSalaValido(id), true);
});
test('rechaza otras longitudes, rutas, espacios y valores no textuales', () => {
  for (const id of ['', '1234567', '123456789', 'Ab3/xY-9', 'Ab3 xY-9', '../rooms', '_'.repeat(20), null, 12345678]) assert.equal(esIdSalaValido(id), false);
});
