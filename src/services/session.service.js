const db = require("../database/sqlite");
const { parseDbTimestamp } = require("../utils/time");
const hotspot = require("./hotspot.service");

// -------------------------
// OPEN SESSION
// -------------------------
async function openSession(clientMac) {
  await db.ready();

  const existing = await db.get(`
    SELECT session_token
    FROM sessions
    WHERE client_mac = ? AND status = 'ACTIVE'
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `, [clientMac]);

  if (existing?.session_token) {
    const existingSession = await getSession(existing.session_token);
    if (existingSession?.status === "ACTIVE") {
      return existingSession;
    }
  }

  const sessionToken = generateToken();

  await db.run(`
    INSERT INTO sessions (
      session_token,
      client_mac,
      status,
      credits,
      started_at
    ) VALUES (?, ?, 'ACTIVE', 0, CURRENT_TIMESTAMP)
  `, [sessionToken, clientMac]);

  return await getSession(sessionToken);
}

// -------------------------
// GET SESSION (SOURCE OF TRUTH)
// -------------------------
async function getSession(sessionToken) {
  await db.ready();

  const session = await db.get(`
    SELECT * FROM sessions
    WHERE session_token = ?
  `, [sessionToken]);

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
    await db.run(`
      UPDATE sessions
      SET status = 'EXPIRED', credits = 0, ended_at = CURRENT_TIMESTAMP
      WHERE session_token = ?
    `, [sessionToken]);

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
async function creditSession(sessionToken, seconds) {
  await db.ready();

  await db.transaction(async () => {
    const session = await db.get(`
      SELECT * FROM sessions WHERE session_token = ?
    `, [sessionToken]);

    if (!session) throw new Error("Session not found");

    const newCredits = session.credits + seconds;

    await db.run(`
      UPDATE sessions
      SET credits = ?
      WHERE session_token = ?
    `, [newCredits, sessionToken]);

    await db.run(`
      INSERT INTO transactions (
        session_id,
        type,
        amount,
        metadata
      ) VALUES (?, 'CREDIT', ?, ?)
    `, [session.id, seconds, JSON.stringify({ source: "bottle" })]);

    // Wire hotspot integration: extend or create access
    if (session.client_mac) {
      const device = await db.get(`
        SELECT * FROM devices WHERE mac_address = ?
      `, [session.client_mac]);

      if (device && device.hotspot_enabled) {
        // Device exists and is enabled: extend access
        hotspot.extendAccess(session.client_mac, Math.ceil(seconds / 60));
        await db.run(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'EXTEND', ?)
        `, [session.client_mac, Math.ceil(seconds / 60)]);
      } else {
        // First time: create access
        hotspot.createAccess(session.client_mac, Math.ceil(seconds / 60));
        if (!device) {
          await db.run(`
            INSERT INTO devices (mac_address, hotspot_enabled)
            VALUES (?, 1)
          `, [session.client_mac]);
        }
        await db.run(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'CREATE', ?)
        `, [session.client_mac, Math.ceil(seconds / 60)]);
      }
    }
  });
}

// -------------------------
// CONSUME SESSION (ADMIN ONLY)
// -------------------------
// NOTE: NOT USED FOR REAL-TIME BILLING IN MODEL 1
async function consumeSession(sessionToken, seconds) {
  await db.ready();

  await db.transaction(async () => {
    const session = await db.get(`
      SELECT * FROM sessions WHERE session_token = ?
    `, [sessionToken]);

    if (!session) throw new Error("Session not found");

    const newCredits = Math.max(0, session.credits - seconds);

    await db.run(`
      UPDATE sessions
      SET credits = ?
      WHERE session_token = ?
    `, [newCredits, sessionToken]);

    await db.run(`
      INSERT INTO transactions (
        session_id,
        type,
        amount,
        metadata
      ) VALUES (?, 'CONSUME', ?, ?)
    `, [session.id, seconds, JSON.stringify({ reason: "manual_adjustment" })]);
  });
}

// -------------------------
// CLOSE SESSION
// -------------------------
async function closeSession(sessionToken) {
  await db.ready();

  await db.transaction(async () => {
    const session = await db.get(`
      SELECT * FROM sessions WHERE session_token = ?
    `, [sessionToken]);

    if (!session) throw new Error("Session not found");

    await db.run(`
      UPDATE sessions
      SET status = 'EXPIRED',
          ended_at = CURRENT_TIMESTAMP
      WHERE session_token = ?
    `, [sessionToken]);

    if (session.client_mac) {
      hotspot.revokeAccess(session.client_mac);

      await db.run(`
        INSERT INTO hotspot_events (device_mac, action)
        VALUES (?, 'REVOKE')
      `, [session.client_mac]);
    }
  });
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