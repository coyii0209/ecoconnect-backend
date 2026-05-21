const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = path.join(__dirname, "../../storage/ecoconnect.db");
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);

// DETECTIONS TABLE
db.exec(`
CREATE TABLE IF NOT EXISTS detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT,
  confidence REAL,
  created_at TEXT
);
`);

// REWARDS TABLE
db.exec(`
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detection_id INTEGER,
  reward_minutes INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// SESSIONS TABLE (remote schema preserved)
db.exec(`
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

// MIGRATION: Add ended_at column if it doesn't exist
try {
  const checkColumn = db.prepare(`
    PRAGMA table_info(sessions)
  `).all();
  
  const hasEndedAt = checkColumn.some(col => col.name === 'ended_at');
  
  if (!hasEndedAt) {
    db.exec(`
      ALTER TABLE sessions 
      ADD COLUMN ended_at DATETIME
    `);
    console.log('[DB] Migrated: Added ended_at column to sessions table');
  }
} catch (err) {
  console.error('[DB] Migration error:', err.message);
}

// SESSION INDEXES
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_sessions_session_token 
  ON sessions (session_token);

  CREATE INDEX IF NOT EXISTS idx_sessions_client_mac 
  ON sessions (client_mac);

  CREATE INDEX IF NOT EXISTS idx_sessions_created_at 
  ON sessions (created_at);
`);

// TRANSACTIONS TABLE
db.exec(`
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

// TRANSACTIONS INDEXES
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_transactions_created_at 
  ON transactions (created_at);
`);

// SCHEMA VERSION (for migrations)
db.exec(`
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// DEVICES TABLE (tracks hotspot-capable devices)
db.exec(`
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE NOT NULL,
  hotspot_enabled INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// HOTSPOT EVENTS TABLE (logs access grants/revokes)
db.exec(`
CREATE TABLE IF NOT EXISTS hotspot_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_mac TEXT,
  action TEXT,
  duration_minutes INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`);

// Additional local tables (preserve user's changes)
db.exec(`
CREATE TABLE IF NOT EXISTS access_control (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_address TEXT UNIQUE,
  status TEXT DEFAULT 'blocked',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS processed_events (
  event_id TEXT PRIMARY KEY,
  camera_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS reject_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT,
  camera_id TEXT,
  reason TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

module.exports = db;