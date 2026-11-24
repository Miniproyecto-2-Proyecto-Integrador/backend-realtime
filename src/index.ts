import { registrarEventos } from "./Salas/tiempoReal.js";
import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
const io = new Server(server, {
  cors: { origin: allowedOrigins },
  // Si un cliente pierde la conexión menos de dos minutos, al volver recupera
  // sus salas y los eventos que se perdió.
  connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
});

registrarEventos(io, { auth, db });

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