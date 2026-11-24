export type ParticipanteSocket = { uid: string; nombre: string; avatar?: string };
// El avatar (avatarN o dirección de la foto) viaja con la presencia para que todos vean a quién tienen al lado.
export type Participante = { nombre: string; esAnfitrion: boolean; avatar?: string };

// Una persona con varias pestañas abiertas cuenta una sola vez. La lista no
// expone UIDs: el anfitrión aparece primero y el resto en orden alfabético.
export function construirParticipantes(sockets: ParticipanteSocket[], propietarioUid?: string): Participante[] {
  const datosPorUid = new Map<string, { nombre: string; avatar?: string }>();
  for (const { uid, nombre, avatar } of sockets) {
    if (!datosPorUid.has(uid)) datosPorUid.set(uid, { nombre, avatar });
  }
  return [...datosPorUid]
    .map(([uid, { nombre, avatar }]) => ({ nombre, esAnfitrion: uid === propietarioUid, ...(avatar && { avatar }) }))
    .sort((a, b) => Number(b.esAnfitrion) - Number(a.esAnfitrion) || a.nombre.localeCompare(b.nombre, "es"));
}