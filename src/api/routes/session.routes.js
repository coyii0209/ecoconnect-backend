const express = require("express");
const {
  openSession,
  creditSession,
  closeSession,
  getSession
} = require("../../services/session.service");

const router = express.Router();

function success(data) {
  return { ok: true, data };
}

function error(message) {
  return { ok: false, error: message };
}

// OPEN SESSION
router.post("/open", (req, res) => {
  try {
    const { clientMac } = req.body;

    if (!clientMac) {
      return res.status(400).json(error("clientMac is required"));
    }

    const session = openSession(clientMac);
    res.json(success(session));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

// ADD CREDITS
router.post("/credit", (req, res) => {
  try {
    const { sessionToken, seconds } = req.body;

    if (!sessionToken || typeof seconds !== "number") {
      return res.status(400).json(error("Invalid input"));
    }

    creditSession(sessionToken, seconds);

    res.json(success(getSession(sessionToken)));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

// CLOSE SESSION
router.post("/close", (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json(error("sessionToken is required"));
    }

    closeSession(sessionToken);

    res.json(success({ closed: true }));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

// GET SESSION
router.get("/:token", (req, res) => {
  try {
    const session = getSession(req.params.token);

    if (!session) {
      return res.status(404).json(error("Session not found"));
    }

    res.json(success(session));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

module.exports = router;