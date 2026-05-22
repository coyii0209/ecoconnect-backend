const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dbPath = path.join(__dirname, "../../storage/ecoconnect.db");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({
        lastInsertRowid: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function exec(sql) {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

async function transaction(work) {
  await run("BEGIN IMMEDIATE TRANSACTION");
  try {
    const result = await work();
    await run("COMMIT");
    return result;
  } catch (err) {
    try {
      await run("ROLLBACK");
    } catch {
      // Ignore rollback failures; preserve original error.
    }
    throw err;
  }
}

let initPromise;

async function initialize() {
  await exec(`
CREATE TABLE IF NOT EXISTS detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  confidence REAL,
  created_at TEXT
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detection_id INTEGER,
  reward_minutes INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_token TEXT NOT NULL UNIQUE,
    client_mac TEXT,
    client_ip TEXT,
    status TEXT DEFAULT 'PENDING',
    credits INTEGER DEFAULT 0,
    started_at DATETIME,
    ended_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

  try {
    const columns = await all("PRAGMA table_info(sessions)");
    const hasEndedAt = columns.some((col) => col.name === "ended_at");

    if (!hasEndedAt) {
      await exec(`
        ALTER TABLE sessions
        ADD COLUMN ended_at DATETIME
      `);
      console.log("[DB] Migrated: Added ended_at column to sessions table");
    }
  } catch (err) {
    console.error("[DB] Migration error:", err.message);
  }

  await exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_session_token
  ON sessions (session_token);

  CREATE INDEX IF NOT EXISTS idx_sessions_client_mac
  ON sessions (client_mac);

  CREATE INDEX IF NOT EXISTS idx_sessions_created_at
  ON sessions (created_at);
`);

  await exec(`
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    type TEXT,
    amount INTEGER,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (session_id)
    REFERENCES sessions(id)
);
`);

  await exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON transactions (created_at);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE NOT NULL,
  hotspot_enabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS hotspot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_mac TEXT,
  action TEXT,
  duration_minutes INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS access_control (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE,
  status TEXT DEFAULT 'blocked',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  camera_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

  await exec(`
CREATE TABLE IF NOT EXISTS reject_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  camera_id TEXT,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
}

function ready() {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

module.exports = {
  run,
  get,
  all,
  exec,
  transaction,
  ready,
};