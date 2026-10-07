// Reglas añadidas después: preferencia de rol, escudo, final, horario, «¿Quién dijo qué?» y modo online
const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError, createState, normalizeConfig, crossedTime, INTERVIEW_QUESTIONS } = require('./game');

function setup(n = 12, config = {}) {
    const g = new Game(createState(config), () => new Date(), () => 0);
    for (let i = 0; i < n; i++) g.addPlayer({ name: `P${i}` });
    g.start();
    return {
        g,
        traitors: g.state.players.filter(p => p.role === 'traitor'),
        loyals: g.state.players.filter(p => p.role === 'loyal')
    };
}

const voteAll = (g, targetId, exceptId) =>
    g.alive().forEach(p => { if (g.state.round) g.vote(p.id, p.id === targetId ? exceptId : targetId); });

test('reparto con preferencia: quien quiere ser Felón sale mucho más, quien no, mucho menos (pero puede)', () => {
    const count = { yes: 0, no: 0 };
    let x = 7;
    const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    for (let i = 0; i < 2000; i++) {
        const g = new Game(createState({ traitorCount: 1 }), () => new Date(), rnd);
        g.addPlayer({ name: 'Quiero', wantsTraitor: 'yes' });
        g.addPlayer({ name: 'NoQuiero', wantsTraitor: 'no' });
        for (let k = 0; k < 4; k++) g.addPlayer({ name: `Igual${k}` });
        g.start();
        const t = g.state.players.find(p => p.role === 'traitor').name;
        if (t === 'Quiero') count.yes++;
        if (t === 'NoQuiero') count.no++;
    }
    // Papeletas 4 / 0,25 / 1×4 → 4/8,25 ≈ 48 % y 0,25/8,25 ≈ 3 %
    assert.ok(count.yes > 850 && count.yes < 1100, `quiere: ${count.yes}`);
    assert.ok(count.no > 20 && count.no < 120, `no quiere: ${count.no}`);
});

test('escudo: frena el asesinato de esa noche y caduca al amanecer', () => {
    const { g, traitors, loyals } = setup(8);
    g.advance(); // día 1 → noche (sin mesa)
    g.grantShield(loyals[0].id);
    g.state.config.schedule[0].conclave = 1;
    g.nightVote(traitors[0].id, [loyals[0].id]);
    g.advance(); // amanecer
    assert.ok(g.getPlayer(loyals[0].id).alive, 'el escudo le salva');
    assert.deepStrictEqual(g.state.shields, {});
    assert.ok(g.state.events.some(e => e.type === 'nomurder'));
});

test('final: sin unanimidad hay otro destierro; con unanimidad termina', () => {
    const { g, traitors, loyals } = setup(8, { days: 1, schedule: [{ roundtable: 1, conclave: 0 }] });
    g.advance(); // mesa redonda
    voteAll(g, loyals[0].id, loyals[1].id);
    g.advance(); // el MC cierra la mesa del último día
    assert.strictEqual(g.state.phase, 'endgame');
    g.alive().forEach((p, i) => g.endgameVote(p.id, i === 0 ? 'banish' : 'end'));
    assert.strictEqual(g.state.phase, 'roundtable', 'sin unanimidad: otro destierro');
    voteAll(g, loyals[1].id, loyals[2].id);
    assert.strictEqual(g.state.phase, 'endgame', 'tras el destierro se vuelve a decidir');
    g.alive().forEach(p => g.endgameVote(p.id, 'end'));
    assert.strictEqual(g.state.phase, 'end');
    assert.strictEqual(g.state.winner, 'traitor');
    const r = g.results();
    assert.ok(r.players.filter(p => p.won).every(p => traitors.some(t => t.name === p.name)));
});

test('horario automático: cruza la hora en la zona horaria correcta', () => {
    const at = iso => new Date(iso);
    // 18:50 → 19:10 en Madrid (UTC+2 en octubre) cruza las 19:00
    assert.ok(crossedTime(at('2026-10-07T16:50:00Z'), at('2026-10-07T17:10:00Z'), '19:00', 'Europe/Madrid'));
    assert.ok(!crossedTime(at('2026-10-07T17:01:00Z'), at('2026-10-07T17:30:00Z'), '19:00', 'Europe/Madrid'));
    // De la noche a la mañana siguiente cruza las 10:00
    assert.ok(crossedTime(at('2026-10-07T20:30:00Z'), at('2026-10-08T08:05:00Z'), '10:00', 'Europe/Madrid'));
});

test('horario automático: día → mesa → noche → amanecer, y el MC puede seguir avanzando a mano', () => {
    let now = new Date('2026-10-07T08:00:00Z'); // 10:00 en Madrid
    const g = new Game(createState({ timetable: { enabled: true, dawn: '10:00', roundtable: '19:00', night: '22:30' } }), () => now, () => 0.5);
    for (let i = 0; i < 6; i++) g.addPlayer({ name: `P${i}` });
    g.start();
    g.state.config.schedule = [1, 2, 3, 4].map(() => ({ roundtable: 1, conclave: 0 }));
    g.autoStep(); // anota el inicio del día
    now = new Date('2026-10-07T17:01:00Z'); // 19:01
    assert.ok(g.autoStep());
    assert.strictEqual(g.state.phase, 'roundtable');
    now = new Date('2026-10-07T20:31:00Z'); // 22:31
    assert.ok(g.autoStep());
    assert.strictEqual(g.state.phase, 'night');
    assert.ok(!g.autoStep(), 'a las 22:31 no toca nada más');
    now = new Date('2026-10-08T08:01:00Z'); // 10:01 del día siguiente
    assert.ok(g.autoStep());
    assert.strictEqual(g.state.phase, 'day');
    assert.strictEqual(g.state.day, 2);
    g.advance(); // el MC adelanta la mesa a mano
    assert.strictEqual(g.state.phase, 'roundtable');
});

test('¿Quién dijo qué?: los aciertos suman oro a su prueba', () => {
    const g = new Game(createState({ quizGold: 100 }), () => new Date(), () => 0);
    g.addPlayer({ name: 'Ana', answers: [{ q: INTERVIEW_QUESTIONS[0], a: 'Socorrista' }] });
    ['Bea', 'Carlos', 'Dani'].forEach(name => g.addPlayer({ name }));
    g.start();
    const q = g.quizNext();
    assert.strictEqual(q.answer, 'Socorrista');
    const [ana, bea, carlos, dani] = g.state.players;
    assert.throws(() => g.quizGuess(ana.id, ana.id), GameError, 'la autora no adivina');
    g.quizGuess(bea.id, ana.id);
    g.quizGuess(carlos.id, ana.id);
    g.quizGuess(dani.id, bea.id);
    g.quizReveal();
    assert.strictEqual(g.state.quiz.correct.length, 2);
    assert.strictEqual(g.state.tests.find(t => t.quiz).score, 200);
    assert.throws(() => g.quizNext(), GameError, 'no quedan respuestas');
});

test('entrevista: solo preguntas de la lista, sin repetir y como mucho tres', () => {
    const g = new Game(createState());
    const p = g.addPlayer({
        name: 'Eva',
        answers: [
            { q: INTERVIEW_QUESTIONS[0], a: 'Uno' }, { q: INTERVIEW_QUESTIONS[0], a: 'Repetida' },
            { q: 'Inventada', a: 'No vale' }, { q: INTERVIEW_QUESTIONS[1], a: '' },
            { q: INTERVIEW_QUESTIONS[2], a: 'Dos' }, { q: INTERVIEW_QUESTIONS[3], a: 'Tres' }, { q: INTERVIEW_QUESTIONS[4], a: 'Cuatro' }
        ]
    });
    assert.deepStrictEqual(p.answers.map(x => x.a), ['Uno', 'Dos', 'Tres']);
});

test('MC a ciegas: sin roles ni cónclave; panel completo solo si aprueban todos los vivos', () => {
    const { g, traitors } = setup(6);
    g.advance(); // noche 1
    g.state.config.schedule[0].conclave = 1;
    g.nightVote(traitors[0].id, [g.aliveLoyals()[0].id]);
    let mv = g.masterView('X');
    assert.strictEqual(mv.roles, undefined);
    assert.strictEqual(mv.nightVotes, undefined, 'no sabe qué Felón eligió');
    assert.strictEqual(mv.aliveCounts, undefined);
    assert.strictEqual(mv.invitation, undefined);
    assert.ok(Object.keys(mv.nightTally).length === 1, 'pero sí qué víctima hay elegida');
    g.requestUnlock();
    const [a, b, ...rest] = g.alive();
    g.unlockVote(a.id, true);
    g.unlockVote(b.id, false); // basta un «no»
    assert.strictEqual(g.state.unlock.status, 'none');
    g.requestUnlock();
    g.alive().forEach(p => g.unlockVote(p.id, true));
    mv = g.masterView('X');
    assert.strictEqual(mv.fullAccess, true);
    assert.strictEqual(mv.roles[traitors[0].id], 'traitor');
    assert.ok(rest.length > 0);
});

test('sin MC: el organizador juega; la prueba sale sola y da escudo; si le eliminan ve el panel', () => {
    let now = new Date('2026-10-07T08:00:00Z');
    const g = new Game(createState({ hostless: true, mode: 'online', days: 3 }), () => now, () => 0);
    assert.strictEqual(g.config.voting, 'app');
    assert.strictEqual(g.config.timetable.enabled, true);
    const org = g.addPlayer({ name: 'Iván', answers: [{ q: INTERVIEW_QUESTIONS[0], a: 'Socorrista' }] });
    org.organizer = true;
    for (let i = 0; i < 5; i++) g.addPlayer({ name: `P${i}` });
    g.start();
    g.trackPhase(); // amanece el día 1: sale la prueba sola
    assert.ok(g.state.quiz && g.state.quiz.answer === 'Socorrista');
    const guesser = g.state.players.find(p => p.id !== org.id);
    g.quizGuess(guesser.id, org.id);
    g.advance(); // día 1 sin mesa → noche: se desvela y quien acierta se lleva el escudo
    g.trackPhase();
    assert.ok(g.state.quiz === null || g.state.quiz.revealed);
    assert.strictEqual(g.state.shields[guesser.id], 1);
    assert.strictEqual(g.fullAccess(), false);
    org.alive = false;
    assert.strictEqual(g.fullAccess(), true, 'el organizador eliminado ve el panel completo');
});

test('finalizar partida: en cualquier fase, con el ganador que toque', () => {
    const { g } = setup(8);
    g.advance(); // noche
    g.endNow();
    assert.strictEqual(g.state.phase, 'end');
    assert.strictEqual(g.state.winner, 'traitor', 'quedan Felones vivos');
    assert.throws(() => g.endNow(), GameError);
});

test('modo online: sin Fantasmas', () => {
    assert.strictEqual(normalizeConfig({ mode: 'online' }).ghosts.enabled, false);
    assert.strictEqual(normalizeConfig({ mode: 'presencial' }).ghosts.enabled, true);
});

test('bots: juegan también el final y «¿Quién dijo qué?»', () => {
    let x = 3;
    const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    const g = new Game(createState({ days: 2 }), () => new Date(), rnd);
    g.addBots(10);
    g.advance();
    g.quizNext();
    g.botMoves();
    assert.strictEqual(Object.keys(g.state.quiz.guesses).length, 9, 'todos menos el autor');
    g.quizReveal();
    g.quizClose();
    for (let step = 0; step < 300 && g.state.phase !== 'end'; step++) {
        if (!g.botMoves()) g.advance();
    }
    assert.strictEqual(g.state.phase, 'end');
});
