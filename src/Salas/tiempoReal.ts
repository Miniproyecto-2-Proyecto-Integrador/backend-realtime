import type { Auth } from "firebase-admin/auth";
import { Timestamp, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import type { Server } from "socket.io";
import { esIdSalaValido } from "./Domain/idSala.js";
import { construirParticipantes, type ParticipanteSocket } from "./Domain/presencia.js";

type Respuesta = (resultado: { ok: boolean; error?: string; data?: object }) => void;
type Cambio = { tipo: "entro" | "salio"; nombre: string };
// Mientras haya gente en una sala, se vigila su documento en Firestore para
// avisar cuando cambia el nombre o la sala se elimina (por la API, por el
// borrado de la cuenta del anfitrión o por los eventos antiguos del socket).
type Vigilancia = { baja: () => void; nombre: string; propietarioUid: string };

export function registrarEventos(io: Server, { auth, db }: { auth: Auth; db: Firestore }) {
  const rooms = db.collection("rooms");
  const vigiladas = new Map<string, Vigilancia>();

  io.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth.token;
    if (typeof token !== "string" || !token) {
      next(new Error("No autorizado: debes iniciar sesión"));
      return;
    }

    try {
      const session = await auth.verifyIdToken(token, true);
      socket.data.uid = session.uid;
      socket.data.exp = session.exp;
    } catch {
      next(new Error("No autorizado: la sesión no es válida o expiró"));
      return;
    }
    next();
  });

  const detenerVigilancia = (id: string) => {
    vigiladas.get(id)?.baja();
    vigiladas.delete(id);
  };

  const vigilarSala = (id: string, sala: DocumentSnapshot) => {
    if (vigiladas.has(id)) return;
    const vigilancia: Vigilancia = {
      baja: () => undefined,
      nombre: sala.get("nombre") as string,
      propietarioUid: sala.get("propietarioUid") as string,
    };
    vigiladas.set(id, vigilancia);
    vigilancia.baja = rooms.doc(id).onSnapshot(
      (actual) => {
        if (!actual.exists || actual.get("eliminando")) {
          io.to(id).emit("sala:eliminada", { id });
          io.in(id).socketsLeave(id);
          detenerVigilancia(id);
          return;
        }
        vigilancia.propietarioUid = actual.get("propietarioUid") as string;
        const nombre = actual.get("nombre") as string;
        if (nombre !== vigilancia.nombre) {
          vigilancia.nombre = nombre;
          io.to(id).emit("sala:actualizada", { id, nombre });
        }
      },
      (error) => {
        console.error("Se perdió la vigilancia de la sala", (error as { code?: string }).code);
        detenerVigilancia(id);
      },
    );
  };

  const socketsDe = (id: string) =>
    [...(io.sockets.adapter.rooms.get(id) ?? [])].flatMap((sid) => {
      const socket = io.sockets.sockets.get(sid);
      return socket ? [socket] : [];
    });

  const participantesDe = (id: string) => {
    const lista: ParticipanteSocket[] = socketsDe(id)
      .filter((socket) => socket.data.uid && socket.data.nombre)
      .map((socket) => ({ uid: socket.data.uid as string, nombre: socket.data.nombre as string }));
    return construirParticipantes(lista, vigiladas.get(id)?.propietarioUid);
  };

  const uidEnSala = (id: string, uid: string, exceptoSocketId?: string) =>
    socketsDe(id).some((socket) => socket.id !== exceptoSocketId && socket.data.uid === uid);

  const notificarPresencia = (id: string, cambio?: Cambio) => {
    const participantes = participantesDe(id);
    io.to(id).emit("sala:presencia", {
      id,
      cantidad: participantes.length,
      participantes,
      ...(cambio && { cambio }),
    });
    if (participantes.length === 0) detenerVigilancia(id);
  };

  io.on("connection", (socket) => {
    const uid = socket.data.uid as string;
    const perfil = db.collection("users").doc(uid);
    const responder = (ack: unknown, error?: string, data?: object) => {
      if (typeof ack === "function") (ack as Respuesta)({ ok: !error, ...(error && { error }), ...(data && { data }) });
    };
    const estaVigente = () => Date.now() < socket.data.exp * 1000;

    // Reconexión: si el cliente vuelve pronto tras perder la conexión, Socket.IO
    // lo devuelve a sus salas; aquí se restablece la vigilancia y la presencia.
    const restaurarSalas = async () => {
      const ids = [...socket.rooms].filter((id) => id !== socket.id);
      if (ids.length === 0) return;
      try {
        const usuario = await perfil.get();
        if (!usuario.exists || usuario.get("eliminando")) {
          ids.forEach((id) => socket.leave(id));
          return;
        }
        socket.data.nombre = usuario.get("username");
        for (const id of ids) {
          const sala = await rooms.doc(id).get();
          if (!sala.exists || sala.get("eliminando")) {
            socket.emit("sala:eliminada", { id });
            await socket.leave(id);
            continue;
          }
          vigilarSala(id, sala);
          const nombre = socket.data.nombre as string;
          notificarPresencia(id, uidEnSala(id, uid, socket.id) ? undefined : { tipo: "entro", nombre });
        }
      } catch (error) {
        console.error("No se pudieron restaurar las salas", (error as { code?: string }).code);
      }
    };
    if (socket.recovered) void restaurarSalas();

    socket.on("sala:unir", async (id: unknown, ack: unknown) => {
      if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
      if (!esIdSalaValido(id)) return responder(ack, "El ID de sala no es válido.");
      try {
        const [sala, usuario] = await db.getAll(rooms.doc(id), perfil);
        if (!sala.exists || sala.get("eliminando")) return responder(ack, "La sala no existe.");
        if (!usuario.exists || usuario.get("eliminando")) return responder(ack, "Completa tu perfil para entrar.");
        if (!socket.connected) return;
        const nombre = usuario.get("username") as string;
        socket.data.nombre = nombre;
        // Entrar dos veces a la misma sala (por ejemplo al reconectar) no se anuncia.
        const yaEstaba = socket.rooms.has(id);
        const cambio: Cambio | undefined =
          yaEstaba || uidEnSala(id, uid, socket.id) ? undefined : { tipo: "entro", nombre };
        vigilarSala(id, sala);
        await socket.join(id);
        notificarPresencia(id, cambio);
        responder(ack, undefined, {
          id, nombre: sala.get("nombre"),
          rol: sala.get("propietarioUid") === uid ? "administrador" : "participante",
          participantes: participantesDe(id),
        });
      } catch (error) {
        console.error("No se pudo unir a la sala", (error as { code?: string }).code);
        responder(ack, "No pudimos abrir la sala. Intenta de nuevo.");
      }
    });

    socket.on("sala:salir", async (id: unknown, ack: unknown) => {
      if (!esIdSalaValido(id)) return responder(ack, "El ID de sala no es válido.");
      const estaba = socket.rooms.has(id);
      await socket.leave(id);
      const nombre = socket.data.nombre as string | undefined;
      notificarPresencia(id, estaba && nombre && !uidEnSala(id, uid) ? { tipo: "salio", nombre } : undefined);
      responder(ack);
    });

    socket.on("chat:enviar", async (entrada: unknown, ack: unknown) => {
      if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
      const { id, texto } = (entrada ?? {}) as { id?: unknown; texto?: unknown };
      if (!esIdSalaValido(id) || !socket.rooms.has(id)) return responder(ack, "Primero entra a la sala.");
      const contenido = typeof texto === "string" ? texto.trim() : "";
      if (!contenido || contenido.length > 2000) return responder(ack, "Escribe un mensaje de hasta 2000 caracteres.");
      const salaRef = rooms.doc(id);
      const mensajeRef = salaRef.collection("messages").doc();
      const creadoEn = Timestamp.now();
      try {
        const autor = await db.runTransaction(async (t) => {
          const [sala, usuario] = await t.getAll(salaRef, perfil);
          if (!sala.exists || sala.get("eliminando") || !usuario.exists || usuario.get("eliminando")) {
            return null;
          }
          const nombre = usuario.get("username") as string;
          t.create(mensajeRef, { texto: contenido, autor: nombre, autorUid: uid, creadoEn });
          return nombre;
        });
        if (autor === null) return responder(ack, "La sala o el perfil ya no están disponibles.");
        const mensaje = {
          id: mensajeRef.id, salaId: id, autor, texto: contenido, creadoEn: creadoEn.toDate().toISOString(),
        };
        // Los demás reciben el mensaje; quien lo envía lo recibe en la confirmación.
        socket.to(id).emit("chat:mensaje", { ...mensaje, esPropio: false });
        responder(ack, undefined, { ...mensaje, esPropio: true });
      } catch (error) {
        console.error("No se pudo enviar el mensaje", (error as { code?: string }).code);
        responder(ack, "No pudimos enviar el mensaje. Intenta de nuevo.");
      }
    });

    // OBSOLETO: editar y eliminar salas ahora se hace por la API REST
    // (PATCH y DELETE /api/salas/:id). Estos eventos siguen funcionando, pero el
    // aviso a los participantes lo emite la vigilancia de la sala.
    socket.on("sala:actualizar", async (entrada: unknown, ack: unknown) => {
      if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
      const { id, nombre } = (entrada ?? {}) as { id?: unknown; nombre?: unknown };
      const valor = typeof nombre === "string" ? nombre.trim() : "";
      if (!esIdSalaValido(id) || !valor || Array.from(valor).length > 80) {
        return responder(ack, "Usa un ID válido y un nombre de 1 a 80 caracteres.");
      }
      const salaRef = rooms.doc(id);
      try {
        const actualizado = await db.runTransaction(async (t) => {
          const [sala, usuario] = await t.getAll(salaRef, perfil);
          if (sala.get("propietarioUid") !== uid || sala.get("eliminando") ||
              !usuario.exists || usuario.get("eliminando")) return false;
          t.update(salaRef, { nombre: valor });
          return true;
        });
        if (!actualizado) return responder(ack, "No puedes modificar esta sala.");
        responder(ack);
      } catch (error) {
        console.error("No se pudo actualizar la sala", (error as { code?: string }).code);
        responder(ack, "No pudimos actualizar la sala. Intenta de nuevo.");
      }
    });

    // OBSOLETO: ver el comentario de sala:actualizar.
    socket.on("sala:eliminar", async (id: unknown, ack: unknown) => {
      if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
      if (!esIdSalaValido(id)) return responder(ack, "El ID de sala no es válido.");
      const salaRef = rooms.doc(id);
      try {
        const autorizado = await db.runTransaction(async (t) => {
          const [sala, usuario] = await t.getAll(salaRef, perfil);
          if (sala.get("propietarioUid") !== uid || !usuario.exists || usuario.get("eliminando")) return false;
          t.update(salaRef, { eliminando: true });
          return true;
        });
        if (!autorizado) return responder(ack, "No puedes eliminar esta sala.");
        await db.recursiveDelete(salaRef.collection("messages"));
        await salaRef.delete();
        responder(ack);
      } catch (error) {
        console.error("No se pudo eliminar la sala", (error as { code?: string }).code);
        responder(ack, "No pudimos eliminar la sala. Intenta de nuevo.");
      }
    });

    let salasAlSalir: string[] = [];
    socket.on("disconnecting", () => {
      salasAlSalir = [...socket.rooms].filter((id) => id !== socket.id);
    });
    socket.on("disconnect", () => {
      const nombre = socket.data.nombre as string | undefined;
      salasAlSalir.forEach((id) =>
        notificarPresencia(id, nombre && !uidEnSala(id, uid) ? { tipo: "salio", nombre } : undefined),
      );
    });
  });
}