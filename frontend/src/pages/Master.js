import React, { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    ArrowRight, ChatCircle, Coins, Gavel, Ghost, Knife, Megaphone, PaperPlaneRight, ShareNetwork, Television, Trash, Users
} from '@phosphor-icons/react';
import { formatEuros, formatGold, http, mcTokenKey, send, socket, storage } from '../api';
import {
    Avatar, CopyBox, Loading, OfflineBanner, RoleTag, Seal, Segmented, Thresholds, Toasts,
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
            ...(state.config.ghosts.enabled ? [{ id: 'ghosts', label: 'Fantasmas', icon: <Ghost size={18} /> }] : []),
            { id: 'chat', label: 'Chats', icon: <ChatCircle size={18} /> },
            { id: 'share', label: 'Compartir', icon: <ShareNetwork size={18} /> }
        ];
        content = (
            <>
                <div className="topbar">
                    <div className="topbar-inner">
                        <span className="brand">{code}</span>
                        <span className="tag solid">MC</span>
                        <span className="small muted grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.name}</span>
                    </div>
                    <nav className="mc-nav" style={{ maxWidth: 1120, margin: '0 auto', padding: '0 8px' }}>
                        {TABS.map(t => (
                            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>
                        ))}
                    </nav>
                </div>
                <div className="page stack">
                    {tab === 'game' && <GameTab s={state} act={act} />}
                    {tab === 'players' && <PlayersTab s={state} act={act} />}
                    {tab === 'tests' && <TestsTab s={state} act={act} />}
                    {tab === 'ghosts' && <GhostsTab s={state} />}
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
            <span className="tag">Partida {code}</span>
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
            return s.day >= s.days ? 'Terminar la partida' : 'Pasar a la noche';
        case 'night': return `Amanecer del día ${s.day + 1}`;
        default: return null;
    }
}

const PHASE_TITLE = { lobby: 'Sala de espera', day: 'Día', roundtable: 'Mesa redonda', night: 'Noche', end: 'Final' };

function GameTab({ s, act }) {
    const label = nextActionLabel(s);
    const alive = s.players.filter(p => p.alive).length;
    const advance = () => {
        if (s.phase === 'roundtable' && s.round && !window.confirm('Hay una votación abierta. ¿Cerrar la mesa redonda sin más destierros?')) return;
        if (s.phase === 'night' && s.today.conclave > 0 && Object.keys(s.nightTally).length === 0 && !s.nightOverride &&
            !window.confirm('Los traidores no han elegido víctima. ¿Amanecer sin asesinato?')) return;
        act('mc:advance');
    };
    return (
        <>
            <header className={`phase ${s.phase}`}>
                <span className="display">{s.phase === 'day' ? `Día ${s.day}` : PHASE_TITLE[s.phase]}</span>
                <span className="tag">{s.phase === 'lobby' ? `${s.players.length} jugadores` : `Día ${s.day} de ${s.days}`}</span>
            </header>

            <div className="stat-grid">
                <div className="stat"><div className="label">Vivos</div><div className="value">{alive}</div></div>
                <div className="stat"><div className="label row nowrap" style={{ gap: 6 }}><Seal kind="traitor" size={20} />{s.config.factions.traitor}</div><div className="value accent">{s.aliveCounts.traitor}</div></div>
                <div className="stat"><div className="label row nowrap" style={{ gap: 6 }}><Seal kind="loyal" size={20} />{s.config.factions.loyal}</div><div className="value">{s.aliveCounts.loyal}</div></div>
                <div className="stat"><div className="label">Botín</div><div className="value">{formatEuros(s.treasure, s.goldPerEuro)}</div></div>
            </div>

            {s.phase === 'lobby' && <LobbyInfo s={s} />}
            {s.phase === 'roundtable' && <RoundtableControl s={s} act={act} />}
            {s.phase === 'night' && <NightControl s={s} act={act} />}
            {s.phase === 'end' && (
                <p className="note accent">Ganan los {s.winner === 'traitor' ? s.config.factions.traitor : s.config.factions.loyal}. Puedes empezar otra partida con los mismos jugadores desde Compartir.</p>
            )}

            {label && (
                <button className="btn primary block lg" onClick={advance} disabled={s.phase === 'lobby' && s.players.length < 4}>
                    {label} <ArrowRight size={20} />
                </button>
            )}
            {s.phase === 'lobby' && s.players.length < 4 && <p className="small muted m0">Hacen falta al menos 4 jugadores.</p>}

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
        </section>
    );
}

function RoundtableControl({ s, act }) {
    const [pick, setPick] = useState(null);
    const [targetVotes, setTargetVotes] = useState('');
    const alivePlayers = s.players.filter(p => p.alive);
    const ghostTarget = s.ghosts.target;
    const candidates = s.round && s.round.candidates;

    if (!s.round) {
        return <p className="note">Mesa redonda terminada ({s.roundsDone} de {s.today.roundtable}).</p>;
    }

    const banish = async () => {
        const target = s.players.find(p => p.id === pick);
        if (!window.confirm(`¿Desterrar a ${target.name}?`)) return;
        if (await act('mc:banish', { playerId: pick, targetVotes }, `${target.name} desterrado`)) {
            setPick(null);
            setTargetVotes('');
        }
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
                    <button className="btn danger block" onClick={() => act('mc:close-round')} disabled={s.round.voters.length === 0}>Cerrar la votación ya</button>
                    <p className="small muted m0">Se cierra sola cuando votan todos. Si hace falta, también puedes desterrar a alguien directamente:</p>
                </>
            )}

            <div className="player-grid">
                {alivePlayers.map(p => (
                    <button key={p.id} type="button" className={`player-tile ${pick === p.id ? 'selected' : ''}`} onClick={() => setPick(p.id)}>
                        <Avatar player={p} size={56} />
                        <span className="name">{p.name}</span>
                        <RoleTag role={s.roles[p.id]} factions={s.config.factions} />
                    </button>
                ))}
            </div>

            {s.config.voting === 'inperson' && ghostTarget && (
                <label className="field">
                    <span>Votos que ha recibido {ghostTarget.name} (objetivo de los Fantasmas)</span>
                    <input className="input" type="number" min={0} value={targetVotes} onChange={e => setTargetVotes(e.target.value)} />
                </label>
            )}
            <div className="row nowrap">
                <button className="btn ghost grow" onClick={() => act('mc:skip-round')}>No sale nadie</button>
                <button className="btn danger grow" disabled={!pick} onClick={banish}><Gavel size={18} /> Desterrar</button>
            </div>
        </section>
    );
}

function NightControl({ s, act }) {
    const kills = s.today.conclave;
    const names = ids => ids.map(id => s.players.find(p => p.id === id)?.name).join(', ');
    const [override, setOverride] = useState(null);
    const loyals = s.players.filter(p => p.alive && s.roles[p.id] !== 'traitor');
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
            {s.invitation.status !== 'none' && (
                <p className="note m0">Invitación a {s.players.find(p => p.id === s.invitation.targetId)?.name}: {{ pending: 'pendiente', accepted: 'aceptada', rejected: 'rechazada', expired: 'caducada' }[s.invitation.status]}.</p>
            )}
            {kills === 0 ? <p className="small muted m0">Esta noche no hay asesinatos.</p> : (
                <>
                    <p className="small m0">Esta noche {kills === 1 ? 'muere 1 jugador' : `mueren ${kills} jugadores`}.</p>
                    <ul className="event-list">
                        {Object.entries(s.nightVotes).map(([id, ids]) => (
                            <li key={id}><strong>{s.players.find(p => p.id === id)?.name}</strong> elige a {names(ids) || 'nadie'}</li>
                        ))}
                        {Object.keys(s.nightVotes).length === 0 && <li className="muted">Los traidores aún no han votado.</li>}
                    </ul>
                    {s.nightOverride
                        ? <p className="note accent m0">Has decidido tú: {names(s.nightOverride)}. <button className="btn sm ghost" onClick={() => act('mc:night-victims', { ids: null })}>Deshacer</button></p>
                        : (
                            <details>
                                <summary className="small muted" style={{ cursor: 'pointer' }}>Decidir yo las víctimas</summary>
                                <div className="stack-sm" style={{ marginTop: 10 }}>
                                    <div className="player-grid">
                                        {loyals.map(p => (
                                            <button key={p.id} type="button" className={`player-tile ${(override || []).includes(p.id) ? 'selected' : ''}`} onClick={() => toggle(p.id)}>
                                                <Avatar player={p} size={48} /><span className="name">{p.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                    <button className="btn danger block" disabled={!override || override.length === 0} onClick={() => act('mc:night-victims', { ids: override })}>Confirmar víctimas</button>
                                </div>
                            </details>
                        )}
                </>
            )}
        </section>
    );
}

// ---------- Jugadores ----------

function PlayersTab({ s, act }) {
    const [messageTo, setMessageTo] = useState(null);
    const [text, setText] = useState('');
    const send = async e => {
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
                        <RoleTag role={s.roles[p.id]} factions={s.config.factions} />
                        <button className="btn sm icon" title="Mensaje privado" onClick={() => setMessageTo(messageTo === p.id ? null : p.id)}><PaperPlaneRight size={18} /></button>
                        {s.phase === 'lobby' && (
                            <button className="btn sm icon" title="Quitar" onClick={() => window.confirm(`¿Quitar a ${p.name}?`) && act('mc:kick', { playerId: p.id })}><Trash size={18} /></button>
                        )}
                    </div>
                    {messageTo === p.id && (
                        <form className="row nowrap" style={{ marginTop: 10 }} onSubmit={send}>
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
                {t.score === null && <button className="btn sm icon" title="Borrar prueba" onClick={() => window.confirm(`¿Borrar ${t.name}?`) && act('mc:test-remove', { id: t.id })}><Trash size={18} /></button>}
                <button className={`btn sm ${onTv ? 'danger' : ''}`} onClick={() => act('mc:spotlight', { id: onTv ? null : t.id })}>
                    <Television size={18} /> {onTv ? 'Quitar de la tele' : 'Lanzar a la tele'}
                </button>
                <span className="grow" />
                <button className="btn sm primary" disabled={!dirty} onClick={save}>Guardar</button>
            </div>
        </section>
    );
}

// ---------- Fantasmas ----------

function GhostsTab({ s }) {
    const g = s.ghosts;
    return (
        <>
            <p className="note">Solo tú y los eliminados veis esto. El objetivo se elige al azar entre los {s.config.factions.loyal.toLowerCase()} vivos en cada amanecer.</p>
            <div className="row between" style={{ alignItems: 'flex-end' }}>
                <div>
                    <div className="label">Objetivo de hoy</div>
                    <div className="display" style={{ fontSize: '2.6rem' }}>{g.target ? g.target.name : 'Sin objetivo'}</div>
                    {g.target && <div className="small muted">{g.target.votes} votos recibidos hoy</div>}
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
                {['general', 'traitors', 'dead'].map(ch => (
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
                <p className="small muted m0">Quien abra este enlace dirige la partida y ve todos los roles. Sirve para un MC a distancia o para usar varios móviles.</p>
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
                    <button className="btn danger" onClick={() => window.confirm('¿Empezar otra partida con los mismos jugadores?') && act('mc:restart')}>Empezar otra partida</button>
                </section>
            )}
        </>
    );
}

