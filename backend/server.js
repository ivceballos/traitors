require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { Game, GameError, createState, PRESETS, DEFAULT_CONFIG } = require('./game');

const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'traitors-dev-secret';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

if (!process.env.JWT_SECRET) console.warn('⚠️  JWT_SECRET no definido: usando un secreto de desarrollo');

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: '200kb' }));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN }, maxHttpBufferSize: 1e6 });

// ---------- Salas y persistencia ----------
// Cada partida es una sala con código. Se guarda entera en un documento de MongoDB;
// si no hay base de datos, las partidas viven solo en memoria.

const RoomModel = mongoose.model('Room', new mongoose.Schema({
    code: { type: String, unique: true, index: true },
    state: mongoose.Schema.Types.Mixed,
    mcHash: String,
    updatedAt: Date
}, { minimize: false }));

mongoose.set('bufferCommands', false); // sin BD, fallar rápido en vez de colgarse

const rooms = new Map(); // code -> { code, game, mcHash, saving, saveQueued, knownDead }
const dbReady = () => mongoose.connection.readyState === 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
const randomCode = () => Array.from(crypto.randomBytes(4), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return `${salt}:${crypto.scryptSync(password, salt, 32).toString('hex')}`;
}

function checkPassword(password, stored) {
    if (!stored || typeof password !== 'string') return false;
    const [salt, hash] = stored.split(':');
    const candidate = crypto.scryptSync(password, salt, 32);
    return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

function wrapRoom(code, state, mcHash) {
    const room = { code, game: new Game(state), mcHash, saving: false, saveQueued: false, knownDead: null };
    room.knownDead = new Set(room.game.dead().map(p => p.id));
    rooms.set(code, room);
    return room;
}

async function getRoom(rawCode) {
    const code = String(rawCode || '').toUpperCase().trim();
    if (!/^[A-Z0-9]{4}$/.test(code)) return null;
    if (rooms.has(code)) return rooms.get(code);
    if (!dbReady()) return null;
    const doc = await RoomModel.findOne({ code }).lean();
    if (!doc) return null;
    return rooms.get(code) || wrapRoom(code, doc.state, doc.mcHash);
}

async function requireRoom(code) {
    const room = await getRoom(code);
    if (!room) throw new GameError('No existe ninguna partida con ese código');
    return room;
}

async function createRoom({ config, tests, mcPassword }) {
    let code;
    for (let i = 0; i < 20; i++) {
        code = randomCode();
        if (!rooms.has(code) && !(dbReady() && await RoomModel.exists({ code }))) break;
    }
    const password = String(mcPassword || '').trim();
    const room = wrapRoom(code, createState(config, tests), password ? hashPassword(password) : null);
    await persist(room);
    return room;
}

async function persist(room) {
    if (!dbReady()) return;
    if (room.saving) { room.saveQueued = true; return; }
    room.saving = true;
    try {
        await RoomModel.updateOne(
            { code: room.code },
            { state: room.game.state, mcHash: room.mcHash, updatedAt: new Date() },
            { upsert: true }
        );
    } catch (err) {
        console.error(`Error guardando la sala ${room.code}:`, err.message);
    } finally {
        room.saving = false;
        if (room.saveQueued) { room.saveQueued = false; persist(room); }
    }
}

// ---------- Difusión ----------

const pubRoom = code => `${code}:pub`;
const playerRoom = (code, id) => `${code}:p:${id}`;
const mcRoom = code => `${code}:mc`;

function chatHistoryFor(game, playerId) {
    const p = game.getPlayer(playerId);
    const chat = game.state.chat;
    return {
        general: chat.general,
        traitors: p && p.role === 'traitor' ? chat.traitors : [],
        dead: p && !p.alive ? chat.dead : []
    };
}

function broadcast(room) {
    const { code, game } = room;
    io.to(pubRoom(code)).emit('state', game.publicView(code));
    game.state.players.forEach(p => io.to(playerRoom(code, p.id)).emit('private', game.privateView(p.id)));
    io.to(mcRoom(code)).emit('master-state', game.masterView(code));

    // Los recién eliminados reciben el chat de muertos y la bienvenida de los Fantasmas
    game.dead().filter(p => !room.knownDead.has(p.id)).forEach(p => {
        io.to(playerRoom(code, p.id)).emit('chat-history', chatHistoryFor(game, p.id));
        if (game.config.ghosts.enabled) io.to(playerRoom(code, p.id)).emit('ghost-welcome');
    });
    room.knownDead = new Set(game.dead().map(p => p.id));
    persist(room);
}

function emitChat(room, msg) {
    const { code, game } = room;
    io.to(mcRoom(code)).emit('chat', msg);
    if (msg.channel === 'general') {
        io.to(pubRoom(code)).emit('chat', msg);
        return;
    }
    const recipients = msg.channel === 'traitors'
        ? game.state.players.filter(p => p.role === 'traitor')
        : game.dead();
    recipients.forEach(p => io.to(playerRoom(code, p.id)).emit('chat', msg));
}

function notice(room, playerIds, text) {
    playerIds.forEach(id => io.to(playerRoom(room.code, id)).emit('notice', text));
}

const signPlayer = (code, playerId) => jwt.sign({ r: code, p: playerId }, JWT_SECRET);
const signMaster = code => jwt.sign({ r: code, mc: true }, JWT_SECRET);

// ---------- HTTP ----------

app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, db: dbReady() }));

app.get('/api/presets', (_req, res) => res.json({ defaults: DEFAULT_CONFIG, presets: PRESETS }));

const httpHandler = fn => async (req, res) => {
    try {
        res.json(await fn(req));
    } catch (err) {
        if (err instanceof GameError) return res.status(400).json({ error: err.message });
        console.error(err);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};

app.post('/api/rooms', httpHandler(async req => {
    const room = await createRoom(req.body || {});
    return { code: room.code, mcToken: signMaster(room.code) };
}));

app.get('/api/rooms/:code', httpHandler(async req => {
    const room = await requireRoom(req.params.code);
    return { code: room.code, name: room.game.config.name, phase: room.game.state.phase };
}));

// Recuperar el panel del MC desde otro dispositivo con el código y la contraseña
app.post('/api/rooms/:code/mc-login', httpHandler(async req => {
    const room = await requireRoom(req.params.code);
    if (!checkPassword(req.body?.password, room.mcHash)) throw new GameError('Contraseña incorrecta');
    return { mcToken: signMaster(room.code) };
}));

// Las fotos se sirven aparte para no reenviarlas en cada actualización del estado
app.get('/api/rooms/:code/photos/:playerId', async (req, res) => {
    const room = await getRoom(req.params.code).catch(() => null);
    const p = room && room.game.getPlayer(req.params.playerId);
    const match = p && p.photo && p.photo.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!match) return res.status(404).end();
    res.set('Content-Type', match[1]);
    res.set('Cache-Control', 'public, max-age=31536000, immutable'); // la URL lleva ?v=versión
    res.send(Buffer.from(match[2], 'base64'));
});

// ---------- Tiempo real ----------

io.on('connection', (socket) => {
    // Cada socket pertenece a una sola sala; el wrapper valida y devuelve errores por ack
    const on = (event, fn) => socket.on(event, async (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            reply({ ok: true, ...(await fn(payload || {})) });
        } catch (err) {
            if (!(err instanceof GameError)) console.error(err);
            reply({ error: err instanceof GameError ? err.message : 'Error interno del servidor' });
        }
    });

    const currentRoom = async () => {
        if (!socket.data.code) throw new GameError('No estás en ninguna partida');
        return requireRoom(socket.data.code);
    };

    const asPlayer = async () => {
        const room = await currentRoom();
        const id = socket.data.playerId;
        if (!id || !room.game.getPlayer(id)) throw new GameError('No estás en esta partida');
        return { room, game: room.game, id };
    };

    const asMaster = async () => {
        if (!socket.data.isMaster) throw new GameError('Solo el MC puede hacer esto');
        const room = await currentRoom();
        return { room, game: room.game };
    };

    const enterRoom = room => {
        if (socket.data.code && socket.data.code !== room.code) {
            [...socket.rooms].filter(r => r !== socket.id).forEach(r => socket.leave(r));
        }
        socket.data.code = room.code;
        socket.join(pubRoom(room.code));
        socket.emit('state', room.game.publicView(room.code));
    };

    const bindPlayer = (room, playerId) => {
        enterRoom(room);
        socket.data.playerId = playerId;
        // Una sala por jugador: funciona con varios dispositivos y sobrevive a reconexiones
        socket.join(playerRoom(room.code, playerId));
        socket.emit('private', room.game.privateView(playerId));
        socket.emit('chat-history', chatHistoryFor(room.game, playerId));
        return { code: room.code, playerId, token: signPlayer(room.code, playerId) };
    };

    // ----- Entrar -----

    on('tv:watch', async ({ code }) => {
        const room = await requireRoom(code);
        enterRoom(room);
        return { code: room.code };
    });

    on('player:auth', async ({ token }) => {
        let claims;
        try { claims = jwt.verify(token, JWT_SECRET); } catch (_) { throw new GameError('Sesión no válida'); }
        const room = await requireRoom(claims.r);
        if (!room.game.getPlayer(claims.p)) throw new GameError('Ya no formas parte de esta partida');
        return bindPlayer(room, claims.p);
    });

    on('player:join', async ({ code, name, photo }) => {
        const room = await requireRoom(code);
        const player = room.game.addPlayer({ name, photo });
        const session = bindPlayer(room, player.id);
        broadcast(room);
        return session;
    });

    on('mc:auth', async ({ token }) => {
        let claims;
        try { claims = jwt.verify(token, JWT_SECRET); } catch (_) { throw new GameError('Enlace de MC no válido'); }
        if (!claims.mc) throw new GameError('Enlace de MC no válido');
        const room = await requireRoom(claims.r);
        enterRoom(room);
        socket.data.isMaster = true;
        socket.join(mcRoom(room.code));
        socket.emit('master-state', room.game.masterView(room.code));
        socket.emit('chat-history', room.game.state.chat);
        return { code: room.code, hasPassword: !!room.mcHash };
    });

    // ----- Jugadores -----

    on('player:photo', async ({ photo }) => {
        const { room, game, id } = await asPlayer();
        game.setPhoto(id, photo);
        broadcast(room);
    });

    on('vote', async ({ targetId }) => {
        const { room, game, id } = await asPlayer();
        game.vote(id, targetId);
        broadcast(room);
    });

    on('night-vote', async ({ victimIds }) => {
        const { room, game, id } = await asPlayer();
        game.nightVote(id, victimIds);
        broadcast(room);
    });

    on('invite', async ({ targetId }) => {
        const { room, game, id } = await asPlayer();
        game.invite(id, targetId);
        notice(room, [targetId], 'Has recibido una invitación secreta');
        broadcast(room);
    });

    on('respond-invitation', async ({ accept }) => {
        const { room, game, id } = await asPlayer();
        game.respondInvitation(id, !!accept);
        if (accept) io.to(playerRoom(room.code, id)).emit('chat-history', chatHistoryFor(game, id));
        broadcast(room);
    });

    on('chat', async ({ channel, message }) => {
        const { room, game, id } = await asPlayer();
        emitChat(room, game.addChat(id, channel, message));
        persist(room);
    });

    // ----- Maestro de Ceremonias -----

    const master = (event, fn) => on(event, async payload => {
        const ctx = await asMaster();
        const result = await fn(ctx, payload);
        broadcast(ctx.room);
        return result;
    });

    master('mc:advance', ({ room, game }) => {
        const before = game.state.phase;
        game.advance();
        // Al amanecer, los Fantasmas reciben en secreto su objetivo del día
        if (before === 'night' && game.state.ghosts.today) {
            const target = game.getPlayer(game.state.ghosts.today.targetId);
            notice(room, game.dead().map(p => p.id), `💀 Objetivo de hoy: ${target.name}`);
        }
    });
    master('mc:close-round', ({ game }) => game.resolveRound());
    master('mc:banish', ({ game }, { playerId, targetVotes }) => game.banish(playerId, { targetVotes }));
    master('mc:skip-round', ({ game }) => game.skipRound());
    master('mc:night-victims', ({ game }, { ids }) => game.setNightVictims(ids));
    master('mc:conclave-override', ({ game }, { value }) => { game.state.conclaveOverride = !!value; });
    master('mc:config', ({ game }, { config }) => game.updateConfig(config || {}));
    master('mc:kick', ({ room, game }, { playerId }) => {
        game.removePlayer(playerId);
        io.to(playerRoom(room.code, playerId)).emit('kicked');
    });
    master('mc:test-add', ({ game }, test) => { game.addTest(test); });
    master('mc:test-update', ({ game }, { id, changes }) => { game.updateTest(id, changes || {}); });
    master('mc:test-remove', ({ game }, { id }) => game.removeTest(id));
    master('mc:message', ({ room, game }, { text, toId }) => {
        const msg = game.mcMessage(text, toId || null);
        if (toId) notice(room, [toId], `✉️ Mensaje del MC: ${msg.message}`);
        else emitChat(room, msg);
    });
    master('mc:restart', ({ room, game }) => {
        game.restart();
        room.knownDead = new Set();
        io.to(pubRoom(room.code)).emit('chat-history', { general: [], traitors: [], dead: [] });
    });
    master('mc:password', ({ room }, { password }) => {
        const p = String(password || '').trim();
        if (p.length < 4) throw new GameError('La contraseña debe tener al menos 4 caracteres');
        room.mcHash = hashPassword(p);
    });
});

// El cónclave puede abrir y cerrar por horario: avisar cuando cambie
setInterval(() => {
    rooms.forEach(room => {
        if (room.game.state.phase !== 'night' || !room.game.config.conclaveHours) return;
        const open = room.game.conclaveOpen();
        if (open !== room.lastConclaveOpen) {
            room.lastConclaveOpen = open;
            broadcast(room);
        }
    });
}, 30 * 1000);

// En producción el backend sirve también el frontend compilado (un solo dominio)
const buildDir = path.join(__dirname, '..', 'frontend', 'build');
if (fs.existsSync(buildDir)) {
    app.use(express.static(buildDir));
    app.get('*', (_req, res) => res.sendFile(path.join(buildDir, 'index.html')));
}

async function main() {
    const uri = process.env.MONGODB_URI;
    if (uri) {
        try {
            await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
            console.log('Conectado a MongoDB');
        } catch (err) {
            console.error('No se pudo conectar a MongoDB; las partidas solo se guardarán en memoria:', err.message);
        }
    } else {
        console.warn('⚠️  MONGODB_URI no definido: las partidas solo se guardan en memoria');
    }
    server.listen(PORT, () => console.log(`Servidor escuchando en el puerto ${PORT}`));
}

main();
