import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
    Check, DeviceMobile, Envelope, Eye, Gavel, Ghost, HourglassMedium, Knife, MoonStars, Scales, Skull, SunHorizon, Trophy
} from '@phosphor-icons/react';
import { formatEuros, formatGold, playerTokenKey, send, socket, storage } from '../api';
import {
    Art, Avatar, CopyBox, Loading, Modal, OfflineBanner, PhotoPicker, RoleTag, TestsTable, Thresholds, Toasts,
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

    let content;
    if (status === 'missing') {
        content = (
            <div className="page narrow stack" style={{ paddingTop: 64 }}>
                <h1>Código no válido</h1>
                <p className="muted">No existe ninguna partida con el código {code}.</p>
                <Link className="btn primary" to="/">Volver</Link>
            </div>
        );
    } else if (!view || status === 'checking' || (status === 'joined' && !me)) {
        content = <Loading text={connected ? 'Entrando en la partida' : 'Conectando'} />;
    } else if (status === 'join') {
        content = <JoinScreen view={view} code={code} onJoined={() => setStatus('joined')} onError={m => push(m, 'error')} />;
    } else {
        content = <Game view={view} me={me} chat={chat} act={act} onShowRole={() => setShowRole(true)} code={code} push={push} />;
    }

    const ghostKey = me && `ghost-seen:${code}:${me.playerId}`;
    const showGhostWelcome = me && me.ghostSociety && view && view.phase !== 'end' && !storage.get(ghostKey);

    return (
        <>
            <OfflineBanner connected={connected} />
            {content}
            {showRole && me && me.role && view && (
                <RoleModal me={me} view={view} onClose={() => { storage.set(roleSeenKey, '1'); setShowRole(false); }} />
            )}
            {me && me.invitationPending && <InvitationModal view={view} act={act} />}
            {showGhostWelcome && !showRole && (
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
    const [busy, setBusy] = useState(false);

    const join = async e => {
        e.preventDefault();
        setBusy(true);
        try {
            const { token } = await send('player:join', { code, name: name.trim(), photo });
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
                <span className="tag">Partida {code}</span>
                <h1 style={{ marginTop: 14 }}>{view.name}</h1>
            </header>
            {view.phase === 'lobby' ? (
                <form className="stack" onSubmit={join}>
                    <PhotoPicker value={photo} onChange={setPhoto} onError={onError} label={photo ? 'Repetir foto' : 'Hazte una foto para que te reconozcan'} />
                    <label className="field">
                        <span>Tu nombre</span>
                        <input className="input" value={name} maxLength={24} onChange={e => setName(e.target.value)} autoComplete="given-name" />
                    </label>
                    <button className="btn primary block lg" disabled={busy || !name.trim()}>Unirme</button>
                </form>
            ) : (
                <p className="note accent">La partida ya ha empezado. Si ya estabas jugando, abre tu enlace personal desde el móvil con el que te uniste.</p>
            )}
            {view.players.length > 0 && (
                <section className="section">
                    <h3>Ya están dentro ({view.players.length})</h3>
                    <PlayerGrid players={view.players} factions={view.factions} />
                </section>
            )}
        </div>
    );
}

// ---------- Partida ----------

function Game({ view, me, chat, act, onShowRole, code, push }) {
    const self = view.players.find(p => p.id === me.playerId) || { alive: false, name: '' };
    const isTraitor = me.role === 'traitor';

    if (view.phase === 'end') return <EndScreen view={view} me={me} chat={chat} self={self} act={act} />;

    return (
        <>
            <TopBar view={view} self={self} me={me} onShowRole={onShowRole} />
            <div className="page stack">
                <PhaseBlock view={view} me={me} self={self} />

                {view.spotlight && <SpotlightCard view={view} />}
                {view.phase === 'lobby' && <Lobby view={view} self={self} act={act} push={push} />}
                {view.phase === 'roundtable' && self.alive && <RoundtablePanel view={view} me={me} act={act} />}
                {view.phase === 'night' && isTraitor && self.alive && <ConclavePanel view={view} me={me} act={act} />}
                {me.ghostSociety && <GhostPanel ghost={me.ghostSociety} />}
                {me.inbox.length > 0 && <Inbox inbox={me.inbox} />}

                {view.phase !== 'lobby' && (
                    <div className="cols">
                        <div className="stack">
                            <section className="card">
                                <div className="row between" style={{ marginBottom: 14 }}>
                                    <h3 className="m0">Jugadores</h3>
                                    <span className="small muted">{view.players.filter(p => p.alive).length} vivos</span>
                                </div>
                                <PlayerGrid players={view.players} factions={view.factions} meId={me.playerId} allies={isTraitor ? me.allies : null} />
                            </section>
                            <Treasure view={view} />
                            {view.events.length > 0 && <Events events={view.events} />}
                        </div>
                        <div className="stack">
                            <Chat me={me} self={self} view={view} chat={chat} act={act} />
                            <DeviceLink code={code} />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}

function TopBar({ view, self, me, onShowRole }) {
    return (
        <div className="topbar">
            <div className="topbar-inner">
                <span className="brand">{view.code}</span>
                {view.phase !== 'lobby' && <span className="tag">Día {view.day} de {view.days}</span>}
                <span className="grow" />
                {me.role && (
                    <button className="btn sm" onClick={onShowRole}>
                        {self.alive ? <><Eye size={18} /> Mi rol</> : <><Skull size={18} /> Eliminado</>}
                    </button>
                )}
            </div>
        </div>
    );
}

const PHASE_ICON = { lobby: HourglassMedium, day: SunHorizon, roundtable: Scales, night: MoonStars, end: Trophy };

function PhaseBlock({ view, me, self }) {
    const isTraitor = me.role === 'traitor';
    const alive = view.players.filter(p => p.alive).length;
    let title = 'Sala de espera';
    let text = 'Esperando a que el MC empiece la partida.';
    switch (view.phase) {
        case 'day':
            title = `Día ${view.day}`;
            text = view.today.roundtable > 0
                ? `Hoy hay mesa redonda: ${view.today.roundtable === 1 ? 'un destierro' : `${view.today.roundtable} destierros`}.`
                : 'Hoy no hay mesa redonda. Observad bien a los demás.';
            break;
        case 'roundtable':
            title = view.round && view.round.candidates ? 'Desempate' : 'Mesa redonda';
            text = view.voting === 'inperson'
                ? 'Votad en voz alta. El MC registrará el resultado.'
                : view.round ? `Han votado ${view.round.voters.length} de ${alive}.` : 'Votación cerrada.';
            if (view.round && view.today.roundtable > 1) text = `Votación ${view.round.number} de ${view.today.roundtable}. ${text}`;
            break;
        case 'night':
            title = 'Noche';
            text = isTraitor && self.alive
                ? (view.conclaveOpen ? 'El cónclave está abierto.' : `El cónclave abre de ${view.conclaveHours.start} a ${view.conclaveHours.end}.`)
                : `Los ${view.factions.traitor} se reúnen en secreto.`;
            break;
        default:
    }
    if (!self.alive && view.phase !== 'lobby') text = 'Has sido eliminado. Ya no compites, pero sigues dentro del juego.';
    const Icon = PHASE_ICON[view.phase];
    return (
        <header className={`phase ${view.phase}`}>
            <span className="display">{title}</span>
            <Icon size={36} weight="light" className="phase-icon" />
            <p className="phase-text m0">{text}</p>
        </header>
    );
}

function Lobby({ view, self, act, push }) {
    return (
        <section className="stack">
            <PhotoPicker
                value={null}
                size={64}
                label={self.photo ? 'Cambiar tu foto' : 'Añade una foto para que te reconozcan'}
                onChange={photo => act('player:photo', { photo })}
                onError={m => push(m, 'error')}
            />
            <div className="section">
                <h3>En la sala ({view.players.length})</h3>
                <PlayerGrid players={view.players} factions={view.factions} meId={self.id} />
            </div>
        </section>
    );
}

function PlayerGrid({ players, factions, meId, allies, onPick, selected = [], pickable, corner, revealAll }) {
    const allyIds = new Set((allies || []).map(a => a.id));
    return (
        <div className="player-grid">
            {players.map(p => {
                const canPick = onPick && (!pickable || pickable(p));
                const Tag = onPick ? 'button' : 'div';
                return (
                    <Tag
                        key={p.id}
                        type={onPick ? 'button' : undefined}
                        className={`player-tile ${p.alive ? '' : 'dead'} ${selected.includes(p.id) ? 'selected' : ''}`}
                        onClick={canPick ? () => onPick(p) : undefined}
                        disabled={onPick ? !canPick : undefined}
                        style={onPick && !canPick ? { opacity: 0.3 } : undefined}
                    >
                        <Avatar player={p} size={64} />
                        {corner && corner(p)}
                        <span className="name">{p.name}{p.id === meId ? ' (tú)' : ''}</span>
                        {!p.alive && (
                            <span className="sub">
                                {p.eliminatedBy === 'murder' ? <Knife size={13} /> : <Gavel size={13} />}
                                Día {p.eliminatedDay}
                            </span>
                        )}
                        {(!p.alive || revealAll) && p.role && <RoleTag role={p.role} factions={factions} />}
                        {p.alive && allyIds.has(p.id) && p.id !== meId && <span className="sub accent">Aliado</span>}
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
    const pickable = p => p.alive && p.id !== me.playerId && (!candidates || candidates.includes(p.id));
    const voters = new Set(view.round.voters);
    const chosen = pick && pick !== me.myVote ? view.players.find(p => p.id === pick) : null;
    return (
        <section className="card hot stack">
            <h3 className="m0">{candidates ? 'Desempate: solo entre los empatados' : 'Tu voto'}</h3>
            <PlayerGrid
                players={view.players.filter(p => p.alive)}
                factions={view.factions}
                meId={me.playerId}
                onPick={p => setPick(p.id)}
                pickable={pickable}
                selected={[pick || me.myVote].filter(Boolean)}
                corner={p => (voters.has(p.id) ? <span className="corner" title="Ya ha votado"><Check size={13} weight="bold" /></span> : null)}
            />
            {chosen ? (
                <button className="btn danger block lg" onClick={async () => { if (await act('vote', { targetId: chosen.id })) setPick(null); }}>
                    Votar a {chosen.name}
                </button>
            ) : (
                <p className="small muted m0">
                    {myVote ? `Has votado a ${myVote.name}. Puedes cambiarlo hasta que voten todos.` : 'Toca a quien creas que es uno de los ' + view.factions.traitor + '.'}
                </p>
            )}
        </section>
    );
}

// ---------- Cónclave ----------

function ConclavePanel({ view, me, act }) {
    const c = me.conclave;
    const [picks, setPicks] = useState(c.myVotes);
    useEffect(() => setPicks(c.myVotes), [c.myVotes]);

    if (!view.conclaveOpen) {
        return <p className="note">El cónclave está cerrado. Abre de {view.conclaveHours.start} a {view.conclaveHours.end}.</p>;
    }

    const allyIds = new Set(me.allies.map(a => a.id));
    const names = ids => ids.map(id => view.players.find(p => p.id === id)?.name).join(', ');
    const targets = view.players.filter(p => p.alive && !allyIds.has(p.id));
    const toggle = p => setPicks(prev => (prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id].slice(-c.kills)));
    const changed = JSON.stringify([...picks].sort()) !== JSON.stringify([...c.myVotes].sort());
    const inv = c.invitation;

    return (
        <section className="card hot stack">
            <h3 className="m0">Cónclave de los {view.factions.traitor}</h3>
            {inv.available && <Recruit view={view} targets={targets} act={act} />}
            {inv.status === 'pending' && <p className="note m0">Invitación enviada a {inv.targetName}. Esperando su respuesta.</p>}
            {inv.status === 'accepted' && <p className="note accent m0">{inv.targetName} se ha unido a vosotros.</p>}
            {inv.status === 'rejected' && <p className="note m0">{inv.targetName} ha rechazado la invitación.</p>}

            {c.kills > 0 ? (
                <>
                    <p className="small muted m0">
                        {c.kills === 1 ? 'Elegid a la víctima de esta noche.' : `Elegid a las ${c.kills} víctimas de esta noche.`} Cuenta la elección más votada y se sabrá al amanecer.
                    </p>
                    <PlayerGrid players={targets} factions={view.factions} onPick={toggle} selected={picks} />
                    {changed && (
                        <button className="btn danger block lg" disabled={picks.length === 0} onClick={() => act('night-vote', { victimIds: picks })}>
                            <Knife size={20} /> {names(picks)}
                        </button>
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
            <PlayerGrid players={targets} factions={view.factions} onPick={p => setPick(p.id)} selected={[pick].filter(Boolean)} />
            {chosen && <button className="btn primary block" onClick={() => act('invite', { targetId: pick })}>Invitar a {chosen.name}</button>}
        </div>
    );
}

function InvitationModal({ view, act }) {
    const [confirm, setConfirm] = useState(null);
    return (
        <Modal>
            <div className="card hot stack">
                <h2>Invitación secreta</h2>
                <p className="m0">Los {view.factions.traitor} te invitan a unirte a ellos. Si aceptas, cambias de bando y entras en su cónclave.</p>
                <p className="small muted m0">Nadie sabrá lo que decidas. No hay vuelta atrás.</p>
                {confirm === null ? (
                    <div className="row nowrap">
                        <button className="btn grow" onClick={() => setConfirm(false)}>Rechazar</button>
                        <button className="btn danger grow" onClick={() => setConfirm(true)}>Aceptar</button>
                    </div>
                ) : (
                    <div className="row nowrap">
                        <button className="btn ghost grow" onClick={() => setConfirm(null)}>Volver</button>
                        <button className={`btn ${confirm ? 'danger' : 'primary'} grow`} onClick={() => act('respond-invitation', { accept: confirm })}>
                            {confirm ? `Unirme a los ${view.factions.traitor}` : `Seguir con los ${view.factions.loyal}`}
                        </button>
                    </div>
                )}
            </div>
        </Modal>
    );
}

// ---------- Rol ----------

function RoleModal({ me, view, onClose }) {
    const [flipped, setFlipped] = useState(false);
    const isTraitor = me.role === 'traitor';
    const allies = (me.allies || []).filter(a => a.id !== me.playerId);
    return (
        <Modal>
            <div className="stack">
                <p className="small muted center m0">Que nadie vea tu pantalla</p>
                <button className={`role-card ${flipped ? 'flipped' : ''}`} onClick={() => setFlipped(f => !f)} aria-label="Dar la vuelta a la carta">
                    <div className="role-card-inner">
                        <div className="role-face front">
                            <span className="brand">{view.name}</span>
                            <span className="display">Tu<br />rol</span>
                            <span className="small muted">Toca para darle la vuelta</span>
                        </div>
                        <div className={`role-face back ${me.role} has-art`}>
                            <Art name={isTraitor ? 'punal.jpg' : 'farol.jpg'} />
                            <span className="small">Eres de los</span>
                            <span className="display">{isTraitor ? view.factions.traitor : view.factions.loyal}</span>
                            <span className="small">
                                {isTraitor
                                    ? `Elimina a los ${view.factions.loyal} sin que te descubran.${allies.length ? ` Tus aliados: ${allies.map(a => a.name).join(', ')}.` : ''}`
                                    : `Descubre y destierra a todos los ${view.factions.traitor}.`}
                            </span>
                        </div>
                    </div>
                </button>
                <button className="btn primary block" onClick={onClose}>Ocultar</button>
            </div>
        </Modal>
    );
}

// ---------- Fantasmas ----------

function GhostWelcome({ onClose }) {
    return (
        <Modal>
            <div className="card stack">
                <Art name="fantasma.jpg" className="ghost-art" />
                <h2>La Sociedad Secreta de los Fantasmas</h2>
                <p className="m0">Has sido eliminado, pero tu partida sigue. Ahora formas parte de una sociedad secreta que los vivos no conocen.</p>
                <p className="m0">Cada día recibiréis el nombre de un jugador. Conseguid, sin que se note, que los vivos le voten en la mesa redonda. Cada voto suma calaveras, y si lo destierran sumáis más. Con suficientes calaveras robáis parte del botín final.</p>
                <p className="m0"><strong>Ni una palabra a los vivos.</strong> Coordinaos en vuestro chat.</p>
                <button className="btn primary block" onClick={onClose}>Entendido</button>
            </div>
        </Modal>
    );
}

function GhostPanel({ ghost }) {
    return (
        <section className="card stack">
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
    return (
        <section className="card">
            <h3>Lo que ha pasado</h3>
            <ul className="event-list">
                {[...events].reverse().slice(0, 8).map(e => (
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
        return <button className="btn ghost block" onClick={() => setOpen(true)}><DeviceMobile size={20} /> Jugar también desde otro dispositivo</button>;
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

function Chat({ me, self, view, chat, act }) {
    const isTraitor = me.role === 'traitor' && self.alive;
    const isDead = !self.alive && view.phase !== 'lobby';
    const available = ['general', ...(isTraitor ? ['traitors'] : []), ...(isDead ? ['dead'] : [])];
    const [channel, setChannel] = useState(isDead ? 'dead' : 'general');
    const [text, setText] = useState('');
    const [seen, setSeen] = useState({});
    const log = useRef(null);
    const active = available.includes(channel) ? channel : 'general';
    const messages = chat[active] || [];
    const canWrite = active === 'general' ? (self.alive || view.phase === 'end') : true;

    useEffect(() => { if (isDead) setChannel('dead'); }, [isDead]);
    useEffect(() => {
        setSeen(s => ({ ...s, [active]: messages.length }));
        if (log.current) log.current.scrollTop = log.current.scrollHeight;
    }, [messages.length, active]);

    const submit = async e => {
        e.preventDefault();
        if (!text.trim()) return;
        if (await act('chat', { channel: active, message: text.trim() })) setText('');
    };

    return (
        <section className="card">
            {available.length > 1 ? (
                <div className="tabs" role="tablist">
                    {available.map(ch => {
                        const unread = ch !== active ? (chat[ch] || []).length - (seen[ch] || 0) : 0;
                        return (
                            <button key={ch} role="tab" aria-selected={active === ch} className={`tab ${ch} ${active === ch ? 'on' : ''}`} onClick={() => setChannel(ch)}>
                                {CHANNELS[ch].icon}{CHANNELS[ch].label}{unread > 0 && <span className="unread">{unread}</span>}
                            </button>
                        );
                    })}
                </div>
            ) : <h3 className="m0">Chat</h3>}
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
                <button className={`btn ${active === 'traitors' ? 'danger' : 'primary'}`} disabled={!canWrite || !text.trim()}>Enviar</button>
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
                <Trophy size={36} weight="light" className="phase-icon" />
                <p className="phase-text m0">{iWon ? 'Has ganado.' : 'Has perdido.'} {view.name} ha terminado.</p>
            </header>

            {ghosts && ghosts.skulls > 0 && (
                <section className="card hot stack">
                    <h3 className="m0 row nowrap" style={{ gap: 8 }}><Ghost size={20} /> La Sociedad Secreta de los Fantasmas</h3>
                    <p className="m0">Mientras los vivos buscaban a los {view.factions.traitor}, los eliminados conspiraban para que cada día un objetivo secreto recibiera votos.</p>
                    <div className="row between" style={{ alignItems: 'flex-end' }}>
                        <span className="big-number">{ghosts.skulls}</span>
                        <span className="small muted">{ghosts.percent > 0 ? `Roban el ${ghosts.percent}% del botín: ${formatEuros(stolen, view.goldPerEuro)}` : 'No llegan a ningún umbral. El botín queda intacto.'}</span>
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
                    <TestsTable tests={view.tests} />
                </section>
            )}

            <div className="cols">
                <section className="card">
                    <h3>Quién era quién</h3>
                    <PlayerGrid players={sorted} factions={view.factions} meId={me.playerId} revealAll />
                </section>
                <Chat me={me} self={self} view={view} chat={chat} act={act} />
            </div>
        </div>
    );
}
