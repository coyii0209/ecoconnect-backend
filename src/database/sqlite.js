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

// REWARDS TABLE (THIS WAS MISSING)
db.exec(`
CREATE TABLE IF NOT EXISTS rewards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detection_id INTEGER,
  reward_minutes INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// SESSIONS TABLE
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

module.exports = db;