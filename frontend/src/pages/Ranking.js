import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from '@phosphor-icons/react';
import { formatEuros, http } from '../api';

// Tabla de ganadores: victorias y oro acumulado de todas las partidas terminadas
export default function Ranking() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        http('/api/leaderboard').then(setData).catch(err => setError(err.message));
    }, []);

    return (
        <div className="page narrow stack">
            <Link to="/" className="btn sm" style={{ alignSelf: 'flex-start' }}><ArrowLeft size={18} /> Volver</Link>
            <h1 style={{ fontSize: 'clamp(3rem, 14vw, 5rem)' }}>Ganadores</h1>
            {error && <p className="blood">{error}</p>}
            {!data && !error && <div className="spinner" />}
            {data && data.rows.length === 0 && <p className="muted">Todavía no ha terminado ninguna partida.</p>}
            {data && data.rows.length > 0 && (
                <section className="card">
                    <p className="small muted" style={{ marginTop: 0 }}>{data.games} {data.games === 1 ? 'partida' : 'partidas'}. Se ordena por el oro ganado.</p>
                    <table className="table">
                        <thead><tr><th>#</th><th>Jugador</th><th className="r">Victorias</th><th className="r">Oro</th></tr></thead>
                        <tbody>
                            {data.rows.map((r, i) => (
                                <tr key={r.name}>
                                    <td className="brand">{i + 1}</td>
                                    <td>
                                        {r.name}
                                        <div className="tiny muted">{r.loyalWins} como Fiel · {r.traitorWins} como Felón · {r.games} jugadas</div>
                                    </td>
                                    <td className="r num">{r.wins}</td>
                                    <td className="r num">{formatEuros(r.gold)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </section>
            )}
        </div>
    );
}
