const db = require("../database/sqlite");

// load from env
const REWARD_MAP = {
  plastic_bottle: parseInt(process.env.REWARD_PLASTIC_BOTTLE || "5"),
};

const DEFAULT_REWARD = parseInt(process.env.REWARD_DEFAULT || "0");
const MODE = process.env.REWARD_MODE || "allow_zero";

function processReward(detectionId, label) {
  let minutes = REWARD_MAP[label];

  // unknown label handling
  if (minutes === undefined) {
    if (MODE === "strict_reject") {
      return {
        minutes: 0,
        rejected: true,
        reason: "UNKNOWN_LABEL",
      };
    }

    minutes = DEFAULT_REWARD;
  }

  // save reward
  db.prepare(`
    INSERT INTO rewards (detection_id, reward_minutes)
    VALUES (?, ?)
  `).run(detectionId, minutes);

  return {
    minutes,
    rejected: false,
  };
}

module.exports = {
  processReward,
};