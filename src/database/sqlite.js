const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
  path.join(__dirname, "../../storage/ecoconnect.db")
);

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

module.exports = db;