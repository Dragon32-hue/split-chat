const express = require('express');
const http = require('http');
const path = require('path');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 100;

const AVATARS = ['👤', '😀', '🎮', '🦊', '🐱', '🌙', '⚡', '🎨', '🚀', '🍕', '👾', '🧙'];
const COLORS = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#00b0f4'];
const STATUSES = ['online', 'idle', 'dnd'];
const CHANNELS = [
  { id: 'general', name: 'general', topic: 'Talk about anything.' },
  { id: 'random', name: 'random', topic: 'Off-topic, memes and fun.' },
  { id: 'lounge', name: 'lounge', topic: 'Just hang out.' }
];

app.get('/health', (req, res) => res.status(200).send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

const channelMessages = new Map(CHANNELS.map((channel) => [channel.id, []]));
const dmMessages = new Map();
const dmParticipants = new Map();
const profiles = new Map();
const byUsername = new Map();

function clean(value, max) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ').slice(0, max);
}

function pick(list, value, fallback) {
  return list.includes(value) ? value : fallback;
}

function publicProfile(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName,
    avatar: profile.avatar,
    color: profile.color,
    status: profile.status,
    bio: profile.bio,
    joinedAt: profile.joinedAt
  };
}

function getMembers() {
  return [...profiles.values()].map(publicProfile);
}

function dmKey(a, b) {
  const first = a.toLowerCase();
  const second = b.toLowerCase();
  return first < second ? `${first}::${second}` : `${second}::${first}`;
}

function rememberParticipants(a, b) {
  const key = dmKey(a, b);
  if (!dmParticipants.has(key)) {
    dmParticipants.set(key, { [a.toLowerCase()]: a, [b.toLowerCase()]: b });
  }
  return key;
}

function otherName(key, username) {
  const participants = dmParticipants.get(key) || {};
  const lower = username.toLowerCase();
  const other = Object.keys(participants).find((name) => name !== lower);
  return other ? participants[other] : lower;
}

function getConversations(username) {
  const result = {};
  const lower = username.toLowerCase();
  for (const [key, messages] of dmMessages) {
    const participants = dmParticipants.get(key) || {};
    if (!Object.keys(participants).includes(lower)) continue;
    result[otherName(key, lower)] = messages.slice(-MAX_HISTORY);
  }
  return result;
}

function pushMessage(list, message) {
  list.push(message);
  if (list.length > MAX_HISTORY) list.shift();
}

io.on('connection', (socket) => {
  socket.on('join', (data, reply) => {
    const username = clean(data && data.username, 20);
    if (!username) {
      if (reply) reply({ ok: false, error: 'Please enter a username.' });
      return;
    }

    const existing = byUsername.get(username.toLowerCase());
    if (existing && existing !== socket.id) {
      if (reply) reply({ ok: false, error: 'That username is already in use.' });
      return;
    }

    const profile = {
      username,
      displayName: clean(data.displayName, 24) || username,
      avatar: pick(AVATARS, data.avatar, AVATARS[0]),
      color: pick(COLORS, data.color, COLORS[0]),
      status: pick(STATUSES, data.status, 'online'),
      bio: clean(data.bio, 160),
      joinedAt: Date.now()
    };

    profiles.set(socket.id, profile);
    byUsername.set(username.toLowerCase(), socket.id);

    socket.emit('init', {
      channels: CHANNELS,
      messages: Object.fromEntries(channelMessages),
      conversations: getConversations(username),
      members: getMembers()
    });
    io.emit('members', getMembers());
    if (reply) reply({ ok: true, profile: publicProfile(profile) });
  });

  socket.on('profile:update', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    profile.displayName = clean(data.displayName, 24) || profile.username;
    profile.avatar = pick(AVATARS, data.avatar, profile.avatar);
    profile.color = pick(COLORS, data.color, profile.color);
    profile.status = pick(STATUSES, data.status, profile.status);
    profile.bio = clean(data.bio, 160);

    io.emit('members', getMembers());
    io.emit('profile:updated', publicProfile(profile));
  });

  socket.on('message:send', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile || !channelMessages.has(data.channel)) return;

    const text = clean(data.text, 500);
    if (!text) return;

    const message = {
      id: randomUUID(),
      from: profile.username,
      author: publicProfile(profile),
      text,
      time: Date.now()
    };
    pushMessage(channelMessages.get(data.channel), message);
    io.emit('message:new', { channel: data.channel, message });
  });

  socket.on('dm:send', (data, reply) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const to = clean(data.to, 20);
    const targetId = byUsername.get(to.toLowerCase());
    const text = clean(data.text, 500);
    if (!to || !text) return;
    if (!targetId || targetId === socket.id) {
      if (reply) reply({ ok: false, error: 'That user is not online.' });
      return;
    }

    const key = rememberParticipants(profile.username, to);
    if (!dmMessages.has(key)) dmMessages.set(key, []);
    const message = {
      id: randomUUID(),
      from: profile.username,
      to: to,
      author: publicProfile(profile),
      text,
      time: Date.now()
    };
    pushMessage(dmMessages.get(key), message);
    io.to(targetId).emit('dm:new', message);
    socket.emit('dm:new', message);
    if (reply) reply({ ok: true });
  });

  socket.on('typing', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const payload = {
      scope: data.scope === 'dm' ? 'dm' : 'channel',
      target: clean(data.target, 20),
      user: profile.username,
      isTyping: !!data.isTyping
    };

    if (payload.scope === 'dm') {
      const targetId = byUsername.get(payload.target.toLowerCase());
      if (targetId && targetId !== socket.id) io.to(targetId).emit('typing:update', payload);
      return;
    }
    io.except(socket.id).emit('typing:update', payload);
  });

  socket.on('disconnect', () => {
    const profile = profiles.get(socket.id);
    if (profile && byUsername.get(profile.username.toLowerCase()) === socket.id) {
      byUsername.delete(profile.username.toLowerCase());
    }
    profiles.delete(socket.id);
    io.emit('members', getMembers());
  });
});

server.listen(PORT, () => {
  console.log(`Split Chat is running at http://localhost:${PORT}`);
});
