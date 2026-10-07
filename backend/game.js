// Motor del juego: lógica pura, sin sockets ni base de datos, para poder probarla aislada.
const crypto = require('crypto');

const uuid = () => crypto.randomUUID();

class GameError extends Error {}

const MAX_CHAT_HISTORY = 300;
const MAX_MESSAGE_LENGTH = 500;
const MAX_REVOTES = 3;
const MIN_PLAYERS = 4;

// ---------- Configuración ----------

const DEFAULT_CONFIG = {
    name: 'Partida',
    factions: { loyal: 'Fieles', traitor: 'Traidores' },
    days: 4,
    traitorCount: 0, // 0 = automático según el número de jugadores
    // Eliminaciones por día: mesa redonda (votación) y cónclave (asesinatos nocturnos)
    schedule: [
        { roundtable: 0, conclave: 0 },
        { roundtable: 1, conclave: 1 },
        { roundtable: 1, conclave: 1 },
        { roundtable: 1, conclave: 0 }
    ],
    voting: 'app', // 'app': cada uno vota desde su móvil · 'inperson': en voz alta y el MC registra
    tieRule: 'revote', // 'revote': nueva votación entre empatados · 'none': nadie es eliminado
    revealRole: true, // revelar el rol del desterrado
    invitation: true, // la primera noche los traidores pueden reclutar a un fiel
    conclaveHours: null, // { start: '22:30', end: '03:00' } o null (abierto toda la noche)
    timezone: 'Europe/Madrid',
    goldPerEuro: 100,
    ghosts: {
        enabled: true,
        perVote: 1,
        perElimination: 2,
        thresholds: [
            { skulls: 18, percent: 50 },
            { skulls: 26, percent: 75 },
            { skulls: 33, percent: 100 }
        ]
    }
};

const PRESETS = {
    clasico: {
        label: 'Clásico (4 días)',
        config: {}
    },
    'fieles-felones': {
        label: 'Fieles y Felones (despedida, 12 jugadores)',
        config: {
            name: 'Fieles y Felones',
            factions: { loyal: 'Fieles', traitor: 'Felones' },
            schedule: [
                { roundtable: 0, conclave: 0 },
                { roundtable: 1, conclave: 1 },
                { roundtable: 2, conclave: 2 },
                { roundtable: 1, conclave: 0 }
            ],
            voting: 'inperson',
            invitation: false
        },
        tests: ['Llave o Muerte', 'Noche con Ataduras', 'Trivial novio', '¿Quién qué?', 'Aguas Tensas', 'Morder o Morir', 'Chao Pescao']
            .map(name => ({ name, max: 0 }))
    }
};

const clampInt = (v, min, max, fallback) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
};
const cleanText = (v, max, fallback = '') => (String(v ?? '').trim().slice(0, max) || fallback);
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeConfig(input = {}) {
    const d = DEFAULT_CONFIG;
    const days = clampInt(input.days, 1, 10, d.days);
    const schedule = [];
    for (let i = 0; i < days; i++) {
        const src = (input.schedule || [])[i] ||
            (i === 0 ? { roundtable: 0, conclave: 0 } : i === days - 1 ? { roundtable: 1, conclave: 0 } : { roundtable: 1, conclave: 1 });
        schedule.push({
            roundtable: clampInt(src.roundtable, 0, 5, 0),
            conclave: i === days - 1 ? 0 : clampInt(src.conclave, 0, 5, 0) // la última noche no se juega
        });
    }
    let conclaveHours = null;
    if (input.conclaveHours && HHMM.test(input.conclaveHours.start) && HHMM.test(input.conclaveHours.end)) {
        conclaveHours = { start: input.conclaveHours.start, end: input.conclaveHours.end };
    }
    let timezone = d.timezone;
    try {
        if (input.timezone) {
            new Intl.DateTimeFormat('es', { timeZone: input.timezone });
            timezone = input.timezone;
        }
    } catch (_) { /* zona horaria no válida */ }
    const g = { ...d.ghosts, ...(input.ghosts || {}) };
    const thresholds = (Array.isArray(g.thresholds) ? g.thresholds : d.ghosts.thresholds)
        .slice(0, 5)
        .map(t => ({ skulls: clampInt(t.skulls, 1, 999, 1), percent: clampInt(t.percent, 1, 100, 50) }))
        .sort((a, b) => a.skulls - b.skulls);
    return {
        name: cleanText(input.name, 60, d.name),
        factions: {
            loyal: cleanText(input.factions?.loyal, 20, d.factions.loyal),
            traitor: cleanText(input.factions?.traitor, 20, d.factions.traitor)
        },
        days,
        traitorCount: clampInt(input.traitorCount, 0, 10, 0),
        schedule,
        voting: input.voting === 'inperson' ? 'inperson' : 'app',
        tieRule: input.tieRule === 'none' ? 'none' : 'revote',
        revealRole: input.revealRole !== false,
        invitation: input.invitation !== undefined ? !!input.invitation : d.invitation,
        conclaveHours,
        timezone,
        goldPerEuro: clampInt(input.goldPerEuro, 1, 100000, d.goldPerEuro),
        ghosts: {
            enabled: g.enabled !== false,
            perVote: clampInt(g.perVote, 0, 10, d.ghosts.perVote),
            perElimination: clampInt(g.perElimination, 0, 20, d.ghosts.perElimination),
            thresholds: thresholds.length ? thresholds : d.ghosts.thresholds
        }
    };
}

function autoTraitorCount(players) {
    if (players < 6) return 1;
    if (players < 11) return 2;
    return 3;
}

function ghostLootPercent(skulls, thresholds) {
    const reached = [...thresholds].reverse().find(t => skulls >= t.skulls);
    return reached ? reached.percent : 0;
}

function minutesInTimezone(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(date);
    const get = type => Number(parts.find(p => p.type === type).value);
    return get('hour') * 60 + get('minute');
}

function isWithinHours(hours, timezone, date = new Date()) {
    const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
    const now = minutesInTimezone(date, timezone);
    const start = toMin(hours.start);
    const end = toMin(hours.end);
    return start <= end ? now >= start && now < end : now >= start || now < end; // puede cruzar la medianoche
}

function createState(config = {}, tests = []) {
    return {
        config: normalizeConfig(config),
        phase: 'lobby', // lobby | day | roundtable | night | end
        day: 0,
        players: [],
        round: null, // { number, votes, candidates, revotes }
        roundsDone: 0,
        nightVotes: {}, // traidorId -> [víctimas]
        nightOverride: null, // víctimas decididas por el MC
        invitation: { status: 'none', targetId: null },
        winner: null, // 'loyal' | 'traitor'
        events: [], // registro público de lo sucedido
        tests: (tests || []).slice(0, 30).map(t => ({
            id: uuid(), name: cleanText(t.name, 60, 'Prueba'), description: cleanText(t.description, 2000),
            max: clampInt(t.max, 0, 10000000, 0), score: null, status: 'pending'
        })),
        spotlight: null, // prueba que el MC está mostrando en la tele
        ghosts: { skulls: 0, today: null, history: [] }, // today: { day, targetId, votes, eliminated, skulls }
        chat: { general: [], traitors: [], dead: [] },
        inbox: {}, // mensajes privados del MC por jugador
        conclaveOverride: false
    };
}

// ---------- Partida ----------

class Game {
    constructor(state, now = () => new Date(), random = Math.random) {
        this.state = state;
        this.now = now;
        this.random = random;
    }

    get config() { return this.state.config; }

    // ----- Consultas -----

    getPlayer(id) { return this.state.players.find(p => p.id === id); }
    alive() { return this.state.players.filter(p => p.alive); }
    dead() { return this.state.players.filter(p => !p.alive); }
    aliveTraitors() { return this.alive().filter(p => p.role === 'traitor'); }
    aliveLoyals() { return this.alive().filter(p => p.role === 'loyal'); }
    today() { return this.config.schedule[this.state.day - 1] || { roundtable: 0, conclave: 0 }; }
    isLastDay() { return this.state.day >= this.config.days; }
    treasure() { return this.state.tests.reduce((sum, t) => sum + (t.score || 0), 0); }

    requirePlayer(id, { alive = true } = {}) {
        const p = this.getPlayer(id);
        if (!p) throw new GameError('No estás en esta partida');
        if (alive && !p.alive) throw new GameError('Has sido eliminado');
        return p;
    }

    requirePhase(...phases) {
        if (!phases.includes(this.state.phase)) throw new GameError('Ahora no se puede hacer eso');
    }

    conclaveOpen() {
        const s = this.state;
        if (s.phase !== 'night') return false;
        if (s.conclaveOverride || !this.config.conclaveHours) return true;
        return isWithinHours(this.config.conclaveHours, this.config.timezone, this.now());
    }

    requireConclave() {
        this.requirePhase('night');
        if (!this.conclaveOpen()) {
            const h = this.config.conclaveHours;
            throw new GameError(`El cónclave abre de ${h.start} a ${h.end}`);
        }
    }

    log(type, text, extra = {}) {
        this.state.events.push({ id: uuid(), day: this.state.day, type, text, at: this.now().toISOString(), ...extra });
        if (this.state.events.length > 200) this.state.events.shift();
    }

    // ----- Sala de espera -----

    addPlayer({ name, photo }) {
        this.requirePhase('lobby');
        const cleanName = cleanText(name, 24);
        if (!cleanName) throw new GameError('Introduce tu nombre');
        if (this.state.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase())) {
            throw new GameError('Ese nombre ya está en uso');
        }
        if (this.state.players.length >= 40) throw new GameError('La partida está llena');
        if (photo) this.validatePhoto(photo);
        const player = {
            id: uuid(), name: cleanName, photo: photo || null, photoVersion: photo ? 1 : 0,
            role: null, alive: true, eliminatedBy: null, eliminatedDay: null
        };
        this.state.players.push(player);
        return player;
    }

    validatePhoto(photo) {
        if (typeof photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(photo) || photo.length > 300000) {
            throw new GameError('Foto no válida (máx. 200 KB)');
        }
    }

    setPhoto(playerId, photo) {
        const p = this.requirePlayer(playerId, { alive: false });
        if (photo !== null) this.validatePhoto(photo);
        p.photo = photo;
        p.photoVersion = (p.photoVersion || 0) + 1;
    }

    removePlayer(id) {
        this.requirePhase('lobby');
        this.state.players = this.state.players.filter(p => p.id !== id);
    }

    updateConfig(input) {
        this.requirePhase('lobby');
        this.state.config = normalizeConfig({ ...this.config, ...input });
    }

    start() {
        this.requirePhase('lobby');
        const players = this.state.players;
        if (players.length < MIN_PLAYERS) throw new GameError(`Se necesitan al menos ${MIN_PLAYERS} jugadores`);
        const count = this.config.traitorCount || autoTraitorCount(players.length);
        if (count * 2 >= players.length) throw new GameError('Demasiados traidores para tan pocos jugadores');
        // Fisher-Yates: reparto uniforme
        const ids = players.map(p => p.id);
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(this.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
        }
        const traitorIds = new Set(ids.slice(0, count));
        players.forEach(p => {
            p.role = traitorIds.has(p.id) ? 'traitor' : 'loyal';
            p.alive = true;
            p.eliminatedBy = null;
            p.eliminatedDay = null;
        });
        this.state.day = 1;
        this.state.phase = 'day';
        this.log('start', `Empieza la partida con ${players.length} jugadores`);
    }

    // Nueva partida con los mismos jugadores y pruebas
    restart() {
        const s = this.state;
        const fresh = createState(s.config);
        fresh.players = s.players.map(p => ({ ...p, role: null, alive: true, eliminatedBy: null, eliminatedDay: null }));
        fresh.tests = s.tests.map(t => ({ ...t, score: null, status: 'pending' }));
        this.state = fresh;
    }

    // ----- Avance de fases (MC) -----

    advance() {
        const s = this.state;
        switch (s.phase) {
            case 'lobby':
                return this.start();
            case 'day':
                if (this.today().roundtable > 0) {
                    s.phase = 'roundtable';
                    s.roundsDone = 0;
                    this.startRound();
                } else {
                    this.afterRoundtable();
                }
                return;
            case 'roundtable':
                // Terminar la mesa redonda: la votación abierta se descarta
                if (s.round) this.log('skip', 'El MC cierra la mesa redonda sin más destierros');
                s.round = null;
                return this.afterRoundtable();
            case 'night':
                return this.dawn();
            default:
                throw new GameError('La partida ha terminado');
        }
    }

    afterRoundtable() {
        const s = this.state;
        this.finalizeGhostDay();
        if (this.isLastDay()) return this.finish();
        s.phase = 'night';
        s.nightVotes = {};
        s.nightOverride = null;
        s.conclaveOverride = false;
    }

    dawn() {
        const s = this.state;
        if (s.invitation.status === 'pending') s.invitation.status = 'expired';
        const victims = this.computeNightVictims();
        s.day += 1;
        s.phase = 'day';
        s.roundsDone = 0;
        s.nightVotes = {};
        s.nightOverride = null;
        victims.forEach(p => this.eliminate(p, 'murder', s.day - 1));
        if (victims.length === 0) this.log('nomurder', 'Esta noche no ha habido asesinatos');
        if (!this.checkGameOver()) this.assignGhostTarget();
    }

    eliminate(player, by, day = this.state.day) {
        player.alive = false;
        player.eliminatedBy = by;
        player.eliminatedDay = day;
        const reveal = this.config.revealRole ? ` Era ${player.role === 'traitor' ? 'de los ' + this.config.factions.traitor : 'de los ' + this.config.factions.loyal}.` : '';
        this.log(by, by === 'murder' ? `${player.name} ha sido asesinado.` : `${player.name} ha sido desterrado.${reveal}`, { playerId: player.id });
        const g = this.state.ghosts;
        if (by === 'banish' && g.today && g.today.targetId === player.id && this.config.ghosts.enabled) {
            g.today.eliminated = true;
            this.addSkulls(this.config.ghosts.perElimination);
        }
    }

    finish() {
        const s = this.state;
        this.finalizeGhostDay();
        s.phase = 'end';
        s.round = null;
        s.winner = this.aliveTraitors().length > 0 ? 'traitor' : 'loyal';
        this.log('end', `Ganan los ${s.winner === 'traitor' ? this.config.factions.traitor : this.config.factions.loyal}`);
    }

    checkGameOver() {
        const traitors = this.aliveTraitors().length;
        const loyals = this.aliveLoyals().length;
        if (traitors === 0 || traitors >= loyals) {
            this.finish();
            return true;
        }
        return false;
    }

    // ----- Mesa redonda -----

    startRound(candidates = null, revotes = 0) {
        this.state.round = { number: this.state.roundsDone + 1, votes: {}, candidates, revotes };
    }

    vote(voterId, targetId) {
        const s = this.state;
        this.requirePhase('roundtable');
        if (this.config.voting !== 'app') throw new GameError('En esta partida se vota en persona');
        if (!s.round) throw new GameError('No hay ninguna votación abierta');
        this.requirePlayer(voterId);
        if (voterId === targetId) throw new GameError('No puedes votarte a ti mismo');
        const target = this.getPlayer(targetId);
        if (!target || !target.alive) throw new GameError('Voto no válido');
        if (s.round.candidates && !s.round.candidates.includes(targetId)) {
            throw new GameError('En el desempate solo se puede votar a los empatados');
        }
        s.round.votes[voterId] = targetId;
        if (this.alive().every(p => s.round.votes[p.id])) this.resolveRound();
    }

    roundTally() {
        const tally = {};
        Object.entries(this.state.round?.votes || {}).forEach(([voterId, targetId]) => {
            const voter = this.getPlayer(voterId);
            const target = this.getPlayer(targetId);
            if (voter?.alive && target?.alive) tally[targetId] = (tally[targetId] || 0) + 1;
        });
        return tally;
    }

    // Cierra la votación en la app (automático al votar todos, o el MC antes de tiempo)
    resolveRound() {
        const s = this.state;
        this.requirePhase('roundtable');
        if (!s.round) throw new GameError('No hay ninguna votación abierta');
        const tally = this.roundTally();
        this.scoreGhostVotes(tally[s.ghosts.today?.targetId] || 0);
        const counts = Object.values(tally);
        if (counts.length === 0) return this.endRound(null, 'Nadie ha votado: no se destierra a nadie');
        const max = Math.max(...counts);
        const top = Object.keys(tally).filter(id => tally[id] === max);
        if (top.length > 1) {
            const names = top.map(id => this.getPlayer(id).name).join(', ');
            if (this.config.tieRule === 'revote' && s.round.revotes < MAX_REVOTES) {
                this.log('tie', `Empate entre ${names}: nueva votación solo entre ellos`, { tally });
                this.startRound(top, s.round.revotes + 1);
                return;
            }
            return this.endRound(null, `Empate entre ${names}: no se destierra a nadie`, tally);
        }
        this.endRound(top[0], null, tally);
    }

    // Votación en persona (o el MC rompe un empate): registra directamente al desterrado
    banish(playerId, { targetVotes } = {}) {
        const s = this.state;
        this.requirePhase('roundtable');
        if (!s.round) throw new GameError('No hay ninguna votación abierta');
        const p = this.getPlayer(playerId);
        if (!p || !p.alive) throw new GameError('Jugador no válido');
        if (this.config.voting === 'app') {
            this.scoreGhostVotes(this.roundTally()[s.ghosts.today?.targetId] || 0);
        } else if (targetVotes !== undefined && targetVotes !== null && targetVotes !== '') {
            this.scoreGhostVotes(clampInt(targetVotes, 0, 100, 0));
        }
        this.endRound(p.id);
    }

    skipRound() {
        this.requirePhase('roundtable');
        if (!this.state.round) throw new GameError('No hay ninguna votación abierta');
        this.endRound(null, 'No se destierra a nadie en esta votación');
    }

    endRound(expelledId, reason, tally) {
        const s = this.state;
        s.round = null;
        s.roundsDone += 1;
        if (expelledId) {
            this.eliminate(this.getPlayer(expelledId), 'banish');
            if (tally) s.events[s.events.length - 1].tally = tally;
            if (this.checkGameOver()) return;
        } else {
            this.log('novote', reason, tally ? { tally } : {});
        }
        if (s.roundsDone < this.today().roundtable) this.startRound();
    }

    // ----- Cónclave -----

    nightVote(traitorId, victimIds) {
        const s = this.state;
        const traitor = this.requirePlayer(traitorId);
        if (traitor.role !== 'traitor') throw new GameError('No tienes acceso al cónclave');
        this.requireConclave();
        const kills = this.today().conclave;
        if (kills === 0) throw new GameError('Esta noche no hay asesinatos');
        const ids = [...new Set(Array.isArray(victimIds) ? victimIds : [victimIds])].slice(0, kills);
        ids.forEach(id => {
            const v = this.getPlayer(id);
            if (!v || !v.alive || v.role === 'traitor') throw new GameError('Víctima no válida');
        });
        s.nightVotes[traitorId] = ids;
    }

    // El MC puede decidir las víctimas (p. ej. si los traidores no se ponen de acuerdo)
    setNightVictims(ids) {
        this.requirePhase('night');
        if (ids === null) { this.state.nightOverride = null; return; }
        const victims = [...new Set(ids)].map(id => this.getPlayer(id));
        if (victims.some(v => !v || !v.alive)) throw new GameError('Víctima no válida');
        if (victims.length > this.today().conclave) throw new GameError(`Esta noche solo hay ${this.today().conclave} asesinato(s)`);
        this.state.nightOverride = victims.map(v => v.id);
    }

    nightTally() {
        const tally = {};
        Object.entries(this.state.nightVotes).forEach(([traitorId, ids]) => {
            if (!this.getPlayer(traitorId)?.alive) return;
            ids.forEach(id => { tally[id] = (tally[id] || 0) + 1; });
        });
        return tally;
    }

    computeNightVictims() {
        const s = this.state;
        if (s.nightOverride) return s.nightOverride.map(id => this.getPlayer(id)).filter(p => p?.alive);
        const tally = this.nightTally();
        const kills = this.today().conclave;
        return Object.keys(tally)
            .map(id => ({ id, votes: tally[id], tiebreak: this.random() }))
            .sort((a, b) => b.votes - a.votes || a.tiebreak - b.tiebreak)
            .slice(0, kills)
            .map(x => this.getPlayer(x.id))
            .filter(p => p?.alive && p.role !== 'traitor');
    }

    invite(traitorId, targetId) {
        const s = this.state;
        const traitor = this.requirePlayer(traitorId);
        if (traitor.role !== 'traitor') throw new GameError('No tienes acceso al cónclave');
        if (!this.config.invitation || s.day !== 1) throw new GameError('Solo se puede reclutar la primera noche');
        this.requireConclave();
        if (s.invitation.status !== 'none') throw new GameError('La invitación ya se ha usado');
        const target = this.getPlayer(targetId);
        if (!target || !target.alive || target.role !== 'loyal') throw new GameError('Jugador no válido para reclutar');
        if (this.aliveTraitors().length + 1 >= this.aliveLoyals().length - 1) {
            throw new GameError('Hay muy pocos jugadores para reclutar a otro traidor');
        }
        s.invitation = { status: 'pending', targetId, byId: traitorId };
        return target;
    }

    respondInvitation(playerId, accept) {
        const s = this.state;
        if (s.invitation.status !== 'pending' || s.invitation.targetId !== playerId) {
            throw new GameError('No tienes ninguna invitación pendiente');
        }
        this.requirePhase('night');
        const player = this.requirePlayer(playerId);
        s.invitation.status = accept ? 'accepted' : 'rejected';
        if (accept) player.role = 'traitor';
        return player;
    }

    // ----- Sociedad Secreta de los Fantasmas -----

    assignGhostTarget() {
        const g = this.state.ghosts;
        g.today = null;
        if (!this.config.ghosts.enabled || this.dead().length === 0) return null;
        const candidates = this.aliveLoyals();
        if (candidates.length === 0) return null;
        const target = candidates[Math.floor(this.random() * candidates.length)];
        g.today = { day: this.state.day, targetId: target.id, votes: 0, eliminated: false, skulls: 0 };
        return target;
    }

    addSkulls(n) {
        const g = this.state.ghosts;
        g.skulls += n;
        if (g.today) g.today.skulls += n;
    }

    scoreGhostVotes(votes) {
        const g = this.state.ghosts;
        if (!g.today || !this.config.ghosts.enabled || votes <= 0) return;
        g.today.votes += votes;
        this.addSkulls(votes * this.config.ghosts.perVote);
    }

    finalizeGhostDay() {
        const g = this.state.ghosts;
        if (g.today) g.history.push(g.today);
        g.today = null;
    }

    ghostSummary() {
        const g = this.state.ghosts;
        const { thresholds } = this.config.ghosts;
        const percent = ghostLootPercent(g.skulls, thresholds);
        const name = id => this.getPlayer(id)?.name || '?';
        const treasure = this.treasure();
        return {
            skulls: g.skulls,
            percent,
            stolen: Math.floor(treasure * percent / 100),
            target: g.today ? { name: name(g.today.targetId), votes: g.today.votes, skulls: g.today.skulls } : null,
            nextThreshold: thresholds.find(t => g.skulls < t.skulls) || null,
            thresholds,
            perVote: this.config.ghosts.perVote,
            perElimination: this.config.ghosts.perElimination,
            history: g.history.map(h => ({ ...h, targetName: name(h.targetId) }))
        };
    }

    // ----- Pruebas y botín -----

    getTest(id) {
        const t = this.state.tests.find(x => x.id === id);
        if (!t) throw new GameError('Prueba no encontrada');
        return t;
    }

    addTest({ name, max, description }) {
        if (this.state.tests.length >= 30) throw new GameError('Demasiadas pruebas');
        const test = {
            id: uuid(), name: cleanText(name, 60), description: cleanText(description, 2000),
            max: clampInt(max, 0, 10000000, 0), score: null, status: 'pending'
        };
        if (!test.name) throw new GameError('Introduce el nombre de la prueba');
        this.state.tests.push(test);
        return test;
    }

    // Se actualiza la prueba existente: nunca se crean filas duplicadas
    updateTest(id, changes) {
        const t = this.getTest(id);
        if (changes.name !== undefined) t.name = cleanText(changes.name, 60, t.name);
        if (changes.description !== undefined) t.description = cleanText(changes.description, 2000);
        if (changes.max !== undefined) t.max = clampInt(changes.max, 0, 10000000, t.max);
        if (changes.status !== undefined && ['pending', 'active', 'done'].includes(changes.status)) t.status = changes.status;
        if (changes.score !== undefined) {
            if (changes.score === null || changes.score === '') {
                t.score = null;
            } else {
                const n = clampInt(changes.score, 0, 10000000, null);
                if (n === null) throw new GameError('Puntuación no válida');
                if (t.max > 0 && n > t.max) throw new GameError(`La puntuación máxima de esta prueba es ${t.max}`);
                t.score = n;
                t.status = 'done';
            }
        }
        return t;
    }

    removeTest(id) {
        const t = this.getTest(id);
        if (t.score !== null) throw new GameError('No se puede borrar una prueba ya puntuada');
        this.state.tests = this.state.tests.filter(x => x.id !== id);
        if (this.state.spotlight === id) this.state.spotlight = null;
    }

    // El MC lanza una prueba a la tele (y a los móviles); null la quita
    setSpotlight(id) {
        if (id === null) { this.state.spotlight = null; return null; }
        const t = this.getTest(id);
        if (t.status === 'pending') t.status = 'active';
        this.state.spotlight = t.id;
        return t;
    }

    // ----- Chat y mensajes del MC -----

    addChat(playerId, channel, message) {
        const s = this.state;
        const player = this.requirePlayer(playerId, { alive: false });
        const text = cleanText(message, MAX_MESSAGE_LENGTH);
        if (!text) throw new GameError('Mensaje vacío');
        if (channel === 'dead') {
            if (player.alive) throw new GameError('Solo los eliminados pueden usar este chat');
        } else if (channel === 'traitors') {
            if (!player.alive || player.role !== 'traitor') throw new GameError('No tienes acceso a este chat');
        } else {
            channel = 'general';
            if (!player.alive && s.phase !== 'end') throw new GameError('Has sido eliminado: usa el chat de muertos');
        }
        return this.pushChat(channel, { fromId: player.id, from: player.name, message: text });
    }

    pushChat(channel, msg) {
        const full = { id: uuid(), at: this.now().toISOString(), channel, ...msg };
        const list = this.state.chat[channel];
        list.push(full);
        if (list.length > MAX_CHAT_HISTORY) list.splice(0, list.length - MAX_CHAT_HISTORY);
        return full;
    }

    // Anuncio público o mensaje privado del MC a un jugador
    mcMessage(text, toId = null) {
        const message = cleanText(text, MAX_MESSAGE_LENGTH);
        if (!message) throw new GameError('Mensaje vacío');
        if (!toId) return this.pushChat('general', { fromMc: true, from: 'MC', message });
        if (!this.getPlayer(toId)) throw new GameError('Jugador no encontrado');
        const msg = { id: uuid(), at: this.now().toISOString(), message };
        const box = (this.state.inbox[toId] = this.state.inbox[toId] || []);
        box.push(msg);
        if (box.length > 50) box.shift();
        return msg;
    }

    // ---------- Vistas: qué puede ver cada uno ----------

    photoUrl(code, p) {
        return p.photo ? `/api/rooms/${code}/photos/${p.id}?v=${p.photoVersion}` : null;
    }

    publicView(code) {
        const s = this.state;
        const c = this.config;
        const ended = s.phase === 'end';
        return {
            code,
            name: c.name,
            factions: c.factions,
            days: c.days,
            schedule: c.schedule,
            voting: c.voting,
            goldPerEuro: c.goldPerEuro,
            conclaveHours: c.conclaveHours,
            phase: s.phase,
            day: s.day,
            today: this.today(),
            roundsDone: s.roundsDone,
            round: s.round && {
                number: s.round.number,
                candidates: s.round.candidates,
                revotes: s.round.revotes,
                voters: Object.keys(s.round.votes)
            },
            conclaveOpen: this.conclaveOpen(),
            players: s.players.map(p => ({
                id: p.id,
                name: p.name,
                photo: this.photoUrl(code, p),
                alive: p.alive,
                eliminatedBy: p.eliminatedBy,
                eliminatedDay: p.eliminatedDay,
                // El rol solo se conoce al terminar, o al ser eliminado si así se configura
                role: ended || (!p.alive && c.revealRole) ? p.role : undefined
            })),
            tests: s.tests.map(({ id, name, description, max, score, status }) => ({ id, name, description: description || '', max, score, status })),
            spotlight: s.spotlight || null,
            treasure: this.treasure(),
            maxTreasure: s.tests.reduce((sum, t) => sum + t.max, 0),
            events: s.events.slice(-30),
            winner: s.winner,
            // Los Fantasmas son secretos: solo se revelan al terminar
            ghosts: ended && c.ghosts.enabled ? this.ghostSummary() : undefined
        };
    }

    privateView(playerId) {
        const s = this.state;
        const p = this.getPlayer(playerId);
        if (!p) return null;
        const view = {
            playerId: p.id,
            role: p.role,
            myVote: s.round?.votes[p.id] || null,
            invitationPending: s.invitation.status === 'pending' && s.invitation.targetId === p.id,
            inbox: s.inbox[p.id] || []
        };
        if (p.role === 'traitor') {
            view.allies = s.players.filter(x => x.role === 'traitor').map(x => ({ id: x.id, name: x.name, alive: x.alive }));
            view.conclave = {
                kills: s.phase === 'night' ? this.today().conclave : 0,
                myVotes: s.nightVotes[p.id] || [],
                // Los traidores ven las elecciones de sus compañeros
                votes: Object.entries(s.nightVotes).map(([id, ids]) => ({ by: this.getPlayer(id)?.name, victims: ids })),
                invitation: {
                    available: this.config.invitation && s.day === 1 && s.invitation.status === 'none',
                    status: s.invitation.status,
                    targetName: s.invitation.targetId ? this.getPlayer(s.invitation.targetId)?.name : null
                }
            };
        }
        if (!p.alive && this.config.ghosts.enabled) view.ghostSociety = this.ghostSummary();
        return view;
    }

    // El MC lo ve todo
    masterView(code) {
        const s = this.state;
        return {
            ...this.publicView(code),
            config: this.config,
            roles: Object.fromEntries(s.players.map(p => [p.id, p.role])),
            roundVotes: s.round ? s.round.votes : {},
            roundTally: s.round ? this.roundTally() : {},
            nightVotes: s.nightVotes,
            nightTally: this.nightTally(),
            nightOverride: s.nightOverride,
            invitation: s.invitation,
            conclaveOverride: s.conclaveOverride,
            ghosts: this.ghostSummary(),
            aliveCounts: { traitor: this.aliveTraitors().length, loyal: this.aliveLoyals().length },
            inbox: s.inbox
        };
    }
}

module.exports = {
    Game,
    GameError,
    createState,
    normalizeConfig,
    ghostLootPercent,
    isWithinHours,
    autoTraitorCount,
    PRESETS,
    DEFAULT_CONFIG,
    MIN_PLAYERS
};
