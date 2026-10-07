require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Game, GameError, createInitialState } = require('./game');

const PHASE_LABELS = { waiting: 'Sala de espera', day: 'Día', roundtable: 'Mesa redonda', night: 'Noche', gameover: 'Fin del juego' };

const PORT = process.env.PORT || 4000;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'admin123';
const JWT_SECRET = process.env.JWT_SECRET || 'traitors-dev-secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET no definido: usando un secreto de desarrollo');
if (!process.env.MASTER_PASSWORD) console.warn('⚠️  MASTER_PASSWORD no definido: usando "admin123"');

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// ---------- Persistencia ----------
// Todo el estado vive en un único documento: es pequeño y así se guarda de forma atómica.

const GameModel = mongoose.model('Game', new mongoose.Schema({
    gameId: { type: String, unique: true },
    state: mongoose.Schema.Types.Mixed,
    lastUpdated: Date
}, { minimize: false }));

mongoose.set('bufferCommands', false); // si no hay BD, fallar rápido en vez de colgarse

let game = new Game();
let saving = false;
let saveQueued = false;

async function persist() {
    if (mongoose.connection.readyState !== 1) return;
    if (saving) { saveQueued = true; return; }
    saving = true;
    try {
        await GameModel.updateOne(
            { gameId: 'current' },
            { state: game.state, lastUpdated: new Date() },
            { upsert: true }
        );
    } catch (err) {
        console.error('Error guardando el estado:', err.message);
    } finally {
        saving = false;
        if (saveQueued) { saveQueued = false; persist(); }
    }
}

async function loadState() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/traidores';
    try {
        await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
        console.log('Conectado a MongoDB');
        const doc = await GameModel.findOne({ gameId: 'current' }).lean();
        if (doc && doc.state) {
            game = new Game(doc.state);
            console.log(`Partida restaurada (fase: ${game.state.phase}, día: ${game.state.gameDay})`);
        }
    } catch (err) {
        console.error('No se pudo conectar a MongoDB, la partida solo se guardará en memoria:', err.message);
    }
}

// ---------- Difusión de estado ----------

function broadcast() {
    syncDeadChat();
    io.emit('state', game.publicView());
    game.state.players.forEach(p => io.to(p.id).emit('private', game.privateView(p.id)));
    io.to('master').emit('master-state', game.masterView());
    persist();
}

function sendPrivateChat(socket, playerId) {
    const p = game.getPlayer(playerId);
    socket.emit('chat-history', {
        general: game.state.chat.general,
        traitors: p && p.role === 'traidor' ? game.state.chat.traitors : [],
        dead: p && !p.alive ? game.state.chat.dead : []
    });
}

// Al morir, el jugador recibe en todos sus dispositivos el historial del chat de muertos
let knownDead = new Set();
function syncDeadChat() {
    const dead = game.state.players.filter(p => !p.alive).map(p => p.id);
    dead.filter(id => !knownDead.has(id)).forEach(id =>
        io.in(id).fetchSockets().then(sockets => sockets.forEach(s => sendPrivateChat(s, id))));
    knownDead = new Set(dead);
}

function signPlayerToken(playerId) {
    return jwt.sign({ pid: playerId }, JWT_SECRET);
}

function bindPlayer(socket, playerId) {
    socket.data.playerId = playerId;
    // Una sala por jugador: funciona con varias pestañas/dispositivos y sobrevive a reconexiones
    socket.join(playerId);
    socket.emit('session', { playerId, token: signPlayerToken(playerId) });
    socket.emit('state', game.publicView());
    socket.emit('private', game.privateView(playerId));
    sendPrivateChat(socket, playerId);
}

// Envuelve los manejadores: captura errores del juego y los envía al cliente
function handler(socket, fn, errorEvent = 'game-error') {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (err) {
            if (err instanceof GameError) {
                socket.emit(errorEvent, err.message);
            } else {
                console.error(err);
                socket.emit(errorEvent, 'Error interno del servidor');
            }
        }
    };
}

function requirePlayer(socket) {
    const id = socket.data.playerId;
    if (!id || !game.getPlayer(id)) throw new GameError('No estás en la partida');
    return id;
}

function requireMaster(socket) {
    if (!socket.data.isMaster) throw new GameError('No autorizado');
}

io.on('connection', (socket) => {
    socket.emit('state', game.publicView());

    // ----- Jugadores -----

    socket.on('auth', handler(socket, ({ token } = {}) => {
        try {
            const { pid } = jwt.verify(token, JWT_SECRET);
            if (game.getPlayer(pid)) {
                bindPlayer(socket, pid);
                return;
            }
        } catch (_) { /* token inválido */ }
        socket.emit('auth-failed');
    }));

    socket.on('join', handler(socket, ({ name, photo } = {}) => {
        if (socket.data.playerId && game.getPlayer(socket.data.playerId)) return;
        const player = game.addPlayer({ name, photo });
        bindPlayer(socket, player.id);
        broadcast();
    }));

    socket.on('vote', handler(socket, (targetId) => {
        const id = requirePlayer(socket);
        const resolved = game.vote(id, targetId);
        if (resolved) announceVoteResult();
        broadcast();
    }));

    socket.on('night-kill', handler(socket, (victimId) => {
        const id = requirePlayer(socket);
        const victim = game.nightKill(id, victimId);
        const by = game.getPlayer(id).name;
        game.aliveTraitors().forEach(t =>
            io.to(t.id).emit('notice', `${by} ha elegido a ${victim.name} como víctima de esta noche`));
        broadcast();
    }));

    socket.on('invite-player', handler(socket, (targetId) => {
        const id = requirePlayer(socket);
        const target = game.invite(id, targetId);
        io.to(target.id).emit('notice', '¡Has recibido una invitación secreta para unirte a los traidores!');
        game.aliveTraitors().forEach(t => io.to(t.id).emit('notice', `Invitación enviada a ${target.name}`));
        broadcast();
    }));

    socket.on('respond-invitation', handler(socket, (accept) => {
        const id = requirePlayer(socket);
        const player = game.respondInvitation(id, !!accept);
        const msg = accept ? `${player.name} ha aceptado unirse a los traidores` : 'El jugador ha rechazado la invitación';
        game.aliveTraitors().filter(t => t.id !== id).forEach(t => io.to(t.id).emit('notice', msg));
        if (accept) {
            // El nuevo traidor recibe el historial del chat secreto en todos sus dispositivos
            io.in(id).fetchSockets().then(sockets => sockets.forEach(s => sendPrivateChat(s, id)));
        }
        broadcast();
    }));

    socket.on('chat', handler(socket, ({ message, channel } = {}) => {
        const id = requirePlayer(socket);
        const msg = game.addChat(id, channel, message);
        if (msg.channel === 'traitors') {
            game.state.players.filter(p => p.role === 'traidor').forEach(p => io.to(p.id).emit('chat', msg));
        } else if (msg.channel === 'dead') {
            game.state.players.filter(p => !p.alive).forEach(p => io.to(p.id).emit('chat', msg));
        } else {
            io.emit('chat', msg);
        }
        persist();
    }));

    socket.on('logout', () => {
        if (socket.data.playerId) socket.leave(socket.data.playerId);
        socket.data.playerId = null;
    });

    // ----- Maestro de Ceremonias -----

    const masterOk = () => {
        socket.data.isMaster = true;
        socket.join('master');
        socket.emit('master-auth', { ok: true, token: jwt.sign({ master: true }, JWT_SECRET, { expiresIn: '7d' }) });
        socket.emit('master-state', game.masterView());
    };

    socket.on('master-login', (password) => {
        if (typeof password === 'string' && password === MASTER_PASSWORD) masterOk();
        else socket.emit('master-auth', { ok: false, error: 'Contraseña incorrecta' });
    });

    socket.on('master-token', (token) => {
        try {
            if (jwt.verify(token, JWT_SECRET).master) return masterOk();
        } catch (_) { /* token caducado o inválido */ }
        socket.emit('master-auth', { ok: false });
    });

    const master = (fn) => handler(socket, (...args) => { requireMaster(socket); return fn(...args); }, 'master-error');

    socket.on('master-advance', master(() => {
        const before = game.state.phase;
        game.advance();
        const s = game.state;
        if (before === 'waiting') {
            io.emit('notice', '¡La partida ha comenzado! Mira tu rol.');
        } else if (before === 'roundtable') {
            announceVoteResult();
        } else if (before === 'night') {
            const victim = s.lastNightVictim && game.getPlayer(s.lastNightVictim);
            io.emit('notice', victim
                ? `Amanece el día ${s.gameDay}. ${victim.name} ha sido asesinado esta noche.`
                : `Amanece el día ${s.gameDay}. Esta noche no ha habido asesinato.`);
        }
        if (s.phase === 'gameover') io.emit('notice', `Fin del juego: ganan los ${s.winner}`);
        socket.emit('master-message', `${PHASE_LABELS[s.phase]} · Día ${s.gameDay}`);
        broadcast();
    }));

    socket.on('master-kick-player', master((playerId) => {
        game.removePlayer(playerId);
        io.to(playerId).emit('auth-failed');
        broadcast();
    }));

    socket.on('master-start-test', master(({ testName, players } = {}) => {
        const test = game.startTest(testName, players);
        test.players.forEach(id => io.to(id).emit('notice', `¡Has sido seleccionado para la prueba: ${test.name}!`));
        socket.emit('master-message', `Prueba "${test.name}" iniciada`);
        broadcast();
    }));

    socket.on('master-end-test', master((testId) => {
        game.endTest(testId);
        broadcast();
    }));

    socket.on('master-add-points', master(({ players, points } = {}) => {
        const result = game.addPoints(players, points);
        result.players.forEach(p => io.to(p.id).emit('notice',
            result.points > 0 ? `¡Has ganado ${result.points} puntos!` : `Has perdido ${-result.points} puntos`));
        socket.emit('master-message', 'Puntos asignados');
        broadcast();
    }));

    socket.on('master-set-conclave-override', master((value) => {
        game.state.ignoreConclaveHours = !!value;
        broadcast();
    }));

    socket.on('master-reset-game', master(() => {
        game = new Game(createInitialState());
        io.emit('game-reset');
        socket.emit('master-message', 'Juego reiniciado');
        broadcast();
    }));
});

function announceVoteResult() {
    const r = game.state.lastVoteResult;
    if (!r) return;
    if (r.expelledId) {
        const p = game.getPlayer(r.expelledId);
        io.emit('notice', `${p.name} ha sido desterrado. Era ${p.role === 'traidor' ? 'TRAIDOR' : 'FIEL'}.`);
    } else if (r.tie) {
        io.emit('notice', 'Empate en la votación. No se destierra a nadie.');
    } else {
        io.emit('notice', 'Nadie ha votado. No se destierra a nadie.');
    }
}

// El cónclave abre y cierra por horario: avisar a los clientes cuando cambie
let lastConclaveOpen = game.conclaveOpen();
setInterval(() => {
    const open = game.conclaveOpen();
    if (open !== lastConclaveOpen) {
        lastConclaveOpen = open;
        broadcast();
    }
}, 30 * 1000);

// ---------- HTTP ----------

app.get('/health', (_req, res) => res.json({ ok: true, phase: game.state.phase, db: mongoose.connection.readyState === 1 }));

// En producción el backend sirve también el frontend compilado (mismo origen = sin problemas de CORS en móviles)
const buildDir = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(buildDir)) {
    app.use(express.static(buildDir));
    app.get('*', (_req, res) => res.sendFile(path.join(buildDir, 'index.html')));
}

loadState().then(() => {
    server.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
});
