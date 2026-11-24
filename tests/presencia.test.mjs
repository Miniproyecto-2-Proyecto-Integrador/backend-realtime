import test from 'node:test';
import assert from 'node:assert/strict';
import { construirParticipantes } from '../dist/Salas/Domain/presencia.js';
test('el anfitrión va primero y el resto en orden alfabético', () => {
  const lista = construirParticipantes(
    [{ uid: 'u2', nombre: 'zoe' }, { uid: 'u1', nombre: 'ana' }, { uid: 'u3', nombre: 'luis' }], 'u3');
  assert.deepEqual(lista, [
    { nombre: 'luis', esAnfitrion: true }, { nombre: 'ana', esAnfitrion: false }, { nombre: 'zoe', esAnfitrion: false },
  ]);
});
test('una persona con varias pestañas cuenta una sola vez y no se exponen UIDs', () => {
  const lista = construirParticipantes([{ uid: 'u1', nombre: 'ana' }, { uid: 'u1', nombre: 'ana' }]);
  assert.deepEqual(lista, [{ nombre: 'ana', esAnfitrion: false }]);
});
test('sin sockets la lista queda vacía', () => {
  assert.deepEqual(construirParticipantes([], 'u1'), []);
});