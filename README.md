# Traitors - El Juego

Juego web multijugador inspirado en el reality show "Traitors España".

## 🎮 Características

- Juego multijugador en tiempo real
- Roles secretos (traidores y fieles)
- Duración de 4 días
- Sistema de invitación anónima a nuevos traidores
- Chat general y privado para traidores
- Sistema de pruebas y puntuaciones
- Panel de control para el Maestro de Ceremonias
- Cónclave nocturno (22:30-3:00)
- Persistencia de sesiones (reconexión automática)

## 🎯 Reglas del Juego

### Estructura General
- El juego dura 4 días y el **Maestro de Ceremonias (MC)** controla el ritmo: empieza la partida y avanza cada fase desde su panel
- Se necesitan mínimo 4 jugadores
- Traidores iniciales: 2 (1 si hay menos de 6 jugadores, para que la partida no termine al instante)
- Los roles solo se revelan al ser eliminado o al terminar la partida

### Fases de cada día
| Día | Fases |
|-----|-------|
| 1 | Día (presentaciones) → Noche: los traidores pueden invitar en secreto a un fiel. Sin mesa redonda ni asesinato |
| 2-3 | Día (se revela la víctima de la noche) → Mesa redonda (votación) → Noche (asesinato) |
| 4 | Día → Mesa redonda → Fin del juego |

- **Mesa redonda:** todos los vivos votan; se cierra sola cuando han votado todos (o la cierra el MC). En caso de empate no se destierra a nadie
- **Cónclave nocturno:** las acciones y el chat secreto de los traidores solo están disponibles de 22:30 a 3:00 (hora de `GAME_TIMEZONE`, por defecto Madrid). El MC puede abrirlo fuera de horario
- La invitación se bloquea si dejaría a los traidores igualados con los fieles (victoria automática)

### Fin del Juego
- Los Fieles ganan si eliminan a todos los Traidores
- Los Traidores ganan si igualan o superan en número a los Fieles
- Si al terminar el día 4 queda algún Traidor vivo, ganan los Traidores

## 🛠️ Instalación

### Requisitos Previos
- Node.js 18 o superior
- MongoDB (opcional: sin él la partida funciona, pero solo se guarda en memoria)

### Backend
```bash
cd backend
npm install
cp .env.example .env   # y edita los valores
npm start
npm test               # pruebas de la lógica del juego
```

### Frontend (desarrollo)
```bash
cd frontend
npm install
npm start
```
En desarrollo el frontend se conecta al puerto 4000 de la misma máquina, así que desde el móvil basta con abrir `http://IP-DEL-PC:3000` estando en la misma red wifi. Para otro servidor, define `REACT_APP_SERVER_URL`.

### Producción
```bash
cd frontend && npm run build
cd ../backend && npm start
```
El backend sirve el frontend compilado: todo funciona en un único puerto (`http://servidor:4000`).

## 🚀 Uso

### Para Jugadores
- Abre la web, introduce tu nombre (y una URL de foto opcional) y espera a que el MC comience
- **Varios dispositivos:** en la partida, pulsa «Jugar también desde otro dispositivo» y abre ese enlace en tu móvil, portátil… (no lo compartas: revela tu rol)

### Para el Maestro de Ceremonias
- Abre `/master` e introduce la contraseña de MC
- Avanza las fases, gestiona pruebas y puntos (también negativos), y quita jugadores antes de empezar

## 🔒 Persistencia y Reconexión

- Cada jugador tiene una identidad estable (no ligada a la conexión): recargar, perder la red o bloquear el móvil no le saca de la partida
- El estado completo se guarda en MongoDB y se restaura si el servidor se reinicia
- La sesión del MC también se recuerda en el navegador
