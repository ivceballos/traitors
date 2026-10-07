import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Crown, User } from '@phosphor-icons/react';
import { http } from '../api';
import { Art } from '../components';

// Partidas en las que ya participa este dispositivo (para volver con un toque)
function savedGames() {
    const games = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const m = key && key.match(/^(player|mc):([A-Z0-9]{4})$/);
            if (m) games.push({ kind: m[1], code: m[2] });
        }
    } catch (_) { /* sin almacenamiento */ }
    return games;
}

export default function Home() {
    const navigate = useNavigate();
    const [code, setCode] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const games = savedGames();

    const join = async e => {
        e.preventDefault();
        setBusy(true);
        try {
            await http(`/api/rooms/${code}`);
            navigate(`/p/${code}`);
        } catch (err) {
            setError(err.message);
            setBusy(false);
        }
    };

    return (
        <div className="page narrow home">
            <div>
                <header className="home-hero">
                    <Art name="encapuchados.webp" />
                    <img className="logo" src={`${process.env.PUBLIC_URL}/img/logo.webp`} alt="" width="132" height="132" />
                    <h1>Fieles<span><em>y</em>Felones</span></h1>
                    <p>El juego de traición para viajes con amigos.</p>
                </header>

                <form className="stack" onSubmit={join}>
                    <label className="field">
                        <span className="label">Código de la partida</span>
                        <input
                            className="input code"
                            maxLength={4}
                            value={code}
                            onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); setError(''); }}
                            autoCapitalize="characters"
                            autoComplete="off"
                            spellCheck="false"
                        />
                    </label>
                    {error && <p className="accent small m0">{error}</p>}
                    <button className="btn primary block lg" disabled={busy || code.length !== 4}>
                        {busy ? <><span className="spinner-sm" />Entrando…</> : <>Entrar <ArrowRight size={20} /></>}
                    </button>
                    {!busy && code.length !== 4 && <p className="btn-hint m0">Escribe los 4 caracteres del código</p>}
                </form>

                {games.length > 0 && (
                    <section className="section stack-sm" style={{ marginTop: 32 }}>
                        <h3>Tus partidas</h3>
                        {games.map(g => (
                            <Link key={g.kind + g.code} className="btn block" style={{ justifyContent: 'space-between' }} to={`/${g.kind === 'mc' ? 'mc' : 'p'}/${g.code}`}>
                                <span className="row nowrap">{g.kind === 'mc' ? <Crown size={20} /> : <User size={20} />}{g.kind === 'mc' ? 'Dirigir' : 'Jugar'}</span>
                                <span className="room-code" style={{ fontSize: '1rem' }}>{g.code}</span>
                            </Link>
                        ))}
                    </section>
                )}
            </div>

            <footer className="section row between" style={{ marginTop: 40 }}>
                <span className="small muted">¿Diriges la partida?</span>
                <Link className="btn sm" to="/crear"><Crown size={18} /> Crear partida</Link>
            </footer>
            <Link className="small muted" to="/ranking" style={{ alignSelf: 'center' }}>Tabla de ganadores</Link>
        </div>
    );
}
