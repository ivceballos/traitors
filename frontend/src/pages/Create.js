import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { http, mcTokenKey, playerTokenKey, storage } from '../api';
import { ArrowLeft, CaretDown, DeviceMobile, Megaphone, Plus, X } from '@phosphor-icons/react';
import { Segmented, Stepper } from '../components';

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 30;

// Igual que autoTraitorCount en el servidor, que es quien decide al empezar con los jugadores reales
const autoTraitors = players => (players < 6 ? 1 : players < 11 ? 2 : 3);

// Calendario automático: el primer día no cae nadie (si hay al menos 3), el último solo hay mesa
// redonda y al final quedan vivos unos dos quintos. Las eliminaciones se cargan en los días finales.
export function autoSchedule(players, days) {
    const schedule = Array.from({ length: days }, () => ({ roundtable: 0, conclave: 0 }));
    let left = Math.max(1, players - Math.max(3, Math.round(players * 0.4)));
    const last = days - 1;
    const firstActive = days >= 3 ? 1 : 0;
    const middle = [];
    for (let i = last - 1; i >= firstActive; i--) middle.push(i);
    const slots = middle.flatMap(i => [[i, 'roundtable'], [i, 'conclave']]);
    schedule[last].roundtable = 1;
    left -= 1;
    while (left > 0 && slots.length) {
        let placed = false;
        for (const [i, key] of slots) {
            if (left === 0) break;
            if (schedule[i][key] < 5) { schedule[i][key] += 1; left -= 1; placed = true; }
        }
        if (!placed) break;
    }
    return schedule;
}

export default function Create() {
    const navigate = useNavigate();
    const [config, setConfig] = useState(null);
    const [players, setPlayers] = useState(12);
    const [advanced, setAdvanced] = useState(false);
    const [tests, setTests] = useState([]);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    // Sin MC: quien crea también juega (nombre, preferencia y entrevista, como cualquiera)
    const [host, setHost] = useState({ name: '', wantsTraitor: 'maybe', answers: {} });
    const [questions, setQuestions] = useState([]);

    useEffect(() => {
        http('/api/presets').then(data => {
            const d = data.defaults;
            setConfig({ ...d, schedule: autoSchedule(12, d.days) });
            setQuestions([...(data.questions || [])].sort(() => Math.random() - 0.5).slice(0, 3));
        }).catch(err => setError(err.message));
    }, []);

    const set = (key, value) => setConfig(c => ({ ...c, [key]: value }));
    // Cambiar jugadores o días vuelve a calcular el calendario
    const setPlayersAuto = n => { setPlayers(n); setConfig(c => ({ ...c, schedule: autoSchedule(n, c.days) })); };
    const setDaysAuto = days => setConfig(c => ({ ...c, days, schedule: autoSchedule(players, days) }));
    const setDay = (i, key, value) => setConfig(c => ({
        ...c, schedule: c.schedule.map((d, j) => (j === i ? { ...d, [key]: value } : d))
    }));
    const setGhosts = (key, value) => setConfig(c => ({ ...c, ghosts: { ...c.ghosts, [key]: value } }));
    const setThreshold = (i, key, value) => setGhosts('thresholds', config.ghosts.thresholds.map((t, j) => (j === i ? { ...t, [key]: value } : t)));

    const submit = async e => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const hostless = config.mode === 'online' && config.hostless !== false;
            const { code, mcToken, playerToken } = await http('/api/rooms', {
                method: 'POST',
                body: {
                    config: { ...config, hostless },
                    tests: tests.filter(t => t.name.trim()),
                    mcPassword: password,
                    host: hostless ? {
                        name: host.name.trim(), wantsTraitor: host.wantsTraitor,
                        answers: questions.map(q => ({ q, a: (host.answers[q] || '').trim() })).filter(x => x.a)
                    } : undefined
                }
            });
            storage.set(mcTokenKey(code), mcToken);
            if (playerToken) {
                storage.set(playerTokenKey(code), playerToken);
                navigate(`/p/${code}`);
            } else {
                navigate(`/mc/${code}`);
            }
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    if (!config) {
        return <div className="page narrow center">{error ? <p className="blood">{error}</p> : <div className="spinner" />}</div>;
    }

    const roundtables = config.schedule.reduce((acc, d) => acc + d.roundtable, 0);
    const conclaves = config.schedule.reduce((acc, d) => acc + d.conclave, 0);
    const traitors = config.traitorCount || autoTraitors(players);
    const survivors = Math.max(0, players - roundtables - conclaves);
    const { loyal, traitor } = config.factions;

    return (
        <form className="page narrow stack" onSubmit={submit}>
            <Link to="/" className="btn sm" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={18} /> Volver</Link>
            <h1 style={{ fontSize: 'clamp(3rem, 14vw, 5rem)' }}>Nueva partida</h1>

            <section className="card stack">
                <label className="field">
                    <span>Nombre de la partida</span>
                    <input className="input" value={config.name} maxLength={60} onChange={e => set('name', e.target.value)} />
                </label>
                <div className="field">
                    <span>¿Dónde jugáis?</span>
                    <Segmented value={config.mode} onChange={v => setConfig(c => ({ ...c, mode: v, ...(v === 'online' ? { voting: 'app' } : {}) }))}
                        options={[{ value: 'presencial', label: 'Juntos' }, { value: 'online', label: 'A distancia' }]} />
                    <span className="tiny muted">
                        {config.mode === 'online'
                            ? 'Cada uno desde su casa: se vota en la app y podéis usar el horario automático. Sin Sociedad de los Fantasmas.'
                            : 'Todos en el mismo sitio, con la tele de fondo. Los eliminados forman la Sociedad de los Fantasmas. El MC dirige sin ver los roles.'}
                    </span>
                </div>
                {config.mode === 'online' && (
                    <label className="check">
                        <input type="checkbox" checked={config.hostless !== false} onChange={e => set('hostless', e.target.checked)} />
                        <span>Sin MC: yo también juego. La partida avanza sola por horario y nadie ve los roles.</span>
                    </label>
                )}
                {config.mode === 'online' && config.hostless !== false && (
                    <div className="stack-sm">
                        <label className="field">
                            <span>Tu nombre</span>
                            <input className="input" value={host.name} maxLength={24} onChange={e => setHost(h => ({ ...h, name: e.target.value }))} autoComplete="given-name" />
                        </label>
                        <div className="field">
                            <span>¿Te gustaría ser de los {config.factions.traitor}?</span>
                            <Segmented value={host.wantsTraitor} onChange={v => setHost(h => ({ ...h, wantsTraitor: v }))}
                                options={[{ value: 'yes', label: 'Sí' }, { value: 'maybe', label: 'Me da igual' }, { value: 'no', label: 'Prefiero que no' }]} />
                        </div>
                        {questions.map(q => (
                            <label key={q} className="field">
                                <span className="small">{q}</span>
                                <input className="input" maxLength={120} value={host.answers[q] || ''}
                                    onChange={e => setHost(h => ({ ...h, answers: { ...h.answers, [q]: e.target.value } }))} />
                            </label>
                        ))}
                    </div>
                )}
                <div className="row between">
                    <span>Jugadores</span>
                    <Stepper value={players} min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={setPlayersAuto} label="Jugadores" />
                </div>
                <div className="row between">
                    <span>Días</span>
                    <Stepper value={config.days} min={1} max={10} onChange={setDaysAuto} label="Días" />
                </div>
                <p className="muted small m0">
                    {traitors} {traitor} entre {players} jugadores. {roundtables} desterrados en la mesa redonda y {conclaves} asesinados en el cónclave: al final quedan {survivors} en pie.
                    {' '}Si sigue vivo alguno de los {traitor}, ganan ellos.
                </p>
                <p className="faint tiny m0">Es una previsión: al empezar se reparten los roles con los que hayan entrado de verdad.</p>
            </section>

            <button type="button" className="btn block" aria-expanded={advanced} onClick={() => setAdvanced(a => !a)}>
                Opciones avanzadas <CaretDown size={16} style={{ transform: advanced ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
            </button>

            {advanced && (
                <>
                    <section className="card stack">
                        <h3 className="m0">Bandos</h3>
                        <div className="cols">
                            <label className="field">
                                <span>Nombre de los buenos</span>
                                <input className="input" value={loyal} maxLength={20} onChange={e => set('factions', { ...config.factions, loyal: e.target.value })} />
                            </label>
                            <label className="field">
                                <span>Nombre de los malos</span>
                                <input className="input" value={traitor} maxLength={20} onChange={e => set('factions', { ...config.factions, traitor: e.target.value })} />
                            </label>
                        </div>
                        <div className="row between">
                            <span>{traitor} al empezar</span>
                            <Segmented
                                value={config.traitorCount}
                                onChange={v => set('traitorCount', v)}
                                options={[{ value: 0, label: 'Auto' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]}
                            />
                        </div>
                        <p className="muted tiny m0">Automático: 1 con menos de 6 jugadores, 2 hasta 10 y 3 a partir de 11.</p>
                    </section>

                    <section className="card stack">
                        <h3 className="m0">Calendario</h3>
                        <table className="table">
                            <thead><tr><th>Día</th><th className="r">Mesa redonda</th><th className="r">Cónclave</th></tr></thead>
                            <tbody>
                                {config.schedule.map((d, i) => (
                                    <tr key={i}>
                                        <td className="brand">{i + 1}</td>
                                        <td className="r"><Stepper value={d.roundtable} max={5} onChange={v => setDay(i, 'roundtable', v)} /></td>
                                        <td className="r">
                                            {i === config.days - 1
                                                ? <span className="muted small">Final</span>
                                                : <Stepper value={d.conclave} max={5} onChange={v => setDay(i, 'conclave', v)} />}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <p className="muted tiny m0">Eliminaciones por día. Si cambias los jugadores o los días, el calendario se vuelve a calcular.</p>
                    </section>

                    <section className="card stack">
                        <h3 className="m0">Mesa redonda</h3>
                        <Segmented
                            value={config.voting}
                            onChange={v => set('voting', v)}
                            options={[{ value: 'app', label: 'En la app', icon: <DeviceMobile size={18} /> }, { value: 'inperson', label: 'En persona', icon: <Megaphone size={18} /> }]}
                        />
                        <p className="muted tiny m0">
                            {config.voting === 'app'
                                ? 'Cada jugador vota desde su móvil y el resultado aparece a la vez para todos.'
                                : 'Se vota en voz alta y el MC registra al desterrado con un toque.'}
                        </p>
                        {config.voting === 'app' && (
                            <label className="field">
                                <span>En caso de empate</span>
                                <Segmented
                                    value={config.tieRule}
                                    onChange={v => set('tieRule', v)}
                                    options={[{ value: 'revote', label: 'Votar entre empatados' }, { value: 'none', label: 'Nadie sale' }]}
                                />
                            </label>
                        )}
                        <label className="check"><input type="checkbox" checked={config.revealRole} onChange={e => set('revealRole', e.target.checked)} /> Revelar el rol de cada eliminado</label>
                        <label className="check">
                            <input type="checkbox" checked={config.endgame} onChange={e => set('endgame', e.target.checked)} />
                            Final del programa: tras el último día, los supervivientes deciden si acabar (por unanimidad) o desterrar a alguien más
                        </label>
                    </section>

                    <section className="card stack">
                        <label className="check">
                            <input type="checkbox" checked={config.timetable.enabled} onChange={e => set('timetable', { ...config.timetable, enabled: e.target.checked })} />
                            <h3 className="m0">Horario automático</h3>
                        </label>
                        <p className="muted tiny m0">La partida avanza sola cada día a estas horas. El MC puede avanzar a mano o pausarlo cuando quiera.</p>
                        <div className="row nowrap">
                            {[['dawn', 'Amanecer'], ['roundtable', 'Mesa redonda'], ['night', 'Noche']].map(([k, l]) => (
                                <label key={k} className="field grow">
                                    <span className="small">{l}</span>
                                    <input className="input" type="time" value={config.timetable[k]} onChange={e => set('timetable', { ...config.timetable, [k]: e.target.value })} />
                                </label>
                            ))}
                        </div>
                    </section>

                    <section className="card stack">
                        <h3 className="m0">Cónclave nocturno</h3>
                        <label className="check">
                            <input type="checkbox" checked={!!config.conclaveHours} onChange={e => set('conclaveHours', e.target.checked ? { start: '22:30', end: '03:00' } : null)} />
                            Solo en un horario
                        </label>
                        {config.conclaveHours && (
                            <div className="row nowrap">
                                <input className="input" type="time" value={config.conclaveHours.start} onChange={e => set('conclaveHours', { ...config.conclaveHours, start: e.target.value })} />
                                <span className="muted">a</span>
                                <input className="input" type="time" value={config.conclaveHours.end} onChange={e => set('conclaveHours', { ...config.conclaveHours, end: e.target.value })} />
                            </div>
                        )}
                        <label className="check">
                            <input type="checkbox" checked={config.invitation} onChange={e => set('invitation', e.target.checked)} />
                            La primera noche pueden reclutar en secreto a uno de los {loyal}
                        </label>
                    </section>

                    {config.mode !== 'online' && <section className="card hot stack">
                        <label className="check">
                            <input type="checkbox" checked={config.ghosts.enabled} onChange={e => setGhosts('enabled', e.target.checked)} />
                            <h3 className="m0">Sociedad Secreta de los Fantasmas</h3>
                        </label>
                        <p className="muted small m0">
                            Los eliminados reciben cada día un objetivo secreto. Ganan calaveras cuando los vivos le votan en la mesa redonda y con ellas pueden robar parte del botín final. Nadie lo sabe hasta que muere.
                        </p>
                        {config.ghosts.enabled && (
                            <>
                                <div className="row between">
                                    <span className="small">Calaveras por voto al objetivo</span>
                                    <Stepper value={config.ghosts.perVote} max={10} onChange={v => setGhosts('perVote', v)} />
                                </div>
                                <div className="row between">
                                    <span className="small">Extra si el objetivo es desterrado</span>
                                    <Stepper value={config.ghosts.perElimination} max={20} onChange={v => setGhosts('perElimination', v)} />
                                </div>
                                <label className="check small">
                                    <input type="checkbox" checked={config.ghosts.auto !== false} onChange={e => setGhosts('auto', e.target.checked)} />
                                    Umbrales automáticos según los días y el número de jugadores (recomendado)
                                </label>
                                {config.ghosts.auto !== false ? (
                                    <p className="small muted m0">Se calculan al empezar para robar el 50, 75 y 100 % del botín.</p>
                                ) : (
                                    <table className="table">
                                        <thead><tr><th>Calaveras</th><th className="r">Roban del botín</th></tr></thead>
                                        <tbody>
                                            {config.ghosts.thresholds.map((t, i) => (
                                                <tr key={i}>
                                                    <td><input className="input" style={{ maxWidth: 110 }} type="number" min={1} value={t.skulls} onChange={e => setThreshold(i, 'skulls', e.target.value)} /></td>
                                                    <td className="r"><input className="input" style={{ maxWidth: 110, marginLeft: 'auto' }} type="number" min={1} max={100} value={t.percent} onChange={e => setThreshold(i, 'percent', e.target.value)} /> %</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </>
                        )}
                    </section>}

                    <section className="card stack">
                        <h3 className="m0">Pruebas y botín</h3>
                        <label className="field">
                            <span>Oro por cada euro</span>
                            <input className="input" type="number" min={1} value={config.goldPerEuro} onChange={e => set('goldPerEuro', e.target.value)} />
                        </label>
                        {tests.map((t, i) => (
                            <div key={i} className="row nowrap">
                                <input className="input grow" placeholder="Nombre de la prueba" value={t.name} onChange={e => setTests(ts => ts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                                <input className="input" style={{ width: 110 }} type="number" min={0} placeholder="Máx." value={t.max || ''} onChange={e => setTests(ts => ts.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
                                <button type="button" className="btn sm icon" aria-label="Quitar" onClick={() => setTests(ts => ts.filter((_, j) => j !== i))}><X size={16} /></button>
                            </div>
                        ))}
                        <button type="button" className="btn block" onClick={() => setTests(ts => [...ts, { name: '', max: 0 }])}><Plus size={18} /> Añadir prueba</button>
                        <p className="muted tiny m0">Puedes añadir o cambiar pruebas en cualquier momento desde el panel.</p>
                    </section>

                    <section className="card stack">
                        <h3 className="m0">Acceso del MC</h3>
                        <label className="field">
                            <span>Contraseña (opcional, para abrir el panel desde otro móvil)</span>
                            <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                        </label>
                    </section>
                </>
            )}

            {error && <p className="blood">{error}</p>}
            <button className="btn primary block lg" disabled={busy || (config.mode === 'online' && config.hostless !== false && !host.name.trim())}>
                {busy ? <><span className="spinner-sm" />Creando…</> : 'Crear partida'}
            </button>
        </form>
    );
}
