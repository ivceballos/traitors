import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';

const socket = io('http://localhost:4000');

function MasterPanel() {
    const [authenticated, setAuthenticated] = useState(false);
    const [password, setPassword] = useState('');
    const [gameState, setGameState] = useState({
        phase: 'waiting',
        gameDay: 0,
        players: [],
        roleDistribution: { traidores: 0, fieles: 0 },
        scores: {},
        activeTests: [],
        invitationStatus: null
    });
    const [testName, setTestName] = useState('');
    const [selectedPlayers, setSelectedPlayers] = useState([]);
    const [pointsToAdd, setPointsToAdd] = useState(0);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        socket.on('master-auth', (success) => {
            if (success) {
                setAuthenticated(true);
                socket.emit('master-get-state');
            } else {
                setError('Contraseña incorrecta');
            }
        });

        socket.on('master-update', setGameState);
        socket.on('master-error', setError);
        socket.on('master-message', setMessage);

        return () => {
            socket.off('master-auth');
            socket.off('master-update');
            socket.off('master-error');
            socket.off('master-message');
        };
    }, []);

    const handleLogin = () => {
        if (!password.trim()) {
            setError('Introduce la contraseña');
            return;
        }
        socket.emit('master-login', password.trim());
    };

    const togglePlayerSelection = (playerId) => {
        setSelectedPlayers(prev =>
            prev.includes(playerId)
                ? prev.filter(id => id !== playerId)
                : [...prev, playerId]
        );
    };

    const startTest = () => {
        if (!testName.trim()) {
            setError('Introduce un nombre para la prueba');
            return;
        }
        if (selectedPlayers.length === 0) {
            setError('Selecciona al menos un jugador');
            return;
        }
        socket.emit('master-start-test', {
            testName: testName.trim(),
            players: selectedPlayers
        });
        setTestName('');
        setSelectedPlayers([]);
    };

    const addPoints = () => {
        if (selectedPlayers.length === 0) {
            setError('Selecciona al menos un jugador');
            return;
        }
        if (!pointsToAdd || pointsToAdd <= 0) {
            setError('Introduce un número válido de puntos');
            return;
        }
        socket.emit('master-add-points', {
            players: selectedPlayers,
            points: parseInt(pointsToAdd)
        });
        setPointsToAdd(0);
        setSelectedPlayers([]);
    };

    const nextDay = () => {
        socket.emit('master-next-day');
    };

    const resetGame = () => {
        if (window.confirm('¿Seguro que quieres reiniciar el juego?')) {
            socket.emit('master-reset-game');
        }
    };

    if (!authenticated) {
        return (
            <div style={{ padding: 20, maxWidth: 600, margin: '0 auto' }}>
                <h2>Panel del Maestro de Ceremonias</h2>
                {error && <div style={{ color: 'red', marginBottom: 10 }}>{error}</div>}
                <div>
                    <input
                        type="password"
                        placeholder="Contraseña"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        onKeyPress={e => e.key === 'Enter' && handleLogin()}
                        style={{ marginRight: 10, padding: 8 }}
                    />
                    <button
                        onClick={handleLogin}
                        style={{
                            padding: '8px 16px',
                            backgroundColor: '#4CAF50',
                            color: 'white',
                            border: 'none',
                            borderRadius: 4
                        }}
                    >
                        Acceder
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div style={{ padding: 20, maxWidth: 1000, margin: '0 auto' }}>
            <h2>Panel del Maestro de Ceremonias</h2>
            {error && <div style={{ color: 'red', marginBottom: 10, padding: 10, backgroundColor: '#ffebee', borderRadius: 4 }}>{error}</div>}
            {message && <div style={{ color: 'green', marginBottom: 10, padding: 10, backgroundColor: '#e8f5e9', borderRadius: 4 }}>{message}</div>}

            <div style={{
                marginBottom: 20,
                padding: 15,
                backgroundColor: '#f5f5f5',
                borderRadius: 8,
                boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
            }}>
                <h3>Estado del Juego</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>Fase: <strong>{gameState.phase}</strong></div>
                    <div>Día: <strong>{gameState.gameDay}</strong></div>
                    <div>Jugadores: <strong>{gameState.players.length}</strong></div>
                    <div>
                        Roles: <strong>
                            {gameState.roleDistribution.traidores} traidores,
                            {gameState.roleDistribution.fieles} fieles
                        </strong>
                    </div>
                    <div>Invitación: <strong>{gameState.invitationStatus || 'ninguna'}</strong>
