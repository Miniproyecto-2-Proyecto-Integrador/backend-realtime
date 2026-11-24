export type ParticipanteSocket = { uid: string; nombre: string };
export type Participante = { nombre: string; esAnfitrion: boolean };

// Una persona con varias pestañas abiertas cuenta una sola vez. La lista no
// expone UIDs: el anfitrión aparece primero y el resto en orden alfabético.
export function construirParticipantes(sockets: ParticipanteSocket[], propietarioUid?: string): Participante[] {
  const nombrePorUid = new Map<string, string>();
  for (const { uid, nombre } of sockets) {
    if (!nombrePorUid.has(uid)) nombrePorUid.set(uid, nombre);
  }
  return [...nombrePorUid]
    .map(([uid, nombre]) => ({ nombre, esAnfitrion: uid === propietarioUid }))
    .sort((a, b) => Number(b.esAnfitrion) - Number(a.esAnfitrion) || a.nombre.localeCompare(b.nombre, "es"));
}