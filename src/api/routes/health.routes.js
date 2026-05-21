const express = require("express");
const router = express.Router();
const db = require("../../database/sqlite");

// Health check route
router.get("/", (req, res) => {
  try {
    const row = db.prepare("SELECT 1 as test").get();

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