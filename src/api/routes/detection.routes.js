const COOLDOWN_MS = 5000; // 5 seconds per camera
const cameraLastSeen = new Map();

const express = require("express");
const router = express.Router();

const db = require("../../database/sqlite");
const rewardService = require("../../services/reward.service");

const TOKEN = process.env.DETECTOR_TOKEN;
const THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.8");

//
// AUTH MIDDLEWARE (simple bearer check)
//
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const token = header.split(" ")[1];

  if (token !== TOKEN) {
    return res.status(401).json({ error: "Invalid token" });
  }

  next();
}

//
// POST /api/detection (SECURED)
//
router.post("/", auth, (req, res) => {
  try {
    const { label, confidence, event_id, camera_id } = req.body;

    // 1. Validate fields
    if (!label || confidence === undefined || !event_id || !camera_id) {
      db.prepare(`
        INSERT INTO reject_logs (event_id, camera_id, reason)
        VALUES (?, ?, ?)
      `).run(event_id || null, camera_id || null, "MISSING_FIELDS");

      return res.status(400).json({
        error: "Missing required fields",
      });
    }

    // 2. LOW CONFIDENCE CHECK
    if (confidence < THRESHOLD) {
      db.prepare(`
        INSERT INTO reject_logs (event_id, camera_id, reason)
        VALUES (?, ?, ?)
      `).run(event_id, camera_id, "LOW_CONFIDENCE");

      return res.json({
        success: false,
        rejected: true,
        reason: "LOW_CONFIDENCE",
      });
    }

    // 3. EVENT_ID IDEMPOTENCY CHECK
    const exists = db.prepare(`
      SELECT event_id FROM processed_events WHERE event_id = ?
    `).get(event_id);

    if (exists) {
      db.prepare(`
        INSERT INTO reject_logs (event_id, camera_id, reason)
        VALUES (?, ?, ?)
      `).run(event_id, camera_id, "DUPLICATE_EVENT");

      return res.json({
        success: false,
        rejected: true,
        reason: "DUPLICATE_EVENT",
      });
    }

    // 4. CAMERA COOLDOWN CHECK
    const now = Date.now();
    const lastSeen = cameraLastSeen.get(camera_id) || 0;

    if (now - lastSeen < COOLDOWN_MS) {
      db.prepare(`
        INSERT INTO reject_logs (event_id, camera_id, reason)
        VALUES (?, ?, ?)
      `).run(event_id, camera_id, "CAMERA_COOLDOWN");

      return res.json({
        success: false,
        rejected: true,
        reason: "CAMERA_COOLDOWN",
      });
    }

    cameraLastSeen.set(camera_id, now);

    // 5. STORE EVENT ID (MARK AS PROCESSED)
    db.prepare(`
      INSERT INTO processed_events (event_id, camera_id)
      VALUES (?, ?)
    `).run(event_id, camera_id);

    // 6. STORE DETECTION
    const stmt = db.prepare(`
      INSERT INTO detections (label, confidence, created_at)
      VALUES (?, ?, datetime('now'))
    `);

    const result = stmt.run(label, confidence);

    // 7. REWARD
    const reward = rewardService.processReward(
      result.lastInsertRowid,
      label
    );

    res.json({
      success: true,
      detectionId: result.lastInsertRowid,
      rewardMinutes: reward.minutes,
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}); 

  module.exports = router;