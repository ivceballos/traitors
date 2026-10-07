import { io } from 'socket.io-client';

// Servidores por orden de preferencia. public/config.js puede dar una lista
// (NAS principal y Render de reserva); si está vacía, se usa el de siempre:
// en desarrollo el puerto 4000 de la misma máquina (el hostname actual permite
// probar desde el móvil en la misma red) y en producción el mismo origen.
const configured = (window.FF_SERVERS || []).filter(Boolean).map(s => s.replace(/\/+$/, ''));
const SERVERS = process.env.REACT_APP_SERVER_URL
    ? [process.env.REACT_APP_SERVER_URL]
    : configured.length
        ? configured
        : [process.env.NODE_ENV === 'development'
            ? `${window.location.protocol}//${window.location.hostname}:4000`
            : window.location.origin];

let current = 0;
export const serverUrl = () => SERVERS[current];

export const socket = io(SERVERS[0], { autoConnect: true });

// Si el servidor actual no responde, pasar al siguiente. Comparten la base de datos,
// así que la partida sigue igual; el Manager reabre la conexión con la nueva URI.
function nextServer() {
    if (SERVERS.length < 2) return false;
    current = (current + 1) % SERVERS.length;
    socket.io.uri = SERVERS[current];
    return true;
}

let failures = 0;
socket.on('connect', () => { failures = 0; });
socket.on('connect_error', () => {
    if (++failures >= 2 && nextServer()) failures = 0;
});

// Emite un evento y espera la respuesta del servidor
export function send(event, payload = {}) {
    return new Promise((resolve, reject) => {
        socket.timeout(10000).emit(event, payload, (err, res) => {
            if (err) return reject(new Error('El servidor no responde'));
            if (res && res.error) return reject(new Error(res.error));
            resolve(res || {});
        });
    });
}

export async function http(path, options = {}) {
    let res;
    // Un fallo de red prueba los demás servidores; un error del servidor no
    for (let tries = 0; ; tries++) {
        try {
            res = await fetch(serverUrl() + path, {
                ...options,
                headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
                body: options.body ? JSON.stringify(options.body) : undefined
            });
            break;
        } catch (err) {
            if (tries + 1 >= SERVERS.length || !nextServer()) throw new Error('El servidor no responde');
        }
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de conexión');
    return data;
}

export const photoSrc = url => (url ? serverUrl() + url : null);

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

export const playerTokenKey = code => `player:${code}`;
export const mcTokenKey = code => `mc:${code}`;

// Reduce la foto en el móvil antes de enviarla (≈ 30 KB en vez de varios MB)
export function resizePhoto(file, size = 360) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const scale = size / Math.min(img.width, img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            canvas.getContext('2d').drawImage(img, (size - w) / 2, (size - h) / 2, w, h); // recorte cuadrado centrado
            URL.revokeObjectURL(img.src);
            resolve(canvas.toDataURL('image/jpeg', 0.82));
        };
        img.onerror = () => reject(new Error('No se pudo leer la imagen'));
        img.src = URL.createObjectURL(file);
    });
}

export const PHASES = {
    lobby: 'Sala de espera',
    day: 'Día',
    roundtable: 'Mesa redonda',
    night: 'Noche',
    end: 'Fin de la partida'
};

export const formatGold = (gold, perEuro = 100) =>
    `${Math.round(gold).toLocaleString('es-ES')} oro`;

export const formatEuros = (gold, perEuro = 100) =>
    (gold / perEuro).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

export const roleLabel = (role, factions) => (role === 'traitor' ? factions.traitor : factions.loyal);
