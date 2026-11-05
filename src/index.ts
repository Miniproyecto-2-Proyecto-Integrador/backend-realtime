import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

app.get("/", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "Backend Realtime funcionando correctamente",
  });
});

app.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Servidor Realtime ejecutándose en el puerto ${PORT}`);
});