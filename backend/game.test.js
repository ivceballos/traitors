const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError, createState, normalizeConfig, ghostLootPercent, ghostMaxSkulls, isWithinHours, PRESETS } = require('./game');

// Partida de n jugadores ya empezada, con reparto determinista
function setup(n = 12, config = {}, tests = []) {
    const g = new Game(createState(config, tests), () => new Date(), () => 0);
    for (let i = 0; i < n; i++) g.addPlayer({ name: `P${i}` });
    g.start();
    const traitors = g.state.players.filter(p => p.role === 'traitor');
    const loyals = g.state.players.filter(p => p.role === 'loyal');
    return { g, traitors, loyals };
}

const voteAll = (g, targetId, exceptId) =>
    g.alive().forEach(p => { if (g.state.round) g.vote(p.id, p.id === targetId ? exceptId : targetId); });

test('configuración: valores por defecto, límites y calendario', () => {
    const c = normalizeConfig({ days: 3, schedule: [{ roundtable: 9, conclave: 1 }], voting: 'x' });
    assert.strictEqual(c.days, 3);
    assert.strictEqual(c.schedule.length, 3);
    assert.strictEqual(c.schedule[0].roundtable, 5, 'se limita a 5');
    assert.strictEqual(c.schedule[2].conclave, 0, 'la última noche no se juega');
    assert.strictEqual(c.voting, 'app');
    assert.deepStrictEqual(normalizeConfig({ ghosts: { thresholds: [{ skulls: 30, percent: 100 }, { skulls: 10, percent: 50 }] } })
        .ghosts.thresholds.map(t => t.skulls), [10, 30]);
});

test('reparto: automático (3 traidores con 12) o fijado por el MC', () => {
    assert.strictEqual(setup(12).traitors.length, 3);
    assert.strictEqual(setup(5).traitors.length, 1);
    assert.strictEqual(setup(8, { traitorCount: 3 }).traitors.length, 3);
    const g = new Game(createState({ traitorCount: 2 }));
    ['A', 'B', 'C', 'D'].forEach(name => g.addPlayer({ name }));
    assert.throws(() => g.start(), /Demasiados traidores/);
});

test('sala de espera: nombres únicos, fotos validadas, no se entra tras empezar', () => {
    const g = new Game(createState());
    g.addPlayer({ name: 'Ana' });
    assert.throws(() => g.addPlayer({ name: 'ana' }), /en uso/);
    assert.throws(() => g.addPlayer({ name: 'Luis', photo: 'http://x/y.jpg' }), /Foto/);
    g.addPlayer({ name: 'Luis', photo: 'data:image/jpeg;base64,AAAA' });
    ['B', 'C'].forEach(name => g.addPlayer({ name }));
    g.start();
    assert.throws(() => g.addPlayer({ name: 'Tarde' }), GameError);
});

test('calendario Fieles y Felones: 12 → 10 → 6 → 5', () => {
    const preset = PRESETS['fieles-felones'];
    const { g, loyals } = setup(12, { ...preset.config, traitorCount: 2 }, preset.tests);
    assert.strictEqual(g.state.tests.length, 7);
    g.advance(); // día 1 sin mesa -> noche
    assert.strictEqual(g.state.phase, 'night');
    g.advance(); // amanecer día 2 sin asesinatos
    assert.strictEqual(g.alive().length, 12);
    const victims = [...loyals];
    // Día 2: 1 mesa + 1 cónclave
    g.advance();
    g.banish(victims.shift().id);
    assert.strictEqual(g.state.round, null, 'solo una votación el día 2');
    g.advance(); // noche
    g.setNightVictims([victims.shift().id]);
    g.advance();
    assert.strictEqual(g.alive().length, 10);
    // Día 3: 2 mesas + 2 cónclave
    g.advance();
    g.banish(victims.shift().id);
    assert.ok(g.state.round, 'segunda votación abierta automáticamente');
    g.banish(victims.shift().id);
    g.advance();
    g.setNightVictims([victims.shift().id, victims.shift().id]);
    g.advance();
    assert.strictEqual(g.alive().length, 6);
    // Día 4: 1 mesa y final
    g.advance();
    g.banish(victims.shift().id);
    g.advance();
    assert.strictEqual(g.state.phase, 'endgame', 'tras el último día llega el final');
    g.decideEndgame('end'); // en persona: el MC registra que deciden acabar
    assert.strictEqual(g.state.phase, 'end');
    assert.strictEqual(g.alive().length, 5);
    assert.strictEqual(g.state.winner, 'traitor', 'si queda algún traidor al final, ganan ellos');
});

test('votación en la app: se resuelve sola y revela el rol', () => {
    const { g, loyals, traitors } = setup(8);
    g.advance(); g.advance(); g.advance(); // noche 1 -> día 2 -> mesa
    voteAll(g, traitors[0].id, loyals[0].id);
    assert.strictEqual(g.getPlayer(traitors[0].id).alive, false);
    assert.strictEqual(g.publicView('X').players.find(p => p.id === traitors[0].id).role, 'traitor');
});

test('empate: nueva votación solo entre empatados', () => {
    const { g, loyals } = setup(6);
    g.advance(); g.advance(); g.advance();
    const [a, b] = loyals;
    g.alive().forEach((p, i) => g.vote(p.id, p.id === a.id ? b.id : p.id === b.id ? a.id : (i % 2 ? a.id : b.id)));
    assert.deepStrictEqual([...g.state.round.candidates].sort(), [a.id, b.id].sort());
    assert.throws(() => g.vote(loyals[2].id, loyals[3].id), /empatados/);
    g.alive().forEach(p => g.vote(p.id, p.id === a.id ? b.id : a.id));
    assert.strictEqual(g.getPlayer(a.id).alive, false);
});

test('empate con regla "nadie": no se destierra a nadie', () => {
    const { g, loyals } = setup(6, { tieRule: 'none' });
    g.advance(); g.advance(); g.advance();
    const [a, b] = loyals;
    g.vote(a.id, b.id);
    g.vote(b.id, a.id);
    g.resolveRound();
    assert.strictEqual(g.alive().length, 6);
    assert.strictEqual(g.state.round, null);
});

test('votación en persona: no se vota en la app, el MC registra', () => {
    const { g, loyals } = setup(8, { voting: 'inperson' });
    g.advance(); g.advance(); g.advance();
    assert.throws(() => g.vote(loyals[0].id, loyals[1].id), /en persona/);
    g.banish(loyals[1].id);
    assert.strictEqual(g.getPlayer(loyals[1].id).eliminatedBy, 'banish');
});

test('cónclave: los traidores votan víctimas y gana la más votada', () => {
    const { g, traitors, loyals } = setup(10);
    g.advance(); g.advance(); g.advance(); // mesa día 2
    g.skipRound();
    g.advance(); // noche 2
    assert.throws(() => g.nightVote(loyals[0].id, [loyals[1].id]), /cónclave/);
    assert.throws(() => g.nightVote(traitors[0].id, [traitors[1].id]), /no válida/);
    g.nightVote(traitors[0].id, [loyals[1].id]);
    g.nightVote(traitors[1].id, [loyals[1].id]);
    assert.deepStrictEqual(g.nightTally(), { [loyals[1].id]: 2 });
    g.advance();
    assert.strictEqual(g.getPlayer(loyals[1].id).eliminatedBy, 'murder');
});

test('cónclave con horario: cerrado fuera de horas salvo que lo abra el MC', () => {
    const tenAm = () => new Date('2026-10-07T08:00:00Z'); // 10:00 en Madrid
    const g = new Game(createState({ conclaveHours: { start: '22:30', end: '03:00' } }), tenAm, () => 0);
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach(name => g.addPlayer({ name }));
    g.start(); g.advance(); g.advance(); g.advance(); g.skipRound(); g.advance();
    const traitor = g.aliveTraitors()[0];
    const loyal = g.aliveLoyals()[0];
    assert.throws(() => g.nightVote(traitor.id, [loyal.id]), /22:30/);
    g.state.conclaveOverride = true;
    g.nightVote(traitor.id, [loyal.id]);
});

test('horario cruzando la medianoche en hora de Madrid', () => {
    const h = { start: '22:30', end: '03:00' };
    assert.strictEqual(isWithinHours(h, 'Europe/Madrid', new Date('2026-10-07T20:29:00Z')), false);
    assert.strictEqual(isWithinHours(h, 'Europe/Madrid', new Date('2026-10-07T20:30:00Z')), true);
    assert.strictEqual(isWithinHours(h, 'Europe/Madrid', new Date('2026-10-08T01:00:00Z')), false);
});

test('reclutamiento la primera noche', () => {
    const { g, traitors, loyals } = setup(10);
    g.advance(); // noche 1
    g.invite(traitors[0].id, loyals[0].id);
    assert.throws(() => g.invite(traitors[1].id, loyals[1].id), /ya se ha usado/);
    g.respondInvitation(loyals[0].id, true);
    assert.strictEqual(g.getPlayer(loyals[0].id).role, 'traitor');
    assert.strictEqual(g.privateView(traitors[0].id).allies.length, 3);
});

test('pruebas: se actualiza la prueba existente (sin duplicados) y el botín es la suma', () => {
    const g = new Game(createState({}, [{ name: 'Llave o Muerte', max: 6000 }]));
    const id = g.state.tests[0].id;
    g.updateTest(id, { score: 4500 });
    g.updateTest(id, { score: 5000 });
    assert.strictEqual(g.state.tests.length, 1);
    assert.strictEqual(g.treasure(), 5000);
    assert.throws(() => g.updateTest(id, { score: 7000 }), /máxima/);
    assert.throws(() => g.removeTest(id), /puntuada/);
    g.addTest({ name: 'Aguas Tensas', max: 4000 });
    assert.strictEqual(g.publicView('X').maxTreasure, 10000);
});

test('Fantasmas: umbrales manuales', () => {
    const t = normalizeConfig({ ghosts: { auto: false, thresholds: [{ skulls: 18, percent: 50 }, { skulls: 26, percent: 75 }, { skulls: 33, percent: 100 }] } }).ghosts.thresholds;
    assert.strictEqual(ghostLootPercent(17, t), 0);
    assert.strictEqual(ghostLootPercent(18, t), 50);
    assert.strictEqual(ghostLootPercent(26, t), 75);
    assert.strictEqual(ghostLootPercent(40, t), 100);
});

test('Fantasmas: umbrales automáticos según calendario y jugadores', () => {
    const despedida = normalizeConfig(PRESETS['fieles-felones'].config);
    assert.strictEqual(ghostMaxSkulls(despedida, 12), 26);
    const { g } = setup(12, PRESETS['fieles-felones'].config);
    assert.deepStrictEqual(g.ghostThresholds().map(t => t.skulls), [8, 12, 16]);
    const small = setup(6).g.ghostThresholds().map(t => t.skulls);
    assert.ok(small[0] >= 1 && small[0] < small[1] && small[1] < small[2], 'crecientes también con pocos jugadores');
});

test('Fantasmas: objetivo vivo de cualquier bando, 1 calavera por voto y +2 si cae', () => {
    const { g, loyals } = setup(10);
    g.advance(); g.advance(); g.advance(); // mesa día 2
    voteAll(g, loyals[0].id, loyals[1].id); // primer muerto: aún no hay fantasmas
    assert.strictEqual(g.state.ghosts.history.length, 0);
    g.advance(); g.advance(); // noche -> día 3 (ya hay fantasmas)
    const target = g.state.ghosts.today.targetId;
    assert.ok(g.getPlayer(target).alive);
    g.advance(); // mesa
    const other = g.alive().find(p => p.id !== target).id;
    const voters = g.alive().length - 1; // todos menos el objetivo le votan
    voteAll(g, target, other);
    assert.strictEqual(g.getPlayer(target).alive, false);
    assert.strictEqual(g.state.ghosts.skulls, voters * 1 + 2);
});

test('Fantasmas: en persona los apuntan los propios Fantasmas (el MC no sabe nada)', () => {
    const { g } = setup(10, { voting: 'inperson' });
    g.advance(); g.advance(); g.advance();
    const firstDead = g.aliveLoyals()[0];
    g.banish(firstDead.id);
    g.advance(); g.advance(); g.advance();
    const target = g.state.ghosts.today.targetId;
    const other = g.aliveLoyals().find(p => p.id !== target).id;
    g.banish(other); // el MC destierra sin saber nada del objetivo
    assert.throws(() => g.ghostReport(g.alive()[0].id, 4), GameError, 'un vivo no puede');
    g.ghostReport(firstDead.id, 4);
    assert.strictEqual(g.state.ghosts.skulls, 4);
    assert.throws(() => g.ghostReport(firstDead.id, 2), /Ya se han apuntado/);
    assert.strictEqual(g.masterView('TEST').ghosts, undefined, 'el MC no ve a los Fantasmas');
    assert.strictEqual(g.masterView('TEST').roles, undefined, 'ni los roles');
});

test('Fantasmas: los desempates y «no sale nadie» no vuelven a puntuar', () => {
    const { g, loyals } = setup(10, { schedule: [{ roundtable: 0, conclave: 0 }, { roundtable: 1, conclave: 0 }, { roundtable: 2, conclave: 0 }, { roundtable: 1, conclave: 0 }] });
    g.advance(); g.advance(); g.advance();
    voteAll(g, loyals[0].id, loyals[1].id);
    g.advance(); g.advance(); g.advance(); // día 3, ya hay objetivo
    const target = g.state.ghosts.today.targetId;
    const others = g.alive().filter(p => p.id !== target);
    // Empate 4-4 entre el objetivo y otro (dos abstenciones): 4 calaveras
    const rival = others[0].id;
    others.slice(1, 5).forEach(p => g.vote(p.id, target));
    others.slice(5, 8).forEach(p => g.vote(p.id, rival));
    g.vote(target, rival);
    assert.throws(() => g.vote(target, others[1].id), /ya está registrado/, 'el voto no se cambia');
    g.resolveRound();
    assert.strictEqual(g.state.ghosts.skulls, 4);
    assert.strictEqual(g.state.round.revotes, 1, 'desempate abierto');
    g.skipRound();
    assert.strictEqual(g.state.ghosts.skulls, 4, 'el desempate y el salto no suman');
});

test('noche: todos señalan sospechoso y el MC ve el recuento', () => {
    const { g, traitors, loyals } = setup(8);
    assert.throws(() => g.suspect(loyals[0].id, traitors[0].id), GameError, 'solo de noche');
    g.advance(); // día 1 sin mesa -> noche
    g.suspect(loyals[0].id, traitors[0].id);
    g.suspect(traitors[0].id, loyals[1].id);
    g.suspect(loyals[2].id, traitors[0].id);
    assert.throws(() => g.suspect(loyals[3].id, loyals[3].id), /ti mismo/);
    assert.strictEqual(g.privateView(loyals[0].id).mySuspect, traitors[0].id);
    assert.strictEqual(g.masterView('X').suspicionTally[traitors[0].id], 2);
    assert.ok(!JSON.stringify(g.publicView('X')).includes('suspicion'));
    g.advance(); // amanecer: se reinician y no se anuncia «sin asesinatos» si no tocaba
    assert.deepStrictEqual(g.state.suspicions, {});
    assert.ok(!g.state.events.some(e => e.type === 'nomurder'));
});

test('Fantasmas: el secreto solo lo ven los muertos hasta el final (ni el MC)', () => {
    const manual = { auto: false, thresholds: [{ skulls: 18, percent: 50 }, { skulls: 26, percent: 75 }, { skulls: 33, percent: 100 }] };
    const { g, loyals } = setup(10, { ghosts: manual }, [{ name: 'X', max: 0 }]);
    g.updateTest(g.state.tests[0].id, { score: 10000 });
    g.getPlayer(loyals[0].id).alive = false;
    g.assignGhostTarget();
    g.state.ghosts.skulls = 26;
    assert.strictEqual(g.publicView('X').ghosts, undefined);
    assert.strictEqual(g.privateView(loyals[1].id).ghostSociety, undefined);
    assert.strictEqual(g.privateView(loyals[0].id).ghostSociety.percent, 75);
    assert.strictEqual(g.masterView('X').ghosts, undefined);
    g.finish();
    assert.strictEqual(g.publicView('X').ghosts.stolen, 7500);
});

test('Fantasmas desactivados: sin objetivo ni panel', () => {
    const { g, loyals } = setup(10, { ghosts: { enabled: false } });
    g.getPlayer(loyals[0].id).alive = false;
    assert.strictEqual(g.assignGhostTarget(), null);
    assert.strictEqual(g.privateView(loyals[0].id).ghostSociety, undefined);
});

test('privacidad: la vista pública no revela roles ni votos del cónclave', () => {
    const { g } = setup(8);
    const view = JSON.stringify(g.publicView('X'));
    assert.ok(!view.includes('"role":"traitor"') && !view.includes('"role":"loyal"'));
    assert.ok(!view.includes('nightVotes'));
});

test('chats: general, traidores y muertos', () => {
    const { g, traitors, loyals } = setup(8);
    assert.throws(() => g.addChat(loyals[0].id, 'traitors', 'hola'), /acceso/);
    assert.strictEqual(g.addChat(traitors[0].id, 'traitors', 'hola').channel, 'traitors');
    g.getPlayer(loyals[0].id).alive = false;
    assert.throws(() => g.addChat(loyals[0].id, 'general', 'hola'), /muertos/);
    assert.strictEqual(g.addChat(loyals[0].id, 'dead', 'buuu').channel, 'dead');
    assert.throws(() => g.addChat(loyals[1].id, 'dead', 'hola'), /eliminados/);
});

test('MC: anuncios públicos y mensajes privados', () => {
    const { g, loyals } = setup(6);
    assert.strictEqual(g.mcMessage('¡Prueba a las 18:00!').fromMc, true);
    g.mcMessage('Tu misión secreta…', loyals[0].id);
    assert.strictEqual(g.privateView(loyals[0].id).inbox.length, 1);
    assert.strictEqual(g.privateView(loyals[1].id).inbox.length, 0);
});

test('nueva partida con los mismos jugadores', () => {
    const { g } = setup(6, {}, [{ name: 'X', max: 100 }]);
    g.updateTest(g.state.tests[0].id, { score: 50 });
    g.restart();
    assert.strictEqual(g.state.phase, 'lobby');
    assert.strictEqual(g.state.players.length, 6);
    assert.ok(g.state.players.every(p => p.role === null && p.alive));
    assert.strictEqual(g.treasure(), 0);
});

test('pruebas en la tele: el MC lanza una prueba y se marca en juego', () => {
    const g = new Game(createState({}, [{ name: 'Aguas Tensas', max: 5000, description: 'Pasad el agua con los ojos vendados' }]));
    const id = g.state.tests[0].id;
    g.setSpotlight(id);
    const view = g.publicView('X');
    assert.strictEqual(view.spotlight, id);
    assert.strictEqual(view.tests[0].status, 'active');
    assert.strictEqual(view.tests[0].description, 'Pasad el agua con los ojos vendados');
    g.updateTest(id, { score: 3200 });
    assert.strictEqual(g.publicView('X').spotlight, id, 'sigue en la tele para enseñar el resultado');
    g.setSpotlight(null);
    assert.strictEqual(g.publicView('X').spotlight, null);
});

test('bots: una partida entera jugada solo por jugadores de prueba', () => {
    for (let seed = 1; seed <= 20; seed++) {
        let x = seed;
        const rnd = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
        const g = new Game(createState({ days: 4 }), () => new Date(), rnd);
        assert.strictEqual(g.addBots(12).length, 12);
        assert.ok(g.state.players.every(p => p.bot && p.name.startsWith('🤖')));
        g.advance(); // empieza
        for (let step = 0; step < 200 && g.state.phase !== 'end'; step++) {
            if (!g.botMoves()) g.advance(); // si los bots no tienen nada que hacer, el MC avanza
        }
        assert.strictEqual(g.state.phase, 'end', `semilla ${seed}: la partida termina`);
        assert.ok(['loyal', 'traitor'].includes(g.state.winner));
    }
});

test('bots: no se pueden añadir con la partida empezada', () => {
    const { g } = setup(6);
    assert.throws(() => g.addBots(3), GameError);
});
