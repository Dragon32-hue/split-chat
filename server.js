const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const store = require('./store');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 100;
const SESSION_DAYS = 7;

const AVATARS = ['👤', '😀', '🎮', '🦊', '🐱', '🌙', '⚡', '🎨', '🚀', '🍕', '👾', '🧙'];
const COLORS = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#00b0f4'];
const STATUSES = ['online', 'idle', 'dnd'];
const CHANNELS = [
  { id: 'general', name: 'general', topic: 'Talk about anything.' },
  { id: 'random', name: 'random', topic: 'Off-topic, memes and fun.' },
  { id: 'lounge', name: 'lounge', topic: 'Just hang out.' }
];
const AVATAR_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

app.use(express.json({ limit: '1mb' }));
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

function cleanAvatarImage(value) {
  const image = String(value || '');
  if (image.length > 120000 || !AVATAR_IMAGE_PATTERN.test(image)) return '';
  return image;
}

function publicProfile(profile) {
  return {
    username: profile.username,
    displayName: profile.displayName,
    avatar: profile.avatar,
    color: profile.color,
    status: profile.status,
    bio: profile.bio,
    avatarImage: profile.avatarImage || '',
    joinedAt: profile.joinedAt
  };
}

function buildProfile(username, data) {
  return {
    username,
    displayName: clean(data.displayName, 24) || username,
    avatar: pick(AVATARS, data.avatar, AVATARS[0]),
    color: pick(COLORS, data.color, COLORS[0]),
    status: pick(STATUSES, data.status, 'online'),
    bio: clean(data.bio, 160),
    avatarImage: cleanAvatarImage(data.avatarImage),
    joinedAt: Date.now()
  };
}

function updateProfileFields(profile, data) {
  profile.displayName = clean(data.displayName, 24) || profile.username;
  profile.avatar = pick(AVATARS, data.avatar, profile.avatar);
  profile.color = pick(COLORS, data.color, profile.color);
  profile.status = pick(STATUSES, data.status, profile.status);
  profile.bio = clean(data.bio, 160);
  if (data.avatarImage !== undefined) profile.avatarImage = cleanAvatarImage(data.avatarImage);
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

async function sessionProfile(token) {
  if (!token) return null;
  const session = await store.getSession(token);
  if (!session) return null;
  const account = await store.getAccount(session.username);
  return account ? publicProfile(account.profile) : null;
}

function broadcastProfile(profile) {
  for (const [id, current] of profiles) {
    if (current.username === profile.username) profiles.set(id, profile);
  }
  io.emit('members', getMembers());
  io.emit('profile:updated', profile);
}

app.post('/api/register', async (req, res) => {
  try {
    const body = req.body || {};
    const username = clean(body.username, 20);
    const password = String(body.password || '');
    if (!/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-20 letters, numbers, _ or -.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (await store.getAccount(username)) {
      return res.status(409).json({ error: 'That username is already taken.' });
    }

    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    const profile = buildProfile(username, body);
    await store.saveAccount({
      username: username.toLowerCase(),
      salt,
      hash,
      profile,
      createdAt: profile.joinedAt
    });

    const token = crypto.randomBytes(32).toString('hex');
    await store.saveSession(token, username, Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    res.json({ token, profile: publicProfile(profile) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const body = req.body || {};
    const username = clean(body.username, 20);
    const password = String(body.password || '');
    const account = await store.getAccount(username);
    if (!account) return res.status(401).json({ error: 'Wrong username or password.' });

    const candidate = crypto.scryptSync(password, account.salt, 64);
    const stored = Buffer.from(account.hash, 'hex');
    if (stored.length !== candidate.length || !crypto.timingSafeEqual(stored, candidate)) {
      return res.status(401).json({ error: 'Wrong username or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    await store.saveSession(token, username, Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    res.json({ token, profile: publicProfile(account.profile) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/profile', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const account = await store.getAccount(profile.username);
    if (!account) return res.status(401).json({ error: 'Please log in again.' });

    updateProfileFields(account.profile, body.profile || {});
    await store.saveAccount(account);
    const updated = publicProfile(account.profile);
    broadcastProfile(updated);
    res.json({ profile: updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    await store.deleteSession(String((req.body || {}).token || ''));
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

io.on('connection', (socket) => {
  socket.on('join', async (data, reply) => {
    try {
      const profile = await sessionProfile(String(data && data.token || ''));
      if (!profile) {
        if (reply) reply({ ok: false, error: 'Your session expired. Please log in again.', expired: true });
        socket.emit('auth:expired');
        return;
      }

      const existing = byUsername.get(profile.username.toLowerCase());
      if (existing && existing !== socket.id) {
        if (reply) reply({ ok: false, error: 'This account is already connected in another tab.' });
        return;
      }

      profiles.set(socket.id, profile);
      byUsername.set(profile.username.toLowerCase(), socket.id);

      socket.emit('init', {
        channels: CHANNELS,
        messages: Object.fromEntries(channelMessages),
        conversations: getConversations(profile.username),
        members: getMembers()
      });
      io.emit('members', getMembers());
      if (reply) reply({ ok: true, profile });
    } catch (error) {
      console.error(error);
      if (reply) reply({ ok: false, error: 'Could not join. Please try again.' });
    }
  });

  socket.on('message:send', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile || !channelMessages.has(data.channel)) return;

    const text = clean(data.text, 500);
    if (!text) return;

    const message = {
      id: crypto.randomUUID(),
      from: profile.username,
      author: publicProfile(profile),
      text,
      time: Date.now(),
      reactions: {}
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
      id: crypto.randomUUID(),
      from: profile.username,
      to,
      author: publicProfile(profile),
      text,
      time: Date.now(),
      reactions: {}
    };
    pushMessage(dmMessages.get(key), message);
    io.to(targetId).emit('dm:new', message);
    socket.emit('dm:new', message);
    if (reply) reply({ ok: true });
  });

  socket.on('reaction:add', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const scope = data.scope === 'dm' ? 'dm' : 'channel';
    const target = clean(data.target, 20);
    const emoji = clean(data.emoji, 8);
    const messageId = String(data.messageId || '');
    if (!emoji) return;

    let message = null;
    if (scope === 'channel') {
      const list = channelMessages.get(target);
      if (list) message = list.find((item) => item.id === messageId);
    } else {
      for (const list of dmMessages.values()) {
        const found = list.find((item) => item.id === messageId);
        if (found) {
          message = found;
          break;
        }
      }
    }
    if (!message) return;

    if (!message.reactions) message.reactions = {};
    const users = message.reactions[emoji] || [];
    const index = users.indexOf(profile.username);
    if (index >= 0) users.splice(index, 1);
    else users.push(profile.username);
    if (users.length) message.reactions[emoji] = users;
    else delete message.reactions[emoji];

    const payload = { scope, target, messageId, reactions: message.reactions };
    if (scope === 'dm') {
      const ids = [
        byUsername.get(message.from.toLowerCase()),
        byUsername.get(message.to.toLowerCase())
      ].filter(Boolean);
      io.to(ids).emit('reaction:update', payload);
    } else {
      io.emit('reaction:update', payload);
    }
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

store.init().then(() => {
  server.listen(PORT, () => {
    console.log(`Split Chat is running at http://localhost:${PORT}`);
  });
}).catch((error) => {
  console.error('Failed to start:', error);
  process.exit(1);
});
