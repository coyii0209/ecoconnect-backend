const express = require("express");
const {
  openSession,
  creditSession,
  closeSession,
  getSession
} = require("../../services/session.service");
const hotspot = require("../../services/hotspot.service");

const router = express.Router();

function success(data) {
  return { ok: true, data };
}

function error(message) {
  return { ok: false, error: message };
}

function extractClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  const candidate = Array.isArray(forwarded)
    ? forwarded[0]
    : typeof forwarded === "string"
      ? forwarded.split(",")[0]
      : req.ip || req.socket?.remoteAddress || "";

  return hotspot.normalizeIp(candidate);
}

// OPEN SESSION
router.post("/open", async (req, res) => {
  try {
    const { clientMac } = req.body || {};
    const clientIp = extractClientIp(req);

    console.log("[SESSION_ROUTE] /open", {
      forwardedFor: req.headers["x-forwarded-for"] || null,
      reqIp: req.ip || null,
      socketRemoteAddress: req.socket?.remoteAddress || null,
      resolvedClientIp: clientIp || null,
      providedClientMac: clientMac || null
    });

    const session = await openSession({
      clientMac,
      clientIp
    });

    res.json(success(session));
  } catch (e) {
    console.error("[SESSION_ROUTE] /open error", e);
    res.status(500).json(error(e.message));
  }
});

// ADD CREDITS
router.post("/credit", async (req, res) => {
  try {
    const { sessionToken, seconds } = req.body;

    if (!sessionToken || typeof seconds !== "number") {
      return res.status(400).json(error("Invalid input"));
    }

    await creditSession(sessionToken, seconds);

    res.json(success(await getSession(sessionToken)));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

// CLOSE SESSION
router.post("/close", async (req, res) => {
  try {
    const { sessionToken } = req.body;

    if (!sessionToken) {
      return res.status(400).json(error("sessionToken is required"));
    }

    await closeSession(sessionToken);

    res.json(success({ closed: true }));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

// GET SESSION
router.get("/:token", async (req, res) => {
  try {
    const session = await getSession(req.params.token);

    if (!session) {
      return res.status(404).json(error("Session not found"));
    }

    res.json(success(session));
  } catch (e) {
    res.status(500).json(error(e.message));
  }
});

module.exports = router;