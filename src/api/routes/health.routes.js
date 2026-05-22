const express = require("express");
const router = express.Router();
const db = require("../../database/sqlite");

// Health check route
router.get("/", async (req, res) => {
  try {
    await db.ready();
    const row = await db.get("SELECT 1 as test");

    res.json({
      status: "online",
      database: row.test === 1
    });
  } catch (err) {
    res.json({
      status: "online",
      database: false,
      error: err.message
    });
  }
});

module.exports = router;