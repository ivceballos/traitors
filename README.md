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
- El juego dura exactamente 4 días
- Se necesitan mínimo 4 jugadores para empezar
- Los jugadores pueden ser Fieles o Traidores

### Primer Día
1. Se seleccionan aleatoriamente 2 traidores
2. Los traidores pueden invitar a un fiel a unirse (invitación anónima)
3. No hay mesa de deliberación
4. No hay asesinatos

### Días Siguientes (2-4)
1. Hay mesa de deliberación donde todos votan
2. Los traidores pueden matar a un fiel cada noche
3. El cónclave nocturno solo está disponible de 22:30 a 3:00

### Fin del Juego
- Los Fieles ganan si eliminan a todos los Traidores
- Los Traidores ganan si igualan o superan en número a los Fieles
- Si se llega al final del día 4, los Fieles ganan si queda algún Traidor

## 🛠️ Instalación

### Requisitos Previos
- Node.js (v14 o superior)
- MongoDB
- npm o yarn

### Backend
```bash
cd backend
npm install
```

Crear archivo .env con las siguientes variables:

```
MONGODB_URI=tu_url_de_mongodb
JWT_SECRET=tu_clave_secreta
MASTER_PASSWORD=contraseña_del_mc
PORT=4000
```

Iniciar el servidor:

```bash
npm start
```

### Frontend
```bash
cd frontend
npm install
npm start
```

## 🚀 Uso

### Para Jugadores
- Acceder a http://localhost:3000
- Introducir nombre y foto (opcional)
- Esperar a que haya suficientes jugadores
- Jugar según las instrucciones en pantalla

### Para el Maestro de Ceremonias
- Acceder a http://localhost:3000/master
- Introducir la contraseña de MC
- Gestionar pruebas y puntuaciones
- Supervisar el desarrollo del juego

## 🔒 Persistencia y Reconexión

El juego implementa un sistema de persistencia que permite:

- Reconexión automática si se cierra o recarga la página
- Recuperación del estado del juego si el servidor se reinicia
- Mantener las sesiones activas entre dispositivos

## 👥 Contribución
1. Fork el repositorio
2. Crea una rama para tu feature (git checkout -b feature/AmazingFeature)
3. Commit tus cambios (git commit -m 'Add some AmazingFeature')
4. Push a la rama (git push origin feature/AmazingFeature)
5. Abre un Pull Request

## 📝 Licencia

Distribuido bajo la Licencia MIT. Ver LICENSE para más información.
