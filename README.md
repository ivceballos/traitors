# Traidores App (Prototipo)

Juego web inspirado en el reality "Traitors España".  
Permite jugar en grupo, con roles secretos, chat y votaciones.

## Estructura

- `backend/`: Servidor Node.js con Socket.io
- `frontend/`: App React para los jugadores

## Cómo ejecutar

### 1. Backend

```bash
cd backend
npm install
node server.js
```

El backend quedará en http://localhost:4000

### 2. Frontend

```bash
cd frontend
npm install
npm start
```

El frontend abrirá en http://localhost:3000

### 3. Jugar

Abre http://localhost:3000 en varios navegadores o dispositivos (en la misma red) para simular varios jugadores.

## Notas

- Todo el estado se guarda en memoria (si reinicias el backend, se pierde la partida).
- Puedes personalizar la lógica y la interfaz a tu gusto.
