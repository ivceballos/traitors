const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

let players = [];
let phase = 'waiting'; // waiting, night, roundtable, voting, gameover
let traitors = [];
let faithfuls = [];
let nightVictim = null;
let votes = [];
let gameOverWinner = null;

function assignRoles() {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  traitors = shuffled.slice(0, 2).map(p => p.id);
  faithfuls = shuffled.slice(2).map(p => p.id);
  players = players.map(p => ({
    ...p,
    role: traitors.includes(p.id) ? 'traidor' : 'fiel',
    alive: true,
  }));
}

function getAlivePlayers() {
  return players.filter(p => p.alive);
}

function checkGameOver() {
  const aliveTraitors = getAlivePlayers().filter(p => p.role === 'traidor');
  const aliveFaithfuls = getAlivePlayers().filter(p => p.role === 'fiel');
  if (aliveTraitors.length === 0) {
    phase = 'gameover';
    gameOverWinner = 'FIELES';
    return true;
  }
  if (aliveTraitors.length >= aliveFaithfuls.length) {
    phase = 'gameover';
    gameOverWinner = 'TRAIDORES';
    return true;
  }
  return false;
}

io.on('connection', (socket) => {
  socket.on('join', ({ name, photo }) => {
    if (phase !== 'waiting') {
      socket.emit('error', 'La partida ya ha comenzado');
      return;
    }
    players.push({ id: socket.id, name, photo, role: null, alive: true });
    io.emit('players', players);
  });

  socket.on('start', () => {
    if (phase !== 'waiting') return;
    assignRoles();
    phase = 'night';
    io.emit('phase', phase);
    players.forEach(p => {
      io.to(p.id).emit('role', { role: p.role, traitors: traitors.map(id => players.find(pl => pl.id === id).name) });
    });
    io.emit('players', players);
  });

  socket.on('night-kill', (victimId) => {
    if (phase !== 'night') return;
    if (!traitors.includes(socket.id)) return;
    nightVictim = victimId;
    phase = 'roundtable';
    players = players.map(p => p.id === victimId ? { ...p, alive: false } : p);
    io.emit('phase', phase);
    io.emit('players', players);
    io.emit('night-victim', players.find(p => p.id === victimId));
  });

  socket.on('vote', (votedId) => {
    if (phase !== 'roundtable') return;
    if (!getAlivePlayers().find(p => p.id === socket.id)) return;
    votes.push({ voter: socket.id, voted: votedId });
    if (votes.length === getAlivePlayers().length) {
      const tally = {};
      votes.forEach(v => { tally[v.voted] = (tally[v.voted] || 0) + 1; });
      const [expelledId] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
      players = players.map(p => p.id === expelledId ? { ...p, alive: false } : p);
      votes = [];
      const expelled = players.find(p => p.id === expelledId);
      if (expelled.role === 'traidor') {
        const newTraitor = getAlivePlayers().find(p => p.role === 'fiel');
        if (newTraitor) {
          players = players.map(p => p.id === newTraitor.id ? { ...p, role: 'traidor' } : p);
        }
      }
      if (!checkGameOver()) {
        phase = 'night';
        io.emit('phase', phase);
      }
      io.emit('players', players);
      io.emit('expelled', expelled);
      if (phase === 'gameover') {
        io.emit('gameover', gameOverWinner);
      }
    }
  });

  socket.on('chat', ({ message, phaseType }) => {
    if (phaseType === 'night') {
      traitors.forEach(id => io.to(id).emit('chat', { from: players.find(p => p.id === socket.id).name, message }));
    } else {
      io.emit('chat', { from: players.find(p => p.id === socket.id).name, message });
    }
  });

  socket.on('disconnect', () => {
    players = players.filter(p => p.id !== socket.id);
    io.emit('players', players);
  });
});

server.listen(4000, () => console.log('Backend running on http://localhost:4000'));
