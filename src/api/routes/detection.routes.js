const express = require("express");
const router = express.Router();

const db = require("../../database/sqlite");
const rewardService = require("../../services/reward.service");

//
// POST /api/detection
// Receive YOLO detection
//
router.post("/", (req, res) => {
  try {
    const { label, confidence, timestamp } = req.body;

    if (!label || confidence === undefined) {
      return res.status(400).json({
        error: "label and confidence are required",
      });
    }

    const stmt = db.prepare(`
      INSERT INTO detections (label, confidence, created_at)
      VALUES (?, ?, datetime('now'))
    `);

    const result = stmt.run(label, confidence);

    const reward = rewardService.processReward(
      result.lastInsertRowid,
      label
    );

    res.json({
      success: true,
      detectionId: result.lastInsertRowid,
      label,
      confidence,
      rewardMinutes: reward.minutes,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

//
// GET latest detection
//
router.get("/latest", (req, res) => {
  const row = db.prepare(`
    SELECT * FROM detections
    ORDER BY id DESC
    LIMIT 1
  `).get();

  res.json(row || {});
});

//
// GET history (last 20)
//
router.get("/history", (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM detections
    ORDER BY id DESC
    LIMIT 20
  `).all();

  res.json(rows);
});

module.exports = router;