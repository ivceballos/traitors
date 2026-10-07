import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    Check, Crown, DeviceMobile, Envelope, Eye, EyeSlash, Gavel, Ghost, HourglassMedium, Knife, MoonStars, PaperPlaneRight, Question, Scales, Shield, SunHorizon, Trophy
} from '@phosphor-icons/react';
import { formatEuros, formatGold, playerTokenKey, send, socket, storage } from '../api';
import {
    ActionButton, Art, Avatar, CopyBox, HoldButton, Loading, Modal, Seal, Segmented, OfflineBanner, PhotoPicker, RoleTag, TestsTable, Thresholds, Toasts,
    useConnection, useSocketEvent, useToasts
} from '../components';

const EMPTY_CHAT = { general: [], traitors: [], dead: [] };

// Enlace para abrir la misma sesión en otro dispositivo: /p/CODE?t=<token>
function adoptTokenFromUrl(code) {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('t');
    if (!t) return;
    storage.set(playerTokenKey(code), t);
    window.history.replaceState(null, '', window.location.pathname);
}

export default function Player() {
    const code = useParams().code.toUpperCase();
    const connected = useConnection();
    const { toasts, push, dismiss } = useToasts();
    const [view, setView] = useState(null);
    const [me, setMe] = useState(null);
    const [status, setStatus] = useState('checking'); // checking | join | joined | missing
    const [chat, setChat] = useState(EMPTY_CHAT);
    const [showRole, setShowRole] = useState(false);
    const [, forceRender] = useState(0);
    const lastEvent = useRef(null);

    // Conectar (y reconectar tras cortes, recargas o el móvil en reposo)
    useEffect(() => {
        adoptTokenFromUrl(code);
        const connect = async () => {
            const token = storage.get(playerTokenKey(code));
            if (token) {
                try {
                    await send('player:auth', { token });
                    setStatus('joined');
                    return;
                } catch (err) {
                    storage.remove(playerTokenKey(code));
                    setMe(null);
                }
            }
            try {
                await send('tv:watch', { code });
                setStatus('join');
            } catch (err) {
                setStatus('missing');
            }
        };
        socket.on('connect', connect);
        if (socket.connected) connect();
        return () => socket.off('connect', connect);
    }, [code]);

    useSocketEvent('state', next => {
        // Avisar de lo que acaba de pasar (no al cargar por primera vez)
        const events = next.events || [];
        if (lastEvent.current !== null) {
            const idx = events.findIndex(e => e.id === lastEvent.current);
            events.slice(idx + 1).forEach(e => push(e.text));
        }
        lastEvent.current = events.length ? events[events.length - 1].id : '';
        setView(next);
    });
    useSocketEvent('private', setMe);
    useSocketEvent('chat-history', h => setChat({ ...EMPTY_CHAT, ...h }));
    useSocketEvent('chat', msg => setChat(c => ({ ...c, [msg.channel]: [...(c[msg.channel] || []), msg].slice(-300) })));
    useSocketEvent('notice', text => push(text));
    useSocketEvent('ghost-welcome', () => forceRender(n => n + 1));
    useSocketEvent('kicked', () => {
        storage.remove(playerTokenKey(code));
        setMe(null);
        setStatus('join');
        push('El MC te ha quitado de la partida', 'error');
    });

    // Al empezar la partida se enseña el rol una vez
    const roleSeenKey = me && `role-seen:${code}:${me.playerId}`;
    useEffect(() => {
        if (me && me.role && !storage.get(roleSeenKey)) setShowRole(true);
    }, [me, roleSeenKey]);

    const act = async (event, payload) => {
        try {
            await send(event, payload);
            return true;
        } catch (err) {
            push(err.message, 'error');
            return false;
        }
    };

    const sheetOpen = showRole && me && me.role && view && status === 'joined';
    let content;
    if (status === 'missing') {
        content = (
            <div className="page narrow stack" style={{ paddingTop: 64 }}>
                <h1>Código no válido</h1>
                <p className="muted">No existe ninguna partida con el código {code}.</p>
                <Link className="btn" to="/">Volver</Link>
            </div>
        );
    } else if (!view || status === 'checking' || (status === 'joined' && !me)) {
        content = <Loading text={connected ? 'Entrando en la partida' : 'Conectando'} />;
    } else if (status === 'join') {
        content = <JoinScreen view={view} code={code} onJoined={() => setStatus('joined')} onError={m => push(m, 'error')} />;
    } else {
        content = <Game view={view} me={me} chat={chat} act={act} onShowRole={() => { setShowRole(true); window.scrollTo(0, 0); }} code={code} push={push} />;
    }

    const ghostKey = me && `ghost-seen:${code}:${me.playerId}`;
    const showGhostWelcome = me && me.ghostSociety && view && view.phase !== 'end' && !storage.get(ghostKey);

    return (
        <>
            <OfflineBanner connected={connected} />
            {/* Con «Mi rol» abierto no se pinta nada más: ni debajo queda información */}
            {sheetOpen ? (
                <SecretSheet me={me} view={view} chat={chat} act={act} self={view.players.find(p => p.id === me.playerId) || { alive: false }}
                    onClose={() => { storage.set(roleSeenKey, '1'); setShowRole(false); window.scrollTo(0, 0); }} />
            ) : content}
            {me && me.invitationPending && <InvitationModal view={view} act={act} />}
            {showGhostWelcome && !sheetOpen && (
                <GhostWelcome onClose={() => { storage.set(ghostKey, '1'); forceRender(n => n + 1); }} />
            )}
            <Toasts toasts={toasts} dismiss={dismiss} />
        </>
    );
}

// ---------- Entrar ----------

function JoinScreen({ view, code, onJoined, onError }) {
    const [name, setName] = useState('');
    const [photo, setPhoto] = useState(null);
    const [wantsTraitor, setWantsTraitor] = useState('maybe');
    // Tres preguntas de la entrevista al azar; las respuestas salen luego en «¿Quién dijo qué?»
    const [questions] = useState(() => [...(view.questions || [])].sort(() => Math.random() - 0.5).slice(0, view.interviewCount || 3));
    const [answers, setAnswers] = useState({});
    const [busy, setBusy] = useState(false);

    const join = async e => {
        e.preventDefault();
        setBusy(true);
        try {
            const { token } = await send('player:join', {
                code, name: name.trim(), photo, wantsTraitor,
                answers: questions.map(q => ({ q, a: (answers[q] || '').trim() })).filter(x => x.a)
            });
            storage.set(playerTokenKey(code), token);
            onJoined();
        } catch (err) {
            onError(err.message);
            setBusy(false);
        }
    };

    return (
        <div className="page narrow stack">
            <header style={{ padding: '32px 0 8px' }}>
                <span className="tag">Partida <span className="room-code" style={{ fontSize: 'inherit' }}>{code}</span></span>
                <h1 style={{ marginTop: 14 }}>{view.name}</h1>
            </header>
            {view.phase === 'lobby' ? (
                <form className="stack" onSubmit={join}>
                    <PhotoPicker value={photo} onChange={setPhoto} onError={onError} label={photo ? 'Repetir foto' : 'Hazte una foto para que te reconozcan'} />
                    <label className="field">
                        <span>Tu nombre</span>
                        <input className="input" value={name} maxLength={24} onChange={e => setName(e.target.value)} autoComplete="given-name" />
                    </label>
                    <div className="field">
                        <span>¿Te gustaría ser de los {view.factions.traitor}?</span>
                        <Segmented value={wantsTraitor} onChange={setWantsTraitor}
                            options={[{ value: 'yes', label: 'Sí' }, { value: 'maybe', label: 'Me da igual' }, { value: 'no', label: 'Prefiero que no' }]} />
                        <span className="tiny muted">Es secreto. Cuenta para el sorteo, pero no lo decide: le puede tocar a cualquiera.</span>
                    </div>
                    {questions.length > 0 && (
                        <section className="card stack-sm">
                            <h3 className="m0">Entrevista secreta</h3>
                            <p className="tiny muted m0">Nadie sabrá que son tuyas… hasta «¿Quién dijo qué?».</p>
                            {questions.map(q => (
                                <label key={q} className="field">
                                    <span className="small">{q}</span>
                                    <input className="input" maxLength={120} value={answers[q] || ''} onChange={e => setAnswers(a => ({ ...a, [q]: e.target.value }))} />
                                </label>
                            ))}
                        </section>
                    )}
                    <button className="btn primary block lg" disabled={busy || !name.trim()}>{busy ? <><span className="spinner-sm" />Enviando…</> : 'Unirme'}</button>
                    {!name.trim() && <p className="btn-hint m0">Escribe tu nombre</p>}
                </form>
            ) : (
                <p className="note accent">La partida ya ha empezado. Si ya estabas jugando, abre tu enlace personal desde el móvil con el que te uniste.</p>
            )}
            {view.players.length > 0 && (
                <section className="section">
                    <h3>Ya están dentro (<span className="num">{view.players.length}</span>)</h3>
                    <PlayerGrid players={view.players} factions={view.factions} />
                </section>
            )}
        </div>
    );
}

// ---------- Partida ----------

const TAB_LABELS = { players: 'Jugadores', loot: 'Botín', events: 'Sucesos', chat: 'Chat' };

function Game({ view, me, chat, act, onShowRole, code, push }) {
    const self = view.players.find(p => p.id === me.playerId) || { alive: false, name: '' };
    if (view.phase === 'end') return <EndScreen view={view} me={me} chat={chat} self={self} act={act} />;
    const dead = !self.alive && view.phase !== 'lobby';

    return (
        <>
            <TopBar view={view} onShowRole={onShowRole} hasRole={!!me.role} />
            <div className="page stack">
                <PhaseBlock view={view} me={me} self={self} />

                {/* Lo que toca hacer ahora va siempre arriba */}
                {me.hasShield && (
                    <p className="note gold m0 row nowrap" style={{ gap: 8 }}><Shield size={20} weight="fill" /> Tienes el escudo: esta noche no pueden asesinarte. Nadie más lo sabe.</p>
                )}
                {view.quiz && <QuizPanel view={view} me={me} self={self} act={act} />}
                {view.spotlight && <SpotlightCard view={view} />}
                {me.inbox.length > 0 && <Inbox inbox={me.inbox} />}
                {view.phase === 'lobby' && <Lobby view={view} self={self} act={act} push={push} me={me} />}
                {view.phase === 'endgame' && self.alive && <EndgamePanel view={view} me={me} act={act} />}
                {view.phase === 'roundtable' && self.alive && <RoundtablePanel view={view} me={me} act={act} />}
                {view.phase === 'night' && self.alive && <SuspectPanel view={view} me={me} act={act} />}
                {dead && me.ghostSociety && <GhostPanel ghost={me.ghostSociety} view={view} act={act} />}
                {view.unlock?.status === 'pending' && self.alive && <UnlockPrompt view={view} me={me} act={act} />}
                {me.organizer && view.phase !== 'lobby' && <OrganizerPanel view={view} me={me} self={self} act={act} code={code} />}

                {view.phase !== 'lobby' && <MainTabs view={view} me={me} self={self} chat={chat} act={act} />}
                <DeviceLink code={code} />
            </div>
        </>
    );
}

// Jugadores, botín, sucesos y chat plegados en pestañas para que la pantalla no sea un rollo
function MainTabs({ view, me, self, chat, act }) {
    const dead = !self.alive;
    const channels = ['general', ...(dead ? ['dead'] : [])];
    const tabs = ['players', ...(view.tests.length > 0 ? ['loot'] : []), 'events', 'chat'];
    const [tab, setTab] = useState('players');
    const [seen, setSeen] = useState(() => Object.fromEntries(channels.map(ch => [ch, (chat[ch] || []).length])));
    const unread = channels.reduce((n, ch) => n + Math.max(0, (chat[ch] || []).length - (seen[ch] || 0)), 0);
    const active = tabs.includes(tab) ? tab : 'players';
    return (
        <section className="stack-sm">
            <div className="tabs panel-tabs" role="tablist">
                {tabs.map(t => (
                    <button key={t} role="tab" aria-selected={active === t} className={`tab ${active === t ? 'on' : ''}`} onClick={() => setTab(t)}>
                        {TAB_LABELS[t]}{t === 'chat' && active !== 'chat' && unread > 0 && <span className="unread">{unread}</span>}
                    </button>
                ))}
            </div>
            {active === 'players' && (
                <section className="card">
                    <div className="row between" style={{ marginBottom: 14 }}>
                        <h3 className="m0">Jugadores</h3>
                        <span className="small muted"><span className="num">{view.players.filter(p => p.alive).length}</span> vivos</span>
                    </div>
                    <PlayerGrid players={view.players} factions={view.factions} meId={me.playerId} />
                </section>
            )}
            {active === 'loot' && <Treasure view={view} />}
            {active === 'events' && <Events events={view.events} />}
            {active === 'chat' && (
                <Chat me={me} view={view} chat={chat} act={act} channels={channels} initial={dead ? 'dead' : 'general'}
                    onSeen={(ch, n) => setSeen(s => (s[ch] === n ? s : { ...s, [ch]: n }))} />
            )}
        </section>
    );
}

function TopBar({ view, onShowRole, hasRole }) {
    return (
        <div className="topbar">
            <div className="topbar-inner">
                <span className="room-code">{view.code}</span>
                {view.phase !== 'lobby' && <span className="tag">Día <span className="num">{view.day}</span> de <span className="num">{view.days}</span></span>}
                <span className="grow" />
                {/* Todos tienen el mismo botón: lo secreto (aliados, cónclave) vive detrás */}
                {hasRole && <button className="btn sm" onClick={onShowRole}><Eye size={18} /> Mi rol</button>}
            </div>
        </div>
    );
}

const PHASE_ICON = { lobby: HourglassMedium, day: SunHorizon, roundtable: Scales, night: MoonStars, endgame: Crown, end: Trophy };

// Título de la fase y una línea de «qué toca ahora». De noche es igual para todos los bandos.
function PhaseBlock({ view, me, self }) {
    const alive = view.players.filter(p => p.alive).length;
    let title = 'Sala de espera';
    let text = 'Esperando a que el MC empiece la partida.';
    let now = null;
    switch (view.phase) {
        case 'day':
            title = `Día ${view.day}`;
            text = view.today.roundtable > 0
                ? `Hoy hay mesa redonda: ${view.today.roundtable === 1 ? 'un destierro' : `${view.today.roundtable} destierros`}.`
                : 'Hoy no hay mesa redonda. Observad bien a los demás.';
            now = 'Habla, observa y espera a que el MC abra la mesa.';
            break;
        case 'roundtable':
            title = view.round && view.round.candidates ? 'Desempate' : 'Mesa redonda';
            if (view.voting === 'inperson') {
                text = 'Votad en voz alta. El MC registrará el resultado.';
                now = 'Escucha, acusa y vota cuando lo pida el MC.';
            } else {
                text = view.round ? `Han votado ${view.round.voters.length} de ${alive}.` : 'Votación cerrada.';
                now = view.round ? (me.myVote ? 'Ya has votado. Espera al resto.' : 'Elige abajo y confirma tu voto. No se puede cambiar.') : 'Espera al MC.';
            }
            if (view.round && view.today.roundtable > 1) text = `Votación ${view.round.number} de ${view.today.roundtable}. ${text}`;
            break;
        case 'night':
            title = 'Noche';
            text = `Los ${view.factions.traitor} se reúnen en secreto.`;
            now = 'Señala abajo a tu sospechoso. Si tienes algo más que hacer esta noche, está en «Mi rol».';
            break;
        case 'endgame':
            title = 'El final';
            text = `Quedáis ${alive}. Si creéis que ya no quedan ${view.factions.traitor}, se acaba. Si alguien duda, se destierra a uno más.`;
            now = view.voting === 'inperson'
                ? 'Decidid en voz alta. Solo se acaba si todos estáis de acuerdo.'
                : (me.myEndgame ? 'Ya has decidido. Espera al resto.' : 'Elige abajo. Hace falta unanimidad para acabar.');
            break;
        default:
    }
    if (!self.alive && view.phase !== 'lobby') {
        text = 'Te han eliminado. Ya no compites, pero sigues dentro del juego.';
        now = me.ghostSociety?.target ? `Objetivo de hoy: ${me.ghostSociety.target.name}.` : null;
    }
    const Icon = PHASE_ICON[view.phase];
    return (
        <header className={`phase ${view.phase}`}>
            <span className="display">{title}</span>
            <Icon size={36} weight="light" className="phase-icon" />
            <p className="phase-text m0">{text}</p>
            {now && <p className="now m0" style={{ gridColumn: '1 / -1' }}>{now}</p>}
        </header>
    );
}

function Lobby({ view, self, act, push, me }) {
    return (
        <section className="stack">
            {me.organizer && view.hostless && (
                <div className="card stack-sm">
                    <h3 className="m0">Organizas tú</h3>
                    <p className="small muted m0">
                        Juegas como uno más: no verás ningún rol. Cuando estéis todos, empieza la partida; después avanza sola
                        (amanecer {view.timetable.dawn}, mesa {view.timetable.roundtable}, noche {view.timetable.night}).
                    </p>
                    <ActionButton className="primary block lg" disabled={view.players.length < 4}
                        hint={`Hacen falta al menos 4 jugadores (hay ${view.players.length})`} onClick={() => act('org:start')}>
                        Empezar partida
                    </ActionButton>
                    <ActionButton className="block" onClick={() => act('org:add-bots', { count: 6 })}>Añadir 6 jugadores de prueba</ActionButton>
                </div>
            )}
            <PhotoPicker
                value={null}
                size={64}
                label={self.photo ? 'Cambiar tu foto' : 'Añade una foto para que te reconozcan'}
                onChange={photo => act('player:photo', { photo })}
                onError={m => push(m, 'error')}
            />
            <div className="section">
                <h3>En la sala (<span className="num">{view.players.length}</span>)</h3>
                <PlayerGrid players={view.players} factions={view.factions} meId={self.id} />
            </div>
        </section>
    );
}

function PlayerGrid({ players, factions, meId, onPick, selected = [], pickable, note, revealAll, kill }) {
    return (
        <div className="player-grid">
            {players.map(p => {
                const canPick = onPick && (!pickable || pickable(p));
                const Tag = onPick ? 'button' : 'div';
                return (
                    <Tag
                        key={p.id}
                        type={onPick ? 'button' : undefined}
                        className={`player-tile ${p.alive ? '' : 'dead'} ${selected.includes(p.id) ? 'selected' : ''} ${kill ? 'kill' : ''}`}
                        onClick={canPick ? () => onPick(p) : undefined}
                        disabled={onPick ? !canPick : undefined}
                        style={onPick && !canPick ? { opacity: 0.3 } : undefined}
                    >
                        <Avatar player={p} size={64} />
                        <span className="name">{p.name}{p.id === meId ? ' (tú)' : ''}</span>
                        {!p.alive && (
                            <span className="sub">
                                {p.eliminatedBy === 'murder' ? <Knife size={13} /> : <Gavel size={13} />}
                                Día {p.eliminatedDay}
                            </span>
                        )}
                        {note && note(p)}
                        {(!p.alive || revealAll) && p.role && <RoleTag role={p.role} factions={factions} />}
                    </Tag>
                );
            })}
        </div>
    );
}

// ---------- Mesa redonda ----------

function RoundtablePanel({ view, me, act }) {
    const [pick, setPick] = useState(null);
    if (view.voting !== 'app' || !view.round) return null;
    const candidates = view.round.candidates;
    const myVote = me.myVote && view.players.find(p => p.id === me.myVote);
    const pickable = p => !myVote && p.alive && p.id !== me.playerId && (!candidates || candidates.includes(p.id));
    const voters = new Set(view.round.voters);
    const chosen = !myVote && pick ? view.players.find(p => p.id === pick) : null;
    return (
        <section className="card hot stack">
            <h3 className="m0">{candidates ? 'Desempate: solo entre los empatados' : 'Tu voto'}</h3>
            <PlayerGrid
                players={view.players.filter(p => p.alive)}
                factions={view.factions}
                meId={me.playerId}
                onPick={myVote ? undefined : p => setPick(p.id)}
                pickable={pickable}
                selected={[myVote ? myVote.id : pick].filter(Boolean)}
                note={p => (voters.has(p.id) ? <span className="sub voted"><Check size={12} weight="bold" /> ya votó</span> : null)}
            />
            {myVote ? (
                <p className="note accent m0">Has votado a <strong>{myVote.name}</strong>. Tu voto es definitivo.</p>
            ) : (
                <ActionButton className="primary block lg" disabled={!chosen} hint="Elige a alguien de la mesa"
                    onClick={async () => { if (await act('vote', { targetId: chosen.id })) { setPick(null); return true; } return false; }}>
                    {chosen ? `Confirmar voto a ${chosen.name}` : 'Confirmar voto'}
                </ActionButton>
            )}
        </section>
    );
}

// ---------- Final: acabar o desterrar a uno más ----------

function EndgamePanel({ view, me, act }) {
    if (view.voting !== 'app' || !view.endgame) return null;
    const alive = view.players.filter(p => p.alive).length;
    return (
        <section className="card hot stack">
            <h3 className="m0">¿Quedan {view.factions.traitor} entre vosotros?</h3>
            <p className="small muted m0">Han decidido {view.endgame.voters.length} de {alive}. Solo se acaba si todos elegís acabar.</p>
            {me.myEndgame ? (
                <p className="note accent m0">{me.myEndgame === 'end' ? 'Has elegido acabar la partida.' : 'Has elegido desterrar a alguien más.'}</p>
            ) : (
                <div className="cols">
                    <ActionButton className="primary block lg" onClick={() => act('endgame-vote', { choice: 'end' })}>Acabar: ya no quedan</ActionButton>
                    <ActionButton className="block lg" onClick={() => act('endgame-vote', { choice: 'banish' })}>Desterrar a otro</ActionButton>
                </div>
            )}
        </section>
    );
}

// ---------- ¿Quién dijo qué? ----------

function QuizPanel({ view, me, self, act }) {
    const q = view.quiz;
    const [pick, setPick] = useState(null);
    useEffect(() => setPick(null), [q.id]);
    const author = q.revealed && view.players.find(p => p.id === q.authorId);
    const myGuess = me.myQuizGuess && view.players.find(p => p.id === me.myQuizGuess);
    const chosen = pick && view.players.find(p => p.id === pick);
    return (
        <section className="card hot stack">
            <h3 className="m0 row nowrap" style={{ gap: 8 }}><Question size={20} /> ¿Quién dijo qué?</h3>
            <p className="small muted m0">{q.question}</p>
            <p className="display m0" style={{ fontSize: '2rem' }}>«{q.answer}»</p>
            {q.revealed ? (
                <p className="note accent m0">
                    Era de <strong>{author?.name}</strong>. {q.correct.includes(me.playerId) ? '¡Has acertado!' : myGuess ? 'No has acertado.' : ''} {q.correct.length} {q.correct.length === 1 ? 'acierto' : 'aciertos'}: +{formatGold(q.gold)} para el botín.
                </p>
            ) : me.quizIsMine ? (
                <p className="note m0">Esta respuesta es tuya. Pon cara de póker.</p>
            ) : !self.alive && view.phase !== 'lobby' ? null : myGuess ? (
                <p className="note m0">Has dicho que es de <strong>{myGuess.name}</strong>. Espera a que el MC lo desvele.</p>
            ) : (
                <>
                    <PlayerGrid players={view.players.filter(p => p.id !== me.playerId)} factions={view.factions} meId={me.playerId}
                        onPick={p => setPick(p.id)} selected={[pick].filter(Boolean)} />
                    <ActionButton className="primary block" disabled={!chosen} hint="Toca a quien creas que lo dijo"
                        onClick={() => act('quiz-guess', { authorId: chosen.id })}>
                        {chosen ? `Es de ${chosen.name}` : 'Elegir'}
                    </ActionButton>
                </>
            )}
        </section>
    );
}

// ---------- Noche: todos señalan a un sospechoso ----------

function SuspectPanel({ view, me, act }) {
    const [pick, setPick] = useState(null);
    const current = me.mySuspect && view.players.find(p => p.id === me.mySuspect);
    const chosen = pick && pick !== me.mySuspect ? view.players.find(p => p.id === pick) : null;
    return (
        <section className="card stack">
            <h3 className="m0">¿De quién sospechas?</h3>
            <p className="small muted m0">Nadie verá tu elección. Solo el MC conoce el recuento de la noche.</p>
            <PlayerGrid
                players={view.players.filter(p => p.alive)}
                factions={view.factions}
                meId={me.playerId}
                onPick={p => setPick(p.id)}
                pickable={p => p.id !== me.playerId}
                selected={[pick || me.mySuspect].filter(Boolean)}
            />
            {current && !chosen && <p className="small muted m0">Tu sospechoso esta noche: <strong>{current.name}</strong>. Puedes cambiarlo.</p>}
            <ActionButton className={current ? 'block' : 'primary block'} disabled={!chosen} hint={current ? null : 'Toca a alguien'}
                onClick={async () => { if (await act('suspect', { targetId: chosen.id })) { setPick(null); return true; } return false; }}>
                {chosen ? `Señalar a ${chosen.name}` : 'Señalar'}
            </ActionButton>
        </section>
    );
}

// ---------- Cónclave ----------

function ConclavePanel({ view, me, act }) {
    const c = me.conclave;
    const [picks, setPicks] = useState(c.myVotes);
    useEffect(() => setPicks(c.myVotes), [c.myVotes]);

    if (!view.conclaveOpen) {
        return <p className="note felon">El cónclave está cerrado. Abre de {view.conclaveHours.start} a {view.conclaveHours.end}.</p>;
    }

    const allyIds = new Set(me.allies.map(a => a.id));
    const names = ids => ids.map(id => view.players.find(p => p.id === id)?.name).join(', ');
    const targets = view.players.filter(p => p.alive && !allyIds.has(p.id));
    const toggle = p => setPicks(prev => (prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id].slice(-c.kills)));
    const changed = JSON.stringify([...picks].sort()) !== JSON.stringify([...c.myVotes].sort());
    const inv = c.invitation;

    return (
        <section className="card felon stack">
            <h3 className="m0">Cónclave de los {view.factions.traitor}</h3>
            {inv.available && <Recruit view={view} targets={targets} act={act} />}
            {inv.status === 'pending' && <p className="note m0">Invitación enviada a {inv.targetName}. Esperando su respuesta.</p>}
            {inv.status === 'accepted' && <p className="note felon m0">{inv.targetName} se ha unido a vosotros.</p>}
            {inv.status === 'rejected' && <p className="note m0">{inv.targetName} ha rechazado la invitación.</p>}

            {c.kills > 0 ? (
                <>
                    <p className="small muted m0">
                        {c.kills === 1 ? 'Elegid a la víctima de esta noche.' : `Elegid a las ${c.kills} víctimas de esta noche.`} Cuenta la elección más votada y se sabrá al amanecer.
                    </p>
                    <PlayerGrid players={targets} factions={view.factions} onPick={toggle} selected={picks} kill />
                    {c.myVotes.length > 0 && !changed && <p className="small m0">Tu elección: <strong>{names(c.myVotes)}</strong>.</p>}
                    {changed && (
                        <HoldButton className="block lg" disabled={picks.length === 0} onConfirm={() => act('night-vote', { victimIds: picks })}>
                            <Knife size={20} /> <span>{picks.length ? names(picks) : 'Elige a alguien'}</span>
                        </HoldButton>
                    )}
                    {c.votes.length > 0 && (
                        <ul className="event-list">
                            {c.votes.map(v => <li key={v.by}><strong>{v.by}</strong> elige a {names(v.victims)}</li>)}
                        </ul>
                    )}
                </>
            ) : !inv.available && <p className="small muted m0">Esta noche no hay asesinatos. Aprovechad para conspirar en vuestro chat.</p>}
        </section>
    );
}

function Recruit({ view, targets, act }) {
    const [pick, setPick] = useState(null);
    const chosen = pick && view.players.find(p => p.id === pick);
    return (
        <div className="stack-sm">
            <p className="small m0">Esta noche podéis invitar en secreto a uno de los {view.factions.loyal} a cambiar de bando. Solo hay una oportunidad.</p>
            <PlayerGrid players={targets} factions={view.factions} onPick={p => setPick(p.id)} selected={[pick].filter(Boolean)} kill />
            {chosen && <HoldButton className="block" onConfirm={() => act('invite', { targetId: pick })}>Invitar a {chosen.name}</HoldButton>}
        </div>
    );
}

function InvitationModal({ view, act }) {
    const [confirm, setConfirm] = useState(null);
    return (
        <Modal>
            <div className="card felon stack">
                <h2>Invitación secreta</h2>
                <p className="m0">Los {view.factions.traitor} te invitan a unirte a ellos. Si aceptas, cambias de bando y entras en su cónclave.</p>
                <p className="small muted m0">Nadie sabrá lo que decidas. No hay vuelta atrás.</p>
                {confirm === null ? (
                    <div className="row nowrap">
                        <button className="btn grow" onClick={() => setConfirm(false)}>Rechazar</button>
                        <button className="btn primary grow" onClick={() => setConfirm(true)}>Aceptar</button>
                    </div>
                ) : (
                    <div className="row nowrap">
                        <button className="btn grow" onClick={() => setConfirm(null)}>Volver</button>
                        {confirm
                            ? <HoldButton wrapClass="grow" className="block" onConfirm={() => act('respond-invitation', { accept: true })}>Unirme a los {view.factions.traitor}</HoldButton>
                            : <ActionButton wrapClass="grow" className="primary block" onClick={() => act('respond-invitation', { accept: false })}>Seguir con los {view.factions.loyal}</ActionButton>}
                    </div>
                )}
            </div>
        </Modal>
    );
}

// ---------- Rol: todo lo secreto vive aquí ----------

function SecretSheet({ me, view, chat, act, self, onClose }) {
    const [flipped, setFlipped] = useState(false);
    const isTraitor = me.role === 'traitor';
    const allies = (me.allies || []).filter(a => a.id !== me.playerId);
    const playing = view.phase !== 'end' && self.alive;
    return (
        <div className="secret-sheet" role="dialog" aria-modal="true" aria-label="Mi rol">
            <div className="topbar">
                <div className="topbar-inner">
                    <span className="brand">Mi rol</span>
                    <span className="grow" />
                    <button className="btn primary sm" onClick={onClose}><EyeSlash size={18} /> Ocultar</button>
                </div>
            </div>
            <div className="page narrow stack">
                <button className={`role-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(f => !f)} aria-label="Dar la vuelta a la carta">
                    <div className="role-card-inner">
                        <div className="role-face front">
                            <span className="brand">{view.name}</span>
                            <img className="logo" src={`${process.env.PUBLIC_URL}/img/logo.webp`} alt="" style={{ width: '62%', alignSelf: 'center' }} />
                            <span className="small">Comprueba que nadie mira tu pantalla.<br /><span className="muted">Toca la carta para ver tu bando.</span></span>
                        </div>
                        <div className={`role-face back ${me.role} has-art`}>
                            <Art name={isTraitor ? 'punal.jpg' : 'farol.jpg'} />
                            <Seal kind={me.role} size={64} className="card-seal" />
                            <span className="grow" />
                            <span className="small">Eres de los</span>
                            <span className="display">{isTraitor ? view.factions.traitor : view.factions.loyal}</span>
                            <span className="small">
                                {isTraitor ? `Elimina a los ${view.factions.loyal} sin que te descubran.` : `Descubre y destierra a todos los ${view.factions.traitor}.`}
                            </span>
                        </div>
                    </div>
                </button>

                {flipped && isTraitor && allies.length > 0 && (
                    <section className="card felon stack-sm">
                        <h3 className="m0">Tus aliados</h3>
                        <div className="allies">
                            {allies.map(a => {
                                const p = view.players.find(x => x.id === a.id) || { ...a, photo: null };
                                return <span key={a.id} className="ally"><Avatar player={p} size={36} />{a.name}{!a.alive && <span className="tiny muted">(eliminado)</span>}</span>;
                            })}
                        </div>
                    </section>
                )}
                {flipped && isTraitor && playing && view.phase === 'night' && <ConclavePanel view={view} me={me} act={act} />}
                {flipped && isTraitor && playing && (
                    <Chat me={me} view={view} chat={chat} act={act} channels={['traitors']} initial="traitors" />
                )}
            </div>
        </div>
    );
}

// ---------- Fantasmas ----------

function GhostWelcome({ onClose }) {
    return (
        <Modal>
            <div className="card stack">
                <Seal kind="ghost" size={120} className="center-seal" />
                <h2 className="center">La Sociedad Secreta de los Fantasmas</h2>
                <p className="m0">Te han eliminado, pero tu partida sigue. Ahora formas parte de una sociedad secreta que los vivos no conocen.</p>
                <p className="m0">Cada día recibiréis el nombre de un jugador. Conseguid, sin que se note, que los vivos le voten en la mesa redonda. Cada voto suma calaveras, y si lo destierran sumáis más. Con suficientes calaveras robáis parte del botín final.</p>
                <p className="m0"><strong>Ni una palabra a los vivos.</strong> Coordinaos en vuestro chat.</p>
                <button className="btn primary block" onClick={onClose}>Entendido</button>
            </div>
        </Modal>
    );
}

// El MC pide ver el panel completo: hace falta que lo aprueben todos los vivos
function UnlockPrompt({ view, me, act }) {
    const alive = view.players.filter(p => p.alive).length;
    return (
        <section className="card hot stack-sm">
            <h3 className="m0">El MC pide ver todo</h3>
            <p className="small m0">Para desatascar la partida quiere ver los roles, el cónclave y los Fantasmas. Solo se abre si lo aprobáis todos los vivos ({view.unlock.approvals} de {alive}). Un «no» lo cancela.</p>
            {me.myUnlockVote ? (
                <p className="note accent m0">Lo has aprobado.</p>
            ) : (
                <div className="cols">
                    <ActionButton className="primary block" onClick={() => act('unlock-vote', { approve: true })}>Aprobar</ActionButton>
                    <ActionButton className="block" onClick={() => act('unlock-vote', { approve: false })}>No</ActionButton>
                </div>
            )}
        </section>
    );
}

// Quien organiza una partida sin MC juega como uno más; solo puede pausar el horario y,
// si le eliminan (o todos lo aprueban), abrir el panel completo
function OrganizerPanel({ view, me, self, act, code }) {
    const tt = view.timetable;
    const fullAccess = !self.alive || view.unlock?.status === 'unlocked';
    if (!view.hostless) return null;
    return (
        <section className="card stack-sm">
            <h3 className="m0">Organizas tú</h3>
            {(
                <>
                    <p className="small muted m0">
                        {tt.enabled ? `La partida avanza sola: amanecer ${tt.dawn}, mesa ${tt.roundtable}, noche ${tt.night}.` : 'El horario automático está en pausa.'}
                    </p>
                    <div className="row">
                        <ActionButton onClick={() => act('org:timetable', { enabled: !tt.enabled })}>{tt.enabled ? 'Pausar horario' : 'Reanudar horario'}</ActionButton>
                        {fullAccess
                            ? <Link className="btn primary" to={`/mc/${code}`}>Abrir el panel completo</Link>
                            : view.unlock?.status === 'none' && <ActionButton onClick={() => act('org:request-unlock')}>Pedir ver todo</ActionButton>}
                    </div>
                </>
            )}
        </section>
    );
}

function GhostPanel({ ghost, view, act }) {
    const [votes, setVotes] = useState('');
    const reporting = ghost.inPerson && view.phase === 'roundtable' && ghost.target && !ghost.target.reported;
    return (
        <section className="card stack">
            {reporting && (
                <div className="note gold stack-sm">
                    <span>En persona, el MC no sabe quién es vuestro objetivo. Apuntad vosotros cuántos votos recibió <strong>{ghost.target.name}</strong> en la primera votación de hoy (basta con que lo haga uno).</span>
                    <div className="row nowrap">
                        <input className="input" type="number" inputMode="numeric" min={0} value={votes} onChange={e => setVotes(e.target.value)} style={{ maxWidth: 110 }} />
                        <ActionButton className="primary" disabled={votes === ''} onClick={() => act('ghost-report', { votes })}>Apuntar</ActionButton>
                    </div>
                </div>
            )}
            {ghost.target?.reported && ghost.inPerson && <p className="tiny muted m0">Votos de hoy apuntados por {ghost.target.reportedBy}.</p>}
            <Art name="fantasma.jpg" className="ghost-art" />
            <div className="row between">
                <h3 className="m0 row nowrap" style={{ gap: 8 }}><Ghost size={20} /> Sociedad Secreta</h3>
                <span className="tag">Solo para eliminados</span>
            </div>
            <div className="row between" style={{ alignItems: 'flex-end' }}>
                <div>
                    <div className="label">Objetivo de hoy</div>
                    <div className="display" style={{ fontSize: '2.6rem' }}>{ghost.target ? ghost.target.name : 'Al amanecer'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div className="big-number">{ghost.skulls}</div>
                    <div className="label">calaveras</div>
                </div>
            </div>
            <Thresholds skulls={ghost.skulls} thresholds={ghost.thresholds} />
            <p className="small muted m0">
                {ghost.perVote === 1 ? '1 calavera' : `${ghost.perVote} calaveras`} por cada voto al objetivo y {ghost.perElimination} más si lo destierran.
                {ghost.nextThreshold && ` Os faltan ${ghost.nextThreshold.skulls - ghost.skulls} para robar el ${ghost.nextThreshold.percent}%.`}
            </p>
            {ghost.history.length > 0 && <GhostHistory history={ghost.history} />}
        </section>
    );
}

function GhostHistory({ history }) {
    return (
        <ul className="event-list">
            {history.map((h, i) => (
                <li key={i} className="row between nowrap">
                    <span><span className="day">Día {h.day}</span>{h.targetName}: {h.votes} {h.votes === 1 ? 'voto' : 'votos'}{h.eliminated ? ', desterrado' : ''}</span>
                    <strong className="num">+{h.skulls}</strong>
                </li>
            ))}
        </ul>
    );
}

// ---------- Botín, sucesos y mensajes ----------

function Treasure({ view }) {
    if (view.tests.length === 0) return null;
    return (
        <section className="card stack">
            <div className="treasure">
                <span className="big-number">{formatEuros(view.treasure, view.goldPerEuro)}</span>
                <span className="muted small">{formatGold(view.treasure)}{view.maxTreasure > 0 && ` de ${formatGold(view.maxTreasure)} posibles`}</span>
            </div>
            <TestsTable tests={view.tests} />
        </section>
    );
}

function SpotlightCard({ view }) {
    const t = view.tests.find(x => x.id === view.spotlight);
    if (!t) return null;
    return (
        <section className="card hot stack-sm spotlight-card">
            <span className="label">Prueba en juego</span>
            <span className="display" style={{ fontSize: '2.8rem' }}>{t.name}</span>
            {t.description && <p className="desc m0">{t.description}</p>}
            <p className="small muted m0">
                {t.score !== null ? `Conseguido: ${formatGold(t.score)}` : t.max ? `Hasta ${formatGold(t.max)} para el botín` : 'Oro para el botín'}
            </p>
        </section>
    );
}

function Events({ events }) {
    if (events.length === 0) return <p className="small muted">Todavía no ha pasado nada.</p>;
    return (
        <section className="card">
            <h3>Lo que ha pasado</h3>
            <ul className="event-list">
                {[...events].reverse().slice(0, 20).map(e => (
                    <li key={e.id}><span className="day">Día {e.day}</span>{e.text}</li>
                ))}
            </ul>
        </section>
    );
}

function Inbox({ inbox }) {
    return (
        <section className="card hot">
            <h3 className="row nowrap" style={{ gap: 8 }}><Envelope size={20} /> Mensajes privados del MC</h3>
            <ul className="event-list">
                {[...inbox].reverse().map(m => <li key={m.id}>{m.message}</li>)}
            </ul>
        </section>
    );
}

function DeviceLink({ code }) {
    const [open, setOpen] = useState(false);
    const link = `${window.location.origin}/p/${code}?t=${encodeURIComponent(storage.get(playerTokenKey(code)) || '')}`;
    if (!open) {
        return <button className="btn link" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(true)}><DeviceMobile size={18} /> Jugar también desde otro dispositivo</button>;
    }
    return (
        <section className="stack-sm">
            <p className="small muted m0">Abre este enlace en tu otro dispositivo para entrar como el mismo jugador. No lo compartas: quien lo tenga verá tu rol.</p>
            <CopyBox value={link} />
        </section>
    );
}

// ---------- Chat ----------

const CHANNELS = {
    general: { label: 'General', icon: null },
    traitors: { label: 'Cónclave', icon: <Knife size={16} /> },
    dead: { label: 'Fantasmas', icon: <Ghost size={16} /> }
};

function Chat({ me, view, chat, act, channels, initial, onSeen }) {
    const [channel, setChannel] = useState(initial || channels[0]);
    const [text, setText] = useState('');
    const [seen, setSeen] = useState({});
    const log = useRef(null);
    const active = channels.includes(channel) ? channel : channels[0];
    const messages = chat[active] || [];
    const self = view.players.find(p => p.id === me.playerId);
    const canWrite = active === 'general' ? (self?.alive || view.phase === 'end') : true;

    useEffect(() => {
        setSeen(s => ({ ...s, [active]: messages.length }));
        if (onSeen) onSeen(active, messages.length);
        if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }, [messages.length, active]); // eslint-disable-line react-hooks/exhaustive-deps

    const submit = async e => {
        e.preventDefault();
        if (!text.trim()) return;
        if (await act('chat', { channel: active, message: text.trim() })) setText('');
    };

    return (
        <section className={`card ${active === 'traitors' ? 'felon' : ''}`}>
            {channels.length > 1 ? (
                <div className="tabs" role="tablist">
                    {channels.map(ch => {
                        const unread = ch !== active ? (chat[ch] || []).length - (seen[ch] ?? (chat[ch] || []).length) : 0;
                        return (
                            <button key={ch} role="tab" aria-selected={active === ch} className={`tab ${active === ch ? 'on' : ''}`} onClick={() => setChannel(ch)}>
                                {CHANNELS[ch].icon}{CHANNELS[ch].label}{unread > 0 && <span className="unread">{unread}</span>}
                            </button>
                        );
                    })}
                </div>
            ) : <h3 className="m0 row nowrap" style={{ gap: 8 }}>{CHANNELS[active].icon}{active === 'traitors' ? `Chat de los ${view.factions.traitor}` : 'Chat'}</h3>}
            <div className="chat-log" ref={log}>
                {messages.length === 0 && <p className="small faint m0">Nadie ha escrito todavía.</p>}
                {messages.map(m => {
                    const mine = m.fromId === me.playerId;
                    return (
                        <div key={m.id} className={`msg ${m.fromMc ? 'mc' : ''} ${mine ? 'mine' : ''}`}>
                            {!mine && <div className="from">{m.fromMc ? 'Maestro de Ceremonias' : m.from}</div>}
                            <span className="bubble">{m.message}</span>
                            <span className="time">{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                    );
                })}
            </div>
            <form className="row nowrap" onSubmit={submit}>
                <input className="input" value={text} maxLength={500} onChange={e => setText(e.target.value)} disabled={!canWrite}
                    placeholder={canWrite ? 'Escribe un mensaje' : 'Los eliminados no hablan aquí'} aria-label="Mensaje" />
                <button className="btn send" disabled={!canWrite || !text.trim()} aria-label="Enviar"><PaperPlaneRight size={22} weight="fill" /></button>
            </form>
        </section>
    );
}

// ---------- Final ----------

function EndScreen({ view, me, chat, self, act }) {
    const winners = view.winner === 'traitor' ? view.factions.traitor : view.factions.loyal;
    const iWon = me.role === view.winner;
    const ghosts = view.ghosts;
    const stolen = ghosts ? ghosts.stolen : 0;
    const kept = view.treasure - stolen;
    const sorted = useMemo(() => [...view.players].sort((a, b) => (a.role === b.role ? 0 : a.role === 'traitor' ? -1 : 1)), [view.players]);
    return (
        <div className="page stack">
            <header className="phase end" style={{ paddingTop: 32 }}>
                <span className="display" style={{ color: view.winner === 'traitor' ? 'var(--accent)' : 'var(--text)' }}>Ganan los {winners}</span>
                <Seal kind={view.winner} size={96} className="phase-icon" />
                <p className="phase-text m0">{iWon ? 'Has ganado.' : 'Has perdido.'} {view.name} ha terminado.</p>
            </header>

            {ghosts && (
                <section className="card hot stack">
                    <h3 className="m0 row nowrap" style={{ gap: 8 }}><Ghost size={20} /> La Sociedad Secreta de los Fantasmas</h3>
                    <p className="m0">Mientras los vivos buscaban a los {view.factions.traitor}, los eliminados conspiraban en secreto: cada día tenían un objetivo y ganaban calaveras con cada voto que recibía en la mesa redonda.</p>
                    <div className="row between" style={{ alignItems: 'flex-end' }}>
                        <span><span className="big-number">{ghosts.skulls}</span> <span className="label">calaveras</span></span>
                        <span className="small muted">{ghosts.percent > 0 ? `Roban el ${ghosts.percent}% del botín: ${formatEuros(stolen, view.goldPerEuro)}` : ghosts.history.length === 0 ? 'No llegó a haber ningún objetivo. El botín queda intacto.' : 'No llegan a ningún umbral. El botín queda intacto.'}</span>
                    </div>
                    <Thresholds skulls={ghosts.skulls} thresholds={ghosts.thresholds} />
                    {ghosts.history.length > 0 && <GhostHistory history={ghosts.history} />}
                </section>
            )}

            {view.tests.length > 0 && (
                <section className="card stack">
                    <div className="treasure">
                        <span className="big-number">{formatEuros(kept, view.goldPerEuro)}</span>
                        <span className="muted small">para el bote del viaje</span>
                    </div>
                    {view.results && view.results.players.some(p => p.won) && (
                        <p className="small m0">
                            Se lo reparten {view.results.players.filter(p => p.won).map(p => p.name).join(', ')}:{' '}
                            <strong>{formatEuros(view.results.players.find(p => p.won).gold, view.goldPerEuro)}</strong> cada uno.
                        </p>
                    )}
                    <TestsTable tests={view.tests} />
                </section>
            )}
            {me.organizer && view.hostless && (
                <ActionButton className="primary block" onClick={() => act('org:restart')}>Otra partida con los mismos</ActionButton>
            )}
            <Link to="/ranking" className="btn block"><Trophy size={18} /> Tabla de ganadores</Link>

            <div className="cols">
                <section className="card">
                    <h3>Quién era quién</h3>
                    <PlayerGrid players={sorted} factions={view.factions} meId={me.playerId} revealAll />
                </section>
                <Chat me={me} view={view} chat={chat} act={act} channels={['general', ...(me.role === 'traitor' ? ['traitors'] : []), ...(!self.alive ? ['dead'] : [])]} />
            </div>
        </div>
    );
}
