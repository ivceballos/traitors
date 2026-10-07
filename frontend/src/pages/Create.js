import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { http, mcTokenKey, storage } from '../api';
import { ArrowLeft, DeviceMobile, Megaphone, Plus, X } from '@phosphor-icons/react';
import { Segmented, Stepper } from '../components';

const DEFAULT_TESTS = [];

function scheduleFor(days, prev = []) {
    return Array.from({ length: days }, (_, i) => prev[i] ||
        (i === 0 ? { roundtable: 0, conclave: 0 } : i === days - 1 ? { roundtable: 1, conclave: 0 } : { roundtable: 1, conclave: 1 }));
}

export default function Create() {
    const navigate = useNavigate();
    const [presets, setPresets] = useState(null);
    const [preset, setPreset] = useState('clasico');
    const [config, setConfig] = useState(null);
    const [tests, setTests] = useState(DEFAULT_TESTS);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        http('/api/presets').then(data => {
            setPresets(data);
            setConfig(data.defaults);
        }).catch(err => setError(err.message));
    }, []);

    const applyPreset = key => {
        setPreset(key);
        const p = presets.presets[key];
        const next = { ...presets.defaults, ...p.config, factions: { ...presets.defaults.factions, ...(p.config.factions || {}) } };
        next.schedule = scheduleFor(next.days, p.config.schedule);
        setConfig(next);
        setTests((p.tests || []).map(t => ({ ...t })));
    };

    const set = (key, value) => setConfig(c => ({ ...c, [key]: value }));
    const setDays = days => setConfig(c => ({ ...c, days, schedule: scheduleFor(days, c.schedule) }));
    const setDay = (i, key, value) => setConfig(c => ({
        ...c, schedule: c.schedule.map((d, j) => (j === i ? { ...d, [key]: value } : d))
    }));
    const setGhosts = (key, value) => setConfig(c => ({ ...c, ghosts: { ...c.ghosts, [key]: value } }));
    const setThreshold = (i, key, value) => setGhosts('thresholds', config.ghosts.thresholds.map((t, j) => (j === i ? { ...t, [key]: value } : t)));

    const totals = config ? config.schedule.reduce((acc, d) => acc + d.roundtable + d.conclave, 0) : 0;

    const submit = async e => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
            const { code, mcToken } = await http('/api/rooms', {
                method: 'POST',
                body: { config, tests: tests.filter(t => t.name.trim()), mcPassword: password }
            });
            storage.set(mcTokenKey(code), mcToken);
            navigate(`/mc/${code}`);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    if (!config) {
        return <div className="page narrow center">{error ? <p className="blood">{error}</p> : <div className="spinner" />}</div>;
    }

    return (
        <form className="page narrow stack" onSubmit={submit}>
            <Link to="/" className="btn sm" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={18} /> Volver</Link>
            <h1 style={{ fontSize: 'clamp(3rem, 14vw, 5rem)' }}>Nueva partida</h1>

            <section className="card stack">
                <h3 className="m0">Plantilla</h3>
                <div className="stack" style={{ marginTop: 10 }}>
                    {Object.entries(presets.presets).map(([key, p]) => (
                        <label key={key} className="check">
                            <input type="radio" name="preset" checked={preset === key} onChange={() => applyPreset(key)} />
                            <span>{p.label}</span>
                        </label>
                    ))}
                </div>
            </section>

            <section className="card stack">
                <h3 className="m0">Lo básico</h3>
                <label className="field">
                    <span>Nombre de la partida</span>
                    <input className="input" value={config.name} maxLength={60} onChange={e => set('name', e.target.value)} />
                </label>
                <div className="cols">
                    <label className="field">
                        <span>Nombre de los buenos</span>
                        <input className="input" value={config.factions.loyal} maxLength={20} onChange={e => set('factions', { ...config.factions, loyal: e.target.value })} />
                    </label>
                    <label className="field">
                        <span>Nombre de los malos</span>
                        <input className="input" value={config.factions.traitor} maxLength={20} onChange={e => set('factions', { ...config.factions, traitor: e.target.value })} />
                    </label>
                </div>
                <div className="row between">
                    <span>{config.factions.traitor} al empezar</span>
                    <Segmented
                        value={config.traitorCount}
                        onChange={v => set('traitorCount', v)}
                        options={[{ value: 0, label: 'Auto' }, { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }, { value: 4, label: '4' }]}
                    />
                </div>
                <p className="muted tiny" style={{ margin: 0 }}>Automático: 1 con menos de 6 jugadores, 2 hasta 10 y 3 a partir de 11.</p>
            </section>

            <section className="card stack">
                <div className="row between">
                    <h3 className="m0">Calendario</h3>
                    <span className="row"><span className="muted small">Días</span><Stepper value={config.days} min={1} max={10} onChange={setDays} /></span>
                </div>
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
                <p className="muted tiny" style={{ margin: 0 }}>
                    Número de eliminaciones por día. En total: {totals}. Si al final sigue vivo alguno de los {config.factions.traitor}, ganan ellos.
                </p>
            </section>

            <section className="card stack">
                <h3 className="m0">Mesa redonda</h3>
                <Segmented
                    value={config.voting}
                    onChange={v => set('voting', v)}
                    options={[{ value: 'app', label: 'En la app', icon: <DeviceMobile size={18} /> }, { value: 'inperson', label: 'En persona', icon: <Megaphone size={18} /> }]}
                />
                <p className="muted tiny" style={{ margin: 0 }}>
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
                    La primera noche pueden reclutar en secreto a uno de los {config.factions.loyal}
                </label>
            </section>

            <section className="card hot stack">
                <label className="check">
                    <input type="checkbox" checked={config.ghosts.enabled} onChange={e => setGhosts('enabled', e.target.checked)} />
                    <h3 className="m0">Sociedad Secreta de los Fantasmas</h3>
                </label>
                <p className="muted small" style={{ margin: 0 }}>
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
                            <p className="small muted m0">Se calculan al empezar: con la plantilla de 12 jugadores salen 8, 12 y 16 calaveras para robar el 50, 75 y 100 % del botín.</p>
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
            </section>

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
                <p className="muted tiny" style={{ margin: 0 }}>Puedes añadir o cambiar pruebas en cualquier momento desde el panel.</p>
            </section>

            <section className="card stack">
                <h3 className="m0">Acceso del MC</h3>
                <label className="field">
                    <span>Contraseña (opcional, para abrir el panel desde otro móvil)</span>
                    <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
                </label>
            </section>

            {error && <p className="blood">{error}</p>}
            <button className="btn primary block lg" disabled={busy}>{busy ? <><span className="spinner-sm" />Creando…</> : 'Crear partida'}</button>
        </form>
    );
}
