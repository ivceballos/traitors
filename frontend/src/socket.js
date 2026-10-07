import { io } from 'socket.io-client';

// En desarrollo el backend corre en el puerto 4000 de la misma máquina; usar el
// hostname actual (no "localhost") permite jugar desde el móvil en la misma red.
// En producción el backend sirve el frontend, así que basta con el mismo origen.
const SERVER_URL = process.env.REACT_APP_SERVER_URL ||
    (process.env.NODE_ENV === 'development'
        ? `${window.location.protocol}//${window.location.hostname}:4000`
        : window.location.origin);

export const socket = io(SERVER_URL);

export const storage = {
    get(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(key, value); } catch (_) { /* modo privado */ }
    },
    remove(key) {
        try { localStorage.removeItem(key); } catch (_) { /* modo privado */ }
    }
};

export const PHASE_LABELS = {
    waiting: 'Sala de espera',
    day: 'Día',
    roundtable: 'Mesa redonda',
    night: 'Noche',
    gameover: 'Fin del juego'
};
