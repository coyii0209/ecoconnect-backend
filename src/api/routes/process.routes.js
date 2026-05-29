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
  console.log("[PROCESS_ROUTE] GET /status");
  res.json(success(getProcessState()));
});

router.post("/start", async (req, res) => {
  try {
    const { sessionToken } = req.body;
    console.log("[PROCESS_ROUTE] POST /start", { hasSessionToken: Boolean(sessionToken) });

    if (!sessionToken) {
      console.warn("[PROCESS_ROUTE] /start rejected: missing sessionToken");
      return res.status(400).json(failure("sessionToken is required"));
    }

    const result = await startRequest(sessionToken);

    if (!result.ok) {
      console.warn("[PROCESS_ROUTE] /start conflict", { reason: result.reason });
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    console.error("[PROCESS_ROUTE] /start error", error);
    res.status(500).json(failure(error.message));
  }
});

router.post("/admin/decision", (req, res) => {
  try {
    const { decision } = req.body;
    console.log("[PROCESS_ROUTE] POST /admin/decision", { decision });

    if (!["valid", "invalid"].includes(decision)) {
      console.warn("[PROCESS_ROUTE] /admin/decision rejected: invalid decision", { decision });
      return res.status(400).json(failure("decision must be valid or invalid"));
    }

    const result = setDecision(decision);

    if (!result.ok) {
      console.warn("[PROCESS_ROUTE] /admin/decision conflict", { reason: result.reason });
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    console.error("[PROCESS_ROUTE] /admin/decision error", error);
    res.status(500).json(failure(error.message));
  }
});

router.post("/admin/servo", async (req, res) => {
  try {
    const { opened } = req.body;
    console.log("[PROCESS_ROUTE] POST /admin/servo", { opened });

    if (typeof opened !== "boolean") {
      console.warn("[PROCESS_ROUTE] /admin/servo rejected: opened must be boolean");
      return res.status(400).json(failure("opened must be boolean"));
    }

    const result = await setServo(opened);

    if (!result.ok) {
      console.warn("[PROCESS_ROUTE] /admin/servo conflict", { reason: result.reason });
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    console.error("[PROCESS_ROUTE] /admin/servo error", error);
    res.status(500).json(failure(error.message));
  }
});

async function handleIrTrigger(req, res) {
  try {
    console.log("[PROCESS_ROUTE] /admin/ir-trigger");
    const result = await triggerIrReward();

    if (!result.ok) {
      console.warn("[PROCESS_ROUTE] /admin/ir-trigger conflict", { reason: result.reason });
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    console.error("[PROCESS_ROUTE] /admin/ir-trigger error", error);
    res.status(500).json(failure(error.message));
  }
}

router.post("/admin/ir-trigger", handleIrTrigger);
router.get("/admin/ir-trigger", handleIrTrigger);

router.post("/reset", async (req, res) => {
  try {
    console.log("[PROCESS_ROUTE] POST /reset");
    const result = await resetProcess();

    if (!result.ok) {
      console.warn("[PROCESS_ROUTE] /reset conflict", { reason: result.reason });
      return res.status(409).json(failure(result.reason, result.state));
    }

    res.json(success(result));
  } catch (error) {
    console.error("[PROCESS_ROUTE] /reset error", error);
    res.status(500).json(failure(error.message));
  }
});

module.exports = router;