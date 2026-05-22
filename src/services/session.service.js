const db = require("../database/sqlite");
const { parseDbTimestamp } = require("../utils/time");
const hotspot = require("./hotspot.service");

// -------------------------
// OPEN SESSION
// -------------------------
function openSession(clientMac) {
  const existing = db.prepare(`
    SELECT session_token
    FROM sessions
    WHERE client_mac = ? AND status = 'ACTIVE'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(clientMac);

  if (existing?.session_token) {
    const existingSession = getSession(existing.session_token);
    if (existingSession?.status === "ACTIVE") {
      return existingSession;
    }
  }

  const sessionToken = generateToken();

  db.prepare(`
    INSERT INTO sessions (
      session_token,
      client_mac,
      status,
      credits,
      started_at
    ) VALUES (?, ?, 'ACTIVE', 0, CURRENT_TIMESTAMP)
  `).run(sessionToken, clientMac);

  return getSession(sessionToken);
}

// -------------------------
// GET SESSION (SOURCE OF TRUTH)
// -------------------------
function getSession(sessionToken) {
  const session = db.prepare(`
    SELECT * FROM sessions
    WHERE session_token = ?
  `).get(sessionToken);

  if (!session) return null;

  const now = Date.now();

  const started = parseDbTimestamp(session.started_at);
  if (!Number.isFinite(started)) {
    return {
      ...session,
      remaining: session.credits,
      isActive: session.status === "ACTIVE" && session.credits > 0,
    };
  }

  const elapsed = Math.floor((now - started) / 1000);

  const remaining = Math.max(0, session.credits - elapsed);

  console.log(`Session ${sessionToken}: started at ${started}, elapsed ${elapsed}s, remaining ${remaining}s`);

  // Auto-expire: write back to DB so status reflects reality
  if (remaining === 0 && session.status === "ACTIVE" && session.credits > 0) {
    db.prepare(`
      UPDATE sessions
      SET status = 'EXPIRED', credits = 0, ended_at = CURRENT_TIMESTAMP
      WHERE session_token = ?
    `).run(sessionToken);

    return {
      ...session,
      status: "EXPIRED",
      credits: 0,
      remaining: 0,
      isActive: false
    };
  }

  return {
    ...session,
    remaining,
    isActive: session.status === "ACTIVE" && remaining > 0
  };
}

// -------------------------
// CREDIT SESSION (TOP-UP ONLY)
// -------------------------
function creditSession(sessionToken, seconds) {
  const tx = db.transaction(() => {
    const session = db.prepare(`
      SELECT * FROM sessions WHERE session_token = ?
    `).get(sessionToken);

    if (!session) throw new Error("Session not found");

    const newCredits = session.credits + seconds;

    db.prepare(`
      UPDATE sessions
      SET credits = ?
      WHERE session_token = ?
    `).run(newCredits, sessionToken);

    db.prepare(`
      INSERT INTO transactions (
        session_id,
        type,
        amount,
        metadata
      ) VALUES (?, 'CREDIT', ?, ?)
    `).run(
      session.id,
      seconds,
      JSON.stringify({ source: "bottle" })
    );

    // Wire hotspot integration: extend or create access
    if (session.client_mac) {
      const device = db.prepare(`
        SELECT * FROM devices WHERE mac_address = ?
      `).get(session.client_mac);

      if (device && device.hotspot_enabled) {
        // Device exists and is enabled: extend access
        hotspot.extendAccess(session.client_mac, Math.ceil(seconds / 60));
        db.prepare(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'EXTEND', ?)
        `).run(session.client_mac, Math.ceil(seconds / 60));
      } else {
        // First time: create access
        hotspot.createAccess(session.client_mac, Math.ceil(seconds / 60));
        if (!device) {
          db.prepare(`
            INSERT INTO devices (mac_address, hotspot_enabled)
            VALUES (?, 1)
          `).run(session.client_mac);
        }
        db.prepare(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'CREATE', ?)
        `).run(session.client_mac, Math.ceil(seconds / 60));
      }
    }
  });

  tx();
}

// -------------------------
// CONSUME SESSION (ADMIN ONLY)
// -------------------------
// NOTE: NOT USED FOR REAL-TIME BILLING IN MODEL 1
function consumeSession(sessionToken, seconds) {
  const tx = db.transaction(() => {
    const session = db.prepare(`
      SELECT * FROM sessions WHERE session_token = ?
    `).get(sessionToken);

    if (!session) throw new Error("Session not found");

    const newCredits = Math.max(0, session.credits - seconds);

    db.prepare(`
      UPDATE sessions
      SET credits = ?
      WHERE session_token = ?
    `).run(newCredits, sessionToken);

    db.prepare(`
      INSERT INTO transactions (
        session_id,
        type,
        amount,
        metadata
      ) VALUES (?, 'CONSUME', ?, ?)
    `).run(
      session.id,
      seconds,
      JSON.stringify({ reason: "manual_adjustment" })
    );
  });

  tx();
}

// -------------------------
// CLOSE SESSION
// -------------------------
function closeSession(sessionToken) {
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE sessions
      SET status = 'EXPIRED',
          ended_at = CURRENT_TIMESTAMP
      WHERE session_token = ?
    `).run(sessionToken);
  });

  tx();
}

// -------------------------
// TOKEN GENERATOR
// -------------------------
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now();
}

// -------------------------
// EXPORTS
// -------------------------
module.exports = {
  openSession,
  creditSession,
  consumeSession,
  closeSession,
  getSession,
};