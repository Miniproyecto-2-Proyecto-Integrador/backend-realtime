Backend Realtime – Mini Proyecto 2

Servicio backend encargado de proporcionar la infraestructura de comunicación en tiempo real para el sistema de salas de estudio colaborativas del Mini Proyecto 2 de Proyecto Integrador.

Este servicio se desarrolla de manera independiente al Backend API, permitiendo separar las operaciones REST y el acceso a datos de los mecanismos de comunicación en tiempo real.

Tecnologías

Node.js 24

TypeScript

Express

Socket.IO

Docker y Docker Compose

Render

Responsabilidades

El servicio está destinado a gestionar las funcionalidades de comunicación en tiempo real del sistema, entre ellas:

Comunicación entre usuarios dentro de las salas de estudio.

Intercambio de eventos en tiempo real.

Soporte para la futura implementación de señalización WebRTC.

Gestión de conexiones de los clientes.

La implementación de estas funcionalidades se realizará progresivamente durante las siguientes sprints.

Estructura del proyecto

backend-realtime/
├── src/
│   └── index.ts
├── .dockerignore
├── .env.example
├── .gitignore
├── Dockerfile
├── docker-compose.yml
├── package.json
├── package-lock.json
└── tsconfig.json

Requisitos previos

Node.js 24 o compatible.

npm.

Docker Desktop, para ejecutar el servicio en contenedor.

Instalación y ejecución local

Clonar el repositorio:

git clone https://github.com/Miniproyecto-2-Proyecto-Integrador/backend-realtime.git
cd backend-realtime

Instalar las dependencias:

npm ci

Crear el archivo .env tomando como referencia .env.example:

PORT=3001

Iniciar el servidor en desarrollo:

npm run dev

El servicio estará disponible en:

http://localhost:3001

Variables de entorno

Variable

Descripción

PORT

Puerto en el que se ejecuta el servidor.

Si no se especifica un puerto, el servicio utiliza el puerto 3001 por defecto.

Endpoint disponible

Método

Ruta

Descripción

GET

/

Verifica que el servicio esté funcionando.

Ejemplo de respuesta

{
  "success": true,
  "message": "Backend Realtime funcionando correctamente"
}

Este endpoint permite comprobar la disponibilidad básica del servicio.

Construcción y ejecución con Docker

El proyecto utiliza Docker multi-stage para separar la compilación TypeScript de la ejecución de producción.

Para construir y levantar el servicio:

docker compose up --build -d

Para verificar el estado del contenedor:

docker ps

Para consultar los registros:

docker compose logs -f

Para detener el servicio:

docker compose down

Docker Compose construye y ejecuta únicamente el servicio Backend Realtime, utilizando el puerto 3001.

Despliegue en Render

El servicio Backend Realtime se encuentra desplegado en Render mediante Docker.

La configuración utiliza el Dockerfile del repositorio y el puerto proporcionado por la variable de entorno PORT.

URL del servicio:

https://backend-realtime-enj6.onrender.com

Pruebas locales

Para verificar que el servidor responde correctamente, acceder a:

http://localhost:3001/

También se puede comprobar la compilación TypeScript mediante:

npm run build

Consideraciones de arquitectura

Este servicio mantiene una separación respecto al Backend API:

Backend API: gestiona las solicitudes REST y el acceso a Firestore.

Backend Realtime: proporciona la infraestructura para las comunicaciones en tiempo real.

Aunque Socket.IO forma parte de las dependencias del proyecto, sus funcionalidades de comunicación todavía no están implementadas en el servidor actual y se desarrollarán progresivamente durante las siguientes sprints.

La señalización para WebRTC también se incorporará posteriormente, de acuerdo con la planificación del proyecto.

Consideraciones de seguridad

No subir archivos .env al repositorio.

No almacenar credenciales sensibles en el código fuente.

Mantener .env.example sin información privada.

Excluir variables locales y archivos sensibles mediante .gitignore y .dockerignore.

Validar las conexiones y los eventos de los clientes cuando se implementen las funcionalidades de comunicación.

Estado del servicio

La arquitectura base del Backend Realtime se encuentra configurada. Actualmente cuenta con un servidor Express, endpoint de verificación, compilación TypeScript y ejecución mediante Docker y Docker Compose.

Las funcionalidades de comunicación en tiempo real y señalización se desarrollarán durante las siguientes sprints.