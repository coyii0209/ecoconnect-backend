const db = require("../database/sqlite");
const { parseDbTimestamp } = require("../utils/time");
const hotspot = require("./hotspot.service");

const HOTSPOT_STRICT = process.env.HOTSPOT_STRICT === "1";
const SESSION_REVOKE_SUPPLEMENT_THRESHOLD_MS = 5 * 60 * 1000;
const sessionExpiryTimers = new Map();

function runHotspotAction(actionName, actionFn) {
  try {
    const result = actionFn();
    return { ok: true, result };
  } catch (error) {
    console.error(`[HOTSPOT] ${actionName} failed:`, error.message);
    if (HOTSPOT_STRICT) {
      throw error;
    }
    return { ok: false, error };
  }
}

function clearSessionExpiryTimer(sessionToken) {
  const existingTimer = sessionExpiryTimers.get(sessionToken);
  if (existingTimer) {
    clearTimeout(existingTimer);
    sessionExpiryTimers.delete(sessionToken);
    console.log("[SESSION] Cleared scheduled expiry timer", { sessionToken });
  }
}

function getRemainingMsFromSession(session) {
  if (!session) return 0;

  const started = parseDbTimestamp(session.started_at);
  if (!Number.isFinite(started)) {
    return Math.max(0, (session.credits || 0) * 1000);
  }

  const elapsedMs = Date.now() - started;
  const remainingMs = Math.max(0, (session.credits || 0) * 1000 - elapsedMs);
  return remainingMs;
}

async function scheduleSessionExpiry(sessionToken, remainingMs, options = {}) {
  const normalizedRemainingMs = Math.max(0, Math.floor(remainingMs || 0));
  const { source = "SCHEDULE" } = options;

  if (!sessionToken) return { scheduled: false, reason: "NO_SESSION_TOKEN" };

  clearSessionExpiryTimer(sessionToken);

  if (normalizedRemainingMs === 0) {
    console.log("[SESSION] Immediate expiry requested", { sessionToken, source });
    await expireSession(sessionToken, { source });
    return { scheduled: false, reason: "ALREADY_EXPIRED" };
  }

  if (normalizedRemainingMs >= SESSION_REVOKE_SUPPLEMENT_THRESHOLD_MS) {
    return {
      scheduled: false,
      reason: "ABOVE_THRESHOLD",
      remainingMs: normalizedRemainingMs
    };
  }

  console.log("[SESSION] Scheduled expiry timer", {
    sessionToken,
    source,
    remainingMs: normalizedRemainingMs
  });

  const timer = setTimeout(async () => {
    try {
      await expireSession(sessionToken, { source });
    } catch (error) {
      console.error("[SESSION] Scheduled expiry failed", {
        sessionToken,
        source,
        message: error.message
      });
    } finally {
      clearSessionExpiryTimer(sessionToken);
    }
  }, normalizedRemainingMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  sessionExpiryTimers.set(sessionToken, timer);

  return {
    scheduled: true,
    remainingMs: normalizedRemainingMs,
    source
  };
}

async function scheduleSessionExpiryFromSession(session, options = {}) {
  if (!session?.session_token) return { scheduled: false, reason: "NO_SESSION_TOKEN" };

  if (session.status !== "ACTIVE") {
    clearSessionExpiryTimer(session.session_token);
    return { scheduled: false, reason: "NOT_ACTIVE" };
  }

  const remainingMs = getRemainingMsFromSession(session);
  return scheduleSessionExpiry(session.session_token, remainingMs, options);
}

function parseOpenSessionInput(input) {
  if (typeof input === "string") {
    return {
      clientMacHint: hotspot.normalizeMac(input),
      clientIp: null
    };
  }

  return {
    clientMacHint: hotspot.normalizeMac(input?.clientMac || ""),
    clientIp: hotspot.normalizeIp(input?.clientIp || "")
  };
}

function resolveMacFromIp(clientIp) {
  if (!clientIp) return null;

  try {
    return hotspot.getMacFromIp(clientIp);
  } catch (error) {
    console.warn("[SESSION] Unable to resolve MAC from IP", { clientIp, message: error.message });
    return null;
  }
}

async function upsertSessionNetworkIdentity(sessionToken, clientMac, clientIp) {
  if (!sessionToken) return;

  const normalizedMac = hotspot.normalizeMac(clientMac);
  const normalizedIp = hotspot.normalizeIp(clientIp);

  await db.run(`
    UPDATE sessions
    SET client_mac = COALESCE(?, client_mac),
        client_ip = COALESCE(?, client_ip)
    WHERE session_token = ?
  `, [normalizedMac || null, normalizedIp || null, sessionToken]);
}

async function expireSession(sessionToken, options = {}) {
  const { source = "MANUAL" } = options;

  await db.ready();
  clearSessionExpiryTimer(sessionToken);

  await db.transaction(async () => {
    const session = await db.get(`
      SELECT * FROM sessions WHERE session_token = ?
    `, [sessionToken]);

    if (!session) throw new Error("Session not found");

    await db.run(`
      UPDATE sessions
      SET status = 'EXPIRED',
          credits = 0,
          ended_at = CURRENT_TIMESTAMP
      WHERE session_token = ?
    `, [sessionToken]);

    if (session.client_mac) {
      console.log("[SESSION] Expire path hotpot revoke", {
        sessionToken,
        source,
        clientMac: session.client_mac,
        clientIp: session.client_ip || null
      });

      const revokeResult = runHotspotAction("REVOKE", () => {
        hotspot.revokeAccess(session.client_mac);
      });

      await db.run(`
        INSERT INTO hotspot_events (device_mac, action)
        VALUES (?, ?)
      `, [session.client_mac, revokeResult.ok ? `REVOKE_${source}` : `REVOKE_${source}_FAILED`]);

      if (!revokeResult.ok) {
        console.warn("[SESSION] Hotspot revoke failed during expire", {
          sessionToken,
          source,
          clientMac: session.client_mac
        });
      }
    } else {
      console.warn("[SESSION] Expire called without client_mac", {
        sessionToken,
        source
      });
    }
  });
}

// -------------------------
// OPEN SESSION
// -------------------------
async function openSession(input) {
  const { clientMacHint, clientIp } = parseOpenSessionInput(input);
  const resolvedMac = resolveMacFromIp(clientIp);
  const effectiveMac = resolvedMac || clientMacHint || null;

  console.log("[SESSION] openSession called", {
    clientMacHint,
    clientIp,
    resolvedMac,
    effectiveMac
  });

  await db.ready();

  let existing = null;

  if (effectiveMac) {
    existing = await db.get(`
      SELECT session_token
      FROM sessions
      WHERE client_mac = ? AND status = 'ACTIVE'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `, [effectiveMac]);
  }

  if (!existing && clientIp) {
    existing = await db.get(`
      SELECT session_token
      FROM sessions
      WHERE client_ip = ? AND status = 'ACTIVE'
      ORDER BY started_at DESC, id DESC
      LIMIT 1
    `, [clientIp]);
  }

  if (existing?.session_token) {
    console.log("[SESSION] Found existing active session candidate", { sessionToken: existing.session_token });
    await upsertSessionNetworkIdentity(existing.session_token, effectiveMac, clientIp);

    const existingSession = await getSession(existing.session_token);
    if (existingSession?.status === "ACTIVE") {
      console.log("[SESSION] Reusing existing active session", { sessionToken: existing.session_token });
      await scheduleSessionExpiryFromSession(existingSession, { source: "OPEN" });
      return existingSession;
    }
  }

  const sessionToken = generateToken();

  await db.run(`
    INSERT INTO sessions (
      session_token,
      client_mac,
      client_ip,
      status,
      credits,
      started_at
    ) VALUES (?, ?, ?, 'ACTIVE', 0, CURRENT_TIMESTAMP)
  `, [sessionToken, effectiveMac, clientIp || null]);

  console.log("[SESSION] Created new session", {
    sessionToken,
    clientMac: effectiveMac,
    clientIp,
    resolvedFromIp: Boolean(resolvedMac)
  });

  const session = await getSession(sessionToken);
  await scheduleSessionExpiryFromSession(session, { source: "OPEN" });
  return session;
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
    await expireSession(sessionToken, { source: "AUTO_READ" });

    const expiredSession = {
      ...session,
      status: "EXPIRED",
      credits: 0,
      remaining: 0,
      isActive: false
    };

    clearSessionExpiryTimer(sessionToken);
    return expiredSession;
  }

  if (session.status === "ACTIVE") {
    await scheduleSessionExpiryFromSession({
      ...session,
      remaining,
      isActive: true
    }, { source: "READ" });
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
  console.log("[SESSION] creditSession called", { sessionToken, seconds });
  await db.ready();

  await db.transaction(async () => {
    const session = await db.get(`
      SELECT * FROM sessions WHERE session_token = ?
    `, [sessionToken]);

    if (!session) throw new Error("Session not found");

    const newCredits = session.credits + seconds;
    console.log("[SESSION] Applying credits", {
      sessionToken,
      previousCredits: session.credits,
      addSeconds: seconds,
      newCredits
    });

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

    // Try to enrich missing/stale MAC from client_ip before hotspot operations.
    let sessionClientMac = session.client_mac ? hotspot.normalizeMac(session.client_mac) : null;
    const sessionClientIp = hotspot.normalizeIp(session.client_ip);

    if (sessionClientIp) {
      const resolvedMac = resolveMacFromIp(sessionClientIp);
      if (resolvedMac && resolvedMac !== sessionClientMac) {
        console.log("[SESSION] Updating session MAC from IP lookup", {
          sessionToken,
          previousMac: sessionClientMac,
          resolvedMac,
          clientIp: sessionClientIp
        });

        await upsertSessionNetworkIdentity(sessionToken, resolvedMac, sessionClientIp);
        sessionClientMac = resolvedMac;
      }
    }

    // Wire hotspot integration: extend or create access
    if (sessionClientMac) {
      const device = await db.get(`
        SELECT * FROM devices WHERE mac_address = ?
      `, [sessionClientMac]);

      if (device && device.hotspot_enabled) {
        // Device exists and is enabled: extend access
        console.log("[SESSION] Hotspot extend path", { sessionToken, clientMac: sessionClientMac });
        const extendResult = runHotspotAction("EXTEND", () => {
          hotspot.extendAccess(sessionClientMac, Math.ceil(seconds / 60));
        });

        if (extendResult.ok && extendResult.result?.ip) {
          await upsertSessionNetworkIdentity(sessionToken, sessionClientMac, extendResult.result.ip);

          console.log("[SESSION] Updated session client_ip from EXTEND", {
            sessionToken,
            clientMac: sessionClientMac,
            clientIp: extendResult.result.ip
          });
        }

        await db.run(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'EXTEND', ?)
        `, [sessionClientMac, Math.ceil(seconds / 60)]);

        if (!extendResult.ok) {
          console.warn("[SESSION] Hotspot extend failed (non-strict mode)", {
            sessionToken,
            clientMac: sessionClientMac
          });
          await db.run(`
            INSERT INTO hotspot_events (device_mac, action, duration_minutes)
            VALUES (?, 'EXTEND_FAILED', ?)
          `, [sessionClientMac, Math.ceil(seconds / 60)]);
        }
      } else {
        // First time: create access
        console.log("[SESSION] Hotspot create path", {
          sessionToken,
          clientMac: sessionClientMac,
          hasDeviceRecord: Boolean(device)
        });
        const createResult = runHotspotAction("CREATE", () => {
          hotspot.createAccess(sessionClientMac, Math.ceil(seconds / 60));
        });

        if (createResult.ok && createResult.result?.ip) {
          await upsertSessionNetworkIdentity(sessionToken, sessionClientMac, createResult.result.ip);

          console.log("[SESSION] Updated session client_ip from CREATE", {
            sessionToken,
            clientMac: sessionClientMac,
            clientIp: createResult.result.ip
          });
        }

        if (createResult.ok && !device) {
          await db.run(`
            INSERT INTO devices (mac_address, hotspot_enabled)
            VALUES (?, 1)
          `, [sessionClientMac]);
        }

        await db.run(`
          INSERT INTO hotspot_events (device_mac, action, duration_minutes)
          VALUES (?, 'CREATE', ?)
        `, [sessionClientMac, Math.ceil(seconds / 60)]);

        if (!createResult.ok) {
          console.warn("[SESSION] Hotspot create failed (non-strict mode)", {
            sessionToken,
            clientMac: sessionClientMac
          });
          await db.run(`
            INSERT INTO hotspot_events (device_mac, action, duration_minutes)
            VALUES (?, 'CREATE_FAILED', ?)
          `, [sessionClientMac, Math.ceil(seconds / 60)]);
        }
      }
    } else {
      console.warn("[SESSION] No MAC available for hotspot action", {
        sessionToken,
        clientIp: sessionClientIp || null
      });
    }
  });

  const updatedSession = await getSession(sessionToken);
  await scheduleSessionExpiryFromSession(updatedSession, { source: "CREDIT" });
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
  console.log("[SESSION] closeSession called", { sessionToken });
  await expireSession(sessionToken, { source: "MANUAL" });
}

async function closeAllSessions() {
  await db.ready();

  const activeSessions = await db.all(`
    SELECT session_token
    FROM sessions
    WHERE status = 'ACTIVE'
    ORDER BY id ASC
  `);

  let expiredCount = 0;

  for (const row of activeSessions) {
    try {
      await expireSession(row.session_token, { source: "BULK" });
      expiredCount += 1;
    } catch (error) {
      console.error("[SESSION] closeAllSessions failed for session", {
        sessionToken: row.session_token,
        message: error.message
      });
    }
  }

  console.log("[SESSION] closeAllSessions complete", {
    totalActive: activeSessions.length,
    expiredCount
  });

  return {
    totalActive: activeSessions.length,
    expiredCount
  };
}

async function primeExpiringSessions() {
  await db.ready();

  const activeSessions = await db.all(`
    SELECT *
    FROM sessions
    WHERE status = 'ACTIVE'
  `);

  let scheduledCount = 0;

  for (const session of activeSessions) {
    const remainingMs = getRemainingMsFromSession(session);
    if (remainingMs > 0 && remainingMs < SESSION_REVOKE_SUPPLEMENT_THRESHOLD_MS) {
      const result = await scheduleSessionExpiry(session.session_token, remainingMs, { source: "PRIME" });
      if (result.scheduled) {
        scheduledCount += 1;
      }
    }
  }

  console.log("[SESSION] primeExpiringSessions complete", {
    totalActive: activeSessions.length,
    scheduledCount
  });

  return {
    totalActive: activeSessions.length,
    scheduledCount
  };
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
  closeAllSessions,
  expireSession,
  primeExpiringSessions,
  scheduleSessionExpiryFromSession,
  clearSessionExpiryTimer,
  getSession,
};