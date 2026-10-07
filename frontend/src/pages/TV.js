import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatEuros, formatGold, send, socket } from '../api';
import { Avatar, Loading, OfflineBanner, Seal, TestsTable, Thresholds, useConnection, useSocketEvent } from '../components';

const PHASE_TITLE = { lobby: 'Sala de espera', day: 'Día', roundtable: 'Mesa redonda', night: 'Noche', endgame: 'El final', end: 'Final' };

// Pantalla pública para la tele: jugadores y botín, sin secretos. Se actualiza en tiempo real.
export default function TV() {
    const code = useParams().code.toUpperCase();
    const connected = useConnection();
    const [view, setView] = useState(null);
    const [missing, setMissing] = useState(false);
    const [qr, setQr] = useState(null);
    const joinUrl = `${window.location.origin}/p/${code}`;

    useEffect(() => {
        const watch = () => send('tv:watch', { code }).catch(() => setMissing(true));
        socket.on('connect', watch);
        if (socket.connected) watch();
        return () => socket.off('connect', watch);
    }, [code]);

    useEffect(() => {
        QRCode.toDataURL(joinUrl, { margin: 0, width: 480, color: { dark: '#0b0b0c', light: '#edebe7' } }).then(setQr).catch(() => {});
    }, [joinUrl]);

    useSocketEvent('state', setView);

    // La tele no debe apagarse a mitad de partida
    useEffect(() => {
        let lock = null;
        const request = async () => {
            try { if ('wakeLock' in navigator && document.visibilityState === 'visible') lock = await navigator.wakeLock.request('screen'); } catch (_) { /* no soportado */ }
        };
        request();
        document.addEventListener('visibilitychange', request);
        return () => { document.removeEventListener('visibilitychange', request); if (lock) lock.release().catch(() => {}); };
    }, []);

    if (missing) return <Loading text={`No existe la partida ${code}`} />;
    if (!view) return <Loading text="Conectando" />;

    const title = view.phase === 'day' ? `Día ${view.day}` : PHASE_TITLE[view.phase];
    const winners = view.winner && (view.winner === 'traitor' ? view.factions.traitor : view.factions.loyal);
    const stolen = view.ghosts ? view.ghosts.stolen : 0;

    const spot = view.spotlight && view.tests.find(t => t.id === view.spotlight);

    return (
        <div className="tv">
            {view.quiz ? <QuizScreen view={view} /> : spot && <Spotlight test={spot} view={view} />}
            <OfflineBanner connected={connected} />
            <header className="tv-header">
                <div className="row nowrap" style={{ gap: '3vmin' }}>
                    <img className="logo" src={`${process.env.PUBLIC_URL}/img/logo.webp`} alt="" style={{ width: '11vmin', height: '11vmin' }} />
                    <div className="tv-title">{view.name}</div>
                </div>
                <div className={`tv-phase ${view.phase} ${view.winner || ''}`}>
                    {view.phase === 'end' && <Seal kind={view.winner} size={160} className="tv-seal" />}
                    {view.phase === 'end' ? `Ganan los ${winners}` : title}
                    {(view.phase === 'roundtable' || view.phase === 'night') && <div className="label" style={{ marginTop: '1vmin' }}>Día {view.day} de {view.days}</div>}
                    {view.phase === 'endgame' && (
                        <div className="label" style={{ marginTop: '1vmin' }}>
                            ¿Quedan {view.factions.traitor}? Solo se acaba por unanimidad
                            {view.endgame && view.voting === 'app' && ` · han decidido ${view.endgame.voters.length} de ${view.players.filter(p => p.alive).length}`}
                        </div>
                    )}
                </div>
            </header>

            <div className="tv-body">
                <div className="tv-players">
                    {view.players.map(p => (
                        <div key={p.id} className={`tv-player ${p.alive ? '' : 'dead'}`}>
                            <Avatar player={p} />
                            <span className="name">{p.name}</span>
                            {!p.alive && <span className="sub">{p.eliminatedBy === 'murder' ? 'Asesinato' : 'Destierro'}{p.role ? `, ${p.role === 'traitor' ? view.factions.traitor : view.factions.loyal}` : ''}</span>}
                            {view.phase === 'end' && p.alive && p.role && <span className="sub">{p.role === 'traitor' ? view.factions.traitor : view.factions.loyal}</span>}
                        </div>
                    ))}
                </div>

                <div className="tv-side">
                    {view.phase === 'lobby' && (
                        <div className="tv-join">
                            {qr && <img src={qr} alt="" />}
                            <div>
                                <div className="label">Entrad con el código</div>
                                <div className="tv-code">{code}</div>
                                <div className="label" style={{ marginTop: '1vmin' }}>{joinUrl.replace(/^https?:\/\//, '')}</div>
                            </div>
                        </div>
                    )}
                    {view.tests.length > 0 && (
                        <div>
                            <div className="label">{view.phase === 'end' ? 'Bote final' : 'Botín'}</div>
                            <div className="big-number">{formatEuros(view.treasure - stolen, view.goldPerEuro)}</div>
                            <div className="label" style={{ marginBottom: '2vmin' }}>
                                {formatGold(view.treasure)}{view.maxTreasure > 0 && ` de ${formatGold(view.maxTreasure)} posibles`}
                            </div>
                            <TestsTable tests={view.tests} />
                        </div>
                    )}
                    {view.ghosts && (
                        <div>
                            <div className="label">La Sociedad Secreta de los Fantasmas: los eliminados tenían un objetivo secreto cada día</div>
                            <div className="big-number" style={{ fontSize: '7vmin', marginTop: '1vmin' }}>{view.ghosts.skulls} <span className="label">calaveras</span></div>
                            <div className="label">{view.ghosts.percent > 0 ? `Roban el ${view.ghosts.percent}% del botín` : 'No llegan a robar nada'}</div>
                            <div style={{ marginTop: '1.5vmin' }}><Thresholds skulls={view.ghosts.skulls} thresholds={view.ghosts.thresholds} /></div>
                        </div>
                    )}
                </div>
            </div>
            {/* Código y QR siempre a la vista para quien se reconecta o llega tarde */}
            {view.phase !== 'lobby' && view.phase !== 'end' && (
                <div className="tv-corner">
                    {qr && <img src={qr} alt="" />}
                    <div>
                        <div className="label">Código</div>
                        <div className="room-code">{code}</div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ¿Quién dijo qué?: la respuesta a pantalla completa; al desvelar, de quién era y cuánto oro suma
function QuizScreen({ view }) {
    const q = view.quiz;
    const author = q.revealed && view.players.find(p => p.id === q.authorId);
    const alive = view.players.filter(p => p.alive).length;
    return (
        <div className="tv-spotlight">
            <div>
                <div className="label">¿Quién dijo qué?</div>
                <div className="label" style={{ marginTop: '2vmin' }}>{q.question}</div>
                <div className="tv-title" style={{ marginTop: '2vmin' }}>«{q.answer}»</div>
            </div>
            <div className="foot">
                {author ? (
                    <div className="row nowrap" style={{ gap: '3vmin' }}>
                        <Avatar player={author} size={120} />
                        <div>
                            <div className="label">Lo dijo</div>
                            <div className="big-number">{author.name}</div>
                        </div>
                    </div>
                ) : (
                    <div>
                        <div className="label">Respuestas</div>
                        <div className="big-number">{q.guessers.length} de {alive - 1}</div>
                    </div>
                )}
                <div style={{ textAlign: 'right' }}>
                    <div className="label">{q.revealed ? `${q.correct.length} aciertos` : 'Cada acierto suma oro'}</div>
                    <div className="big-number" style={{ fontSize: '7vmin' }}>{q.revealed ? `+${formatGold(q.gold)}` : formatEuros(view.treasure, view.goldPerEuro)}</div>
                </div>
            </div>
        </div>
    );
}

function Spotlight({ test, view }) {
    return (
        <div className="tv-spotlight">
            <div>
                <div className="label">Prueba</div>
                <div className="tv-title" style={{ marginTop: '2vmin' }}>{test.name}</div>
            </div>
            {test.description && <p className="desc m0">{test.description}</p>}
            <div className="foot">
                {test.score !== null ? (
                    <div className="result">
                        <div className="label">Conseguido</div>
                        <div className="big-number">{formatGold(test.score)}</div>
                    </div>
                ) : (
                    <div>
                        <div className="label">En juego</div>
                        <div className="big-number">{test.max ? `Hasta ${formatGold(test.max)}` : 'Oro para el botín'}</div>
                    </div>
                )}
                <div style={{ textAlign: 'right' }}>
                    <div className="label">Botín</div>
                    <div className="big-number" style={{ fontSize: '7vmin' }}>{formatEuros(view.treasure, view.goldPerEuro)}</div>
                </div>
            </div>
        </div>
    );
}
