import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowRight, ChatCircle, Coins, Eye, EyeSlash, Gavel, Ghost, Knife, LinkSimple, Megaphone, PaperPlaneRight, ShareNetwork, Shield as ShieldIcon, Television, Trash, Users
} from '@phosphor-icons/react';
import { formatEuros, formatGold, http, mcTokenKey, send, socket, storage } from '../api';
import {
    ActionButton, Avatar, CopyBox, HoldButton, Loading, OfflineBanner, RoleTag, Seal, Segmented, Thresholds, Toasts,
    useConnection, useSocketEvent, useToasts
} from '../components';

const EMPTY_CHAT = { general: [], traitors: [], dead: [] };

// El enlace del MC (/mc/CODE?k=...) permite dirigir desde cualquier móvil, también a distancia
function adoptTokenFromUrl(code) {
    const params = new URLSearchParams(window.location.search);
    const k = params.get('k');
    if (!k) return;
    storage.set(mcTokenKey(code), k);
    window.history.replaceState(null, '', window.location.pathname);
}

export default function Master() {
    const code = useParams().code.toUpperCase();
    const connected = useConnection();
    const { toasts, push, dismiss } = useToasts(4000);
    const [state, setState] = useState(null);
    const [auth, setAuth] = useState('checking'); // checking | login | ok
    const [chat, setChat] = useState(EMPTY_CHAT);
    const [tab, setTab] = useState('game');
    // El MC dirige a ciegas: solo ve roles, cónclave y Fantasmas si todos los vivos lo aprueban
    const showRoles = !!state?.fullAccess;

    useEffect(() => {
        adoptTokenFromUrl(code);
        const connect = async () => {
            const token = storage.get(mcTokenKey(code));
            if (!token) return setAuth('login');
            try {
                await send('mc:auth', { token });
                setAuth('ok');
            } catch (err) {
                storage.remove(mcTokenKey(code));
                setAuth('login');
            }
        };
        socket.on('connect', connect);
        if (socket.connected) connect();
        return () => socket.off('connect', connect);
    }, [code]);

    useSocketEvent('master-state', setState);
    useSocketEvent('chat-history', h => setChat({ ...EMPTY_CHAT, ...h }));
    useSocketEvent('chat', msg => setChat(c => ({ ...c, [msg.channel]: [...(c[msg.channel] || []), msg].slice(-300) })));

    const act = async (event, payload, ok) => {
        try {
            await send(event, payload);
            if (ok) push(ok);
            return true;
        } catch (err) {
            push(err.message, 'error');
            return false;
        }
    };

    let content;
    if (auth === 'login') {
        content = <Login code={code} onToken={async token => { storage.set(mcTokenKey(code), token); await send('mc:auth', { token }); setAuth('ok'); }} />;
    } else if (auth !== 'ok' || !state) {
        content = <Loading text="Abriendo el panel" />;
    } else {
        const TABS = [
            { id: 'game', label: 'Partida', icon: <Gavel size={18} /> },
            { id: 'players', label: 'Jugadores', icon: <Users size={18} /> },
            { id: 'tests', label: 'Pruebas', icon: <Coins size={18} /> },
            ...(state.config.ghosts.enabled && state.ghosts ? [{ id: 'ghosts', label: 'Fantasmas', icon: <Ghost size={18} /> }] : []),
            { id: 'chat', label: 'Chats', icon: <ChatCircle size={18} /> },
            { id: 'share', label: 'Compartir', icon: <ShareNetwork size={18} /> }
        ];
        content = (
            <>
                <div className="topbar">
                    <div className="topbar-inner">
                        <span className="room-code">{code}</span>
                        <span className="tag gold">MC</span>
                        <span className="small muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.name}</span>
                        <UnlockButton s={state} act={act} />
                    </div>
                    <nav className="mc-nav" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 8px' }}>
                        {TABS.map(t => (
                            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>
                        ))}
                    </nav>
                </div>
                <div className="page stack">
                    {tab === 'game' && <GameTab s={state} act={act} showRoles={showRoles} />}
                    {tab === 'players' && <PlayersTab s={state} act={act} showRoles={showRoles} code={code} />}
                    {tab === 'tests' && <TestsTab s={state} act={act} />}
                    {tab === 'ghosts' && state.ghosts && <GhostsTab s={state} />}
                    {tab === 'chat' && <ChatTab s={state} chat={chat} act={act} />}
                    {tab === 'share' && <ShareTab s={state} code={code} act={act} />}
                </div>
            </>
        );
    }

    return (
        <>
            <OfflineBanner connected={connected} />
            {content}
            <Toasts toasts={toasts} dismiss={dismiss} />
        </>
    );
}

// Si la partida se atasca, el MC pide ver el panel completo; lo aprueban (o no) los vivos desde su móvil
function UnlockButton({ s, act }) {
    if (s.fullAccess) return <span className="tag gold"><Eye size={16} /> Panel completo</span>;
    if (s.phase === 'lobby' || s.phase === 'end') return <span className="tag"><EyeSlash size={16} /> Sin roles</span>;
    if (s.unlock.status === 'pending') {
        return <span className="tag">Esperando aprobación: {s.unlock.approvals} de {s.players.filter(p => p.alive).length}</span>;
    }
    return (
        <HoldButton className="sm" hint={null} title="Pide a los jugadores ver roles, cónclave y Fantasmas"
            onConfirm={() => act('mc:request-unlock', {}, 'Petición enviada a los jugadores')}>
            <Eye size={18} /> <span>Pedir ver todo</span>
        </HoldButton>
    );
}

function Login({ code, onToken }) {
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const submit = async e => {
        e.preventDefault();
        try {
            const { mcToken } = await http(`/api/rooms/${code}/mc-login`, { method: 'POST', body: { password } });
            await onToken(mcToken);
        } catch (err) {
            setError(err.message);
        }
    };
    return (
        <form className="page narrow stack" style={{ paddingTop: 48 }} onSubmit={submit}>
            <span className="tag">Partida <span className="room-code" style={{ fontSize: 'inherit' }}>{code}</span></span>
            <h1>Panel del MC</h1>
            <p className="muted m0">Abre el enlace de MC que recibiste o entra con la contraseña de la partida.</p>
            <label className="field">
                <span>Contraseña</span>
                <input className="input" type="password" value={password} onChange={e => { setPassword(e.target.value); setError(''); }} autoComplete="current-password" />
            </label>
            {error && <p className="accent small m0">{error}</p>}
            <button className="btn primary block lg" disabled={!password}>Entrar</button>
            <Link className="small muted" to="/">Volver al inicio</Link>
        </form>
    );
}

// ---------- Partida ----------

function nextActionLabel(s) {
    switch (s.phase) {
        case 'lobby': return 'Empezar partida';
        case 'day': return s.today.roundtable > 0 ? 'Abrir mesa redonda' : 'Pasar a la noche';
        case 'roundtable':
            if (s.round) return 'Cerrar la mesa sin más destierros';
            if (s.endgameRound) return 'Volver a decidir si acabar';
            if (s.day >= s.days) return s.endgameEnabled && s.players.filter(p => p.alive).length > 2 ? 'Pasar al final' : 'Terminar la partida';
            return 'Pasar a la noche';
        case 'night': return `Amanecer del día ${s.day + 1}`;
        case 'endgame': return 'Terminar la partida ya';
        default: return null;
    }
}

const PHASE_TITLE = { lobby: 'Sala de espera', day: 'Día', roundtable: 'Mesa redonda', night: 'Noche', endgame: 'El final', end: 'Final' };

function GameTab({ s, act, showRoles }) {
    const label = nextActionLabel(s);
    const alive = s.players.filter(p => p.alive).length;
    // Avanzar es lo normal (dorado); si se pierde algo (una votación abierta, una noche sin víctima), se mantiene pulsado
    const risk = s.phase === 'roundtable' && s.round
        ? 'Hay una votación abierta: se descarta. Mantén pulsado para confirmar'
        : s.phase === 'night' && s.today.conclave > 0 && Object.keys(s.nightTally).length === 0 && !s.nightOverride
            ? `Los ${s.config.factions.traitor} no han elegido víctima: amanecerá sin asesinato. Mantén pulsado`
            : null;
    return (
        <>
            <header className={`phase ${s.phase}`}>
                <span className="display">{s.phase === 'day' ? `Día ${s.day}` : PHASE_TITLE[s.phase]}</span>
                <span className="tag">{s.phase === 'lobby' ? `${s.players.length} jugadores` : `Día ${s.day} de ${s.days}`}</span>
            </header>

            <div className="stat-grid">
                <div className="stat"><div className="label">Vivos</div><div className="value">{alive}</div></div>
                {showRoles ? (
                    <>
                        <div className="stat"><div className="label row nowrap" style={{ gap: 6 }}><Seal kind="traitor" size={20} />{s.config.factions.traitor}</div><div className="value accent">{s.aliveCounts.traitor}</div></div>
                        <div className="stat"><div className="label row nowrap" style={{ gap: 6 }}><Seal kind="loyal" size={20} />{s.config.factions.loyal}</div><div className="value">{s.aliveCounts.loyal}</div></div>
                    </>
                ) : (
                    <div className="stat"><div className="label">Eliminados</div><div className="value">{s.players.length - alive}</div></div>
                )}
                <div className="stat"><div className="label">Botín</div><div className="value">{formatEuros(s.treasure, s.goldPerEuro)}</div></div>
            </div>

            {s.phase === 'lobby' && <LobbyInfo s={s} />}
            {s.phase === 'roundtable' && <RoundtableControl s={s} act={act} showRoles={showRoles} />}
            {s.phase === 'night' && <NightControl s={s} act={act} showRoles={showRoles} />}
            {s.phase === 'endgame' && <EndgameControl s={s} act={act} />}
            {['day', 'roundtable', 'night', 'endgame'].includes(s.phase) && <QuizControl s={s} act={act} />}
            {s.phase !== 'end' && <TimetableControl s={s} act={act} />}
            {s.phase === 'end' && (
                <p className="note accent">Ganan los {s.winner === 'traitor' ? s.config.factions.traitor : s.config.factions.loyal}. Puedes empezar otra partida con los mismos jugadores desde Compartir.</p>
            )}

            {label && (risk
                ? <HoldButton className="block lg" hint={risk} onConfirm={() => act('mc:advance')}>{label} <ArrowRight size={20} /></HoldButton>
                : (
                    <ActionButton className="primary block lg" onClick={() => act('mc:advance')} disabled={s.phase === 'lobby' && s.players.length < 4}
                        hint={`Hacen falta al menos 4 jugadores (hay ${s.players.length})`}>
                        {label} <ArrowRight size={20} />
                    </ActionButton>
                ))}

            {s.phase === 'lobby' && (
                <div className="stack-sm">
                    <ActionButton className="block" onClick={() => act('mc:add-bots', { count: 6 })}>Añadir 6 jugadores de prueba</ActionButton>
                    <p className="muted tiny m0 center">Para probar sin gente: los 🤖 votan, señalan y matan solos al azar. Únete tú también desde otro móvil o pestaña para ver la partida como jugador.</p>
                </div>
            )}

            {s.events.length > 0 && (
                <section className="section">
                    <h3>Registro</h3>
                    <ul className="event-list">
                        {[...s.events].reverse().slice(0, 12).map(e => <li key={e.id}><span className="day">Día {e.day}</span>{e.text}</li>)}
                    </ul>
                </section>
            )}
        </>
    );
}

// Final: los jugadores votan en la app, o el MC registra lo que decidan en voz alta
function EndgameControl({ s, act }) {
    const alive = s.players.filter(p => p.alive);
    const votes = s.endgameVotes || {};
    const label = { end: 'acabar', banish: 'desterrar' };
    return (
        <section className="card hot stack">
            <h3 className="m0">El final</h3>
            {s.config.voting === 'app' ? (
                <ul className="event-list">
                    {alive.map(p => <li key={p.id} className="row between nowrap"><span>{p.name}</span><span className="muted">{votes[p.id] ? label[votes[p.id]] : 'pensando…'}</span></li>)}
                </ul>
            ) : (
                <p className="small muted m0">Que decidan en voz alta. Solo se acaba si todos están de acuerdo.</p>
            )}
            <div className="cols">
                <HoldButton className="block" hint={null} onConfirm={() => act('mc:endgame-decide', { choice: 'end' })}>Unanimidad: acabar</HoldButton>
                <ActionButton className="block" onClick={() => act('mc:endgame-decide', { choice: 'banish' })}>Desterrar a otro</ActionButton>
            </div>
        </section>
    );
}

// ¿Quién dijo qué?: el MC saca una respuesta de la entrevista, la desvela y suma el oro
function QuizControl({ s, act }) {
    const q = s.quizFull;
    const author = q && s.players.find(p => p.id === q.authorId);
    const guesses = q ? Object.keys(q.guesses).length : 0;
    return (
        <section className="card stack-sm">
            <div className="row between">
                <h3 className="m0">¿Quién dijo qué?</h3>
                <span className="small muted">{s.quizLeft} respuestas sin usar</span>
            </div>
            {q && (
                <>
                    <p className="small muted m0">{q.question}</p>
                    <p className="m0"><strong>«{q.answer}»</strong> — es de {author?.name}</p>
                    <p className="small m0">{q.revealed ? `${q.correct.length} aciertos: +${formatGold(q.gold)}` : `${guesses} han respondido`}</p>
                </>
            )}
            <div className="row">
                {q && !q.revealed && <ActionButton className="primary" onClick={() => act('mc:quiz-reveal')}>Desvelar</ActionButton>}
                {(!q || q.revealed) && s.quizLeft > 0 && <ActionButton className={q ? 'primary' : ''} onClick={() => act('mc:quiz-next')}>{q ? 'Siguiente respuesta' : 'Sacar una respuesta'}</ActionButton>}
                {q && <ActionButton onClick={() => act('mc:quiz-close')}>Cerrar</ActionButton>}
            </div>
        </section>
    );
}

// Horario automático: se activa, pausa o cambia en cualquier momento; el MC siempre puede avanzar a mano
function TimetableControl({ s, act }) {
    const tt = s.config.timetable;
    const [draft, setDraft] = useState(tt);
    useEffect(() => setDraft(tt), [tt.enabled, tt.dawn, tt.roundtable, tt.night]); // eslint-disable-line react-hooks/exhaustive-deps
    const changed = draft.dawn !== tt.dawn || draft.roundtable !== tt.roundtable || draft.night !== tt.night;
    return (
        <section className="card stack-sm">
            <label className="check">
                <input type="checkbox" checked={tt.enabled} onChange={e => act('mc:timetable', { enabled: e.target.checked }, e.target.checked ? 'Horario automático activado' : 'Horario automático en pausa')} />
                <h3 className="m0">Horario automático</h3>
            </label>
            <p className="tiny muted m0">La partida avanza sola a estas horas. Puedes seguir avanzando a mano cuando quieras.</p>
            <div className="row nowrap">
                {[['dawn', 'Amanecer'], ['roundtable', 'Mesa'], ['night', 'Noche']].map(([k, l]) => (
                    <label key={k} className="field grow">
                        <span className="tiny">{l}</span>
                        <input className="input" type="time" value={draft[k]} onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))} />
                    </label>
                ))}
            </div>
            {changed && <ActionButton className="block" onClick={() => act('mc:timetable', draft, 'Horario guardado')}>Guardar horario</ActionButton>}
        </section>
    );
}

function LobbyInfo({ s }) {
    const c = s.config;
    const total = c.schedule.reduce((n, d) => n + d.roundtable + d.conclave, 0);
    return (
        <section className="card stack-sm">
            <h3>Configuración</h3>
            <p className="small m0">{c.days} días, {total} eliminaciones, {c.traitorCount || 'reparto automático de'} {c.factions.traitor.toLowerCase()}.</p>
            <p className="small m0">Mesa redonda {c.voting === 'app' ? 'votando en la app' : 'en persona'}{c.voting === 'app' && (c.tieRule === 'revote' ? ', desempate entre empatados' : ', con empate no sale nadie')}.</p>
            <p className="small m0">Cónclave {c.conclaveHours ? `de ${c.conclaveHours.start} a ${c.conclaveHours.end}` : 'abierto toda la noche'}{c.invitation ? ', con reclutamiento la primera noche' : ''}.</p>
            {c.ghosts.enabled && <p className="small m0">Sociedad de los Fantasmas activada.</p>}
            <p className="small m0">{c.mode === 'online' ? 'Partida a distancia.' : 'Partida en persona.'}{c.endgame ? ' Al final, votación para acabar o seguir.' : ''}</p>
        </section>
    );
}

function RoundtableControl({ s, act, showRoles }) {
    const [pick, setPick] = useState(null);
    const alivePlayers = s.players.filter(p => p.alive);
    const candidates = s.round && s.round.candidates;

    if (!s.round) {
        return <p className="note">Mesa redonda terminada ({s.roundsDone} de {s.today.roundtable}).</p>;
    }

    const picked = pick && s.players.find(p => p.id === pick);
    const banish = async () => {
        if (await act('mc:banish', { playerId: pick }, `Desterrado: ${picked.name}`)) setPick(null);
    };

    return (
        <section className="card hot stack">
            <div className="row between">
                <h3 className="m0">{candidates ? 'Desempate' : `Votación ${s.round.number} de ${s.today.roundtable}`}</h3>
                {s.config.voting === 'app' && <span className="tag">{s.round.voters.length} de {alivePlayers.length} votos</span>}
            </div>

            {s.config.voting === 'app' && (
                <>
                    <ul className="event-list">
                        {Object.entries(s.roundTally).sort((a, b) => b[1] - a[1]).map(([id, n]) => (
                            <li key={id} className="row between nowrap">
                                <span>{s.players.find(p => p.id === id)?.name}</span><strong className="num">{n}</strong>
                            </li>
                        ))}
                        {Object.keys(s.roundTally).length === 0 && <li className="muted">Nadie ha votado todavía.</li>}
                    </ul>
                    <HoldButton className="block" onConfirm={() => act('mc:close-round')} disabled={s.round.voters.length === 0}>Cerrar la votación ya</HoldButton>
                    <p className="small muted m0">Se cierra sola cuando votan todos. Si hace falta, también puedes desterrar a alguien directamente:</p>
                </>
            )}

            <div className="player-grid">
                {alivePlayers.map(p => (
                    <button key={p.id} type="button" className={`player-tile ${pick === p.id ? 'selected' : ''}`} onClick={() => setPick(p.id)}>
                        <Avatar player={p} size={56} />
                        <span className="name">{p.name}</span>
                        {showRoles && <RoleTag role={s.roles[p.id]} factions={s.config.factions} />}
                    </button>
                ))}
            </div>

            <div className="row nowrap" style={{ alignItems: 'flex-start' }}>
                <ActionButton wrapClass="grow" className="block" onClick={() => act('mc:skip-round')}>No sale nadie</ActionButton>
                <HoldButton wrapClass="grow" className="block" disabled={!pick} onConfirm={banish}
                    hint={picked ? `Mantén para desterrar a ${picked.name}` : null}>
                    <Gavel size={18} /> <span>Desterrar</span>
                </HoldButton>
            </div>
            {!pick && <p className="btn-hint m0">Toca a quien sale desterrado</p>}
        </section>
    );
}

function NightControl({ s, act, showRoles }) {
    const kills = s.today.conclave;
    const names = ids => ids.map(id => s.players.find(p => p.id === id)?.name).join(', ');
    const [override, setOverride] = useState(null);
    const candidates = s.players.filter(p => p.alive && (!showRoles || s.roles?.[p.id] !== 'traitor'));
    const tallyList = (tally) => Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const toggle = id => setOverride(prev => {
        const cur = prev || [];
        return cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id].slice(-kills);
    });
    return (
        <section className="card stack">
            <div className="row between">
                <h3 className="m0 row nowrap" style={{ gap: 8 }}><Knife size={20} /> Cónclave</h3>
                <span className="tag">{s.conclaveOpen ? 'Abierto' : 'Cerrado'}</span>
            </div>
            {s.config.conclaveHours && (
                <label className="check small">
                    <input type="checkbox" checked={s.conclaveOverride} onChange={e => act('mc:conclave-override', { value: e.target.checked })} />
                    Abrir ya, fuera del horario ({s.config.conclaveHours.start} a {s.config.conclaveHours.end})
                </label>
            )}
            {s.invitationStatus !== 'none' && (
                <p className="note m0">
                    Reclutamiento{showRoles && s.invitation ? ` de ${s.players.find(p => p.id === s.invitation.targetId)?.name}` : ''}:{' '}
                    {{ pending: 'pendiente', accepted: 'aceptado', rejected: 'rechazado', expired: 'caducado' }[s.invitationStatus]}.
                </p>
            )}
            {kills === 0 ? <p className="small muted m0">Esta noche no hay asesinatos.</p> : (
                <>
                    <p className="small m0">Esta noche {kills === 1 ? 'muere 1 jugador' : `mueren ${kills} jugadores`}.</p>
                    <ul className="event-list">
                        {showRoles && s.nightVotes
                            ? Object.entries(s.nightVotes).map(([id, ids]) => (
                                <li key={id}><strong>{s.players.find(p => p.id === id)?.name}</strong> elige a {names(ids) || 'nadie'}</li>
                            ))
                            : tallyList(s.nightTally).map(([id, n]) => (
                                <li key={id} className="row between nowrap"><span>{s.players.find(p => p.id === id)?.name}</span><strong className="num">{n}</strong></li>
                            ))}
                        {s.nightVoters === 0 && <li className="muted">El cónclave aún no ha elegido.</li>}
                    </ul>
                    {s.nightOverride
                        ? <p className="note felon m0">Has decidido tú: {names(s.nightOverride)}. <button className="btn link" onClick={() => act('mc:night-victims', { ids: null })}>Deshacer</button></p>
                        : (
                            <details>
                                <summary className="small muted" style={{ cursor: 'pointer' }}>Decidir yo las víctimas</summary>
                                <div className="stack-sm" style={{ marginTop: 10 }}>
                                    <div className="player-grid">
                                        {candidates.map(p => (
                                            <button key={p.id} type="button" className={`player-tile ${(override || []).includes(p.id) ? 'selected' : ''}`} onClick={() => toggle(p.id)}>
                                                <Avatar player={p} size={48} /><span className="name">{p.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <HoldButton className="block" disabled={!override || override.length === 0} onConfirm={() => act('mc:night-victims', { ids: override })}>Elegir víctima</HoldButton>
                                </div>
                            </details>
                        )}
                </>
            )}
            <div className="section stack-sm">
                <h3 className="m0">Sospechas de la noche</h3>
                <p className="small muted m0">Todos los vivos señalan a alguien para que ninguna pantalla se distinga. Llevan {s.suspicionCount} de {s.players.filter(p => p.alive).length}.</p>
                {Object.keys(s.suspicionTally).length > 0 && (
                    <ul className="event-list">
                        {tallyList(s.suspicionTally).map(([id, n]) => (
                            <li key={id} className="row between nowrap"><span>{s.players.find(p => p.id === id)?.name}</span><strong className="num">{n}</strong></li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

// ---------- Jugadores ----------

function PlayersTab({ s, act, showRoles, code }) {
    const [messageTo, setMessageTo] = useState(null);
    const [links, setLinks] = useState({});
    // Enlace de reentrada: para quien pierde el móvil o se queda sin batería
    const getLink = async p => {
        if (links[p.id]) return setLinks(l => { const { [p.id]: _, ...rest } = l; return rest; });
        try {
            const { token } = await send('mc:player-link', { playerId: p.id });
            setLinks(l => ({ ...l, [p.id]: `${window.location.origin}/p/${code}?t=${encodeURIComponent(token)}` }));
        } catch (err) {
            setLinks(l => ({ ...l, [p.id]: null }));
        }
    };
    const [text, setText] = useState('');
    const sendMessage = async e => {
        e.preventDefault();
        if (await act('mc:message', { text, toId: messageTo }, 'Mensaje enviado')) {
            setText('');
            setMessageTo(null);
        }
    };
    return (
        <section>
            <h3>{s.players.length} jugadores</h3>
            {s.players.map(p => (
                <div key={p.id} style={{ borderTop: '1px solid var(--line)', padding: '12px 0' }}>
                    <div className="row nowrap">
                        <Avatar player={p} size={44} />
                        <div className="grow">
                            <div style={{ fontWeight: 600 }}>{p.name}</div>
                            <div className="tiny muted">{p.alive ? 'Vivo' : `${p.eliminatedBy === 'murder' ? 'Asesinado' : 'Desterrado'} el día ${p.eliminatedDay}`}</div>
                        </div>
                        {showRoles && <RoleTag role={s.roles[p.id]} factions={s.config.factions} />}
                        {p.alive && ['day', 'roundtable', 'night'].includes(s.phase) && (
                            <button className={`btn sm icon ${s.shields.includes(p.id) ? 'primary' : ''}`} aria-pressed={s.shields.includes(p.id)}
                                title={s.shields.includes(p.id) ? 'Quitar el escudo' : 'Dar el escudo (le protege esta noche)'} aria-label="Escudo"
                                onClick={() => act('mc:shield', { playerId: p.id, on: !s.shields.includes(p.id) }, s.shields.includes(p.id) ? `Escudo retirado a ${p.name}` : `${p.name} tiene el escudo esta noche`)}>
                                <ShieldIcon size={18} weight={s.shields.includes(p.id) ? 'fill' : 'regular'} />
                            </button>
                        )}
                        <button className="btn sm icon" title="Enlace para volver a entrar" aria-label="Enlace para volver a entrar" onClick={() => getLink(p)}><LinkSimple size={18} /></button>
                        <button className="btn sm icon" title="Mensaje privado" aria-label="Mensaje privado" onClick={() => setMessageTo(messageTo === p.id ? null : p.id)}><PaperPlaneRight size={18} /></button>
                        {s.phase === 'lobby' && (
                            <HoldButton className="sm icon" title={`Mantén para quitar a ${p.name}`} hint={null} onConfirm={() => act('mc:kick', { playerId: p.id })}><Trash size={18} /></HoldButton>
                        )}
                    </div>
                    {p.id in links && (
                        <div className="stack-sm" style={{ marginTop: 10 }}>
                            {links[p.id] ? (
                                <>
                                    <p className="small muted m0">Enlace personal de {p.name}: entra como este jugador y ve su rol. Envíaselo solo a esa persona.</p>
                                    <CopyBox value={links[p.id]} />
                                </>
                            ) : <p className="small accent m0">No se ha podido generar el enlace. Prueba otra vez.</p>}
                        </div>
                    )}
                    {messageTo === p.id && (
                        <form className="row nowrap" style={{ marginTop: 10 }} onSubmit={sendMessage}>
                            <input className="input" autoFocus value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder={`Mensaje privado para ${p.name}`} />
                            <button className="btn primary" disabled={!text.trim()}>Enviar</button>
                        </form>
                    )}
                </div>
            ))}
        </section>
    );
}

// ---------- Pruebas ----------

function TestsTab({ s, act }) {
    const [name, setName] = useState('');
    const [max, setMax] = useState('');
    const [description, setDescription] = useState('');
    const add = async e => {
        e.preventDefault();
        if (await act('mc:test-add', { name, max, description })) { setName(''); setMax(''); setDescription(''); }
    };
    return (
        <>
            <div className="treasure">
                <span className="big-number">{formatEuros(s.treasure, s.goldPerEuro)}</span>
                <span className="muted small">{formatGold(s.treasure)}{s.maxTreasure > 0 && ` de ${formatGold(s.maxTreasure)} posibles`}</span>
            </div>
            {s.tests.map(t => <TestRow key={t.id} t={t} act={act} onTv={s.spotlight === t.id} />)}
            <form className="section stack-sm" onSubmit={add}>
                <h3>Nueva prueba</h3>
                <div className="row nowrap">
                    <input className="input grow" placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
                    <input className="input" style={{ width: 120 }} type="number" min={0} placeholder="Máximo" value={max} onChange={e => setMax(e.target.value)} />
                </div>
                <textarea className="input" placeholder="Instrucciones para los jugadores (se ven en la tele)" value={description} onChange={e => setDescription(e.target.value)} />
                <button className="btn block" disabled={!name.trim()}>Añadir prueba</button>
                {!name.trim() && <p className="btn-hint m0">Escribe el nombre de la prueba</p>}
            </form>
        </>
    );
}

function TestRow({ t, act, onTv }) {
    const [score, setScore] = useState(t.score ?? '');
    const [max, setMax] = useState(t.max || '');
    const [description, setDescription] = useState(t.description || '');
    useEffect(() => { setScore(t.score ?? ''); setMax(t.max || ''); setDescription(t.description || ''); }, [t.score, t.max, t.description]);
    const dirty = String(score) !== String(t.score ?? '') || String(max) !== String(t.max || '') || description !== (t.description || '');
    const save = () => act('mc:test-update', { id: t.id, changes: { max: max || 0, score: score === '' ? null : score, description } }, 'Prueba guardada');
    return (
        <section className={`card stack-sm ${onTv ? 'hot' : ''}`}>
            <div className="row between nowrap">
                <strong className="grow">{t.name}</strong>
                <Segmented
                    value={t.status}
                    onChange={status => act('mc:test-update', { id: t.id, changes: { status } })}
                    options={[{ value: 'pending', label: 'Pendiente' }, { value: 'active', label: 'En juego' }, { value: 'done', label: 'Hecha' }]}
                />
            </div>
            <div className="row nowrap">
                <label className="field grow"><span>Oro conseguido</span><input className="input" type="number" min={0} value={score} onChange={e => setScore(e.target.value)} /></label>
                <label className="field" style={{ width: 120 }}><span>Máximo</span><input className="input" type="number" min={0} value={max} onChange={e => setMax(e.target.value)} /></label>
            </div>
            <label className="field"><span>Instrucciones</span><textarea className="input" value={description} onChange={e => setDescription(e.target.value)} /></label>
            <div className="row nowrap">
                {t.score === null && <HoldButton className="sm icon" title={`Mantén para borrar ${t.name}`} hint={null} onConfirm={() => act('mc:test-remove', { id: t.id })}><Trash size={18} /></HoldButton>}
                <ActionButton className={`sm ${onTv || dirty ? '' : 'primary'}`} onClick={() => act('mc:spotlight', { id: onTv ? null : t.id })}>
                    <Television size={18} /> {onTv ? 'Quitar de la tele' : 'Lanzar a la tele'}
                </ActionButton>
                <span className="grow" />
                {dirty && <ActionButton className="sm primary" onClick={save}>Guardar</ActionButton>}
            </div>
        </section>
    );
}

// ---------- Fantasmas ----------

function GhostsTab({ s }) {
    const g = s.ghosts;
    return (
        <>
            <p className="note">Solo tú y los eliminados veis esto. En cada amanecer se elige al azar un objetivo entre los vivos, de cualquier bando. Solo puntúa la primera votación de cada mesa: los desempates y «No sale nadie» no suman.{g.auto ? ' Los umbrales se calculan con el calendario y el número de jugadores.' : ''}</p>
            <div className="row between" style={{ alignItems: 'flex-end' }}>
                <div>
                    <div className="label">Objetivo de hoy</div>
                    <div className="display" style={{ fontSize: '2.6rem' }}>{g.target ? g.target.name : 'Sin objetivo'}</div>
                    {g.target && <div className="small muted"><span className="num">{g.target.votes}</span> votos recibidos hoy</div>}
                </div>
                <div style={{ textAlign: 'right' }}>
                    <div className="big-number">{g.skulls}</div>
                    <div className="label">calaveras</div>
                </div>
            </div>
            <Thresholds skulls={g.skulls} thresholds={g.thresholds} />
            <p className="small m0">Si la partida acabara ahora robarían el {g.percent}% del botín ({formatEuros(g.stolen, s.goldPerEuro)}).</p>
            {g.history.length > 0 && (
                <ul className="event-list">
                    {g.history.map((h, i) => (
                        <li key={i} className="row between nowrap">
                            <span><span className="day">Día {h.day}</span>{h.targetName}: {h.votes} votos{h.eliminated ? ', desterrado' : ''}</span>
                            <strong className="num">+{h.skulls}</strong>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}

// ---------- Chats ----------

function ChatTab({ s, chat, act }) {
    const [channel, setChannel] = useState('general');
    const [text, setText] = useState('');
    const log = useRef(null);
    const messages = chat[channel] || [];
    useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [messages.length, channel]);
    const announce = async e => {
        e.preventDefault();
        if (await act('mc:message', { text })) setText('');
    };
    return (
        <section className="card">
            <div className="tabs">
                {/* Los chats de Felones y Fantasmas son privados: solo con el panel completo */}
                {(s.fullAccess ? ['general', 'traitors', 'dead'] : ['general']).map(ch => (
                    <button key={ch} className={`tab ${ch} ${channel === ch ? 'on' : ''}`} onClick={() => setChannel(ch)}>
                        {{ general: 'General', traitors: s.config.factions.traitor, dead: 'Fantasmas' }[ch]} <span className="faint">{(chat[ch] || []).length}</span>
                    </button>
                ))}
            </div>
            <div className="chat-log" ref={log}>
                {messages.length === 0 && <p className="small faint m0">Sin mensajes.</p>}
                {messages.map(m => (
                    <div key={m.id} className={`msg ${m.fromMc ? 'mc' : ''}`}>
                        <div className="from">{m.fromMc ? 'Tú (MC)' : m.from}</div>
                        <span className="bubble">{m.message}</span>
                    </div>
                ))}
            </div>
            {channel === 'general' ? (
                <form className="row nowrap" onSubmit={announce}>
                    <input className="input" value={text} maxLength={500} onChange={e => setText(e.target.value)} placeholder="Anuncio para todos" />
                    <button className="btn primary" disabled={!text.trim()}><Megaphone size={18} /> Anunciar</button>
                </form>
            ) : <p className="small faint m0">Solo lectura. Este chat no lo ve nadie más que sus miembros y tú.</p>}
        </section>
    );
}

// ---------- Compartir y ajustes ----------

function ShareTab({ s, code, act }) {
    const origin = window.location.origin;
    const mcLink = `${origin}/mc/${code}?k=${encodeURIComponent(storage.get(mcTokenKey(code)) || '')}`;
    const [password, setPassword] = useState('');
    return (
        <>
            <section className="stack-sm">
                <h3>Para los jugadores</h3>
                <CopyBox value={`${origin}/p/${code}`} />
                <p className="small muted m0">O que entren en {origin.replace(/^https?:\/\//, '')} con el código {code}.</p>
            </section>
            <section className="section stack-sm">
                <h3>Para la tele</h3>
                <CopyBox value={`${origin}/tv/${code}`} />
                <p className="small muted m0">Ábrelo en el navegador del televisor. Muestra jugadores y botín, nunca roles.</p>
            </section>
            <section className="section stack-sm">
                <h3>Para otro MC</h3>
                <CopyBox value={mcLink} />
                <p className="small muted m0">Quien abra este enlace dirige la partida y puede ver todos los roles. Sirve para un MC a distancia o para usar varios móviles.</p>
            </section>
            <form className="section stack-sm" onSubmit={async e => { e.preventDefault(); if (await act('mc:password', { password }, 'Contraseña guardada')) setPassword(''); }}>
                <h3>Contraseña del panel</h3>
                <div className="row nowrap">
                    <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Nueva contraseña" autoComplete="new-password" />
                    <button className="btn" disabled={password.length < 4}>Guardar</button>
                </div>
            </form>
            {s.phase !== 'lobby' && (
                <section className="section stack-sm">
                    <h3>Otra partida</h3>
                    <p className="small muted m0">Vuelve a la sala de espera con los mismos jugadores y pruebas. Se borran roles, puntuaciones y chats.</p>
                    <HoldButton onConfirm={() => act('mc:restart')}>Empezar otra partida</HoldButton>
                </section>
            )}
        </>
    );
}

