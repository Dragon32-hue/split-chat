const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

let pool = null;
let fileData = { accounts: {}, sessions: {}, servers: {}, memberships: [], roles: [], channels: [], friends: [] };

function normalizeDatabaseUrl(value) {
  let url = String(value || '').trim();
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    url = url.slice(1, -1).trim();
  }
  if (url && !/^postgres(?:ql)?:\/\//i.test(url) && url.includes('.pooler.supabase.com')) {
    url = `postgresql://${url}`;
  }
  return url;
}

async function init() {
  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  if (databaseUrl) {
    const schemeEnd = databaseUrl.indexOf('://') + 3;
    const at = databaseUrl.lastIndexOf('@');
    const masked = at > schemeEnd
      ? `${databaseUrl.slice(0, schemeEnd)}***${databaseUrl.slice(at)}`
      : databaseUrl;
    console.log('DATABASE_URL diagnostics:', JSON.stringify({
      scheme: /^postgres(?:ql)?:\/\//i.test(databaseUrl),
      length: databaseUrl.length,
      hasAt: databaseUrl.includes('@'),
      hasPort: /:5432\b/.test(databaseUrl) || /:6543\b/.test(databaseUrl),
      placeholder: databaseUrl.includes('[YOUR'),
      masked,
      whitespace: /\s/.test(databaseUrl),
      hash: databaseUrl.includes('#'),
      percent: databaseUrl.includes('%'),
      question: databaseUrl.includes('?'),
      ampersand: databaseUrl.includes('&')
    }));
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      throw new Error('DATABASE_URL must start with postgresql://');
    }
    if (databaseUrl.includes('[YOUR')) {
      throw new Error('DATABASE_URL still contains a placeholder. Replace it with your real database password.');
    }

    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: databaseUrl,
      ssl: { rejectUnauthorized: false }
    });
    await pool.query(`CREATE TABLE IF NOT EXISTS accounts (
      username TEXT PRIMARY KEY,
      salt TEXT NOT NULL,
      hash TEXT NOT NULL,
      profile JSONB NOT NULL,
      created_at BIGINT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      icon TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS server_members (
      server_id TEXT NOT NULL,
      username TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY (server_id, username)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS roles (
      server_id TEXT NOT NULL,
      id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      permissions JSONB NOT NULL,
      PRIMARY KEY (server_id, id)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS channels (
      id TEXT PRIMARY KEY,
      server_id TEXT NOT NULL,
      name TEXT NOT NULL,
      topic TEXT NOT NULL
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS friends (
      user TEXT NOT NULL,
      friend TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at BIGINT NOT NULL,
      PRIMARY KEY (user, friend)
    )`);
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    try {
      fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
      fileData = { accounts: {}, sessions: {}, servers: {}, memberships: [], roles: [], channels: [], friends: [] };
    }
  }
  if (!fileData.accounts) fileData.accounts = {};
  if (!fileData.sessions) fileData.sessions = {};
  if (!fileData.servers) fileData.servers = {};
  if (!fileData.memberships) fileData.memberships = [];
  if (!fileData.roles) fileData.roles = [];
  if (!fileData.channels) fileData.channels = [];
  if (!fileData.friends) fileData.friends = [];
}

function saveFile() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(fileData));
}

function normalizeProfile(profile) {
  return typeof profile === 'string' ? JSON.parse(profile) : profile;
}

function normalizePermissions(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function mapServer(row) {
  return { id: row.id, name: row.name, owner: row.owner, icon: row.icon, createdAt: Number(row.created_at) };
}

function mapChannel(row) {
  return { id: row.id, serverId: row.server_id, name: row.name, topic: row.topic };
}

function mapRole(row) {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    color: row.color,
    permissions: normalizePermissions(row.permissions)
  };
}

async function getAccount(username) {
  const key = username.toLowerCase();
  if (pool) {
    const result = await pool.query('SELECT * FROM accounts WHERE username = $1', [key]);
    if (!result.rows[0]) return null;
    const row = result.rows[0];
    return {
      username: row.username,
      salt: row.salt,
      hash: row.hash,
      profile: normalizeProfile(row.profile),
      createdAt: row.created_at
    };
  }
  return fileData.accounts[key] || null;
}

async function saveAccount(account) {
  const key = account.username.toLowerCase();
  if (pool) {
    await pool.query(
      `INSERT INTO accounts (username, salt, hash, profile, created_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO UPDATE SET salt = $2, hash = $3, profile = $4, created_at = $5`,
      [key, account.salt, account.hash, JSON.stringify(account.profile), account.createdAt]
    );
    return;
  }
  fileData.accounts[key] = account;
  saveFile();
}

async function getSession(token) {
  if (pool) {
    const result = await pool.query('SELECT * FROM sessions WHERE token = $1', [token]);
    const row = result.rows[0];
    if (!row || Number(row.expires_at) < Date.now()) return null;
    return { username: row.username, expiresAt: Number(row.expires_at) };
  }
  const session = fileData.sessions[token];
  if (!session || session.expiresAt < Date.now()) return null;
  return session;
}

async function saveSession(token, username, expiresAt) {
  if (pool) {
    await pool.query(
      `INSERT INTO sessions (token, username, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET username = $2, expires_at = $3`,
      [token, username.toLowerCase(), expiresAt]
    );
    return;
  }
  fileData.sessions[token] = { username: username.toLowerCase(), expiresAt };
  saveFile();
}

async function deleteSession(token) {
  if (pool) {
    await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
    return;
  }
  delete fileData.sessions[token];
  saveFile();
}

async function getServerById(serverId) {
  if (pool) {
    const result = await pool.query('SELECT * FROM servers WHERE id = $1', [serverId]);
    return result.rows[0] ? mapServer(result.rows[0]) : null;
  }
  const server = fileData.servers[serverId];
  return server ? { ...server, createdAt: Number(server.createdAt) } : null;
}

async function getMembership(serverId, username) {
  const key = username.toLowerCase();
  if (pool) {
    const result = await pool.query(
      'SELECT role_id FROM server_members WHERE server_id = $1 AND username = $2',
      [serverId, key]
    );
    return result.rows[0] ? { serverId, username: key, roleId: result.rows[0].role_id } : null;
  }
  return fileData.memberships.find((item) => item.serverId === serverId && item.username === key) || null;
}

async function getServersFor(username) {
  const key = username.toLowerCase();
  let servers = [];

  if (pool) {
    const memberResult = await pool.query(
      'SELECT server_id, role_id FROM server_members WHERE username = $1',
      [key]
    );
    for (const membership of memberResult.rows) {
      const server = await getServerById(membership.server_id);
      if (!server) continue;
      const [channels, roles, members] = await Promise.all([
        pool.query('SELECT * FROM channels WHERE server_id = $1 ORDER BY name', [server.id]),
        pool.query('SELECT * FROM roles WHERE server_id = $1 ORDER BY name', [server.id]),
        pool.query('SELECT username, role_id FROM server_members WHERE server_id = $1', [server.id])
      ]);
      servers.push({
        ...server,
        myRoleId: membership.role_id,
        channels: channels.rows.map(mapChannel),
        roles: roles.rows.map(mapRole),
        members: members.rows.map((row) => ({ username: row.username, roleId: row.role_id }))
      });
    }
    return servers;
  }

  fileData.memberships.filter((item) => item.username === key).forEach((membership) => {
    const server = fileData.servers[membership.serverId];
    if (!server) return;
    servers.push({
      ...server,
      createdAt: Number(server.createdAt),
      myRoleId: membership.roleId,
      channels: fileData.channels.filter((channel) => channel.serverId === server.id),
      roles: fileData.roles.filter((role) => role.serverId === server.id),
      members: fileData.memberships
        .filter((item) => item.serverId === server.id)
        .map((item) => ({ username: item.username, roleId: item.roleId }))
    });
  });
  return servers;
}

async function createServer(username, name, icon, allPermissions, memberPermissions) {
  const key = username.toLowerCase();
  const serverId = crypto.randomUUID();
  const channelId = crypto.randomUUID();
  const server = { id: serverId, name, icon, owner: key, createdAt: Date.now() };
  const ownerRole = { id: 'owner', serverId, name: 'Owner', color: '#fee75c', permissions: allPermissions };
  const memberRole = { id: 'member', serverId, name: 'Member', color: '#5865f2', permissions: memberPermissions };
  const channel = { id: channelId, serverId, name: 'general', topic: 'Welcome to your server.' };

  if (pool) {
    await pool.query('INSERT INTO servers (id, name, owner, icon, created_at) VALUES ($1,$2,$3,$4,$5)',
      [serverId, name, key, icon, server.createdAt]);
    await pool.query('INSERT INTO roles (server_id, id, name, color, permissions) VALUES ($1,$2,$3,$4,$5)',
      [serverId, 'owner', ownerRole.name, ownerRole.color, JSON.stringify(allPermissions)]);
    await pool.query('INSERT INTO roles (server_id, id, name, color, permissions) VALUES ($1,$2,$3,$4,$5)',
      [serverId, 'member', memberRole.name, memberRole.color, JSON.stringify(memberPermissions)]);
    await pool.query('INSERT INTO server_members (server_id, username, role_id) VALUES ($1,$2,$3)',
      [serverId, key, 'owner']);
    await pool.query('INSERT INTO channels (id, server_id, name, topic) VALUES ($1,$2,$3,$4)',
      [channelId, serverId, channel.name, channel.topic]);
    return (await getServersFor(key)).find((item) => item.id === serverId);
  }

  fileData.servers[serverId] = server;
  fileData.roles.push(ownerRole, memberRole);
  fileData.memberships.push({ serverId, username: key, roleId: 'owner' });
  fileData.channels.push(channel);
  saveFile();
  return (await getServersFor(key)).find((item) => item.id === serverId);
}

async function joinServer(serverId, username) {
  const key = username.toLowerCase();
  const server = await getServerById(serverId);
  if (!server || await getMembership(serverId, key)) return null;

  if (pool) {
    await pool.query('INSERT INTO server_members (server_id, username, role_id) VALUES ($1,$2,$3)',
      [serverId, key, 'member']);
  } else {
    fileData.memberships.push({ serverId, username: key, roleId: 'member' });
    saveFile();
  }
  return (await getServersFor(key)).find((item) => item.id === serverId);
}

async function getChannel(channelId) {
  if (pool) {
    const result = await pool.query('SELECT * FROM channels WHERE id = $1', [channelId]);
    return result.rows[0] ? mapChannel(result.rows[0]) : null;
  }
  const channel = fileData.channels.find((item) => item.id === channelId);
  return channel ? { ...channel } : null;
}

async function createChannel(serverId, name, topic) {
  const channel = { id: crypto.randomUUID(), serverId, name, topic };
  if (pool) {
    await pool.query('INSERT INTO channels (id, server_id, name, topic) VALUES ($1,$2,$3,$4)',
      [channel.id, serverId, name, topic]);
  } else {
    fileData.channels.push(channel);
    saveFile();
  }
  return channel;
}

async function getRole(serverId, roleId) {
  if (pool) {
    const result = await pool.query('SELECT * FROM roles WHERE server_id = $1 AND id = $2', [serverId, roleId]);
    return result.rows[0] ? mapRole(result.rows[0]) : null;
  }
  const role = fileData.roles.find((item) => item.serverId === serverId && item.id === roleId);
  return role ? { ...role, permissions: [...role.permissions] } : null;
}

async function createRole(serverId, name, color, permissions) {
  const role = { id: crypto.randomUUID(), serverId, name, color, permissions };
  if (pool) {
    await pool.query('INSERT INTO roles (server_id, id, name, color, permissions) VALUES ($1,$2,$3,$4,$5)',
      [serverId, role.id, name, color, JSON.stringify(permissions)]);
  } else {
    fileData.roles.push(role);
    saveFile();
  }
  return role;
}

async function setMemberRole(serverId, username, roleId) {
  const key = username.toLowerCase();
  if (pool) {
    await pool.query('UPDATE server_members SET role_id = $1 WHERE server_id = $2 AND username = $3',
      [roleId, serverId, key]);
  } else {
    const membership = fileData.memberships.find((item) => item.serverId === serverId && item.username === key);
    if (membership) membership.roleId = roleId;
    saveFile();
  }
  return getMembership(serverId, key);
}

async function getFriends(username) {
  const key = username.toLowerCase();
  let rows;
  if (pool) {
    const result = await pool.query(
      'SELECT user, friend, status FROM friends WHERE user = $1 OR friend = $1',
      [key]
    );
    rows = result.rows;
  } else {
    rows = fileData.friends.filter((item) => item.user === key || item.friend === key);
  }
  return rows.map((row) => {
    const incoming = row.user.toLowerCase() !== key;
    let direction = 'accepted';
    if (row.status === 'pending') direction = incoming ? 'incoming' : 'outgoing';
    return { username: incoming ? row.user : row.friend, status: row.status, direction };
  });
}

async function sendFriendRequest(from, to) {
  const user = from.toLowerCase();
  const friend = to.toLowerCase();
  if (user === friend) return false;
  if (!await getAccount(friend)) return false;

  const existing = fileData.friends.find((item) =>
    (item.user === user && item.friend === friend) || (item.user === friend && item.friend === user));
  if (!pool && existing) return false;
  if (pool) {
    const found = await pool.query(
      'SELECT 1 FROM friends WHERE (user = $1 AND friend = $2) OR (user = $2 AND friend = $1)',
      [user, friend]
    );
    if (found.rows.length) return false;
    await pool.query(
      'INSERT INTO friends (user, friend, status, created_at) VALUES ($1,$2,$3,$4)',
      [user, friend, 'pending', Date.now()]
    );
  } else {
    fileData.friends.push({ user, friend, status: 'pending', createdAt: Date.now() });
    saveFile();
  }
  return true;
}

async function acceptFriendRequest(owner, requester) {
  const user = owner.toLowerCase();
  const friend = requester.toLowerCase();
  if (pool) {
    const result = await pool.query(
      "UPDATE friends SET status = 'accepted' WHERE user = $1 AND friend = $2 AND status = 'pending'",
      [friend, user]
    );
    if (!result.rowCount) return false;
    await pool.query(
      `INSERT INTO friends (user, friend, status, created_at) VALUES ($1,$2,'accepted',$3)
       ON CONFLICT (user, friend) DO UPDATE SET status = 'accepted'`,
      [user, friend, Date.now()]
    );
  } else {
    const row = fileData.friends.find((item) =>
      item.user === friend && item.friend === user && item.status === 'pending');
    if (!row) return false;
    row.status = 'accepted';
    const reciprocal = fileData.friends.find((item) => item.user === user && item.friend === friend);
    if (reciprocal) reciprocal.status = 'accepted';
    else fileData.friends.push({ user, friend, status: 'accepted', createdAt: Date.now() });
    saveFile();
  }
  return true;
}

async function removeFriend(username, other) {
  const user = username.toLowerCase();
  const friend = other.toLowerCase();
  if (pool) {
    await pool.query(
      'DELETE FROM friends WHERE (user = $1 AND friend = $2) OR (user = $2 AND friend = $1)',
      [user, friend]
    );
  } else {
    fileData.friends = fileData.friends.filter((item) =>
      !((item.user === user && item.friend === friend) || (item.user === friend && item.friend === user)));
    saveFile();
  }
  return true;
}

module.exports = {
  init,
  getAccount,
  saveAccount,
  getSession,
  saveSession,
  deleteSession,
  getServerById,
  getMembership,
  getServersFor,
  createServer,
  joinServer,
  getChannel,
  createChannel,
  getRole,
  createRole,
  setMemberRole,
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend
};
