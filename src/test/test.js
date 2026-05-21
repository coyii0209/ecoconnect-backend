const {
  openSession,
  creditSession,
  getSession,
  closeSession
} = require("../services/session.service");
const { parseDbTimestamp } = require("../utils/time");

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function printState(label, token) {
  const session = getSession(token);

  const now = Date.now();
  const started = parseDbTimestamp(session.started_at);
  const elapsed = Math.floor((now - started) / 1000);

  console.log(`\n📍 ${label}`);
  console.log("status:", session.status);
  console.log("credits (DB):", session.credits);
  console.log("started_at:", session.started_at);
  console.log("elapsed (calc):", elapsed);
  console.log("remaining (computed):", session.remaining);
  console.log("isActive:", session.isActive);
}

(async () => {

  console.log("\n==============================");
  console.log("🚀 MODEL 1 DEBUG TEST (FIXED)");
  console.log("==============================\n");

  // 1. Open session
  const session = openSession("AA:BB:CC:DD:EE:FF");
  const token = session.session_token;

  await printState("Immediately after open", token);

  // 2. Credit session
  console.log("\n🍾 Adding 120 seconds credit");
  creditSession(token, 120);

  await printState("After credit added", token);

  // 3. WAIT (IMPORTANT)
  console.log("\n⏳ waiting 3 seconds...");
  await wait(3000);

  await printState("After 3 seconds", token);

  console.log("\n⏳ waiting 5 seconds...");
  await wait(5000);

  await printState("After 8 seconds total", token);

  console.log("\n⏳ waiting 4 more seconds...");
  await wait(4000);

  await printState("After 12 seconds total", token);

  // 4. Close session
  console.log("\n🛑 Closing session");
  closeSession(token);

  await printState("After close", token);

  console.log("\n==============================");
  console.log("✅ TEST COMPLETE");
  console.log("==============================\n");

})();