import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

function App() {
    const [name, setName] = useState('');
    const [photo, setPhoto] = useState('');
    const [joined, setJoined] = useState(false);
    const [role, setRole] = useState(null);
    const [traitors, setTraitors] = useState([]);
    const [phase, setPhase] = useState('waiting');
    const [gameDay, setGameDay] = useState(0);
    const [players, setPlayers] = useState([]);
    const [chat, setChat] = useState([]);
    const [message, setMessage] = useState('');
    const [nightVictim, setNightVictim] = useState(null);
    const [expelled, setExpelled] = useState(null);
    const [gameOver, setGameOver] = useState(null);
    const [score, setScore] = useState(0);
    const [activeTest, setActiveTest] = useState(null);
    const [pendingInvitation, setPendingInvitation] = useState(false);
    const [error, setError] = useState(null);
    const [systemMessage, setSystemMessage] = useState(null);
    const [token, setToken] = useState(localStorage.getItem('playerToken') || '');
    const [reconnecting, setReconnecting] = useState(false);

    useEffect(() => {
        // Intentar reconexión al cargar
        if (token) {
            setReconnecting(true);
            socket.emit('auth', {
                token,
                name,
                photo
            });
        }

        socket.on('token', (newToken) => {
            setToken(newToken);
            localStorage.setItem('playerToken', newToken);
        });

        socket.on('reconnected', ({ phase, gameDay, score }) => {
            setPhase(phase);
            setGameDay(gameDay);
            setScore(score);
            setJoined(true);
            setReconnecting(false);
            setSystemMessage('Reconectado a la partida');
        });

        socket.on('connect_error', () => {
            setError('Error de conexión. Intentando reconectar...');
        });

        socket.on('error', (message) => {
            setError(message);
            // Limpiar el error después de 5 segundos
            setTimeout(() => setError(null), 5000);
            if (reconnecting) {
                setReconnecting(false);
            }
        });

        socket.on('message', (message) => {
            setSystemMessage(message);
            // Limpiar el mensaje después de 5 segundos
            setTimeout(() => setSystemMessage(null), 5000);
        });

        socket.on('disconnect', () => {
            setError('Desconectado del servidor. Intentando reconectar...');
        });

        socket.on('role', ({ role, traitors }) => {
            setRole(role);
            setTraitors(traitors);
        });

        socket.on('phase', setPhase);
        socket.on('game-day', setGameDay);
        socket.on('players', setPlayers);
        socket.on('chat', msg => setChat(c => [...c, msg]));
        socket.on('night-victim', setNightVictim);
        socket.on('expelled', setExpelled);
        socket.on('gameover', setGameOver);

        socket.on('test-started', ({ testName }) => {
            setActiveTest(testName);
            setSystemMessage(`¡Has sido seleccionado para la prueba: ${testName}!`);
        });

        socket.on('points-added', ({ points, total }) => {
            setScore(total);
            setSystemMessage(`¡Has ganado ${points} puntos!`);
        });

        socket.on('traitor-invitation', () => {
            setPendingInvitation(true);
            setSystemMessage('¡Has recibido una invitación para unirte a los traidores!');
        });

        socket.on('invitation-sent', (playerName) => {
            setSystemMessage(`Invitación enviada a ${playerName}`);
        });

        socket.on('invitation-accepted', (playerName) => {
            setSystemMessage(`${playerName} ha aceptado unirse a los traidores`);
        });

        socket.on('invitation-rejected', () => {
            setSystemMessage('El jugador ha rechazado la invitación');
        });

        socket.on('invitation-cancelled', (reason) => {
            setSystemMessage(`Invitación cancelada: ${reason}`);
        });

        socket.on('game-reset', () => {
            setJoined(false);
            setRole(null);
            setTraitors([]);
            setPhase('waiting');
            setGameDay(0);
            setPlayers([]);
            setChat([]);
            setMessage('');
            setNightVictim(null);
            setExpelled(null);
            setGameOver(null);
            setScore(0);
            setActiveTest(null);
            setPendingInvitation(false);
            localStorage.removeItem('playerToken');
            setToken('');
        });

        return () => {
            socket.off('connect_error');
            socket.off('error');
            socket.off('message');
            socket.off('disconnect');
            socket.off('role');
            socket.off('phase');
            socket.off('game-day');
            socket.off('players');
            socket.off('chat');
            socket.off('night-victim');
            socket.off('expelled');
            socket.off('gameover');
            socket.off('test-started');
            socket.off('points-added');
            socket.off('traitor-invitation');
            socket.off('invitation-sent');
            socket.off('invitation-accepted');
            socket.off('invitation-rejected');
            socket.off('invitation-cancelled');
            socket.off('game-reset');
            socket.off('token');
            socket.off('reconnected');
        };
    }, []);

    const isValidUrl = (string) => {
        try {
            new URL(string);
            return true;
        } catch (_) {
            return false;
        }
    };

    const handleJoin = () => {
        if (!name.trim()) {
            setError('Por favor, introduce un nombre');
            return;
        }
        if (photo && !isValidUrl(photo)) {
            setError('URL de foto no válida');
            return;
        }
        socket.emit('auth', { token: '', name: name.trim(), photo });
        setJoined(true);
        setError(null);
    };

    const handleStart = () => {
        socket.emit('start');
    };

    const handleInvitePlayer = (id) => {
        socket.emit('invite-player', id);
    };

    const handleRespondInvitation = (accept) => {
        socket.emit('respond-invitation', accept);
        setPendingInvitation(false);
    };

    const handleNightKill = (id) => {
        socket.emit('night-kill', id);
    };

    const handleVote = (id) => {
        socket.emit('vote', id);
    };

    const sendMessage = () => {
        if (!message.trim()) return;

        // Determinar si es chat de traidores o general
        const chatType = (role === 'traidor' && (phase === 'night' || phase === 'invitation'))
            ? 'traitors'
            : 'general';

        socket.emit('chat', { message: message.trim(), phaseType: chatType });
        setMessage('');
    };

    // Pantalla de reconexión
    if (reconnecting) {
        return (
            <div style={{ padding: 20, maxWidth: 600, margin: '0 auto', textAlign: 'center' }}>
                <h2>Reconectando...</h2>
                <p>Intentando reconectar a la partida en curso.</p>
                <div style={{ marginTop: 20 }}>
                    <div className="spinner" style={{
                        border: '4px solid rgba(0, 0, 0, 0.1)',
                        borderLeft: '4px solid #3498db',
                        borderRadius: '50%',
                        width: '30px',
                        height: '30px',
                        animation: 'spin 1s linear infinite',
                        margin: '0 auto'
                    }}></div>
                </div>
                <style>{`
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                `}</style>
            </div>
        );
    }

    // Pantalla de inicio de sesión
    if (!joined) {
        return (
            <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
                <h2>Traidores - El Juego</h2>
                {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}
                <div style={{ marginBottom: 20 }}>
                    <p>Bienvenido al juego de estrategia, alianzas y traición.</p>
                </div>
                <div style={{ marginBottom: 10 }}>
                    <input
                        placeholder="Tu nombre"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        style={{ marginRight: 10, padding: 8 }}
                    />
                    <input
                        placeholder="URL de tu foto (opcional)"
                        value={photo}
                        onChange={e => setPhoto(e.target.value)}
                        style={{ marginRight: 10, padding: 8 }}
                    />
                    <button
                        onClick={handleJoin}
                        style={{ padding: '8px 16px', backgroundColor: '#4CAF50', color: 'white', border: 'none', borderRadius: 4 }}
                    >
                        Entrar
                    </button>
                </div>
            </div>
        );
    }

    // Pantalla de espera
    if (phase === 'waiting') {
        return (
            <div style={{ padding: 20, maxWidth: 800, margin: '0 auto' }}>
                <h2>Esperando a que empiece la partida...</h2>
                {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}
                {systemMessage && <div style={{ color: 'blue', marginBottom: 10 }}>{systemMessage}</div>}

                <div style={{ marginBottom: 20 }}>
                    <h3>Jugadores ({players.length})</h3>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {players.map(p => (
                            <li key={p.id} style={{
                                marginBottom: 10,
                                display: 'flex',
                                alignItems: 'center'
                            }}>
                                {p.photo && (
                                    <img
                                        src={p.photo}
                                        alt=""
                                        width={40}
                                        height={40}
                                        style={{
                                            borderRadius: '50%',
                                            marginRight: 10,
                                            objectFit: 'cover'
                                        }}
                                    />
                                )}
                                {p.name}
                            </li>
                        ))}
                    </ul>
                </div>

                <button
                    onClick={handleStart}
                    disabled={players.length < 4}
                    style={{
                        padding: '10px 20px',
                        backgroundColor: players.length < 4 ? '#cccccc' : '#4CAF50',
                        color: 'white',
                        border: 'none',
                        borderRadius: 4
                    }}
                >
                    Comenzar Juego
                </button>

                {players.length < 4 && (
                    <div style={{ color: 'orange', marginTop: 10 }}>
                        Se necesitan al menos 4 jugadores para comenzar
                    </div>
                )}
            </div>
        );
    }

    // Pantalla de fin de juego
    if (gameOver) {
        return (
            <div style={{ padding: 20, maxWidth: 800, margin: '0 auto' }}>
                <h2>¡Fin del juego!</h2>
                <h3>Ganadores: {gameOver}</h3>

                <div style={{ marginBottom: 20 }}>
                    <h3>Jugadores finales</h3>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {players.map(p => (
                            <li key={p.id} style={{
                                marginBottom: 10,
                                opacity: p.alive ? 1 : 0.5,
                                display: 'flex',
                                alignItems: 'center'
                            }}>
                                {p.photo && (
                                    <img
                                        src={p.photo}
                                        alt=""
                                        width={40}
                                        height={40}
                                        style={{
                                            borderRadius: '50%',
                                            marginRight: 10,
                                            objectFit: 'cover'
                                        }}
                                    />
                                )}
                                {p.name} - {p.role}
                                {!p.alive && <span style={{ marginLeft: 10, color: 'red' }}>Eliminado</span>}
                            </li>
                        ))}
                    </ul>
                </div>

                <div>
                    <h3>Puntuaciones finales</h3>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {players.map(p => (
                            <li key={p.id}>
                                {p.name}: {score} puntos
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        );
    }

    // Pantalla de invitación para unirse a los traidores
    if (pendingInvitation) {
        return (
            <div style={{
                padding: 20,
                maxWidth: 600,
                margin: '0 auto',
                backgroundColor: '#f8f8f8',
                borderRadius: 8,
                boxShadow: '0 2px 10px rgba(0,0,0,0.1)'
            }}>
                <h2 style={{ color: '#d32f2f' }}>Invitación Secreta</h2>

                <div style={{ marginBottom: 30, lineHeight: 1.6 }}>
                    <p>Has recibido una invitación anónima para unirte a los <strong>traidores</strong>.</p>
                    <p>Si aceptas, te convertirás en un traidor y podrás participar en los cónclaves nocturnos.</p>
                    <p>Si rechazas, seguirás siendo un fiel y los traidores no podrán invitar a nadie más hasta el siguiente día.</p>
                    <p><strong>Esta decisión es irreversible.</strong></p>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <button
                        onClick={() => handleRespondInvitation(false)}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            width: '48%'
                        }}
                    >
                        Rechazar y seguir siendo Fiel
                    </button>

                    <button
                        onClick={() => handleRespondInvitation(true)}
                        style={{
                            padding: '10px 20px',
                            backgroundColor: '#d32f2f',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4,
                            width: '48%'
                        }}
                    >
                        Aceptar y convertirme en Traidor
                    </button>
                </div>
            </div>
        );
    }

    // Pantalla principal del juego
    return (
        <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div>
                    <h2>Traidores - Día {gameDay}</h2>
                    <div>Fase: <strong>{phase}</strong></div>
                </div>
                <div>
                    <div>Tu rol: <strong style={{ color: role === 'traidor' ? '#d32f2f' : '#4CAF50' }}>{role}</strong></div>
                    <div>Puntos: <strong>{score}</strong></div>
                </div>
            </div>

            {error && <div style={{ color: 'red', marginBottom: 10, padding: 10, backgroundColor: '#ffebee', borderRadius: 4 }}>{error}</div>}
            {systemMessage && <div style={{ color: 'blue', marginBottom: 10, padding: 10, backgroundColor: '#e3f2fd', borderRadius: 4 }}>{systemMessage}</div>}

            {role === 'traidor' && traitors.length > 0 && (
                <div style={{ marginBottom: 20, padding: 10, backgroundColor: '#ffebee', borderRadius: 4 }}>
                    <strong>Compañeros traidores:</strong> {traitors.join(', ')}
                </div>
            )}

            {activeTest && (
                <div style={{ marginBottom: 20, padding: 10, backgroundColor: '#e8f5e9', borderRadius: 4 }}>
                    <h3>Prueba Activa: {activeTest}</h3>
                    <p>El Maestro de Ceremonias ha iniciado esta prueba para ti.</p>
                </div>
            )}

            <div style={{ display: 'flex', gap: 20 }}>
                {/* Panel izquierdo: Jugadores */}
                <div style={{ flex: 1 }}>
                    <h3>Jugadores</h3>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {players.filter(p => p.alive).map(p => (
                            <li key={p.id} style={{
                                marginBottom: 10,
                                padding: 10,
                                backgroundColor: '#f5f5f5',
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center' }}>
                                    {p.photo && (
                                        <img
                                            src={p.photo}
                                            alt=""
                                            width={40}
                                            height={40}
                                            style={{
                                                borderRadius: '50%',
                                                marginRight: 10,
                                                objectFit: 'cover'
                                            }}
                                        />
                                    )}
                                    <span>{p.name}</span>
                                </div>

                                <div>
                                    {/* Botón de invitar (solo para traidores en fase de invitación) */}
                                    {phase === 'invitation' && role === 'traidor' && p.id !== socket.id && p.role !== 'traidor' && (
                                        <button
                                            onClick={() => handleInvitePlayer(p.id)}
                                            style={{
                                                marginLeft: 10,
                                                padding: '5px 10px',
                                                backgroundColor: '#673AB7',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 4
                                            }}
                                        >
                                            Invitar
                                        </button>
                                    )}

                                    {/* Botón de asesinar (solo para traidores en fase nocturna, después del día 1) */}
                                    {phase === 'night' && role === 'traidor' && gameDay > 1 && p.id !== socket.id && p.role !== 'traidor' && (
                                        <button
                                            onClick={() => handleNightKill(p.id)}
                                            style={{
                                                marginLeft: 10,
                                                padding: '5px 10px',
                                                backgroundColor: '#d32f2f',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 4
                                            }}
                                        >
                                            Asesinar
                                        </button>
                                    )}

                                    {/* Botón de votar (solo en fase de mesa redonda) */}
                                    {phase === 'roundtable' && p.id !== socket.id && (
                                        <button
                                            onClick={() => handleVote(p.id)}
                                            style={{
                                                marginLeft: 10,
                                                padding: '5px 10px',
                                                backgroundColor: '#FF9800',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: 4
                                            }}
                                        >
                                            Votar
                                        </button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>

                    {players.filter(p => !p.alive).length > 0 && (
                        <div>
                            <h3>Jugadores eliminados</h3>
                            <ul style={{ listStyle: 'none', padding: 0 }}>
                                {players.filter(p => !p.alive).map(p => (
                                    <li key={p.id} style={{
                                        marginBottom: 10,
                                        padding: 10,
                                        backgroundColor: '#f5f5f5',
                                        borderRadius: 4,
                                        opacity: 0.6,
                                        display: 'flex',
                                        alignItems: 'center'
                                    }}>
                                        {p.photo && (
                                            <img
                                                src={p.photo}
                                                alt=""
                                                width={40}
                                                height={40}
                                                style={{
                                                    borderRadius: '50%',
                                                    marginRight: 10,
                                                    objectFit: 'cover',
                                                    filter: 'grayscale(100%)'
                                                }}
                                            />
                                        )}
                                        <span>{p.name}</span>
                                        <span style={{ marginLeft: 10, color: 'red' }}>Eliminado</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                {/* Panel derecho: Chat */}
                <div style={{ flex: 1 }}>
                    <h3>
                        {role === 'traidor' && (phase === 'night' || phase === 'invitation')
                            ? 'Chat de Traidores (privado)'
                            : 'Chat General'}
                    </h3>

                    <div style={{
                        border: '1px solid #ccc',
                        height: 400,
                        overflowY: 'scroll',
                        marginBottom: 10,
                        padding: 10,
                        backgroundColor: '#f9f9f9',
                        borderRadius: 4
                    }}>
                        {chat.filter(msg => {
                            // Filtrar mensajes según el tipo de chat actual
                            if (role === 'traidor' && (phase === 'night' || phase === 'invitation')) {
                                return msg.isTraitorChat;
                            } else {
                                return !msg.isTraitorChat;
                            }
                        }).map((msg, i) => (
                            <div key={i} style={{
                                marginBottom: 8,
                                padding: 8,
                                backgroundColor: msg.from === name ? '#e3f2fd' : 'white',
                                borderRadius: 4
                            }}>
                                <b>{msg.from}:</b> {msg.message}
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', gap: 10 }}>
                        <input
                            value={message}
                            onChange={e => setMessage(e.target.value)}
                            onKeyPress={e => e.key === 'Enter' && sendMessage()}
                            style={{
                                flexGrow: 1,
                                padding: 8,
                                borderRadius: 4,
                                border: '1px solid #ccc'
                            }}
                            placeholder="Escribe un mensaje..."
                        />
                        <button
                            onClick={sendMessage}
                            style={{
                                padding: '8px 16px',
                                backgroundColor: '#2196F3',
                                color: 'white',
                                border: 'none',
                                borderRadius: 4
                            }}
                        >
                            Enviar
                        </button>
                    </div>
                </div>
            </div>

            {/* Información de eventos */}
            <div style={{ marginTop: 20 }}>
                {nightVictim && (
                    <div style={{
                        marginBottom: 10,
                        padding: 10,
                        backgroundColor: '#ffebee',
                        borderRadius: 4,
                        color: '#d32f2f'
                    }}>
                        <strong>Asesinado esta noche:</strong> {nightVictim.name}
                    </div>
                )}

                {expelled && (
                    <div style={{
                        marginBottom: 10,
                        padding: 10,
                        backgroundColor: '#fff3e0',
                        borderRadius: 4,
                        color: '#e65100'
                    }}>
                        <strong>Expulsado en la mesa redonda:</strong> {expelled.name}
                        ({expelled.role === 'traidor' ? 'Era un traidor' : 'Era un fiel'})
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
