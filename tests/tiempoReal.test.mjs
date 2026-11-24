import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { io as conectar } from 'socket.io-client';
import { registrarEventos } from '../dist/Salas/tiempoReal.js';

const SALA = 'Ab3_xY-9';
const OTRA = 'Zz9_wV-1';
const usuarios = { anfitrion: 'ana', luis: 'luis', zoe: 'zoe' };
let salas, mensajes, escuchas;
const instantanea = (id) => {
  const d = salas[id];
  return { id, exists: Boolean(d), get: (k) => d?.[k] };
};
const snapUsuario = (uid) => ({ id: uid, exists: uid in usuarios, get: (k) => (k === 'username' ? usuarios[uid] : undefined) });
const refSala = (id) => ({
  id, tipo: 'sala',
  get: async () => instantanea(id),
  onSnapshot(alRecibir) {
    const escucha = { id, alRecibir };
    escuchas.push(escucha);
    setImmediate(() => alRecibir(instantanea(id)));
    return () => { escucha.cerrada = true; };
  },
  collection: () => ({ doc: () => ({ id: `msg${mensajes.length + 1}`, tipo: 'mensaje', sala: id }) }),
});
const refUsuario = (uid) => ({ id: uid, tipo: 'usuario', get: async () => snapUsuario(uid) });
const leer = (ref) => (ref.tipo === 'sala' ? instantanea(ref.id) : snapUsuario(ref.id));
const db = {
  collection: (nombre) => ({ doc: (id) => (nombre === 'rooms' ? refSala(id) : refUsuario(id)) }),
  getAll: async (...refs) => refs.map(leer),
  runTransaction: async (cb) => cb({
    getAll: async (...refs) => refs.map(leer),
    create: (ref, datos) => mensajes.push({ ref, datos }),
    update: () => {},
  }),
  recursiveDelete: async () => {},
};
const auth = {
  verifyIdToken: async (token) => {
    if (!(token in usuarios)) throw new Error('token inválido');
    return { uid: token, exp: Math.floor(Date.now() / 1000) + 3600 };
  },
};

let http, io, puerto;
const clientes = [];
test.before(async () => {
  http = createServer();
  io = new Server(http, { connectionStateRecovery: { maxDisconnectionDuration: 60000 } });
  registrarEventos(io, { auth, db });
  await new Promise((resolver) => http.listen(0, resolver));
  puerto = http.address().port;
});
test.after(async () => {
  clientes.splice(0).forEach((c) => c.close());
  await io.close();
});
test.afterEach(async () => {
  clientes.splice(0).forEach((c) => c.close());
  await new Promise((r) => setTimeout(r, 60));
});
test.beforeEach(() => {
  salas = {
    [SALA]: { nombre: 'Estudio', propietarioUid: 'anfitrion' },
    [OTRA]: { nombre: 'Otra', propietarioUid: 'anfitrion' },
  };
  mensajes = [];
  escuchas = [];
});
const crear = async (token) => {
  const cliente = conectar(`http://localhost:${puerto}`, { auth: { token }, reconnectionDelay: 20 });
  clientes.push(cliente);
  await new Promise((resolver, rechazar) => {
    cliente.once('connect', resolver);
    cliente.once('connect_error', rechazar);
  });
  return cliente;
};
const unir = (cliente, id = SALA) => new Promise((resolver) => cliente.emit('sala:unir', id, resolver));
const esperar = (cliente, evento, ms = 1500) => new Promise((resolver, rechazar) => {
  const t = setTimeout(() => rechazar(new Error(`No llegó ${evento}`)), ms);
  cliente.once(evento, (datos) => { clearTimeout(t); resolver(datos); });
});
const silencio = (cliente, evento, ms = 250) => new Promise((resolver, rechazar) => {
  const alRecibir = () => rechazar(new Error(`Llegó ${evento} inesperado`));
  cliente.once(evento, alRecibir);
  setTimeout(() => { cliente.off(evento, alRecibir); resolver(); }, ms);
});

test('sin token válido la conexión se rechaza', async () => {
  await assert.rejects(crear('desconocido'), /No autorizado/);
});
test('al unirse devuelve rol, nombre y participantes; los demás ven quién entró', async () => {
  const ana = await crear('anfitrion');
  const resAna = await unir(ana);
  assert.deepEqual(resAna.data.participantes, [{ nombre: 'ana', esAnfitrion: true }]);
  assert.equal(resAna.data.rol, 'administrador');
  const aviso = esperar(ana, 'sala:presencia');
  const luis = await crear('luis');
  const resLuis = await unir(luis);
  assert.equal(resLuis.data.rol, 'participante');
  assert.deepEqual(resLuis.data.participantes.map((p) => p.nombre), ['ana', 'luis']);
  const presencia = await aviso;
  assert.equal(presencia.cantidad, 2);
  assert.deepEqual(presencia.cambio, { tipo: 'entro', nombre: 'luis' });
});
test('un ID inexistente se rechaza con mensaje claro', async () => {
  const luis = await crear('luis');
  assert.match((await unir(luis, 'Nn0_nN-0')).error, /no existe/);
  assert.match((await unir(luis, '')).error, /no es válido/);
});
test('el mensaje llega a la misma sala con hora y esPropio, y se guarda; a otra sala no', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const luis = await crear('luis'); await unir(luis);
  const zoe = await crear('zoe'); await unir(zoe, OTRA);
  const recibido = esperar(luis, 'chat:mensaje');
  const ruido = silencio(zoe, 'chat:mensaje');
  const ack = await new Promise((r) => ana.emit('chat:enviar', { id: SALA, texto: '  Hola  ' }, r));
  assert.equal(ack.ok, true);
  assert.equal(ack.data.esPropio, true);
  assert.equal(ack.data.texto, 'Hola');
  const mensaje = await recibido;
  assert.equal(mensaje.esPropio, false);
  assert.equal(mensaje.autor, 'ana');
  assert.equal(mensaje.id, ack.data.id);
  assert.ok(!Number.isNaN(Date.parse(mensaje.creadoEn)));
  await ruido;
  assert.equal(mensajes.length, 1);
  assert.equal(mensajes[0].datos.autorUid, 'anfitrion');
});
test('un mensaje vacío no se envía ni se guarda', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const ack = await new Promise((r) => ana.emit('chat:enviar', { id: SALA, texto: '   ' }, r));
  assert.equal(ack.ok, false);
  assert.equal(mensajes.length, 0);
});
test('no se puede escribir en una sala sin haber entrado', async () => {
  const luis = await crear('luis');
  const ack = await new Promise((r) => luis.emit('chat:enviar', { id: SALA, texto: 'Hola' }, r));
  assert.match(ack.error, /Primero entra/);
});
test('dos pestañas de la misma persona cuentan una vez y no se anuncian dos veces', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const luis1 = await crear('luis'); await unir(luis1);
  const aviso = esperar(ana, 'sala:presencia');
  const luis2 = await crear('luis');
  const res = await unir(luis2);
  assert.equal(res.data.participantes.length, 2);
  const presencia = await aviso;
  assert.equal(presencia.cantidad, 2);
  assert.equal(presencia.cambio, undefined);
});
test('al salir los demás reciben el aviso con el nombre', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const luis = await crear('luis'); await unir(luis);
  const aviso = esperar(ana, 'sala:presencia');
  luis.emit('sala:salir', SALA);
  const presencia = await aviso;
  assert.equal(presencia.cantidad, 1);
  assert.deepEqual(presencia.cambio, { tipo: 'salio', nombre: 'luis' });
});
test('si la sala se elimina en Firestore, los participantes reciben el aviso', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const luis = await crear('luis'); await unir(luis);
  const avisos = Promise.all([esperar(ana, 'sala:eliminada'), esperar(luis, 'sala:eliminada')]);
  delete salas[SALA];
  escuchas.filter((e) => e.id === SALA && !e.cerrada).forEach((e) => e.alRecibir(instantanea(SALA)));
  const [aviso] = await avisos;
  assert.equal(aviso.id, SALA);
  assert.ok(escuchas.filter((e) => e.id === SALA).every((e) => e.cerrada));
});
test('si cambia el nombre de la sala en Firestore, se avisa a los participantes', async () => {
  const luis = await crear('luis'); await unir(luis);
  const aviso = esperar(luis, 'sala:actualizada');
  salas[SALA].nombre = 'Nuevo nombre';
  escuchas.filter((e) => e.id === SALA && !e.cerrada).forEach((e) => e.alRecibir(instantanea(SALA)));
  assert.deepEqual(await aviso, { id: SALA, nombre: 'Nuevo nombre' });
});
test('al perder la conexión un momento, el cliente vuelve a su sala y sigue recibiendo mensajes', async () => {
  const ana = await crear('anfitrion'); await unir(ana);
  const luis = await crear('luis'); await unir(luis);
  const reconectado = new Promise((r) => luis.once('connect', r));
  luis.io.engine.close();
  await reconectado;
  assert.equal(luis.recovered, true);
  await new Promise((r) => setTimeout(r, 100));
  const recibido = esperar(luis, 'chat:mensaje');
  await new Promise((r) => ana.emit('chat:enviar', { id: SALA, texto: 'Sigues aquí' }, r));
  assert.equal((await recibido).texto, 'Sigues aquí');
});