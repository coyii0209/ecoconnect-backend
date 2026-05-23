require("dotenv").config();
const createLogger = require("./utils/logger");
createLogger.configureGlobalConsole();

const log = createLogger("SERVER");
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
  log.info("Client connected", {
    socketId: socket.id,
    clientIp: socket.handshake?.address || null
  });

  socket.emit("process:status", {
    reason: "INITIAL_SYNC",
    state: getProcessState()
  });

  socket.on("disconnect", (reason) => {
    log.info("Client disconnected", {
      socketId: socket.id,
      reason
    });
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
        log.error("Session sweep failed for token", {
          sessionToken: row.session_token,
          message: error.message
        });
      }
    }

    log.info("Session sweep complete", { expiredCount: expiredSessions.length });

    await primeExpiringSessions();
  } catch (err) {
    log.error("Session sweep error", { message: err.message });
  }
}

async function cleanupAllowedClientsOnStartup() {
  try {
    log.info("Hotspot startup cleanup begin");
    const result = hotspot.revokeAllAllowedClientIps();
    log.info("Hotspot startup cleanup complete", result);
  } catch (error) {
    log.error("Hotspot startup cleanup error", { message: error.message });
  }
}

async function bootstrap() {
  await cleanupAllowedClientsOnStartup();

  // Background sweep: expire sessions whose credits have run out
  // Runs every 5 minutes — no need for the user to return to the portal
  setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);

  // Run once at startup to catch any sessions that expired while the server was down
  sweepExpiredSessions().catch((err) => {
    log.error("Session sweep startup error", { message: err.message });
  });

  primeExpiringSessions().catch((err) => {
    log.error("Session prime startup error", { message: err.message });
  });

  server.listen(PORT, () => {
    log.info("Backend listening", { port: PORT, logEnabled: createLogger.isEnabled, logLevel: createLogger.level });
  });
}

bootstrap().catch((err) => {
  log.error("Bootstrap error", { message: err.message });
});