# Traidores

Juego social de traición para viajes con amigos, inspirado en *Traitors*. Todo pasa en la web: cada jugador usa su móvil, el Maestro de Ceremonias (MC) dirige desde su panel, presente o a distancia, y una tele muestra el estado de la partida.

## Cómo se juega

1. **El MC crea la partida** en `/crear` y elige las reglas del viaje. Recibe un código de 4 letras.
2. **Los jugadores entran** con ese código, se hacen una foto y esperan en la sala.
3. **El MC empieza.** Cada jugador ve su rol en una carta que se gira con un toque.
4. **Cada día** el MC avanza las fases: día, mesa redonda (destierros) y noche (cónclave de los traidores). Las víctimas se revelan al amanecer.
5. **Pruebas:** el MC las lanza a la tele con sus instrucciones y apunta el oro conseguido. El oro forma el botín común (100 de oro = 1 €, configurable).
6. **Fin:** ganan los buenos si eliminan a todos los traidores. Ganan los traidores si igualan en número a los buenos o si sigue vivo alguno al acabar el último día.

### Lo que se configura en cada partida

| Opción | Qué hace |
|---|---|
| Nombres de los bandos | Fieles/Traidores, Fieles/Felones… |
| Número de traidores | Automático (1, 2 o 3 según jugadores) o fijo |
| Calendario | Días y eliminaciones por día en la mesa redonda y en el cónclave |
| Mesa redonda | Votar desde la app (con desempate entre empatados) o en persona y el MC registra |
| Cónclave | Abierto toda la noche o en un horario (por ejemplo 22:30 a 3:00) |
| Reclutamiento | La primera noche los traidores pueden invitar en secreto a un jugador |
| Sociedad Secreta de los Fantasmas | Ver abajo |
| Pruebas | Nombre, instrucciones y oro máximo |

Incluye la plantilla **Fieles y Felones** (12 jugadores, calendario 0 → 1+1 → 2+2 → 1, votación en persona y sus 7 pruebas).

### La Sociedad Secreta de los Fantasmas

Mecánica secreta: nadie la conoce hasta que muere. Cada amanecer los eliminados reciben un objetivo, un jugador bueno elegido al azar. Ganan calaveras por cada voto que reciba en la mesa redonda (1 por voto y 2 más si lo destierran). Con 18, 26 o 33 calaveras roban el 50 %, 75 % o 100 % del botín final. Todo es configurable. Tienen su propio chat y su panel, y la revelación llega en la pantalla final.

## Pantallas

| Ruta | Para quién |
|---|---|
| `/` | Entrar con el código |
| `/crear` | Crear una partida |
| `/p/CÓDIGO` | Jugador. Incluye un enlace para usar la misma sesión en otro dispositivo |
| `/mc/CÓDIGO` | Panel del MC: fases, votos en directo, cónclave, pruebas, chats, mensajes privados y enlaces para compartir |
| `/tv/CÓDIGO` | Tele: jugadores, botín y pruebas a pantalla completa. Nunca muestra roles |

Para sumar un segundo MC, o uno a distancia, basta con enviarle el enlace de MC desde la pestaña *Compartir*.

## Desarrollo

Requisitos: Node.js 18 o superior.

```bash
cd backend && npm install && npm test && npm run dev   # API en :4000
cd frontend && npm install && npm start                 # web en :3000
```

Desde el móvil, en la misma wifi: `http://IP-DEL-PC:3000`. Sin `MONGODB_URI` las partidas se guardan solo en memoria.

## Publicarlo (gratis)

1. Crea una base de datos gratuita en [MongoDB Atlas](https://www.mongodb.com/atlas) y copia su cadena de conexión.
2. En [Render](https://render.com), *New → Blueprint* y elige este repositorio. Render lee `render.yaml`.
3. Pega la cadena de conexión en `MONGODB_URI`. `JWT_SECRET` se genera solo.
4. Opcional: en tu proveedor de dominio crea un `CNAME` (por ejemplo `juego.ivceballos.com`) hacia la dirección de Render y añádelo en *Settings → Custom Domains*.

En el plan gratuito el servidor se duerme tras 15 minutos sin uso y tarda unos 30 segundos en despertar. Las partidas no se pierden porque están en la base de datos.
