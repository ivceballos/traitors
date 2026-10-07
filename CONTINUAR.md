# Cómo seguir: estado del proyecto «Fieles y Felones»

Documento de traspaso para continuar en local. Rama de trabajo: `claude/repos-multi-device-access-ortq9f`.

## Qué es

Web app del juego de traición «Fieles y Felones» (inspirado en *Traitors*) para viajes con amigos. Sustituye a lo que se usó en la primera partida (julio 2025, 12 jugadores): Google Sheets con Apps Script, WhatsApp y una MC remota a la que había que conectar a mano. En la app no debe aparecer «Despedida de Adrián» en ningún sitio.

- Backend: Node, Express y Socket.IO (`backend/`). El motor del juego es puro, está en `backend/game.js` y lo prueba `backend/game.test.js` (`npm test`, 26 tests).
- Frontend: React con CRA (`frontend/`). Rutas: `/` (portada), `/crear`, `/p/CÓDIGO` (jugador), `/mc/CÓDIGO` (MC), `/tv/CÓDIGO` (tele).
- Persistencia: MongoDB opcional (`MONGODB_URI`). Sin ella, las partidas viven solo en memoria.

## Decisiones de Iván (no reabrir)

- Salas con código, MC humano (presente o remoto) y solo el MC marca el ritmo.
- Votación configurable: en la app o en persona.
- Si al final del último día queda algún Felón vivo, ganan los Felones.
- Estética: castillo nocturno azulado, antorchas y encapuchados. Títulos en IM Fell English, texto en Geist.
- Colores: rojo para los Felones y lo irreversible, marfil para los Fieles, dorado para la marca y el oro.
- Logo F&F dorado con la serpiente como «&». Las imágenes están en la carpeta de Drive «FIELES Y FELONES» (`D:\TRABAJO\FIELES Y FELONES`).
- Sociedad Secreta de los Fantasmas: la conocen solo los muertos y se revela al final. Su objetivo puede ser de cualquier bando, como propuso el concilio (decidido el 7/10/2026).

## Hecho (todo subido)

- Motor configurable: bandos, días, calendario, votación, desempates, cónclave con horario, reclutamiento, pruebas y botín, chats (general, Felones y muertos), mensajes del MC y prueba lanzada a la tele.
- Cambios del concilio de diseño, UX y dinámicas (informe: https://claude.ai/artifact/XQue16QzcsVqNwurzb785R):
  - Botones: primario dorado; lacre rojo que se confirma manteniendo pulsado (`HoldButton`); secundario en contorno; discreto subrayado; desactivado con pista; «Enviando…» y «Reintentar» (`ActionButton`).
  - Secretos: «Mi rol» guarda la carta, los aliados, el cónclave y el chat de los Felones. De noche todos señalan a un sospechoso (`suspect`). El MC tiene los roles ocultos por defecto.
  - Fantasmas: objetivo de cualquier bando, umbrales automáticos (8/12/16 con 12 jugadores), solo puntúa la primera votación, votos al objetivo obligatorios en persona y revelación final siempre.
  - Voto bloqueado al confirmarlo. Pantalla del jugador con la acción arriba y pestañas.
  - Tele: Wake Lock, velo, código y QR siempre visibles. Enlace de reentrada por jugador desde el MC.
- Logo nuevo e iconos.
- Ideas tomadas de The Traitors Live (Londres) y The Traitors: Anywhere (WhatsApp), adaptadas (7/10/2026):
  - Preferencia de rol al unirse (Sí / Me da igual / Prefiero que no): papeletas 4 / 1 / 0,25 en el sorteo; nadie queda descartado.
  - Entrevista secreta (3 preguntas al unirse) y prueba «¿Quién dijo qué?»: el MC saca una respuesta, los demás adivinan el autor y cada acierto suma `quizGold` a esa prueba.
  - Escudo: el MC lo da (normalmente a quien gana una prueba) y frena el asesinato de esa noche; los Felones no saben quién lo tiene.
  - Final (`endgame`): tras el último día los supervivientes votan acabar o desterrar a otro; solo se acaba por unanimidad o con 2 vivos.
  - Horario automático (`timetable`): amanecer, mesa y noche a horas fijas; el MC puede avanzar a mano o pausarlo.
  - Modo «A distancia» (`mode: 'online'`): sin Fantasmas y con votación en la app.
  - Tabla de ganadores (`/ranking`): se guarda cada partida terminada (sin bots) en la colección `results`.
  - Jugadores de prueba (bots) desde la sala de espera.
- En `localhost` la app ignora `config.js` y usa siempre el servidor local.

### Actualizar el NAS (comprobado el 7/10/2026)
1. Zip del último commit **sin `docker-compose.yml`** (el del NAS lleva las claves pegadas): `git archive --prefix=fieles-y-felones/` y quitar el compose del zip.
2. File Station → `docker` → subir el zip → Extraer… → Opciones → **Sobrescribir** → Extraer todo (el gestor de contraseñas de Iván bloquea los clics automáticos en este diálogo).
3. Container Manager → Proyecto `fieles-y-felones` → Detener → Acción → **Limpiar** → Imagen `fieles-y-felones-juego` → Eliminar → Proyecto → Acción → **Crear**. Sin borrar la imagen, «Crear» reutiliza la antigua y no recompila.
4. Render: Manual Deploy → Deploy latest commit (está conectado como repositorio público, no se despliega solo).

## En curso: despliegue con NAS principal y Render de reserva

El hosting de Iván (DirectAdmin en srv122.tamainut.net, dominio a-mas-s.es) **solo ejecuta PHP**: no sirve para el servidor, pero sí para alojar la web estática. Tiene un **Synology DS220+** (Intel, Container Manager).

Arquitectura acordada:

```
web estática en el hosting PHP (p. ej. juego.a-mas-s.es)
        │  el móvil prueba primero el NAS y, si falla, Render
   NAS (principal) ── Render gratis (reserva)
        └──── MongoDB Atlas M0 (partida compartida) ────┘
```

### Hecho en esta parte (probado con MongoDB real el 7/10/2026)

`backend/server.js`:
- Cada documento de sala lleva `rev`. `persist()` solo escribe si `rev` coincide. Si hay conflicto, recarga la versión del otro servidor y la reenvía (`refresh`).
- `getRoom()` llama a `syncRoom()` antes de cada acción. No relee mientras haya un guardado propio pendiente.
- Cada 3 s, las salas con alguien conectado comprueban si otro servidor ha guardado y reenvían los cambios.
- `KEEPALIVE_URL`: el NAS llama a Render cada 10 min para que no se duerma.

Sin `MONGODB_URI` todo funciona como antes (comprobado: tests y partida simulada de 12 jugadores). Con MongoDB real y dos servidores: la sala creada en uno se juega en el otro, una sesión de A vale en B, al apagar A el MC y los jugadores siguen en B, y cuando A vuelve trae lo que pasó mientras estaba caído.

Frontend:
- `frontend/public/config.js` define `window.FF_SERVERS` (NAS primero y Render después). Se carga antes del bundle y se puede editar en el hosting sin recompilar. Vacío = mismo origen.
- `frontend/src/api.js`: tras 2 fallos de conexión cambia al siguiente servidor (`socket.io.uri`). `http()` prueba los demás servidores si hay fallo de red, y `photoSrc` usa el servidor actual.
- `frontend/public/.htaccess` para el hosting PHP (rutas de React y `config.js` sin caché). CRA lo copia a `build/`.

Despliegue:
- `render.yaml`: `JWT_SECRET` con `sync: false`; hay que poner **la misma** que en el NAS.
- `Dockerfile` multietapa y `docker-compose.yml`. Se publica con el túnel de Cloudflare que ya corre en el NAS (`cloudflare-cloudflared-tunel`), sin abrir puertos. Claves en `.env` según `.env.nas.example`.
- Dominio del NAS: `fyf-nas.ivceballos.com` (Cloudflare). NAS en `https://ivceballos.quickconnect.to/`.

### Pendiente

1. **Iván:** crear las cuentas de MongoDB Atlas (M0, Network Access 0.0.0.0/0) y Render (New → Blueprint, esta rama).
2. **Cloudflare:** en el túnel que ya existe, añadir el nombre público `fyf-nas.ivceballos.com` → `http://192.168.1.33:4000`.
3. **NAS:** subir el repo a una carpeta compartida, crear el `.env` y montar el proyecto en Container Manager.
4. **Hosting:** subir `frontend/build/` (o elegir dominio para la web).
5. **Ensayo:** una hora con 5 o 6 móviles, el MC a distancia y la tele. Apagar el NAS a propósito a mitad de partida.

## Desarrollo en local

```bash
cd backend && npm install && npm test && npm run dev      # puerto 4000
cd frontend && npm install && npm start                   # puerto 3000, habla con el 4000
```

Variables: ver `backend/.env.example`.
