const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

let pool = null;
let fileData = { accounts: {}, sessions: {} };

async function init() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
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
    return;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    try {
      fileData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (error) {
      fileData = { accounts: {}, sessions: {} };
    }
  }
  if (!fileData.accounts) fileData.accounts = {};
  if (!fileData.sessions) fileData.sessions = {};
}

function saveFile() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(fileData));
}

function normalizeProfile(profile) {
  return typeof profile === 'string' ? JSON.parse(profile) : profile;
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

module.exports = { init, getAccount, saveAccount, getSession, saveSession, deleteSession };
