const test = require('node:test');
const assert = require('node:assert');
const { Game, GameError, isConclaveTime } = require('./game');

function setup(n = 7) {
    const g = new Game();
    g.state.ignoreConclaveHours = true;
    for (let i = 0; i < n; i++) g.addPlayer({ name: `P${i}` });
    g.start(() => 0); // reparto determinista
    const traitors = g.state.players.filter(p => p.role === 'traidor');
    const faithfuls = g.state.players.filter(p => p.role === 'fiel');
    return { g, traitors, faithfuls };
}

test('reparte 2 traidores con 6+ jugadores y 1 con menos', () => {
    assert.strictEqual(setup(7).traitors.length, 2);
    assert.strictEqual(setup(5).traitors.length, 1);
});

test('no se puede empezar con menos de 4 ni unirse tras empezar', () => {
    const g = new Game();
    ['A', 'B', 'C'].forEach(name => g.addPlayer({ name }));
    assert.throws(() => g.start(), GameError);
    g.addPlayer({ name: 'D' });
    g.start();
    assert.throws(() => g.addPlayer({ name: 'E' }), /ya ha comenzado/);
});

test('nombres duplicados y fotos no válidas se rechazan', () => {
    const g = new Game();
    g.addPlayer({ name: 'Ana' });
    assert.throws(() => g.addPlayer({ name: 'ana' }), /en uso/);
    assert.throws(() => g.addPlayer({ name: 'Luis', photo: 'javascript:alert(1)' }), /foto/);
});

test('la vista pública no revela roles de jugadores vivos', () => {
    const { g } = setup();
    const view = g.publicView();
    assert.ok(view.players.every(p => p.role === undefined));
    assert.ok(!JSON.stringify(view).includes('traidor'));
});

test('flujo completo: invitación, asesinato, votación y fin al día 4', () => {
    const { g, traitors, faithfuls } = setup(8);
    // Día 1: día -> noche, sin asesinato pero con invitación
    g.advance();
    assert.strictEqual(g.state.phase, 'night');
    assert.throws(() => g.nightKill(traitors[0].id, faithfuls[0].id), /primer día/);
    g.invite(traitors[0].id, faithfuls[0].id);
    assert.throws(() => g.invite(traitors[1].id, faithfuls[1].id), /invitación/);
    g.respondInvitation(faithfuls[0].id, true);
    assert.strictEqual(g.getPlayer(faithfuls[0].id).role, 'traidor');

    // Día 2: amanecer sin víctima -> mesa redonda
    g.advance();
    assert.strictEqual(g.state.gameDay, 2);
    assert.strictEqual(g.state.lastNightVictim, null);
    g.advance();
    assert.strictEqual(g.state.phase, 'roundtable');
    // Todos votan a un fiel -> se resuelve solo y pasa a la noche
    const target = faithfuls[1].id;
    g.alive().forEach(p => { if (p.id !== target) g.vote(p.id, target); });
    g.vote(target, faithfuls[2].id);
    assert.strictEqual(g.state.phase, 'night');
    assert.strictEqual(g.getPlayer(target).alive, false);
    assert.strictEqual(g.getPlayer(target).eliminatedBy, 'banished');

    // Noche 2: asesinato revelado al amanecer
    g.nightKill(traitors[0].id, faithfuls[2].id);
    assert.strictEqual(g.getPlayer(faithfuls[2].id).alive, true, 'no se revela hasta el amanecer');
    g.advance();
    assert.strictEqual(g.state.lastNightVictim, faithfuls[2].id);
    assert.strictEqual(g.getPlayer(faithfuls[2].id).alive, false);
});

test('empate en la votación: nadie es desterrado', () => {
    const { g, faithfuls } = setup(6);
    g.advance(); g.advance(); g.advance(); // noche 1 -> día 2 -> mesa redonda
    g.vote(faithfuls[0].id, faithfuls[1].id);
    g.vote(faithfuls[1].id, faithfuls[0].id);
    g.advance(); // el MC cierra la votación
    assert.ok(g.state.lastVoteResult.tie);
    assert.strictEqual(g.alive().length, 6);
    assert.strictEqual(g.state.phase, 'night');
});

test('no se puede votar a uno mismo ni votar estando muerto', () => {
    const { g, faithfuls } = setup(6);
    g.advance(); g.advance(); g.advance();
    assert.throws(() => g.vote(faithfuls[0].id, faithfuls[0].id), /ti mismo/);
    g.getPlayer(faithfuls[1].id).alive = false;
    assert.throws(() => g.vote(faithfuls[1].id, faithfuls[0].id), /eliminado/);
});

test('ganan los fieles al desterrar al último traidor', () => {
    const { g, traitors } = setup(5);
    g.advance(); g.advance(); g.advance();
    g.alive().forEach(p => g.vote(p.id, p.id === traitors[0].id ? g.alive().find(x => x.id !== p.id).id : traitors[0].id));
    assert.strictEqual(g.state.phase, 'gameover');
    assert.strictEqual(g.state.winner, 'FIELES');
});

test('si queda algún traidor al terminar el día 4, ganan los traidores', () => {
    const { g } = setup(10);
    g.advance(); // noche 1
    g.advance(); // día 2
    for (let day = 2; day <= 4; day++) {
        g.advance(); // mesa redonda
        g.advance(); // cerrar sin votos
        if (day < 4) g.advance(); // amanecer
    }
    assert.strictEqual(g.state.phase, 'gameover');
    assert.strictEqual(g.state.winner, 'TRAIDORES');
});

test('chat de traidores: solo traidores y solo con el cónclave abierto', () => {
    const { g, traitors, faithfuls } = setup(6);
    assert.throws(() => g.addChat(traitors[0].id, 'traitors', 'hola'), /noche/);
    g.advance();
    assert.throws(() => g.addChat(faithfuls[0].id, 'traitors', 'hola'), /acceso/);
    g.state.ignoreConclaveHours = false;
    const msg = isConclaveTime() ? null : /cónclave/;
    if (msg) assert.throws(() => g.addChat(traitors[0].id, 'traitors', 'hola'), msg);
    g.state.ignoreConclaveHours = true;
    assert.strictEqual(g.addChat(traitors[0].id, 'traitors', 'hola').channel, 'traitors');
});

test('horario del cónclave 22:30-3:00 en hora de Madrid', () => {
    // Octubre 2026: Madrid = UTC+2
    assert.strictEqual(isConclaveTime(new Date('2026-10-07T20:29:00Z')), false); // 22:29
    assert.strictEqual(isConclaveTime(new Date('2026-10-07T20:30:00Z')), true); // 22:30
    assert.strictEqual(isConclaveTime(new Date('2026-10-08T00:59:00Z')), true); // 2:59
    assert.strictEqual(isConclaveTime(new Date('2026-10-08T01:00:00Z')), false); // 3:00
});

test('chat de muertos: solo eliminados; los muertos no escriben en el general', () => {
    const { g, faithfuls } = setup(6);
    const deadId = faithfuls[0].id;
    assert.throws(() => g.addChat(deadId, 'dead', 'hola'), /eliminados/);
    g.getPlayer(deadId).alive = false;
    assert.strictEqual(g.addChat(deadId, 'dead', 'desde el más allá').channel, 'dead');
    assert.throws(() => g.addChat(deadId, 'general', 'hola'), /chat de muertos/);
    assert.throws(() => g.addChat(faithfuls[1].id, 'dead', 'hola'), /eliminados/);
    g.state.phase = 'gameover';
    assert.strictEqual(g.addChat(deadId, 'general', 'bien jugado').channel, 'general');
});

test('partidas guardadas sin chat de muertos se cargan correctamente', () => {
    const g = new Game({ phase: 'waiting', chat: { general: [], traitors: [] } });
    assert.deepStrictEqual(g.state.chat.dead, []);
});
