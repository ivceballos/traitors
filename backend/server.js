require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// Conectar a MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/traidores', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log('Conectado a MongoDB');
}).catch(err => {
    console.error('Error conectando a MongoDB:', err);
});

// Definir modelos
const PlayerSchema = new mongoose.Schema({
    userId: String,
    socketId: String,
    name: String,
    photo: String,
    role: String,
    alive: Boolean,
    score: Number,
    token: String
});

const GameSchema = new mongoose.Schema({
    gameId: { type: String, default: 'current' },
    phase: String,
    gameDay: Number,
    traitors: [String],
    faithfuls: [String],
    nightVictim: String,
    votes: Array,
    gameOverWinner: String,
    invitedPlayer: String,
    invitationAccepted: Boolean,
    lastUpdated: Date
});

const Player = mongoose.model('Player', PlayerSchema);
const Game = mongoose.model('Game', GameSchema);

// Estado del juego (inicial, se cargará desde la base de datos)
let players = [];
let phase = 'waiting';
let traitors = [];
let faithfuls = [];
let nightVictim = null;
let votes = [];
let gameOverWinner = null;
let scores = {};
let activeTests = [];
let gameDay = 0;
let invitedPlayer = null;
let invitationAccepted = false;

// Configuración del MC
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'admin123';
const TOTAL_GAME_DAYS = 4;

// Funciones auxiliares
function isConclaveTimeActive() {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const currentTime = hours + minutes/60;
    return (currentTime >= 22.5 || currentTime < 3); // 22:30 a 3:00
}

function getMasterState() {
    return {
        phase,
        gameDay,
        players: players.map(p => ({
            ...p,
            role: undefined // No enviamos los roles específicos al MC
        })),
        roleDistribution: {
            traidores: players.filter(p => p.role === 'traidor').length,
            fieles: players.filter(p => p.role === 'fiel').length
        },
        scores,
        activeTests,
        invitationStatus: invitedPlayer ? 'pendiente' : (invitationAccepted ? 'aceptada' : 'rechazada')
    };
}

function getAlivePlayers() {
    return players.filter(p => p.alive);
}

async function assignRoles() {
    if (players.length < 4) return false;

    const shuffled = [...players].sort(() => Math.random() - 0.5);
    traitors = shuffled.slice(0, 2).map(p => p.id);
    faithfuls = shuffled.slice(2).map(p => p.id);

    players = players.map(p => ({
        ...p,
        role: traitors.includes(p.id) ? 'traidor' : 'fiel',
        alive: true,
    }));

    // Guardar roles en la base de datos
    await Promise.all(players.map(savePlayer));
    return true;
}

function checkGameOver() {
    const aliveTraitors = getAlivePlayers().filter(p => p.role === 'traidor');
    const aliveFaithfuls = getAlivePlayers().filter(p => p.role === 'fiel');

    if (aliveTraitors.length === 0) {
        phase = 'gameover';
        gameOverWinner = 'FIELES';
        return true;
    }
    if (aliveTraitors.length >= aliveFaithfuls.length) {
        phase = 'gameover';
        gameOverWinner = 'TRAIDORES';
        return true;
    }

    if (gameDay >= TOTAL_GAME_DAYS && phase === 'night') {
        phase = 'gameover';
        gameOverWinner = 'FIELES';
        return true;
    }

    return false;
}

function advanceToNextDay() {
    gameDay++;

    if (gameDay === 1) {
        phase = 'invitation';
    } else {
        phase = 'night';
    }

    io.emit('game-day', gameDay);
    io.emit('phase', phase);
}

function resolveVoteTie(tally) {
    const maxVotes = Math.max(...Object.values(tally));
    const tied = Object.entries(tally)
        .filter(([_, votes]) => votes === maxVotes)
        .map(([id]) => id);

    if (tied.length > 1) {
        return null; // Empate, no se expulsa a nadie
    }
    return tied[0];
}

async function saveGameState() {
    try {
        await Game.findOneAndUpdate(
            { gameId: 'current' },
            {
                phase,
                gameDay,
                traitors,
                faithfuls,
                nightVictim,
                votes,
                gameOverWinner,
                invitedPlayer,
                invitationAccepted,
                lastUpdated: new Date()
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Error saving game state:', err);
    }
}

async function loadGameState() {
    try {
        const game = await Game.findOne({ gameId: 'current' });
        if (game) {
            phase = game.phase;
            gameDay = game.gameDay;
            traitors = game.traitors;
            faithfuls = game.faithfuls;
            nightVictim = game.nightVictim;
            votes = game.votes;
            gameOverWinner = game.gameOverWinner;
            invitedPlayer = game.invitedPlayer;
            invitationAccepted = game.invitationAccepted;
        }
    } catch (err) {
        console.error('Error loading game state:', err);
    }
}

async function savePlayer(player) {
    try {
        await Player.findOneAndUpdate(
            { userId: player.id },
            {
                socketId: player.id,
                name: player.name,
                photo: player.photo,
                role: player.role,
                alive: player.alive,
                score: scores[player.id] || 0,
                token: player.token
            },
            { upsert: true }
        );
    } catch (err) {
        console.error('Error saving player:', err);
    }
}

async function loadPlayers() {
    try {
        const dbPlayers = await Player.find({});
        players = dbPlayers.map(p => ({
            id: p.socketId,
            name: p.name,
            photo: p.photo,
            role: p.role,
            alive: p.alive,
            token: p.token
        }));

        // Reconstruir scores
        scores = {};
        dbPlayers.forEach(p => {
            if (p.score) scores[p.socketId] = p.score;
        });
    } catch (err) {
        console.error('Error loading players:', err);
    }
}

// Cargar estado al iniciar
loadGameState().then(loadPlayers).then(() => {
    console.log('Estado del juego cargado desde la base de datos');
});

// Conexión de Socket.IO
io.on('connection', (socket) => {
    // Autenticación con token
    socket.on('auth', async ({ token, name, photo }) => {
        if (token) {
            // Intento de reconexión con token
            try {
                const player = await Player.findOne({ token });
                if (player) {
                    // Actualizar socketId
                    const oldSocketId = player.socketId;
                    player.socketId = socket.id;
                    await player.save();

                    // Actualizar referencias en el juego
                    if (traitors.includes(oldSocketId)) {
                        traitors = traitors.map(id => id === oldSocketId ? socket.id : id);
                    }
                    if (faithfuls.includes(oldSocketId)) {
                        faithfuls = faithfuls.map(id => id === oldSocketId ? socket.id : id);
                    }
                    if (invitedPlayer === oldSocketId) {
                        invitedPlayer = socket.id;
                    }

                    // Actualizar en la lista de jugadores
                    players = players.map(p =>
                        p.id === oldSocketId ? { ...p, id: socket.id } : p
                    );

                    // Informar al jugador de su rol
                    socket.emit('role', {
                        role: player.role,
                        traitors: player.role === 'traidor' ?
                            traitors.map(id => players.find(p => p.id === id)?.name || 'Desconocido') : []
                    });

                    socket.emit('reconnected', {
                        phase,
                        gameDay,
                        score: scores[oldSocketId] || 0
                    });

                    // Transferir puntuación
                    if (scores[oldSocketId]) {
                        scores[socket.id] = scores[oldSocketId];
                        delete scores[oldSocketId];
                    }

                    saveGameState();
                    io.emit('players', players);
                    return;
                }
            } catch (err) {
                console.error('Error during reconnection:', err);
            }
        }

        // Nuevo jugador o token inválido
        if (phase !== 'waiting') {
            socket.emit('error', 'La partida ya ha comenzado');
            return;
        }

        // Generar token para el nuevo jugador
        const newToken = jwt.sign({ id: uuidv4() }, process.env.JWT_SECRET || 'secret');

        const newPlayer = {
            id: socket.id,
            name,
            photo,
            role: null,
            alive: true,
            token: newToken
        };

        players.push(newPlayer);
        await savePlayer(newPlayer);

        socket.emit('token', newToken);
        io.emit('players', players);
        io.emit('master-update', getMasterState());
    });

    // Autenticación del MC
    socket.on('master-login', (password) => {
        socket.emit('master-auth', password === MASTER_PASSWORD);
    });

    // Obtener estado para el MC
    socket.on('master-get-state', () => {
        socket.emit('master-update', getMasterState());
    });

    // Iniciar prueba
    socket.on('master-start-test', ({ testName, players: testPlayers }) => {
        const test = {
            id: Date.now(),
            name: testName,
            players: testPlayers,
            startTime: new Date()
        };
        activeTests.push(test);

        testPlayers.forEach(playerId => {
            io.to(playerId).emit('test-started', { testName });
        });

        socket.emit('master-message', `Prueba "${testName}" iniciada`);
        io.emit('master-update', getMasterState());
    });

    // Asignar puntos
    socket.on('master-add-points', async ({ players: scorePlayers, points }) => {
        scorePlayers.forEach(playerId => {
            scores[playerId] = (scores[playerId] || 0) + points;
            io.to(playerId).emit('points-added', { points, total: scores[playerId] });
        });

        // Actualizar puntuaciones en la base de datos
        for (const playerId of scorePlayers) {
            const player = players.find(p => p.id === playerId);
            if (player) {
                await savePlayer(player);
            }
        }

        socket.emit('master-message', `Puntos asignados`);
        io.emit('scores-updated', scores);
        io.emit('master-update', getMasterState());
    });

    // Reiniciar juego
    socket.on('master-reset-game', async () => {
        players = [];
        phase = 'waiting';
        traitors = [];
        faithfuls = [];
        nightVictim = null;
        votes = [];
        gameOverWinner = null;
        scores = {};
        activeTests = [];
        gameDay = 0;
        invitedPlayer = null;
        invitationAccepted = false;

        // Limpiar la base de datos
        await Player.deleteMany({});
        await Game.deleteMany({});

        io.emit('game-reset');
        socket.emit('master-message', 'Juego reiniciado');
        io.emit('master-update', getMasterState());
    });

    // Avanzar al siguiente día (solo MC)
    socket.on('master-next-day', async () => {
        if (phase === 'gameover') {
            socket.emit('master-error', 'El juego ha terminado');
            return;
        }

        advanceToNextDay();
        await saveGameState();
        socket.emit('master-message', `Avanzado al día ${gameDay}`);
        io.emit('master-update', getMasterState());
    });

    socket.on('start', async () => {
        if (phase !== 'waiting') return;
        if (players.length < 4) {
            socket.emit('error', 'Se necesitan al menos 4 jugadores');
            return;
        }
        
        if (!await assignRoles()) {
            socket.emit('error', 'Error al asignar roles');
            return;
        }
        
        gameDay = 1;
        phase = 'invitation';
        
        io.emit('game-day', gameDay);
        io.emit('phase', phase);
        
        // Informar a cada jugador de su rol
        players.forEach(p => {
            io.to(p.id).emit('role', {
                role: p.role,
                traitors: p.role === 'traidor' ? 
                    traitors.map(id => players.find(pl => pl.id === id).name) : []
            });
        });
        
        io.emit('players', players);
        await saveGameState();
        io.emit('master-update', getMasterState());
    });

    // Invitar a un fiel a ser traidor (solo en fase de invitación)
    socket.on('invite-player', async (playerId) => {
        if (phase !== 'invitation') return;
        if (!traitors.includes(socket.id)) return;
        if (invitedPlayer) {
            socket.emit('error', 'Ya hay una invitación pendiente');
            return;
        }

        const player = players.find(p => p.id === playerId);
        if (!player || player.role !== 'fiel' || !player.alive) {
            socket.emit('error', 'Jugador no válido para invitar');
            return;
        }

        invitedPlayer = playerId;
        io.to(playerId).emit('traitor-invitation');

        // Notificar a los traidores
        traitors.forEach(id => {
            io.to(id).emit('invitation-sent', players.find(p => p.id === playerId).name);
        });

        await saveGameState();
        io.emit('master-update', getMasterState());
    });

    // Responder a la invitación
    socket.on('respond-invitation', async (accept) => {
        if (phase !== 'invitation') return;
        if (socket.id !== invitedPlayer) return;

        invitationAccepted = accept;

        if (accept) {
            // Convertir al jugador en traidor
            players = players.map(p =>
                p.id === socket.id ? { ...p, role: 'traidor' } : p
            );

            // Actualizar listas
            traitors.push(socket.id);
            faithfuls = faithfuls.filter(id => id !== socket.id);

            // Actualizar en la base de datos
            const player = players.find(p => p.id === socket.id);
            if (player) {
                await savePlayer(player);
            }

            // Informar al nuevo traidor
            io.to(socket.id).emit('role', {
                role: 'traidor',
                traitors: traitors.map(id => players.find(p => p.id === id).name)
            });

            // Informar a los traidores existentes
            traitors.forEach(id => {
                if (id !== socket.id) {
                    io.to(id).emit('invitation-accepted', players.find(p => p.id === socket.id).name);
                }
            });
        } else {
            // Informar a los traidores del rechazo
            traitors.forEach(id => {
                io.to(id).emit('invitation-rejected');
            });
        }

        // Avanzar a la fase nocturna
        phase = 'night';
        io.emit('phase', phase);
        await saveGameState();
        io.emit('master-update', getMasterState());
    });

    socket.on('night-kill', async (victimId) => {
        if (phase !== 'night') return;
        if (!traitors.includes(socket.id)) return;
        if (gameDay === 1) {
            socket.emit('error', 'No se puede asesinar en el primer día');
            return;
        }
        if (!isConclaveTimeActive()) {
            socket.emit('error', 'El cónclave solo está disponible entre 22:30 y 3:00');
            return;
        }

        const victim = players.find(p => p.id === victimId);
        if (!victim || !victim.alive || victim.role === 'traidor') {
            socket.emit('error', 'Víctima no válida');
            return;
        }

        nightVictim = victimId;
        players = players.map(p => p.id === victimId ? { ...p, alive: false } : p);

        // Actualizar en la base de datos
        const player = players.find(p => p.id === victimId);
        if (player) {
            await savePlayer(player);
        }

        // En días posteriores al primero, hay mesa redonda
        phase = 'roundtable';
        io.emit('phase', phase);
        io.emit('players', players);
        io.emit('night-victim', players.find(p => p.id === victimId));
        await saveGameState();
        io.emit('master-update', getMasterState());
    });

    socket.on('vote', async (votedId) => {
        if (phase !== 'roundtable') return;
        const voter = getAlivePlayers().find(p => p.id === socket.id);
        if (!voter) return;

        // Eliminar voto previo
        votes = votes.filter(v => v.voter !== socket.id);
        votes.push({ voter: socket.id, voted: votedId });

        if (votes.length === getAlivePlayers().length) {
            const tally = {};
            votes.forEach(v => { tally[v.voted] = (tally[v.voted] || 0) + 1; });

            const expelledId = resolveVoteTie(tally);
            if (!expelledId) {
                io.emit('message', 'Empate en la votación. No se expulsa a nadie.');
                phase = 'night';
                votes = [];
                io.emit('phase', phase);
                await saveGameState();
                return;
            }

            players = players.map(p => p.id === expelledId ? { ...p, alive: false } : p);
            const expelled = players.find(p => p.id === expelledId);

            // Actualizar en la base de datos
            await savePlayer(expelled);

            votes = [];
            if (!checkGameOver()) {
                phase = 'night';
                io.emit('phase', phase);
            }
            io.emit('players', players);
            io.emit('expelled', expelled);
            if (phase === 'gameover') {
                io.emit('gameover', gameOverWinner);
            }
            await saveGameState();
            io.emit('master-update', getMasterState());
        }
    });

    socket.on('chat', ({ message, phaseType }) => {
        if (!message.trim()) return;

        if (phaseType === 'traitors') {
            if (!traitors.includes(socket.id)) return;
            traitors.forEach(id =>
                io.to(id).emit('chat', {
                    from: players.find(p => p.id === socket.id).name,
                    message: message.trim(),
                    isTraitorChat: true
                })
            );
        } else {
            io.emit('chat', {
                from: players.find(p => p.id === socket.id).name,
                message: message.trim(),
                isTraitorChat: false
            });
        }
    });

    socket.on('disconnect', async () => {
        const player = players.find(p => p.id === socket.id);
        if (!player) return;

        // No eliminamos al jugador, solo actualizamos su socketId
        // para que pueda reconectarse más tarde
        player.socketId = null;
        await savePlayer(player);

        // Si era el jugador invitado, cancelar la invitación
        if (invitedPlayer === socket.id) {
            invitedPlayer = null;
            traitors.forEach(id => {
                io.to(id).emit('invitation-cancelled', 'El jugador invitado se ha desconectado');
            });
            await saveGameState();
        }

        // Notificar a los demás jugadores
        io.emit('player-disconnected', socket.id);
        io.emit('master-update', getMasterState());
    });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
