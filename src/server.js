require("dotenv").config();
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const { setProcessStateEmitter, getProcessState } = require("./services/process.service");
const { expireSession, primeExpiringSessions } = require("./services/session.service");
const hotspot = require("./services/hotspot.service");
const db = require("./database/sqlite");

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

setProcessStateEmitter((payload) => {
  io.emit("process:status", payload);
});

io.on("connection", (socket) => {
  socket.emit("process:status", {
    reason: "INITIAL_SYNC",
    state: getProcessState()
  });
});

const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function sweepExpiredSessions() {
  try {
    await db.ready();
    const expiredSessions = await db.all(`
      SELECT session_token
      FROM sessions
      WHERE status = 'ACTIVE'
        AND credits >= 0
        AND (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', started_at)) >= credits
    `);

    if (expiredSessions.length === 0) {
      return;
    }

    for (const row of expiredSessions) {
      try {
        await expireSession(row.session_token, { source: "SWEEP" });
      } catch (error) {
        console.error("[SESSION SWEEP] Failed to expire session", {
          sessionToken: row.session_token,
          message: error.message
        });
      }
    }

    console.log(`[SESSION SWEEP] Expired ${expiredSessions.length} session(s)`);

    await primeExpiringSessions();
  } catch (err) {
    console.error("[SESSION SWEEP] Error:", err.message);
  }
}

async function cleanupAllowedClientsOnStartup() {
  try {
    console.log("[HOTSPOT STARTUP] Revoking all currently allowed client IPs");
    const result = hotspot.revokeAllAllowedClientIps();
    console.log("[HOTSPOT STARTUP] Cleanup complete", result);
  } catch (error) {
    console.error("[HOTSPOT STARTUP] Cleanup error:", error.message);
  }
}

async function bootstrap() {
  await cleanupAllowedClientsOnStartup();

  // Background sweep: expire sessions whose credits have run out
  // Runs every 5 minutes — no need for the user to return to the portal
  setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);

  // Run once at startup to catch any sessions that expired while the server was down
  sweepExpiredSessions().catch((err) => {
    console.error("[SESSION SWEEP] Startup error:", err.message);
  });

  primeExpiringSessions().catch((err) => {
    console.error("[SESSION PRIME] Startup error:", err.message);
  });

  server.listen(PORT, () => {
    console.log("EcoConnect backend running on port", PORT);
  });
}

bootstrap().catch((err) => {
  console.error("[SERVER] Bootstrap error:", err.message);
});
console.log("SERVER.JS RUNNING");