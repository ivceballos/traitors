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
  const [players, setPlayers] = useState([]);
  const [chat, setChat] = useState([]);
  const [message, setMessage] = useState('');
  const [nightVictim, setNightVictim] = useState(null);
  const [expelled, setExpelled] = useState(null);
  const [gameOver, setGameOver] = useState(null);

  useEffect(() => {
    socket.on('role', ({ role, traitors }) => {
      setRole(role);
      setTraitors(traitors);
    });
    socket.on('phase', setPhase);
    socket.on('players', setPlayers);
    socket.on('chat', msg => setChat(c => [...c, msg]));
    socket.on('night-victim', setNightVictim);
    socket.on('expelled', setExpelled);
    socket.on('gameover', setGameOver);
    return () => socket.disconnect();
  }, []);

  const handleJoin = () => {
    if (!name) return;
    socket.emit('join', { name, photo });
    setJoined(true);
  };

  const handleStart = () => {
    socket.emit('start');
  };

  const handleNightKill = (id) => {
    socket.emit('night-kill', id);
  };

  const handleVote = (id) => {
    socket.emit('vote', id);
  };

  const sendMessage = () => {
    socket.emit('chat', { message, phaseType: phase });
    setMessage('');
  };

  if (!joined) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Unirse a Traidores</h2>
        <input placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
        <input placeholder="URL de foto (opcional)" value={photo} onChange={e => setPhoto(e.target.value)} />
        <button onClick={handleJoin}>Entrar</button>
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div style={{ padding: 20 }}>
        <h2>Esperando a que empiece la partida...</h2>
        <ul>
          {players.map(p => <li key={p.id}>{p.name}</li>)}
        </ul>
        <button onClick={handleStart}>Comenzar</button>
      </div>
    );
  }

  if (gameOver) {
    return (
      <div style={{ padding: 20 }}>
        <h2>¡Fin del juego!</h2>
        <h3>Ganadores: {gameOver}</h3>
        <ul>
          {players.map(p => (
            <li key={p.id}>
              {p.name} - {p.role} {p.alive ? '🟢' : '🔴'}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>Fase: {phase}</h2>
      <div>
        <strong>Tu rol:</strong> {role}
        {role === 'traidor' && (
          <div>
            <strong>Compañeros traidores:</strong> {traitors.join(', ')}
          </div>
        )}
      </div>
      <div>
        <h3>Jugadores vivos</h3>
        <ul>
          {players.filter(p => p.alive).map(p => (
            <li key={p.id}>
              <img src={p.photo || 'https://placehold.co/40'} alt="" width={40} style={{ borderRadius: '50%' }} />
              {p.name}
              {phase === 'night' && role === 'traidor' && p.id !== socket.id && (
                <button onClick={() => handleNightKill(p.id)}>Asesinar</button>
              )}
              {phase === 'roundtable' && p.id !== socket.id && (
                <button onClick={() => handleVote(p.id)}>Votar</button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {nightVictim && <div>Asesinado esta noche: {nightVictim.name}</div>}
      {expelled && <div>Expulsado en la mesa redonda: {expelled.name}</div>}
      <div>
        <h3>Chat ({phase === 'night' && role === 'traidor' ? 'Traidores' : 'General'})</h3>
        <div style={{ border: '1px solid #ccc', height: 100, overflowY: 'scroll', marginBottom: 10 }}>
          {chat.map((msg, i) => <div key={i}><b>{msg.from}:</b> {msg.message}</div>)}
        </div>
        <input value={message} onChange={e => setMessage(e.target.value)} />
        <button onClick={sendMessage}>Enviar</button>
      </div>
    </div>
  );
}

export default App;
