import React, { useEffect, useState } from 'react';
import { socket, storage, PHASE_LABELS } from './socket';
import { Avatar, RoleBadge, Toasts, useConnection, useToasts } from './components';

const MASTER_TOKEN_KEY = 'masterToken';

function MasterPanel() {
    const connected = useConnection(socket);
    const { toasts, push, dismiss } = useToasts(4000);
    const [authenticated, setAuthenticated] = useState(false);
    const [checking, setChecking] = useState(!!storage.get(MASTER_TOKEN_KEY));
    const [password, setPassword] = useState('');
    const [state, setState] = useState(null);

    useEffect(() => {
        const onConnect = () => {
            const token = storage.get(MASTER_TOKEN_KEY);
            if (token) socket.emit('master-token', token);
        };
        const onAuth = ({ ok, token, error }) => {
            setChecking(false);
            setAuthenticated(ok);
            if (ok) storage.set(MASTER_TOKEN_KEY, token);
            else {
                storage.remove(MASTER_TOKEN_KEY);
                if (error) push(error, 'error');
            }
        };
        const onError = msg => push(msg, 'error');
        const onMessage = msg => push(msg);

        socket.on('connect', onConnect);
        socket.on('master-auth', onAuth);
        socket.on('master-state', setState);
        socket.on('master-error', onError);
        socket.on('master-message', onMessage);
        if (socket.connected) onConnect();

        return () => {
            socket.off('connect', onConnect);
            socket.off('master-auth', onAuth);
            socket.off('master-state', setState);
            socket.off('master-error', onError);
            socket.off('master-message', onMessage);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const login = e => {
        e.preventDefault();
        if (password.trim()) socket.emit('master-login', password.trim());
    };

    const logout = () => {
        storage.remove(MASTER_TOKEN_KEY);
        window.location.reload();
    };

    let content;
    if (checking) {
        content = <div className="container narrow center"><div className="spinner" /></div>;
    } else if (!authenticated || !state) {
        content = (
            <div className="container narrow">
                <h1 className="center">Maestro de Ceremonias</h1>
                <form className="card row" onSubmit={login}>
                    <input type="password" placeholder="Contraseña" value={password} onChange={e => setPassword(e.target.value)} autoFocus />
                    <button className="btn gold" type="submit">Acceder</button>
                </form>
            </div>
        );
    } else {
        content = <Dashboard state={state} onLogout={logout} />;
    }

    return (
        <>
            {!connected && <div className="alert error center" style={{ margin: 0, borderRadius: 0 }}>Sin conexión. Reintentando…</div>}
            {content}
            <Toasts toasts={toasts} dismiss={dismiss} />
        </>
    );
}

function Dashboard({ state, onLogout }) {
    const [selected, setSelected] = useState([]);
    const [testName, setTestName] = useState('');
    const [points, setPoints] = useState('');

    // Quitar de la selección a jugadores que ya no existen (p. ej. tras reiniciar)
    useEffect(() => {
        setSelected(sel => sel.filter(id => state.players.some(p => p.id === id)));
    }, [state.players]);

    const toggle = id => setSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
    const allAlive = () => setSelected(state.players.filter(p => p.alive).map(p => p.id));

    const advance = () => {
        if (state.phase === 'roundtable' && state.votesCast < state.votesNeeded &&
            !window.confirm(`Solo han votado ${state.votesCast} de ${state.votesNeeded}. ¿Cerrar la votación igualmente?`)) return;
        socket.emit('master-advance');
    };

    const startTest = e => {
        e.preventDefault();
        socket.emit('master-start-test', { testName: testName.trim(), players: selected });
        setTestName('');
    };

    const addPoints = e => {
        e.preventDefault();
        socket.emit('master-add-points', { players: selected, points: parseInt(points, 10) });
        setPoints('');
    };

    const reset = () => {
        if (window.confirm('¿Seguro que quieres reiniciar el juego? Se borrarán todos los jugadores.')) {
            socket.emit('master-reset-game');
        }
    };

    const canStart = state.phase !== 'waiting' || state.players.length >= state.minPlayers;

    return (
        <div className="container">
            <div className="header">
                <h1>Maestro de Ceremonias</h1>
                <button className="btn ghost sm" onClick={onLogout}>Salir</button>
            </div>

            <div className="card">
                <h3>Estado del juego</h3>
                <div className="stats">
                    <div className="stat">Fase<b>{PHASE_LABELS[state.phase]}</b></div>
                    <div className="stat">Día<b>{state.gameDay}/{state.totalDays}</b></div>
                    <div className="stat">Jugadores<b>{state.players.filter(p => p.alive).length} vivos / {state.players.length}</b></div>
                    <div className="stat">Reparto (vivos)<b>{state.roleDistribution.traidores} T · {state.roleDistribution.fieles} F</b></div>
                    {state.phase === 'roundtable' && <div className="stat">Votos<b>{state.votesCast}/{state.votesNeeded}</b></div>}
                    {state.phase === 'night' && <div className="stat">Cónclave<b>{state.conclaveOpen ? 'Abierto' : `Cerrado (${state.conclaveHours})`}</b></div>}
                    {state.phase === 'night' && state.gameDay > 1 && <div className="stat">Asesinato<b>{state.pendingKill ? 'Elegido' : 'Pendiente'}</b></div>}
                    {state.gameDay === 1 && <div className="stat">Invitación<b>{INVITATION_LABELS[state.invitationStatus]}</b></div>}
                    {state.winner && <div className="stat">Ganadores<b>{state.winner}</b></div>}
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                    {state.nextAction && (
                        <button className="btn gold" onClick={advance} disabled={!canStart}>{state.nextAction}</button>
                    )}
                    <label className="check small">
                        <input
                            type="checkbox"
                            checked={state.ignoreConclaveHours}
                            onChange={e => socket.emit('master-set-conclave-override', e.target.checked)}
                        />
                        Abrir el cónclave fuera de horario
                    </label>
                </div>
                {!canStart && <p className="muted small">Se necesitan al menos {state.minPlayers} jugadores.</p>}
            </div>

            <div className="grid">
                <div className="card">
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                        <h3 style={{ margin: 0 }}>Jugadores</h3>
                        <span className="row">
                            <button className="btn ghost sm" onClick={allAlive}>Todos vivos</button>
                            <button className="btn ghost sm" onClick={() => setSelected([])}>Ninguno</button>
                        </span>
                    </div>
                    <p className="muted small">Selecciona jugadores para pruebas o puntos.</p>
                    <ul className="players">
                        {state.players.map(p => (
                            <li key={p.id} className={`player ${p.alive ? '' : 'dead'} ${selected.includes(p.id) ? 'selected' : ''}`}>
                                <label className="check who">
                                    <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
                                    <Avatar player={p} />
                                    <span className="name">{p.name}</span>
                                </label>
                                <span className="row small">
                                    {!p.alive && <span className="muted">{p.eliminatedBy === 'murder' ? 'Asesinado' : 'Desterrado'}</span>}
                                    <RoleBadge role={p.role} />
                                    <span className="muted">{p.score} pts</span>
                                    {state.phase === 'waiting' && (
                                        <button className="btn red sm" onClick={() => socket.emit('master-kick-player', p.id)}>Quitar</button>
                                    )}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <form className="card" onSubmit={startTest}>
                        <h3>Pruebas</h3>
                        <div className="row">
                            <input placeholder="Nombre de la prueba" value={testName} onChange={e => setTestName(e.target.value)} />
                            <button className="btn green" type="submit" disabled={!testName.trim() || selected.length === 0}>Iniciar ({selected.length})</button>
                        </div>
                        {state.activeTests.length > 0 && (
                            <ul className="players" style={{ marginTop: 12 }}>
                                {state.activeTests.map(t => (
                                    <li key={t.id} className="player">
                                        <span>
                                            <strong>{t.name}</strong>
                                            <div className="muted small">
                                                {t.players.map(id => state.players.find(p => p.id === id)?.name).filter(Boolean).join(', ')}
                                            </div>
                                        </span>
                                        <button type="button" className="btn ghost sm" onClick={() => socket.emit('master-end-test', t.id)}>Terminar</button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </form>

                    <form className="card" onSubmit={addPoints}>
                        <h3>Puntos</h3>
                        <div className="row">
                            <input type="number" placeholder="Puntos (negativo para restar)" value={points} onChange={e => setPoints(e.target.value)} />
                            <button className="btn" type="submit" disabled={!parseInt(points, 10) || selected.length === 0}>Asignar ({selected.length})</button>
                        </div>
                    </form>

                    <div className="card">
                        <h3>Zona peligrosa</h3>
                        <button className="btn red" onClick={reset}>Reiniciar juego</button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const INVITATION_LABELS = {
    none: 'Sin usar',
    pending: 'Pendiente',
    accepted: 'Aceptada',
    rejected: 'Rechazada',
    expired: 'Caducada'
};

export default MasterPanel;
