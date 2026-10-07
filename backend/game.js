// Lógica pura del juego (sin sockets ni base de datos) para poder probarla aislada.
const { randomUUID: uuidv4 } = require('crypto');

const TOTAL_GAME_DAYS = 4;
const MIN_PLAYERS = 4;
const MAX_CHAT_HISTORY = 200;
const MAX_MESSAGE_LENGTH = 500;

const CONCLAVE_START = { hour: 22, minute: 30 };
const CONCLAVE_END = { hour: 3, minute: 0 };
const GAME_TIMEZONE = process.env.GAME_TIMEZONE || 'Europe/Madrid';

class GameError extends Error {}

function createInitialState() {
    return {
        phase: 'waiting', // waiting | day | roundtable | night | gameover
        gameDay: 0,
        players: [],
        votes: {}, // voterId -> targetId
        pendingKill: null, // { victimId, byId }
        lastNightVictim: null,
        lastVoteResult: null, // { tally, expelledId, tie }
        invitation: { status: 'none', targetId: null, day: null },
        winner: null,
        activeTests: [],
        chat: { general: [], traitors: [] },
        ignoreConclaveHours: false
    };
}

// Número de traidores iniciales: 2 según las reglas, pero con menos de 6
// jugadores 2 traidores igualarían a los fieles casi de inmediato.
function initialTraitorCount(playerCount) {
    return playerCount >= 6 ? 2 : 1;
}

function minutesInTimezone(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: GAME_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(date);
    const get = type => Number(parts.find(p => p.type === type).value);
    return get('hour') * 60 + get('minute');
}

function isConclaveTime(date = new Date()) {
    const now = minutesInTimezone(date);
    const start = CONCLAVE_START.hour * 60 + CONCLAVE_START.minute;
    const end = CONCLAVE_END.hour * 60 + CONCLAVE_END.minute;
    return now >= start || now < end; // cruza la medianoche
}

function conclaveHoursLabel() {
    const fmt = ({ hour, minute }) => `${hour}:${String(minute).padStart(2, '0')}`;
    return `${fmt(CONCLAVE_START)}-${fmt(CONCLAVE_END)}`;
}

class Game {
    constructor(state = createInitialState(), now = () => new Date()) {
        this.state = { ...createInitialState(), ...state };
        this.now = now;
    }

    // ---------- Consultas ----------

    getPlayer(id) {
        return this.state.players.find(p => p.id === id);
    }

    alive() {
        return this.state.players.filter(p => p.alive);
    }

    aliveTraitors() {
        return this.alive().filter(p => p.role === 'traidor');
    }

    aliveFaithfuls() {
        return this.alive().filter(p => p.role === 'fiel');
    }

    isTraitor(id) {
        const p = this.getPlayer(id);
        return !!p && p.role === 'traidor';
    }

    conclaveOpen() {
        return this.state.phase === 'night' &&
            (this.state.ignoreConclaveHours || isConclaveTime(this.now()));
    }

    requireConclave() {
        if (this.state.phase !== 'night') throw new GameError('Solo durante la noche');
        if (!this.conclaveOpen()) {
            throw new GameError(`El cónclave solo está abierto de ${conclaveHoursLabel()}`);
        }
    }

    requireAlivePlayer(id) {
        const p = this.getPlayer(id);
        if (!p) throw new GameError('Jugador no encontrado');
        if (!p.alive) throw new GameError('Has sido eliminado');
        return p;
    }

    // ---------- Lobby ----------

    addPlayer({ name, photo }) {
        if (this.state.phase !== 'waiting') throw new GameError('La partida ya ha comenzado');
        const cleanName = String(name || '').trim().slice(0, 30);
        if (!cleanName) throw new GameError('Introduce un nombre');
        if (this.state.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) {
            throw new GameError('Ese nombre ya está en uso');
        }
        let cleanPhoto = String(photo || '').trim();
        if (cleanPhoto) {
            if (cleanPhoto.length > 1000 || !/^https?:\/\//i.test(cleanPhoto)) {
                throw new GameError('URL de foto no válida');
            }
        }
        const player = {
            id: uuidv4(),
            name: cleanName,
            photo: cleanPhoto,
            role: null,
            alive: true,
            score: 0,
            eliminatedBy: null, // 'murder' | 'banished'
            eliminatedDay: null
        };
        this.state.players.push(player);
        return player;
    }

    removePlayer(id) {
        if (this.state.phase !== 'waiting') throw new GameError('Solo se puede expulsar antes de empezar');
        this.state.players = this.state.players.filter(p => p.id !== id);
    }

    start(random = Math.random) {
        if (this.state.phase !== 'waiting') throw new GameError('La partida ya ha comenzado');
        const players = this.state.players;
        if (players.length < MIN_PLAYERS) {
            throw new GameError(`Se necesitan al menos ${MIN_PLAYERS} jugadores`);
        }
        // Fisher-Yates (el sort aleatorio no reparte de forma uniforme)
        const ids = players.map(p => p.id);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        const traitorIds = new Set(ids.slice(0, initialTraitorCount(ids.length)));
        players.forEach(p => {
            p.role = traitorIds.has(p.id) ? 'traidor' : 'fiel';
            p.alive = true;
        });
        this.state.gameDay = 1;
        this.state.phase = 'day';
    }

    // ---------- Avance de fases (solo MC) ----------

    // Día 1: día -> noche (invitación, sin asesinato)
    // Días 2-3: día (se revela la víctima) -> mesa redonda -> noche
    // Día 4: día -> mesa redonda -> fin del juego
    advance() {
        const s = this.state;
        switch (s.phase) {
            case 'waiting':
                this.start();
                return;
            case 'day':
                s.phase = s.gameDay === 1 ? 'night' : 'roundtable';
                if (s.phase === 'roundtable') {
                    s.votes = {};
                    s.lastVoteResult = null;
                }
                return;
            case 'roundtable':
                this.resolveVotes();
                if (s.phase === 'gameover') return;
                if (s.gameDay >= TOTAL_GAME_DAYS) {
                    this.finish();
                    return;
                }
                s.phase = 'night';
                return;
            case 'night':
                this.endNight();
                return;
            case 'gameover':
                throw new GameError('El juego ha terminado');
            default:
                throw new GameError(`Fase desconocida: ${s.phase}`);
        }
    }

    endNight() {
        const s = this.state;
        if (s.invitation.status === 'pending') {
            s.invitation.status = 'expired';
        }
        s.lastNightVictim = null;
        if (s.pendingKill) {
            const victim = this.getPlayer(s.pendingKill.victimId);
            if (victim && victim.alive) {
                victim.alive = false;
                victim.eliminatedBy = 'murder';
                victim.eliminatedDay = s.gameDay;
                s.lastNightVictim = victim.id;
            }
            s.pendingKill = null;
        }
        s.gameDay += 1;
        s.phase = 'day';
        s.lastVoteResult = null;
        this.checkGameOver();
    }

    finish() {
        const s = this.state;
        s.phase = 'gameover';
        s.winner = this.aliveTraitors().length > 0 ? 'TRAIDORES' : 'FIELES';
    }

    checkGameOver() {
        const traitors = this.aliveTraitors().length;
        const faithfuls = this.aliveFaithfuls().length;
        if (traitors === 0) {
            this.state.phase = 'gameover';
            this.state.winner = 'FIELES';
            return true;
        }
        if (traitors >= faithfuls) {
            this.state.phase = 'gameover';
            this.state.winner = 'TRAIDORES';
            return true;
        }
        return false;
    }

    // ---------- Mesa redonda ----------

    vote(voterId, targetId) {
        const s = this.state;
        if (s.phase !== 'roundtable') throw new GameError('Ahora no hay votación');
        this.requireAlivePlayer(voterId);
        if (voterId === targetId) throw new GameError('No puedes votarte a ti mismo');
        const target = this.getPlayer(targetId);
        if (!target || !target.alive) throw new GameError('Voto no válido');
        s.votes[voterId] = targetId;
        // Se resuelve sola cuando han votado todos los vivos
        if (this.alive().every(p => s.votes[p.id])) {
            this.resolveVotes();
            if (s.phase === 'roundtable') {
                if (s.gameDay >= TOTAL_GAME_DAYS) this.finish();
                else s.phase = 'night';
            }
            return true;
        }
        return false;
    }

    resolveVotes() {
        const s = this.state;
        const tally = {};
        Object.entries(s.votes).forEach(([voterId, targetId]) => {
            const voter = this.getPlayer(voterId);
            const target = this.getPlayer(targetId);
            if (voter && voter.alive && target && target.alive) {
                tally[targetId] = (tally[targetId] || 0) + 1;
            }
        });
        s.votes = {};
        const counts = Object.values(tally);
        if (counts.length === 0) {
            s.lastVoteResult = { tally, expelledId: null, tie: false };
            return;
        }
        const max = Math.max(...counts);
        const top = Object.keys(tally).filter(id => tally[id] === max);
        if (top.length > 1) {
            s.lastVoteResult = { tally, expelledId: null, tie: true };
            return;
        }
        const expelled = this.getPlayer(top[0]);
        expelled.alive = false;
        expelled.eliminatedBy = 'banished';
        expelled.eliminatedDay = s.gameDay;
        s.lastVoteResult = { tally, expelledId: expelled.id, tie: false };
        this.checkGameOver();
    }

    // ---------- Cónclave ----------

    nightKill(traitorId, victimId) {
        const s = this.state;
        this.requireAlivePlayer(traitorId);
        if (!this.isTraitor(traitorId)) throw new GameError('No eres traidor');
        if (s.gameDay === 1) throw new GameError('No se puede asesinar el primer día');
        this.requireConclave();
        const victim = this.getPlayer(victimId);
        if (!victim || !victim.alive || victim.role === 'traidor') {
            throw new GameError('Víctima no válida');
        }
        // Se puede cambiar la elección hasta que amanezca
        s.pendingKill = { victimId, byId: traitorId };
        return victim;
    }

    invite(traitorId, targetId) {
        const s = this.state;
        this.requireAlivePlayer(traitorId);
        if (!this.isTraitor(traitorId)) throw new GameError('No eres traidor');
        if (s.gameDay !== 1) throw new GameError('Solo se puede invitar la primera noche');
        this.requireConclave();
        if (s.invitation.day === s.gameDay) {
            throw new GameError('Ya se ha usado la invitación de esta noche');
        }
        const target = this.getPlayer(targetId);
        if (!target || !target.alive || target.role !== 'fiel') {
            throw new GameError('Jugador no válido para invitar');
        }
        // No permitir una invitación que daría la victoria automática a los traidores
        if (this.aliveTraitors().length + 1 >= this.aliveFaithfuls().length - 1) {
            throw new GameError('Hay muy pocos fieles para reclutar a otro traidor');
        }
        s.invitation = { status: 'pending', targetId, day: s.gameDay };
        return target;
    }

    respondInvitation(playerId, accept) {
        const s = this.state;
        if (s.invitation.status !== 'pending' || s.invitation.targetId !== playerId) {
            throw new GameError('No tienes ninguna invitación pendiente');
        }
        if (s.phase !== 'night') throw new GameError('La invitación ha caducado');
        const player = this.requireAlivePlayer(playerId);
        s.invitation.status = accept ? 'accepted' : 'rejected';
        if (accept) player.role = 'traidor';
        return player;
    }

    // ---------- Chat ----------

    addChat(playerId, channel, message) {
        const s = this.state;
        const player = this.requireAlivePlayer(playerId);
        const text = String(message || '').trim().slice(0, MAX_MESSAGE_LENGTH);
        if (!text) throw new GameError('Mensaje vacío');
        if (channel === 'traitors') {
            if (player.role !== 'traidor') throw new GameError('No tienes acceso a este chat');
            this.requireConclave();
        } else {
            channel = 'general';
        }
        const msg = { id: uuidv4(), fromId: player.id, from: player.name, message: text, at: this.now().toISOString(), channel };
        const list = s.chat[channel];
        list.push(msg);
        if (list.length > MAX_CHAT_HISTORY) list.splice(0, list.length - MAX_CHAT_HISTORY);
        return msg;
    }

    // ---------- Herramientas del MC ----------

    startTest(name, playerIds) {
        const testName = String(name || '').trim().slice(0, 80);
        if (!testName) throw new GameError('Introduce un nombre para la prueba');
        const ids = (playerIds || []).filter(id => this.getPlayer(id));
        if (ids.length === 0) throw new GameError('Selecciona al menos un jugador');
        const test = { id: uuidv4(), name: testName, players: ids, startTime: this.now().toISOString() };
        this.state.activeTests.push(test);
        return test;
    }

    endTest(testId) {
        this.state.activeTests = this.state.activeTests.filter(t => t.id !== testId);
    }

    addPoints(playerIds, points) {
        const n = parseInt(points, 10);
        if (!Number.isFinite(n) || n === 0) throw new GameError('Introduce un número de puntos válido');
        const players = (playerIds || []).map(id => this.getPlayer(id)).filter(Boolean);
        if (players.length === 0) throw new GameError('Selecciona al menos un jugador');
        players.forEach(p => { p.score = (p.score || 0) + n; });
        return { players, points: n };
    }

    // ---------- Vistas (qué puede ver cada uno) ----------

    publicView() {
        const s = this.state;
        const revealAll = s.phase === 'gameover';
        return {
            phase: s.phase,
            gameDay: s.gameDay,
            totalDays: TOTAL_GAME_DAYS,
            minPlayers: MIN_PLAYERS,
            winner: s.winner,
            conclaveOpen: this.conclaveOpen(),
            conclaveHours: conclaveHoursLabel(),
            players: s.players.map(p => ({
                id: p.id,
                name: p.name,
                photo: p.photo,
                alive: p.alive,
                score: p.score || 0,
                eliminatedBy: p.eliminatedBy,
                eliminatedDay: p.eliminatedDay,
                // El rol solo se conoce al ser eliminado o al terminar
                role: revealAll || !p.alive ? p.role : undefined
            })),
            voters: Object.keys(s.votes),
            lastNightVictim: s.lastNightVictim,
            lastVoteResult: s.lastVoteResult,
            activeTests: s.activeTests
        };
    }

    privateView(playerId) {
        const s = this.state;
        const p = this.getPlayer(playerId);
        if (!p) return null;
        const view = {
            playerId: p.id,
            role: p.role,
            myVote: s.votes[p.id] || null,
            invitationPending: s.invitation.status === 'pending' && s.invitation.targetId === p.id
        };
        if (p.role === 'traidor') {
            view.traitors = s.players.filter(x => x.role === 'traidor').map(x => ({ id: x.id, name: x.name }));
            view.pendingKill = s.pendingKill ? s.pendingKill.victimId : null;
            view.invitation = {
                status: s.invitation.status,
                targetName: s.invitation.targetId ? this.getPlayer(s.invitation.targetId)?.name : null,
                available: s.gameDay === 1 && s.invitation.day !== s.gameDay
            };
        }
        return view;
    }

    // El MC no ve los roles concretos (solo el reparto) para no condicionar la partida.
    masterView() {
        const s = this.state;
        const pub = this.publicView();
        return {
            ...pub,
            roleDistribution: {
                traidores: this.aliveTraitors().length,
                fieles: this.aliveFaithfuls().length
            },
            votesCast: Object.keys(s.votes).length,
            votesNeeded: this.alive().length,
            pendingKill: !!s.pendingKill,
            invitationStatus: s.invitation.status,
            ignoreConclaveHours: s.ignoreConclaveHours,
            nextAction: this.nextActionLabel()
        };
    }

    nextActionLabel() {
        const s = this.state;
        switch (s.phase) {
            case 'waiting': return 'Comenzar partida';
            case 'day': return s.gameDay === 1 ? 'Pasar a la noche' : 'Abrir mesa redonda';
            case 'roundtable': return s.gameDay >= TOTAL_GAME_DAYS ? 'Cerrar votación y terminar' : 'Cerrar votación y pasar a la noche';
            case 'night': return `Amanecer (día ${s.gameDay + 1})`;
            default: return null;
        }
    }
}

module.exports = {
    Game,
    GameError,
    createInitialState,
    isConclaveTime,
    TOTAL_GAME_DAYS,
    MIN_PLAYERS
};
