const db = require("../database/sqlite");

function processReward(detectionId, label) {
  let minutes = 0;

  if (label === "plastic_bottle") {
    minutes = 5;
  }

  db.prepare(`
    INSERT INTO rewards (detection_id, reward_minutes)
    VALUES (?, ?)
  `).run(detectionId, minutes);

  return { minutes };
}

module.exports = { processReward };