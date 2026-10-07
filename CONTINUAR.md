# Cómo seguir: estado del proyecto «Fieles y Felones»

Documento de traspaso para continuar en local. Rama de trabajo: `claude/repos-multi-device-access-ortq9f`.

## Qué es

Web app del juego de traición «Fieles y Felones» (inspirado en *Traitors*) para viajes con amigos. Sustituye a lo que se usó en la despedida de Adrián (julio 2025, 12 jugadores): Google Sheets con Apps Script, WhatsApp y una MC remota (Alba) a la que había que conectar a mano.

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
- Sociedad Secreta de los Fantasmas: la conocen solo los muertos y se revela al final.

## Hecho (todo subido)

- Motor configurable: bandos, días, calendario, votación, desempates, cónclave con horario, reclutamiento, pruebas y botín, chats (general, Felones y muertos), mensajes del MC y prueba lanzada a la tele.
- Cambios del concilio de diseño, UX y dinámicas (informe: https://claude.ai/artifact/XQue16QzcsVqNwurzb785R):
  - Botones: primario dorado; lacre rojo que se confirma manteniendo pulsado (`HoldButton`); secundario en contorno; discreto subrayado; desactivado con pista; «Enviando…» y «Reintentar» (`ActionButton`).
  - Secretos: «Mi rol» guarda la carta, los aliados, el cónclave y el chat de los Felones. De noche todos señalan a un sospechoso (`suspect`). El MC tiene los roles ocultos por defecto.
  - Fantasmas: objetivo de cualquier bando, umbrales automáticos (8/12/16 en la despedida), solo puntúa la primera votación, votos al objetivo obligatorios en persona y revelación final siempre.
  - Voto bloqueado al confirmarlo. Pantalla del jugador con la acción arriba y pestañas.
  - Tele: Wake Lock, velo, código y QR siempre visibles. Enlace de reentrada por jugador desde el MC.
- Logo nuevo e iconos.

## En curso: despliegue con NAS principal y Render de reserva

El hosting de Iván (DirectAdmin en srv122.tamainut.net, dominio a-mas-s.es) **solo ejecuta PHP**: no sirve para el servidor, pero sí para alojar la web estática. Tiene un **Synology DS220+** (Intel, Container Manager).

Arquitectura acordada:

```
web estática en el hosting PHP (p. ej. juego.a-mas-s.es)
        │  el móvil prueba primero el NAS y, si falla, Render
   NAS (principal) ── Render gratis (reserva)
        └──── MongoDB Atlas M0 (partida compartida) ────┘
```

### Hecho en esta parte (sin probar con base de datos real)

`backend/server.js`:
- Cada documento de sala lleva `rev`. `persist()` solo escribe si `rev` coincide. Si hay conflicto, recarga la versión del otro servidor y la reenvía (`refresh`).
- `getRoom()` llama a `syncRoom()` antes de cada acción. No relee mientras haya un guardado propio pendiente.
- Cada 3 s, las salas con alguien conectado comprueban si otro servidor ha guardado y reenvían los cambios.
- `KEEPALIVE_URL`: el NAS llama a Render cada 10 min para que no se duerma.

Sin `MONGODB_URI` todo funciona como antes (comprobado: tests y partida simulada de 12 jugadores).

### Pendiente

1. **Probar la sincronización con MongoDB real.** Dos servidores en puertos distintos con la misma `MONGODB_URI`: crear la sala en uno, jugar en el otro, apagar uno a mitad de partida.
2. **Frontend con servidor de reserva:**
   - `frontend/public/config.js` con `window.FF_SERVERS = ['https://nas…', 'https://fieles-y-felones.onrender.com']`, cargado en `index.html` antes del bundle. Si la lista está vacía, se usa el mismo origen (comportamiento actual).
   - En `frontend/src/api.js`, tras 2 fallos de conexión, cambiar al siguiente servidor con `socket.io.uri = siguiente` (el Manager vuelve a abrir con la nueva URI). `http()` y `photoSrc` deben usar el servidor actual, no una constante.
   - `frontend/public/.htaccess` para que el hosting PHP sirva `index.html` en las rutas `/p/…`, `/mc/…` y `/tv/…`. Comprobar que CRA lo copia a `build/`.
3. **`render.yaml`:** `JWT_SECRET` pasa a `sync: false`, porque tiene que ser **el mismo** en el NAS y en Render; si no, las sesiones no valen en los dos.
4. **NAS:** `Dockerfile` multietapa (compila el frontend y luego el backend) y `docker-compose.yml` con `MONGODB_URI`, `JWT_SECRET`, `KEEPALIVE_URL` y `PORT=4000`. Guía para el DS220+:
   - Container Manager → Proyecto (desde la carpeta del repo).
   - DDNS de Synology (`xxx.synology.me`) con certificado de Let's Encrypt.
   - Proxy inverso: HTTPS 443 → `http://localhost:4000`, con las cabeceras personalizadas de WebSocket.
   - Abrir el puerto 443 en el router hacia el NAS.
   - Ojo: si la operadora usa CG-NAT no se pueden abrir puertos. La alternativa es un contenedor de Cloudflare Tunnel.
5. **Iván:** crear la cuenta de MongoDB Atlas (M0, Network Access 0.0.0.0/0) y la de Render (New → Blueprint, rama de trabajo).
6. **Ensayo:** una hora con 5 o 6 móviles, el MC a distancia y la tele. Apagar el NAS a propósito a mitad de partida.

### Pregunta abierta

El objetivo de los Fantasmas ahora puede ser de cualquier bando (lo recomendó el concilio). En el juego original era siempre un fiel. Iván tiene que confirmar cuál quiere.

## Desarrollo en local

```bash
cd backend && npm install && npm test && npm run dev      # puerto 4000
cd frontend && npm install && npm start                   # puerto 3000, habla con el 4000
```

Variables: ver `backend/.env.example`.
