import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { Server } from "socket.io";

const app = express();
const projectId = process.env.FIREBASE_PROJECT_ID;
if (!projectId) {
  throw new Error("Falta configurar FIREBASE_PROJECT_ID");
}

const firebase = initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth(firebase);
const db = getFirestore(firebase);
const allowedOrigins = (process.env.CLIENT_ORIGINS ??
  "http://localhost:5173,http://localhost:8080,https://frontend-mp2-delta.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createServer(app);
const io = new Server(server, { cors: { origin: allowedOrigins } });
const rooms = db.collection("rooms");

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

type Respuesta = (resultado: { ok: boolean; error?: string; data?: object }) => void;

io.on("connection", (socket) => {
  const uid = socket.data.uid as string;
  const perfil = db.collection("users").doc(uid);
  const responder = (ack: unknown, error?: string, data?: object) => {
    if (typeof ack === "function") (ack as Respuesta)({ ok: !error, ...(error && { error }), ...(data && { data }) });
  };
  const estaVigente = () => Date.now() < socket.data.exp * 1000;
  const idValido = (id: unknown): id is string => typeof id === "string" && /^[a-zA-Z0-9]{20}$/.test(id);
  const notificarPresencia = (id: string) => {
    const cantidad = new Set(
      [...(io.sockets.adapter.rooms.get(id) ?? [])].map((sid) => io.sockets.sockets.get(sid)?.data.uid),
    ).size;
    io.to(id).emit("sala:presencia", { id, cantidad });
  };

  socket.on("sala:unir", async (id: unknown, ack: unknown) => {
    if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
    if (!idValido(id)) return responder(ack, "El ID de sala no es válido.");
    try {
      const [sala, usuario] = await db.getAll(rooms.doc(id), perfil);
      if (!sala.exists || sala.get("eliminando")) return responder(ack, "La sala no existe.");
      if (!usuario.exists || usuario.get("eliminando")) return responder(ack, "Completa tu perfil para entrar.");
      if (!socket.connected) return;
      await socket.join(id);
      notificarPresencia(id);
      responder(ack, undefined, {
        id, nombre: sala.get("nombre"),
        rol: sala.get("propietarioUid") === uid ? "administrador" : "participante",
      });
    } catch (error) {
      console.error("No se pudo unir a la sala", (error as { code?: string }).code);
      responder(ack, "No pudimos abrir la sala. Intenta de nuevo.");
    }
  });

  socket.on("sala:salir", async (id: unknown, ack: unknown) => {
    if (!idValido(id)) return responder(ack, "El ID de sala no es válido.");
    await socket.leave(id);
    notificarPresencia(id);
    responder(ack);
  });

  socket.on("chat:enviar", async (entrada: unknown, ack: unknown) => {
    if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
    const { id, texto } = (entrada ?? {}) as { id?: unknown; texto?: unknown };
    if (!idValido(id) || !socket.rooms.has(id)) return responder(ack, "Primero entra a la sala.");
    const contenido = typeof texto === "string" ? texto.trim() : "";
    if (!contenido || contenido.length > 2000) return responder(ack, "Escribe un mensaje de hasta 2000 caracteres.");
    const salaRef = rooms.doc(id);
    const mensajeRef = salaRef.collection("messages").doc();
    try {
      const autor = await db.runTransaction(async (t) => {
        const [sala, usuario] = await t.getAll(salaRef, perfil);
        if (!sala.exists || sala.get("eliminando") || !usuario.exists || usuario.get("eliminando")) {
          return null;
        }
        const nombre = usuario.get("username") as string;
        t.create(mensajeRef, {
          texto: contenido, autor: nombre, autorUid: uid, creadoEn: FieldValue.serverTimestamp(),
        });
        return nombre;
      });
      if (autor === null) return responder(ack, "La sala o el perfil ya no están disponibles.");
      socket.to(id).emit("chat:mensaje", { id: mensajeRef.id, salaId: id, autor, texto: contenido });
      responder(ack);
    } catch (error) {
      console.error("No se pudo enviar el mensaje", (error as { code?: string }).code);
      responder(ack, "No pudimos enviar el mensaje. Intenta de nuevo.");
    }
  });

  socket.on("sala:actualizar", async (entrada: unknown, ack: unknown) => {
    if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
    const { id, nombre } = (entrada ?? {}) as { id?: unknown; nombre?: unknown };
    const valor = typeof nombre === "string" ? nombre.trim() : "";
    if (!idValido(id) || !valor || Array.from(valor).length > 80) {
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
      io.to(id).emit("sala:actualizada", { id, nombre: valor });
      responder(ack);
    } catch (error) {
      console.error("No se pudo actualizar la sala", (error as { code?: string }).code);
      responder(ack, "No pudimos actualizar la sala. Intenta de nuevo.");
    }
  });

  socket.on("sala:eliminar", async (id: unknown, ack: unknown) => {
    if (!estaVigente()) return responder(ack, "La sesión expiró. Vuelve a conectarte.");
    if (!idValido(id)) return responder(ack, "El ID de sala no es válido.");
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
      io.to(id).emit("sala:eliminada", { id });
      io.in(id).socketsLeave(id);
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
  socket.on("disconnect", () => salasAlSalir.forEach(notificarPresencia));
});

app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend Realtime funcionando correctamente",
  });
});

server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Servidor Realtime ejecutándose en el puerto ${PORT}`);
});
