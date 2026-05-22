require("dotenv").config();
const app = require("./app");
const http = require("http");
const { Server } = require("socket.io");
const { setProcessStateEmitter, getProcessState } = require("./services/process.service");
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

server.listen(PORT, () => {
  console.log("EcoConnect backend running on port", PORT);
});

// Background sweep: expire sessions whose credits have run out
// Runs every 5 minutes — no need for the user to return to the portal
const SESSION_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

async function sweepExpiredSessions() {
  try {
    await db.ready();
    const result = await db.run(`
      UPDATE sessions
      SET status = 'EXPIRED',
          credits = 0,
          ended_at = CURRENT_TIMESTAMP
      WHERE status = 'ACTIVE'
        AND credits >= 0
        AND (strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', started_at)) >= credits
    `);

    if (result.changes > 0) {
      console.log(`[SESSION SWEEP] Expired ${result.changes} session(s)`);
    }
  } catch (err) {
    console.error("[SESSION SWEEP] Error:", err.message);
  }
}

setInterval(sweepExpiredSessions, SESSION_SWEEP_INTERVAL_MS);
// Run once at startup to catch any sessions that expired while the server was down
sweepExpiredSessions().catch((err) => {
  console.error("[SESSION SWEEP] Startup error:", err.message);
});
console.log("SERVER.JS RUNNING");