import React, { useEffect, useMemo, useRef, useState } from 'react';
import { socket, storage, PHASE_LABELS } from './socket';
import { Avatar, RoleBadge, Toasts, useConnection, useToasts } from './components';

const TOKEN_KEY = 'playerToken';

// Enlace para abrir la misma sesión en otro dispositivo: /?t=<token>
(function adoptTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('t');
    if (t) {
        storage.set(TOKEN_KEY, t);
        params.delete('t');
        const qs = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : ''));
    }
})();

function App() {
    const connected = useConnection(socket);
    const { toasts, push, dismiss } = useToasts();
    const [view, setView] = useState(null); // estado público
    const [me, setMe] = useState(null); // estado privado del jugador
    const [status, setStatus] = useState(storage.get(TOKEN_KEY) ? 'auth' : 'anon'); // anon | auth | joined
    const [ghostWelcome, setGhostWelcome] = useState(false);
    const [chat, setChat] = useState({ general: [], traitors: [], dead: [] });

    useEffect(() => {
        // Se re-autentica en cada (re)conexión: recargas, cortes de red, móvil en reposo...
        const onConnect = () => {
            const token = storage.get(TOKEN_KEY);
            if (token) {
                setStatus('auth');
                socket.emit('auth', { token });
            }
        };
        const onSession = ({ token }) => {
            storage.set(TOKEN_KEY, token);
            setStatus('joined');
        };
        const onAuthFailed = () => {
            storage.remove(TOKEN_KEY);
            setMe(null);
            setStatus('anon');
        };
        const onChat = msg => setChat(c => ({ ...c, [msg.channel]: [...(c[msg.channel] || []), msg].slice(-200) }));
        const onError = msg => push(msg, 'error');
        const onNotice = msg => push(msg);
        // Se muestra la bienvenida aunque el jugador muera con la app cerrada (ver GhostWelcomeModal)
        const onGhostWelcome = () => setGhostWelcome(w => !w);
        const onReset = () => {
            onAuthFailed();
            setChat({ general: [], traitors: [], dead: [] });
            push('El Maestro de Ceremonias ha reiniciado el juego');
        };

        socket.on('connect', onConnect);
        socket.on('session', onSession);
        socket.on('auth-failed', onAuthFailed);
        socket.on('state', setView);
        socket.on('private', setMe);
        socket.on('chat-history', setChat);
        socket.on('chat', onChat);
        socket.on('game-error', onError);
        socket.on('notice', onNotice);
        socket.on('game-reset', onReset);
        socket.on('ghost-welcome', onGhostWelcome);
        if (socket.connected) onConnect();

        return () => {
            socket.off('connect', onConnect);
            socket.off('session', onSession);
            socket.off('auth-failed', onAuthFailed);
            socket.off('state', setView);
            socket.off('private', setMe);
            socket.off('chat-history', setChat);
            socket.off('chat', onChat);
            socket.off('game-error', onError);
            socket.off('notice', onNotice);
            socket.off('game-reset', onReset);
            socket.off('ghost-welcome', onGhostWelcome);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    let content;
    if (!view || (status === 'auth' && !me)) {
        content = (
            <div className="container narrow center">
                <h1>Traidores</h1>
                <div className="spinner" />
                <p className="muted">{connected ? 'Reconectando a la partida…' : 'Conectando con el servidor…'}</p>
            </div>
        );
    } else if (status !== 'joined' || !me) {
        content = <JoinScreen view={view} />;
    } else if (view.phase === 'gameover') {
        content = <GameOverScreen view={view} me={me} chat={chat} />;
    } else {
        content = <GameScreen view={view} me={me} chat={chat} />;
    }

    return (
        <>
            {!connected && view && <div className="alert error center" style={{ margin: 0, borderRadius: 0 }}>Sin conexión. Reintentando…</div>}
            {content}
            {me && me.invitationPending && <InvitationModal />}
            {me && me.ghostSociety && view && view.phase !== 'gameover' && (
                <GhostWelcomeModal key={String(ghostWelcome)} playerId={me.playerId} onClose={() => setGhostWelcome(w => !w)} />
            )}
            <Toasts toasts={toasts} dismiss={dismiss} />
        </>
    );
}

function JoinScreen({ view }) {
    const [name, setName] = useState('');
    const [photo, setPhoto] = useState('');

    const join = e => {
        e.preventDefault();
        socket.emit('join', { name: name.trim(), photo: photo.trim() });
    };

    return (
        <div className="container narrow">
            <h1 className="center">Traidores</h1>
            <p className="center muted">Un juego de estrategia, alianzas y traición.</p>
            {view.phase === 'waiting' ? (
                <form className="card" onSubmit={join}>
                    <div className="row" style={{ marginBottom: 8 }}>
                        <input placeholder="Tu nombre" value={name} maxLength={30} onChange={e => setName(e.target.value)} autoFocus />
                    </div>
                    <div className="row" style={{ marginBottom: 12 }}>
                        <input placeholder="URL de tu foto (opcional)" value={photo} onChange={e => setPhoto(e.target.value)} />
                    </div>
                    <button className="btn gold block" type="submit" disabled={!name.trim()}>Entrar</button>
                </form>
            ) : (
                <div className="alert warn">La partida ya ha comenzado. Si ya estabas jugando, usa el enlace de «otro dispositivo» desde donde te uniste.</div>
            )}
            <PlayerList players={view.players} />
        </div>
    );
}

function PlayerList({ players }) {
    return (
        <div className="card">
            <h3>Jugadores ({players.length})</h3>
            <ul className="players">
                {players.map(p => (
                    <li key={p.id} className="player">
                        <span className="who"><Avatar player={p} /><span className="name">{p.name}</span></span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function InvitationModal() {
    const [confirming, setConfirming] = useState(null);
    const respond = accept => socket.emit('respond-invitation', accept);
    return (
        <div className="modal-backdrop">
            <div className="modal">
                <h2 style={{ color: 'var(--red)' }}>Invitación secreta</h2>
                <p>Has recibido una invitación anónima para unirte a los <strong>traidores</strong>.</p>
                <p>Si aceptas, te convertirás en traidor y entrarás en los cónclaves nocturnos.</p>
                <p>Si rechazas, seguirás siendo fiel y no habrá otra invitación esta noche.</p>
                <p><strong>Esta decisión es irreversible.</strong></p>
                {confirming === null ? (
                    <div className="row">
                        <button className="btn green" style={{ flex: 1 }} onClick={() => setConfirming(false)}>Seguir siendo Fiel</button>
                        <button className="btn red" style={{ flex: 1 }} onClick={() => setConfirming(true)}>Convertirme en Traidor</button>
                    </div>
                ) : (
                    <div className="row">
                        <button className="btn ghost" style={{ flex: 1 }} onClick={() => setConfirming(null)}>Volver</button>
                        <button className={`btn ${confirming ? 'red' : 'green'}`} style={{ flex: 1 }} onClick={() => respond(confirming)}>
                            Confirmar: {confirming ? 'Traidor' : 'Fiel'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}

function phaseHint(view, me, self) {
    const isTraitor = me.role === 'traidor';
    if (!self.alive) return 'Has sido eliminado. Puedes seguir la partida, pero ya no participas.';
    switch (view.phase) {
        case 'waiting':
            return `Esperando a que el Maestro de Ceremonias comience la partida (mínimo ${view.minPlayers} jugadores).`;
        case 'day':
            return view.gameDay === 1
                ? 'Primer día: conoced a los demás jugadores. Hoy no hay mesa redonda.'
                : 'Comentad lo sucedido. Pronto se abrirá la mesa redonda.';
        case 'roundtable':
            return me.myVote ? 'Has votado. Puedes cambiar tu voto hasta que todos hayan votado.' : 'Vota a quien creas que es traidor.';
        case 'night':
            if (!isTraitor) return 'Es de noche. Los traidores están reunidos…';
            if (!view.conclaveOpen) return `El cónclave abre de ${view.conclaveHours}.`;
            return view.gameDay === 1
                ? 'Cónclave abierto: podéis invitar en secreto a un fiel a unirse.'
                : 'Cónclave abierto: elegid a vuestra víctima. Se revelará al amanecer.';
        default:
            return '';
    }
}

function GameScreen({ view, me, chat }) {
    const self = view.players.find(p => p.id === me.playerId) || { alive: false, score: 0 };
    const isTraitor = me.role === 'traidor';
    const traitorIds = useMemo(() => new Set((me.traitors || []).map(t => t.id)), [me.traitors]);
    const alive = view.players.filter(p => p.alive);
    const dead = view.players.filter(p => !p.alive);
    const voters = new Set(view.voters);

    const canAct = self.alive && view.phase === 'night' && isTraitor && view.conclaveOpen;
    const canInvite = canAct && view.gameDay === 1 && me.invitation && me.invitation.available;
    const canKill = canAct && view.gameDay > 1;
    const canVote = self.alive && view.phase === 'roundtable';

    const nightVictim = view.lastNightVictim && view.players.find(p => p.id === view.lastNightVictim);
    const vote = view.lastVoteResult;
    const expelled = vote && vote.expelledId && view.players.find(p => p.id === vote.expelledId);

    return (
        <div className="container">
            <div className="header">
                <div>
                    <h1>Traidores</h1>
                    <span className="badge phase">
                        {view.phase === 'waiting' ? PHASE_LABELS.waiting : `Día ${view.gameDay}/${view.totalDays} · ${PHASE_LABELS[view.phase]}`}
                    </span>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div><strong>{self.name}</strong> <RoleBadge role={me.role} /></div>
                    <div className="muted">{self.score} puntos</div>
                    <div className="gold">💰 Botín: {formatGold(view.treasure, view.goldPerEuro)}</div>
                </div>
            </div>

            <div className="alert info">{phaseHint(view, me, self)}</div>

            {me.ghostSociety && <GhostPanel ghost={me.ghostSociety} />}

            {isTraitor && me.traitors && (
                <div className="alert traitor">
                    <strong>Traidores:</strong> {me.traitors.map(t => t.name).join(', ')}
                    {me.invitation && me.invitation.status === 'pending' && <div>Invitación pendiente: {me.invitation.targetName}</div>}
                    {me.invitation && me.invitation.status === 'accepted' && <div>{me.invitation.targetName} se ha unido a los traidores</div>}
                    {me.invitation && me.invitation.status === 'rejected' && <div>{me.invitation.targetName} rechazó la invitación</div>}
                </div>
            )}

            {view.phase !== 'night' && nightVictim && (
                <div className="alert error"><strong>Asesinado anoche:</strong> {nightVictim.name}</div>
            )}
            {vote && (view.phase === 'night' || view.phase === 'day') && (
                <div className="alert warn">
                    {expelled
                        ? <><strong>Desterrado:</strong> {expelled.name} — era <RoleBadge role={expelled.role} /></>
                        : vote.tie ? 'Empate en la mesa redonda: nadie ha sido desterrado.' : 'Nadie fue desterrado.'}
                </div>
            )}

            {view.activeTests.filter(t => t.players.includes(me.playerId)).map(t => (
                <div key={t.id} className="alert info"><strong>Prueba activa:</strong> {t.name}</div>
            ))}

            <div className="grid">
                <div className="card">
                    <h3>Jugadores vivos ({alive.length})</h3>
                    {view.phase === 'roundtable' && <p className="muted small">Votos emitidos: {view.voters.length}/{alive.length}</p>}
                    <ul className="players">
                        {alive.map(p => {
                            const isMe = p.id === me.playerId;
                            const isAlly = traitorIds.has(p.id);
                            return (
                                <li key={p.id} className={`player ${me.myVote === p.id || me.pendingKill === p.id ? 'selected' : ''}`}>
                                    <span className="who">
                                        <Avatar player={p} />
                                        <span className="name">
                                            {p.name}{isMe && ' (tú)'}
                                            {isTraitor && isAlly && !isMe && <span style={{ color: 'var(--red)' }}> ★</span>}
                                            {view.phase === 'roundtable' && voters.has(p.id) && <span className="muted small"> ✓ votó</span>}
                                        </span>
                                    </span>
                                    <span className="row">
                                        {canInvite && !isAlly && (
                                            <button className="btn sm purple" disabled={me.invitation.status === 'pending'} onClick={() => socket.emit('invite-player', p.id)}>Invitar</button>
                                        )}
                                        {canKill && !isAlly && (
                                            <button className="btn sm red" onClick={() => socket.emit('night-kill', p.id)}>
                                                {me.pendingKill === p.id ? 'Elegido' : 'Asesinar'}
                                            </button>
                                        )}
                                        {canVote && !isMe && (
                                            <button className="btn sm orange" onClick={() => socket.emit('vote', p.id)}>
                                                {me.myVote === p.id ? 'Votado' : 'Votar'}
                                            </button>
                                        )}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                    {dead.length > 0 && (
                        <>
                            <h3 style={{ marginTop: 16 }}>Eliminados</h3>
                            <ul className="players">
                                {dead.map(p => (
                                    <li key={p.id} className="player dead">
                                        <span className="who"><Avatar player={p} /><span className="name">{p.name}</span></span>
                                        <span className="small muted">
                                            {p.eliminatedBy === 'murder' ? 'Asesinado' : 'Desterrado'} (día {p.eliminatedDay}) <RoleBadge role={p.role} />
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </>
                    )}
                </div>

                <Chat me={me} self={self} view={view} chat={chat} />
            </div>

            <DeviceLink />
        </div>
    );
}

const CHANNELS = {
    general: { label: 'General', className: '' },
    traitors: { label: 'Traidores 🔒', className: 'traitors', button: 'red' },
    dead: { label: 'Muertos 💀', className: 'dead', button: 'ghost' }
};

function Chat({ me, self, view, chat }) {
    const isTraitor = me.role === 'traidor';
    const isDead = !self.alive;
    const traitorChatOpen = view.phase === 'night' && view.conclaveOpen;
    const available = ['general', ...(isTraitor ? ['traitors'] : []), ...(isDead ? ['dead'] : [])];

    const [channel, setChannel] = useState('general');
    const [message, setMessage] = useState('');
    const [seen, setSeen] = useState({});
    const logRef = useRef(null);
    const active = available.includes(channel) ? channel : 'general';
    const messages = chat[active] || [];

    const canWrite = {
        general: !isDead || view.phase === 'gameover',
        traitors: !isDead && traitorChatOpen,
        dead: isDead
    }[active];
    const placeholder = canWrite ? 'Escribe un mensaje…'
        : active === 'general' ? 'Has sido eliminado: habla en el chat de muertos'
        : isDead ? 'Has sido eliminado'
        : `El cónclave abre de ${view.conclaveHours}`;

    // Cambiar automáticamente al chat relevante: cónclave para traidores, muertos al ser eliminado
    useEffect(() => {
        if (isTraitor && traitorChatOpen && !isDead) setChannel('traitors');
    }, [isTraitor, traitorChatOpen, isDead]);
    useEffect(() => {
        if (isDead) setChannel('dead');
    }, [isDead]);

    // Marcar como leídos los mensajes del canal abierto
    useEffect(() => {
        setSeen(s => ({ ...s, [active]: messages.length }));
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [messages.length, active]);

    const send = e => {
        e.preventDefault();
        if (!message.trim() || !canWrite) return;
        socket.emit('chat', { message: message.trim(), channel: active });
        setMessage('');
    };

    return (
        <div className="card">
            {available.length > 1 ? (
                <div className="tabs">
                    {available.map(ch => {
                        const unread = ch !== active ? (chat[ch] || []).length - (seen[ch] || 0) : 0;
                        return (
                            <button key={ch} className={`tab ${CHANNELS[ch].className} ${active === ch ? 'active' : ''}`} onClick={() => setChannel(ch)}>
                                {CHANNELS[ch].label}{unread > 0 && <span className="unread">{unread}</span>}
                            </button>
                        );
                    })}
                </div>
            ) : <h3>Chat general</h3>}
            {active === 'dead' && <p className="muted small">Solo los eliminados ven este chat.</p>}
            <div className={`chat-log ${CHANNELS[active].className}`} ref={logRef}>
                {messages.length === 0 && <p className="muted small center">No hay mensajes todavía.</p>}
                {messages.map(m => (
                    <div key={m.id} className={`chat-msg ${m.fromId === me.playerId ? 'mine' : ''}`}>
                        <b>{m.from}:</b> {m.message}
                        <span className="time">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                ))}
            </div>
            <form className="row" onSubmit={send}>
                <input value={message} maxLength={500} onChange={e => setMessage(e.target.value)} placeholder={placeholder} disabled={!canWrite} />
                <button className={`btn ${CHANNELS[active].button || ''}`} type="submit" disabled={!canWrite || !message.trim()}>Enviar</button>
            </form>
        </div>
    );
}

function DeviceLink() {
    const [shown, setShown] = useState(false);
    const [copied, setCopied] = useState(false);
    const link = `${window.location.origin}/?t=${encodeURIComponent(storage.get(TOKEN_KEY) || '')}`;
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(link);
            setCopied(true);
        } catch (_) { /* sin portapapeles: el enlace queda visible */ }
    };
    return (
        <div className="card small">
            {!shown ? (
                <button className="btn ghost sm" onClick={() => setShown(true)}>Jugar también desde otro dispositivo</button>
            ) : (
                <>
                    <p className="muted">Abre este enlace en tu otro dispositivo para entrar como el mismo jugador. <strong>No lo compartas:</strong> quien lo tenga verá tu rol.</p>
                    <div className="row">
                        <input readOnly value={link} onFocus={e => e.target.select()} />
                        <button className="btn sm" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
                    </div>
                </>
            )}
        </div>
    );
}

function formatGold(gold, perEuro = 100) {
    const euros = gold / perEuro;
    return `${gold.toLocaleString('es-ES')} oro (${euros.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })})`;
}

const GHOST_WELCOME_KEY = 'ghostWelcomeSeen:';

function GhostWelcomeModal({ playerId, onClose }) {
    // Solo una vez por jugador y navegador
    const seen = storage.get(GHOST_WELCOME_KEY + playerId);
    if (seen) return null;
    const close = () => {
        storage.set(GHOST_WELCOME_KEY + playerId, '1');
        onClose();
    };
    return (
        <div className="modal-backdrop">
            <div className="modal ghost-modal">
                <h2>💀 La Sociedad Secreta de los Fantasmas</h2>
                <p>Has sido eliminado… pero tu partida no ha terminado. Ahora formas parte de una sociedad secreta que los vivos no conocen.</p>
                <ul>
                    <li>Cada día recibiréis en secreto el nombre de un jugador: vuestro <strong>objetivo</strong>.</li>
                    <li>Vuestra misión es influir sutilmente en los vivos para que reciba votos en la mesa redonda.</li>
                    <li>Cada voto contra el objetivo: <strong>1 calavera</strong>. Si además es eliminado: <strong>+2</strong>.</li>
                    <li>Las calaveras son de todos los Fantasmas. Con 18 robáis el 50 % del botín final; con 26, el 75 %; con 33, el 100 %.</li>
                </ul>
                <p><strong>Ni una palabra a los vivos.</strong> Coordinaos en el chat de muertos.</p>
                <button className="btn block ghost-btn" onClick={close}>Entendido</button>
            </div>
        </div>
    );
}

function SkullProgress({ skulls, thresholds }) {
    const max = Math.max(...thresholds.map(t => t.skulls));
    return (
        <div className="skull-track">
            <div className="skull-fill" style={{ width: `${Math.min(100, (skulls / max) * 100)}%` }} />
            {thresholds.map(t => (
                <span key={t.skulls} className={`skull-mark ${skulls >= t.skulls ? 'reached' : ''}`} style={{ left: `${(t.skulls / max) * 100}%` }}>
                    <span>{t.skulls}💀 · {t.percent}%</span>
                </span>
            ))}
        </div>
    );
}

function GhostPanel({ ghost }) {
    return (
        <div className="card ghost-card">
            <h3>💀 Sociedad Secreta de los Fantasmas</h3>
            <div className="ghost-target">
                {ghost.targetName
                    ? <>Objetivo de hoy: <strong>{ghost.targetName}</strong></>
                    : <span className="muted">Esperando el objetivo del próximo amanecer…</span>}
            </div>
            <p><strong>{ghost.skulls}</strong> calaveras · botín robado al final: <strong>{ghost.percent}%</strong>
                {ghost.nextThreshold && <span className="muted"> (faltan {ghost.nextThreshold.skulls - ghost.skulls} para el {ghost.nextThreshold.percent}%)</span>}
            </p>
            <SkullProgress skulls={ghost.skulls} thresholds={ghost.thresholds} />
            {ghost.history.length > 0 && (
                <ul className="small muted ghost-history">
                    {ghost.history.map((h, i) => (
                        <li key={i}>Día {h.day}: {h.targetName} — {h.votes} voto(s){h.eliminated && ', eliminado'} → +{h.skulls} 💀</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function GhostReveal({ ghosts, treasure, goldPerEuro }) {
    return (
        <div className="card ghost-card">
            <h3>💀 Revelación: la Sociedad Secreta de los Fantasmas</h3>
            <p>Mientras los vivos buscaban a los traidores, los eliminados conspiraban desde las sombras para que cada día un objetivo secreto recibiera votos.</p>
            <SkullProgress skulls={ghosts.skulls} thresholds={ghosts.thresholds} />
            <p>
                Consiguieron <strong>{ghosts.skulls} calaveras</strong>.{' '}
                {ghosts.percent > 0
                    ? <>Roban el <strong>{ghosts.percent}%</strong> del botín: <strong>{formatGold(ghosts.stolen, goldPerEuro)}</strong>. A los vivos les quedan {formatGold(treasure - ghosts.stolen, goldPerEuro)}.</>
                    : <>No alcanzaron el primer umbral: el botín de {formatGold(treasure, goldPerEuro)} queda intacto.</>}
            </p>
            {ghosts.history.length > 0 && (
                <ul className="small muted ghost-history">
                    {ghosts.history.map((h, i) => (
                        <li key={i}>Día {h.day}: {h.targetName} — {h.votes} voto(s){h.eliminated && ', eliminado'} → +{h.skulls} 💀</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function GameOverScreen({ view, me, chat }) {
    const self = view.players.find(p => p.id === me.playerId) || { alive: false };
    const winnersRole = view.winner === 'TRAIDORES' ? 'traidor' : 'fiel';
    const iWon = me.role === winnersRole;
    const ranking = [...view.players].sort((a, b) => b.score - a.score);
    const ghosts = view.ghosts;
    return (
        <div className="container narrow">
            <h1 className="center">Fin del juego</h1>
            <div className={`alert ${view.winner === 'TRAIDORES' ? 'traitor' : 'info'} center`}>
                <h2 style={{ margin: 0 }}>Ganan los {view.winner}</h2>
                <div>{iWon ? '¡Has ganado!' : 'Has perdido.'}</div>
            </div>
            {ghosts && <GhostReveal ghosts={ghosts} treasure={view.treasure} goldPerEuro={view.goldPerEuro} />}
            <div className="card">
                <h3>Jugadores y puntuaciones</h3>
                <ul className="players">
                    {ranking.map(p => (
                        <li key={p.id} className={`player ${p.alive ? '' : 'dead'}`}>
                            <span className="who">
                                <Avatar player={p} />
                                <span className="name">{p.name}{p.id === me.playerId && ' (tú)'}</span>
                            </span>
                            <span className="row">
                                <RoleBadge role={p.role} />
                                <span className="muted small">{p.score} pts</span>
                            </span>
                        </li>
                    ))}
                </ul>
            </div>
            <Chat me={me} self={self} view={view} chat={chat} />
        </div>
    );
}

export default App;
