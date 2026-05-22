const express = require("express");
const {
  getProcessState,
  startRequest,
  setDecision,
  setServo,
  triggerIrReward,
  resetProcess,
} = require("../../services/process.service");

const router = express.Router();

function success(data) {
  return { ok: true, data };
}

function failure(message, data) {
  return { ok: false, error: message, data };
}

router.get("/status", (req, res) => {
  res.json(success(getProcessState()));
});

router.post("/start", (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json(failure("sessionToken is required"));
    }

    const result = startRequest(sessionToken);

    if (!result.ok) {
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    res.status(500).json(failure(error.message));
  }
});

router.post("/admin/decision", (req, res) => {
  try {
    const { decision } = req.body;

    if (!["valid", "invalid"].includes(decision)) {
      return res.status(400).json(failure("decision must be valid or invalid"));
    }

    const result = setDecision(decision);

    if (!result.ok) {
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    res.status(500).json(failure(error.message));
  }
});

router.post("/admin/servo", (req, res) => {
  try {
    const { opened } = req.body;

    if (typeof opened !== "boolean") {
      return res.status(400).json(failure("opened must be boolean"));
    }

    const result = setServo(opened);

    if (!result.ok) {
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    res.status(500).json(failure(error.message));
  }
});

router.post("/admin/ir-trigger", (req, res) => {
  try {
    const result = triggerIrReward();

    if (!result.ok) {
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    res.status(500).json(failure(error.message));
  }
});

router.post("/reset", (req, res) => {
  try {
    res.json(success(resetProcess()));
  } catch (error) {
    res.status(500).json(failure(error.message));
  }
});

module.exports = router;