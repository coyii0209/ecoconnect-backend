#!/usr/bin/env node

/**
 * EcoConnect E2E Smoke Test
 * 
 * Flow:
 * 1. Health check
 * 2. Detection POST (authenticated, accepted)
 * 3. Reward assignment verification
 * 4. Session OPEN (with client MAC)
 * 5. Session CREDIT (top-up with reward minutes)
 * 6. Session FETCH (verify credit applied)
 * 7. Detection POST (duplicate event_id - should reject)
 * 8. Session CLOSE
 */

const http = require("http");

const BASE_URL = "http://localhost:3000";
const DETECTOR_TOKEN = process.env.DETECTOR_TOKEN || "test-token-12345";

let testsPassed = 0;
let testsFailed = 0;

// ============================================
// Startup Check
// ============================================

async function checkServerReady() {
  for (let i = 0; i < 10; i++) {
    try {
      const res = await request("GET", "/api/health");
      if (res.status === 200) {
        log("✓ Server is ready");
        return true;
      }
    } catch (err) {
      if (i < 9) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }
  throw new Error("Server did not respond within 5 seconds. Is it running? (npm run dev)");
}

// ============================================
// HTTP Helper
// ============================================

function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
      },
    };

    if (method === "POST" || method === "PUT") {
      const bodyStr = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null,
        });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function authRequest(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DETECTOR_TOKEN}`,
      },
    };

    if (method === "POST" || method === "PUT") {
      const bodyStr = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null,
        });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// ============================================
// Test Utilities
// ============================================

function log(message) {
  console.log(`[E2E] ${message}`);
}

function pass(testName) {
  testsPassed++;
  console.log(`✓ PASS: ${testName}`);
}

function fail(testName, error) {
  testsFailed++;
  console.error(`✗ FAIL: ${testName}`);
  if (error) console.error(`  Error: ${error}`);
}

async function assert(testName, condition, errorMsg = "") {
  if (condition) {
    pass(testName);
  } else {
    fail(testName, errorMsg);
  }
}

// ============================================
// Tests
// ============================================

async function runTests() {
  log("Starting E2E smoke test suite...");
  log(`Using DETECTOR_TOKEN: ${DETECTOR_TOKEN.substring(0, 8)}...`);
  log("Checking server health...\n");

  // Ensure server is running
  try {
    await checkServerReady();
  } catch (error) {
    fail("Server not ready");
    console.error(error.message);
    process.exit(1);
  }

  // Test IDs
  const eventId = `evt-${Date.now()}-1`;
  const eventIdDuplicate = eventId; // Same ID for duplicate test
  const cameraId = "cam-001";
  const clientMac = "aa:bb:cc:dd:ee:ff";

  let sessionToken = null;
  let detectionId = null;
  let rewardMinutes = 0;

  try {
    // ==========================================
    // 1. HEALTH CHECK
    // ==========================================
    log("\n[1] Testing health endpoint...");
    {
      const res = await request("GET", "/api/health");
      await assert(
        "Health endpoint returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Database is online",
        res.body?.database === true,
        `database=${res.body?.database}`
      );
    }

    // ==========================================
    // 2. DETECTION - ACCEPTED CASE
    // ==========================================
    log("\n[2] Testing detection endpoint (accepted)...");
    {
      const payload = {
        label: "plastic_bottle",
        confidence: 0.95,
        event_id: eventId,
        camera_id: cameraId,
        captured_at: new Date().toISOString(),
      };

      const res = await authRequest("POST", "/api/detection", payload);
      await assert(
        "Detection returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Detection success is true",
        res.body?.success === true,
        `success=${res.body?.success}`
      );
      await assert(
        "Detection has detectionId",
        res.body?.detectionId > 0,
        `detectionId=${res.body?.detectionId}`
      );
      await assert(
        "Reward minutes > 0",
        res.body?.rewardMinutes > 0,
        `rewardMinutes=${res.body?.rewardMinutes}`
      );

      detectionId = res.body?.detectionId;
      rewardMinutes = res.body?.rewardMinutes;
    }

    // ==========================================
    // 3. SESSION - OPEN
    // ==========================================
    log("\n[3] Testing session open...");
    {
      const payload = { clientMac };

      const res = await request("POST", "/api/session/open", payload);
      await assert(
        "Session open returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Session response has ok=true",
        res.body?.ok === true,
        `ok=${res.body?.ok}`
      );
      await assert(
        "Session has token",
        res.body?.data?.session_token,
        `token=${res.body?.data?.session_token}`
      );

      sessionToken = res.body?.data?.session_token;
    }

    // ==========================================
    // 4. SESSION - CREDIT
    // ==========================================
    log("\n[4] Testing session credit...");
    {
      const seconds = rewardMinutes * 60;
      const payload = { sessionToken, seconds };

      const res = await request("POST", "/api/session/credit", payload);
      await assert(
        "Session credit returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Credit response has ok=true",
        res.body?.ok === true,
        `ok=${res.body?.ok}`
      );
      await assert(
        "Credited session has credits > 0",
        res.body?.data?.credits > 0,
        `credits=${res.body?.data?.credits}`
      );
    }

    // ==========================================
    // 5. SESSION - FETCH
    // ==========================================
    log("\n[5] Testing session fetch...");
    {
      const res = await request("GET", `/api/session/${sessionToken}`);
      await assert(
        "Session fetch returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Fetch response has ok=true",
        res.body?.ok === true,
        `ok=${res.body?.ok}`
      );
      await assert(
        "Session data has credits",
        res.body?.data?.credits >= rewardMinutes * 60,
        `credits=${res.body?.data?.credits}, expected >= ${rewardMinutes * 60}`
      );
      await assert(
        "Session is ACTIVE",
        res.body?.data?.status === "ACTIVE",
        `status=${res.body?.data?.status}`
      );
    }

    // ==========================================
    // 6. DETECTION - DUPLICATE REJECTION
    // ==========================================
    log("\n[6] Testing duplicate detection rejection...");
    {
      const payload = {
        label: "plastic_bottle",
        confidence: 0.95,
        event_id: eventIdDuplicate, // Same ID as first detection
        camera_id: cameraId,
        captured_at: new Date().toISOString(),
      };

      const res = await authRequest("POST", "/api/detection", payload);
      await assert(
        "Duplicate detection returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Duplicate detection success is false",
        res.body?.success === false,
        `success=${res.body?.success}`
      );
      await assert(
        "Duplicate rejection reason is DUPLICATE_EVENT",
        res.body?.reason === "DUPLICATE_EVENT",
        `reason=${res.body?.reason}`
      );
    }

    // ==========================================
    // 7. SESSION - CLOSE
    // ==========================================
    log("\n[7] Testing session close...");
    {
      const payload = { sessionToken };

      const res = await request("POST", "/api/session/close", payload);
      await assert(
        "Session close returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Close response has ok=true",
        res.body?.ok === true,
        `ok=${res.body?.ok}`
      );
    }

    // ==========================================
    // 8. SESSION - VERIFY CLOSED
    // ==========================================
    log("\n[8] Verifying closed session...");
    {
      const res = await request("GET", `/api/session/${sessionToken}`);
      await assert(
        "Closed session still returns 200",
        res.status === 200,
        `Got ${res.status}`
      );
      await assert(
        "Closed session status is EXPIRED",
        res.body?.data?.status === "EXPIRED",
        `status=${res.body?.data?.status}`
      );
    }

  } catch (error) {
    fail(`Unexpected error: ${error.message}`);
    console.error(error);
    process.exit(1);
  }

  // ==========================================
  // SUMMARY
  // ==========================================
  log("\n" + "=".repeat(50));
  log(`Tests Passed: ${testsPassed}`);
  log(`Tests Failed: ${testsFailed}`);
  log("=".repeat(50));

  if (testsFailed === 0) {
    log("\n✓ All tests passed!");
    process.exit(0);
  } else {
    log(`\n✗ ${testsFailed} test(s) failed.`);
    process.exit(1);
  }
}

// ==========================================
// RUN
// ==========================================
runTests().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
