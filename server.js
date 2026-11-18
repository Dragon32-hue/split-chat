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
const SESSION_DAYS = 3650;

const AVATARS = ['👤', '😀', '🎮', '🦊', '🐱', '🌙', '⚡', '🎨', '🚀', '🍕', '👾', '🧙'];
const COLORS = ['#5865f2', '#eb459e', '#57f287', '#fee75c', '#ed4245', '#00b0f4'];
const THEMES = ['midnight', 'charcoal', 'light', 'ocean', 'forest'];
const STATUSES = ['online', 'idle', 'dnd'];
const ALL_PERMISSIONS = ['viewChannels', 'sendMessages', 'manageChannels', 'manageRoles', 'manageServer'];
const DEFAULT_PERMISSIONS = ['viewChannels', 'sendMessages'];
const AVATAR_IMAGE_PATTERN = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

app.use(express.json({ limit: '1mb' }));
app.get('/health', (req, res) => res.status(200).send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

const channelMessages = new Map();
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

function cleanServerIcon(value) {
  const icon = String(value || '').trim();
  if (icon.startsWith('i:')) return clean(icon, 32);
  return cleanAvatarImage(icon) || 'i:globe';
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
    joinedAt: profile.joinedAt,
    theme: pick(THEMES, profile.theme, THEMES[0]),
    accent: pick(COLORS, profile.accent, COLORS[0]),
    compact: !!profile.compact
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
    joinedAt: Date.now(),
    theme: pick(THEMES, data.theme, THEMES[0]),
    accent: pick(COLORS, data.accent, COLORS[0]),
    compact: !!data.compact
  };
}

function updateProfileFields(profile, data) {
  if (data.displayName !== undefined) profile.displayName = clean(data.displayName, 24) || profile.username;
  if (data.avatar !== undefined) profile.avatar = pick(AVATARS, data.avatar, profile.avatar);
  if (data.color !== undefined) profile.color = pick(COLORS, data.color, profile.color);
  if (data.status !== undefined) profile.status = pick(STATUSES, data.status, profile.status);
  if (data.bio !== undefined) profile.bio = clean(data.bio, 160);
  if (data.avatarImage !== undefined) profile.avatarImage = cleanAvatarImage(data.avatarImage);
  if (data.theme !== undefined) profile.theme = pick(THEMES, data.theme, profile.theme || THEMES[0]);
  if (data.accent !== undefined) profile.accent = pick(COLORS, data.accent, profile.accent || COLORS[0]);
  if (data.compact !== undefined) profile.compact = !!data.compact;
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

function findMessage(scope, target, messageId) {
  if (scope === 'channel') {
    const list = channelMessages.get(target);
    const message = list && list.find((item) => item.id === messageId);
    return message ? { message, list } : null;
  }
  for (const [key, list] of dmMessages) {
    const message = list.find((item) => item.id === messageId);
    if (message) return { message, list, key };
  }
  return null;
}

function emitMessageEvent(event, scope, message, payload) {
  if (scope === 'dm') {
    const ids = [
      byUsername.get(message.from.toLowerCase()),
      byUsername.get(message.to.toLowerCase())
    ].filter(Boolean);
    io.to(ids).emit(event, payload);
  } else {
    io.emit(event, payload);
  }
}

async function accessTo(username, serverId, permission) {
  const server = await store.getServerById(serverId);
  if (!server) return { server: null, allowed: false };
  if (server.owner.toLowerCase() === username.toLowerCase()) {
    return { server, allowed: true, owner: true };
  }
  const membership = await store.getMembership(serverId, username);
  if (!membership) return { server, allowed: false };
  const role = await store.getRole(serverId, membership.roleId);
  if (!role) return { server, allowed: false };
  return { server, allowed: role.permissions.includes(permission), role, owner: false };
}

async function broadcastServers() {
  for (const [socketId, profile] of profiles) {
    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('servers:update', await store.getServersFor(profile.username));
  }
}

async function broadcastFriends() {
  for (const [socketId, profile] of profiles) {
    const target = io.sockets.sockets.get(socketId);
    if (target) target.emit('friends:update', await store.getFriends(profile.username));
  }
}

async function sessionProfile(token) {
  if (!token) return null;
  const session = await store.getSession(token);
  if (!session) return null;
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  if (expiresAt - session.expiresAt > 24 * 60 * 60 * 1000) {
    await store.saveSession(token, session.username, expiresAt);
  }
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

app.post('/api/servers/create', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const name = clean(body.name, 32);
    const icon = cleanServerIcon(body.icon);
    if (!name) return res.status(400).json({ error: 'Please enter a server name.' });

    const server = await store.createServer(profile.username, name, icon, ALL_PERMISSIONS, DEFAULT_PERMISSIONS);
    await broadcastServers();
    res.json({ server });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Could not create the server: ${error.message}` });
  }
});

app.post('/api/servers/banner', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const serverId = clean(body.serverId, 40);
    const access = await accessTo(profile.username, serverId, 'manageServer');
    if (!access.server) return res.status(404).json({ error: 'Server not found.' });
    if (!access.allowed) return res.status(403).json({ error: 'You cannot manage this server.' });

    const banner = body.banner === null ? '' : cleanAvatarImage(body.banner);
    await store.setServerBanner(serverId, banner);
    await broadcastServers();
    res.json({ ok: true, banner });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Could not update the banner: ${error.message}` });
  }
});

app.post('/api/servers/join', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const server = await store.joinServer(clean(body.serverId, 40), profile.username);
    if (!server) return res.status(404).json({ error: 'Server not found, or you are already a member.' });

    await broadcastServers();
    res.json({ server });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not join that server.' });
  }
});

app.post('/api/servers/channel', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const serverId = clean(body.serverId, 40);
    const access = await accessTo(profile.username, serverId, 'manageChannels');
    if (!access.server) return res.status(404).json({ error: 'Server not found.' });
    if (!access.allowed) return res.status(403).json({ error: 'You cannot manage channels in this server.' });

    const name = clean(body.name, 24).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '');
    if (!/^[a-z0-9][a-z0-9_-]{0,23}$/.test(name)) {
      return res.status(400).json({ error: 'Use 1-24 lowercase letters, numbers, - or _ for the channel name.' });
    }
    const current = (await store.getServersFor(profile.username)).find((server) => server.id === serverId);
    if (current && current.channels.some((channel) => channel.name === name)) {
      return res.status(409).json({ error: 'That channel already exists.' });
    }

    const channel = await store.createChannel(serverId, name, clean(body.topic, 100));
    await broadcastServers();
    res.json({ channel });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create the channel.' });
  }
});

app.post('/api/servers/role', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const serverId = clean(body.serverId, 40);
    const access = await accessTo(profile.username, serverId, 'manageRoles');
    if (!access.server) return res.status(404).json({ error: 'Server not found.' });
    if (!access.allowed) return res.status(403).json({ error: 'You cannot manage roles in this server.' });

    const name = clean(body.name, 24);
    if (!name) return res.status(400).json({ error: 'Please enter a role name.' });
    const permissions = Array.isArray(body.permissions)
      ? body.permissions.filter((permission) => ALL_PERMISSIONS.includes(permission))
      : [];
    if (!permissions.includes('viewChannels')) permissions.push('viewChannels');

    const role = await store.createRole(serverId, name, pick(COLORS, body.color, COLORS[0]), permissions);
    await broadcastServers();
    res.json({ role });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create the role.' });
  }
});

app.post('/api/servers/assign', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const serverId = clean(body.serverId, 40);
    const access = await accessTo(profile.username, serverId, 'manageRoles');
    if (!access.server) return res.status(404).json({ error: 'Server not found.' });
    if (!access.allowed) return res.status(403).json({ error: 'You cannot assign roles in this server.' });

    const username = clean(body.username, 20);
    if (username.toLowerCase() === access.server.owner.toLowerCase()) {
      return res.status(400).json({ error: "The server owner's role cannot be changed." });
    }
    const membership = await store.getMembership(serverId, username);
    if (!membership) return res.status(404).json({ error: 'That member is not in this server.' });
    const role = await store.getRole(serverId, clean(body.roleId, 40));
    if (!role || role.id === 'owner') return res.status(400).json({ error: 'Choose a valid role.' });

    await store.setMemberRole(serverId, username, role.id);
    await broadcastServers();
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not change that role.' });
  }
});

app.post('/api/friends/request', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const username = clean(body.username, 20);
    if (username.toLowerCase() === profile.username.toLowerCase()) {
      return res.status(400).json({ error: 'You cannot friend yourself.' });
    }
    const sent = await store.sendFriendRequest(profile.username, username);
    if (!sent) return res.status(400).json({ error: 'No user with that name, or a request already exists.' });

    await broadcastFriends();
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not send the friend request.' });
  }
});

app.post('/api/friends/accept', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    const accepted = await store.acceptFriendRequest(profile.username, clean(body.username, 20));
    if (!accepted) return res.status(404).json({ error: 'That friend request was not found.' });

    await broadcastFriends();
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not accept that request.' });
  }
});

app.post('/api/friends/remove', async (req, res) => {
  try {
    const body = req.body || {};
    const profile = await sessionProfile(String(body.token || ''));
    if (!profile) return res.status(401).json({ error: 'Please log in again.' });

    await store.removeFriend(profile.username, clean(body.username, 20));
    await broadcastFriends();
    res.json({ ok: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not remove that friend.' });
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
        const previous = io.sockets.sockets.get(existing);
        if (previous) {
          previous.emit('session:replaced');
          previous.disconnect(true);
        }
        profiles.delete(existing);
        byUsername.delete(profile.username.toLowerCase());
      }

      profiles.set(socket.id, profile);
      byUsername.set(profile.username.toLowerCase(), socket.id);

      const servers = await store.getServersFor(profile.username);
      const friends = await store.getFriends(profile.username);
      socket.emit('init', {
        servers,
        friends,
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

  socket.on('message:send', async (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const channel = await store.getChannel(String(data.channel || ''));
    if (!channel) return;
    const access = await accessTo(profile.username, channel.serverId, 'sendMessages');
    if (!access.allowed) {
      socket.emit('message:error', 'You do not have permission to send messages there.');
      return;
    }

    const text = clean(data.text, 500);
    if (!text) return;

    if (!channelMessages.has(channel.id)) channelMessages.set(channel.id, []);
    const message = {
      id: crypto.randomUUID(),
      from: profile.username,
      author: publicProfile(profile),
      text,
      time: Date.now(),
      reactions: {}
    };
    pushMessage(channelMessages.get(channel.id), message);
    io.emit('message:new', { channel: channel.id, message });
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
    const target = clean(data.target, 64);
    const emoji = clean(data.emoji, 8);
    const messageId = String(data.messageId || '');
    if (!emoji) return;

    const found = findMessage(scope, target, messageId);
    if (!found) return;
    const { message } = found;

    if (!message.reactions) message.reactions = {};
    const users = message.reactions[emoji] || [];
    const index = users.indexOf(profile.username);
    if (index >= 0) users.splice(index, 1);
    else users.push(profile.username);
    if (users.length) message.reactions[emoji] = users;
    else delete message.reactions[emoji];

    const payload = { scope, target, messageId, reactions: message.reactions };
    emitMessageEvent('reaction:update', scope, message, payload);
  });

  socket.on('message:edit', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const scope = data.scope === 'dm' ? 'dm' : 'channel';
    const target = clean(data.target, 64);
    const messageId = String(data.messageId || '');
    const text = clean(data.text, 500);
    if (!text) return;

    const found = findMessage(scope, target, messageId);
    if (!found || found.message.from !== profile.username) {
      socket.emit('message:error', 'You can only edit your own messages.');
      return;
    }

    found.message.text = text;
    found.message.edited = Date.now();
    const payload = { scope, target, messageId, text, edited: found.message.edited };
    emitMessageEvent('message:update', scope, found.message, payload);
  });

  socket.on('message:delete', (data) => {
    const profile = profiles.get(socket.id);
    if (!profile) return;

    const scope = data.scope === 'dm' ? 'dm' : 'channel';
    const target = clean(data.target, 64);
    const messageId = String(data.messageId || '');

    const found = findMessage(scope, target, messageId);
    if (!found || found.message.from !== profile.username) {
      socket.emit('message:error', 'You can only delete your own messages.');
      return;
    }

    const index = found.list.indexOf(found.message);
    if (index >= 0) found.list.splice(index, 1);
    const payload = { scope, target, messageId };
    emitMessageEvent('message:deleted', scope, found.message, payload);
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
