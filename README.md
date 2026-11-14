# Backend Realtime

Servicio Socket.IO del Mini Proyecto 2. Usa el mismo proyecto Firebase que
Backend API. GET / comprueba que el proceso esté disponible.

## Configuración

Configura FIREBASE_PROJECT_ID, GOOGLE_APPLICATION_CREDENTIALS y CLIENT_ORIGINS
según .env.example. CLIENT_ORIGINS admite una lista de orígenes separados por
comas. PORT vale 3001 por defecto. En Render, monta la credencial como Secret
File y apunta GOOGLE_APPLICATION_CREDENTIALS a su ruta. La identidad de servicio
necesita acceso a Firestore y permiso para consultar usuarios de Firebase Auth
para comprobar la revocación de sesiones.

Para desarrollo, ejecuta npm ci y npm run dev. Para levantar Realtime en
contenedor, ejecuta docker compose up --build. Los cambios del sprint se publican
desde el Dockerfile tras integrar el PR.

## Contrato de Socket.IO

El cliente conecta enviando el ID token de Firebase en auth.token. Un token
ausente, inválido, revocado o expirado recibe connect_error.

| Evento | Entrada | Resultado |
| --- | --- | --- |
| sala:unir | ID de sala | Confirma ingreso y devuelve nombre y rol |
| sala:salir | ID de sala | Confirma la salida |
| sala:actualizar | { id, nombre } | El propietario cambia el nombre |
| sala:eliminar | ID de sala | El propietario elimina sala y chat |
| chat:enviar | { id, texto } | Persiste el mensaje y lo entrega al resto de la sala |

Los eventos aceptan un callback que recibe { ok, data?, error? }. El servidor
emite sala:presencia con { id, cantidad }, sala:actualizada con { id, nombre },
sala:eliminada con { id } y chat:mensaje con { id, salaId, autor, texto }.

Las salas se crean y se listan por REST en /api/salas. Firestore almacena las
salas en rooms y el chat en rooms/{id}/messages. Una sala en eliminación
rechaza nuevas entradas y mensajes. El borrado de cuenta quita las salas
propias y, en salas ajenas, conserva el texto y sustituye el autor por
«Cuenta eliminada», eliminando el UID de los documentos de mensaje.

## Docker Compose para los tres servicios

Clona frontend, backend-api y backend-realtime en el mismo directorio. Crea
los .env de los tres a partir de sus ejemplos. Usa la misma ruta absoluta
de credenciales de servidor para los dos backends, y configura las variables
VITE_FIREBASE_* públicas del SDK web en el .env del frontend. Desde este
repositorio, ejecuta:

    docker compose --env-file .env --env-file ../frontend/.env -f docker-compose.full.yml up --build

El frontend abre en http://localhost:8080, la API en http://localhost:3000 y
Realtime en http://localhost:3001.
