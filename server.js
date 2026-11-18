const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 50;

app.use(express.static(path.join(__dirname, 'public')));

const messages = [];
const users = new Map();

function broadcastUsers() {
  io.emit('user list', [...new Set(users.values())]);
}

io.on('connection', (socket) => {
  socket.on('join', (rawName, reply) => {
    const name = String(rawName || '').trim().slice(0, 20);
    if (!name) {
      if (reply) reply({ ok: false, error: 'Please enter a username.' });
      return;
    }

    users.set(socket.id, name);
    socket.emit('history', messages);
    broadcastUsers();
    if (reply) reply({ ok: true });
  });

  socket.on('chat message', (rawText) => {
    const name = users.get(socket.id);
    if (!name) return;

    const text = String(rawText || '').trim().slice(0, 500);
    if (!text) return;

    const message = { name, text, time: Date.now() };
    messages.push(message);
    if (messages.length > MAX_HISTORY) messages.shift();
    io.emit('chat message', message);
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    broadcastUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Chat is running at http://localhost:${PORT}`);
});
