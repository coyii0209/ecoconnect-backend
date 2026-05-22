const db = require("../database/sqlite");
const { getSession, creditSession } = require("./session.service");
const rewardService = require("./reward.service");

const REWARD_COOLDOWN_MS = 5000;
const DETECTION_LABEL = process.env.REWARD_DETECTION_LABEL || "plastic_bottle";
const DETECTION_CONFIDENCE = parseFloat(process.env.REWARD_DETECTION_CONFIDENCE || "0.95");
let emitProcessState = () => {};

function initialState() {
  return {
    requestActive: false,
    cameraActive: false,
    requestId: null,
    sessionToken: null,
    cameraId: null,
    yoloDecision: "idle",
    irBottomDetected: false,
    servoGateOpened: false,
    pipelineStatus: "Waiting for bottle...",
    cooldownUntil: 0,
    lastOutcome: null,
    lastReason: null
  };
}

let processState = initialState();

function getProcessState() {
  return {
    ...processState,
    cooldownRemainingMs: Math.max(0, processState.cooldownUntil - Date.now())
  };
}

function setProcessStateEmitter(emitter) {
  emitProcessState = typeof emitter === "function" ? emitter : () => {};
}

function notify(reason, context = {}) {
  console.log("[PROCESS] State update", {
    reason,
    requestId: context.requestId || processState.requestId,
    sessionToken: context.sessionToken || processState.sessionToken,
    yoloDecision: processState.yoloDecision,
    servoGateOpened: processState.servoGateOpened,
    cooldownUntil: processState.cooldownUntil,
    context
  });

  emitProcessState({
    reason,
    state: getProcessState(),
    context
  });
}

function isLocked() {
  return processState.requestActive || processState.cameraActive || processState.servoGateOpened;
}

async function startRequest(sessionToken) {
  console.log("[PROCESS] startRequest called", { sessionToken });
  const session = await getSession(sessionToken);

  if (!session) {
    console.warn("[PROCESS] startRequest rejected: session not found", { sessionToken });
    return {
      ok: false,
      reason: "SESSION_NOT_FOUND",
      state: getProcessState()
    };
  }

  if (session.status === "EXPIRED") {
    console.warn("[PROCESS] startRequest rejected: session expired", { sessionToken });
    return {
      ok: false,
      reason: "SESSION_EXPIRED",
      state: getProcessState()
    };
  }

  if (processState.cooldownUntil > Date.now()) {
    console.warn("[PROCESS] startRequest rejected: cooldown active", {
      cooldownUntil: processState.cooldownUntil,
      now: Date.now()
    });
    return {
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      state: getProcessState()
    };
  }

  if (isLocked()) {
    console.warn("[PROCESS] startRequest rejected: process already active", {
      requestActive: processState.requestActive,
      cameraActive: processState.cameraActive,
      servoGateOpened: processState.servoGateOpened
    });
    return {
      ok: false,
      reason: "PROCESS_ACTIVE",
      state: getProcessState()
    };
  }

  const requestId = `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  processState = {
    ...initialState(),
    requestActive: true,
    cameraActive: true,
    requestId,
    sessionToken,
    cameraId: `kiosk-web-${requestId}`,
    yoloDecision: "pending",
    pipelineStatus: "Camera and YOLO validating"
  };

  notify("REQUEST_STARTED");

  return {
    ok: true,
    reason: "REQUEST_STARTED",
    state: getProcessState()
  };
}

function setDecision(decision) {
  console.log("[PROCESS] setDecision called", { decision, requestId: processState.requestId });
  if (!processState.requestActive || processState.yoloDecision !== "pending") {
    console.warn("[PROCESS] setDecision rejected: flow not ready", {
      requestActive: processState.requestActive,
      yoloDecision: processState.yoloDecision
    });
    return {
      ok: false,
      reason: "FLOW_NOT_READY",
      state: getProcessState()
    };
  }

  if (decision === "valid") {
    processState = {
      ...processState,
      cameraActive: false,
      yoloDecision: "valid",
      pipelineStatus: "Valid bottle detected",
      lastReason: null
    };

    notify("VALID_BOTTLE");

    return {
      ok: true,
      reason: "VALID_BOTTLE",
      state: getProcessState()
    };
  }

  processState = {
    ...initialState(),
    cooldownUntil: processState.cooldownUntil,
    lastOutcome: "rejected",
    lastReason: "BOTTLE_REJECTED",
    pipelineStatus: "Bottle rejected"
  };

  notify("BOTTLE_REJECTED");

  return {
    ok: true,
    reason: "BOTTLE_REJECTED",
    state: getProcessState()
  };
}

function setServo(opened) {
  console.log("[PROCESS] setServo called", { opened, requestId: processState.requestId });
  if (opened) {
    if (!processState.requestActive || processState.yoloDecision !== "valid") {
      console.warn("[PROCESS] setServo(open) rejected: flow not ready", {
        requestActive: processState.requestActive,
        yoloDecision: processState.yoloDecision
      });
      return {
        ok: false,
        reason: "FLOW_NOT_READY",
        state: getProcessState()
      };
    }

    processState = {
      ...processState,
      servoGateOpened: true,
      pipelineStatus: "Servo gate opened"
    };

    notify("SERVO_OPENED");

    return {
      ok: true,
      reason: "SERVO_OPENED",
      state: getProcessState()
    };
  }

  processState = {
    ...processState,
    servoGateOpened: false,
    pipelineStatus: processState.requestActive ? "Valid bottle detected" : "Waiting for bottle..."
  };

  notify("SERVO_CLOSED");

  return {
    ok: true,
    reason: "SERVO_CLOSED",
    state: getProcessState()
  };
}

async function triggerIrReward() {
  console.log("[PROCESS] triggerIrReward called", {
    requestActive: processState.requestActive,
    yoloDecision: processState.yoloDecision,
    servoGateOpened: processState.servoGateOpened,
    hasSessionToken: Boolean(processState.sessionToken)
  });

  if (processState.cooldownUntil > Date.now()) {
    console.warn("[PROCESS] triggerIrReward rejected: cooldown active", {
      cooldownUntil: processState.cooldownUntil,
      now: Date.now()
    });
    return {
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      state: getProcessState()
    };
  }

  if (!processState.requestActive || processState.yoloDecision !== "valid" || !processState.servoGateOpened || !processState.sessionToken) {
    console.warn("[PROCESS] triggerIrReward rejected: flow not ready", {
      requestActive: processState.requestActive,
      yoloDecision: processState.yoloDecision,
      servoGateOpened: processState.servoGateOpened,
      hasSessionToken: Boolean(processState.sessionToken)
    });
    return {
      ok: false,
      reason: "FLOW_NOT_READY",
      state: getProcessState()
    };
  }

  await db.ready();

  const result = await db.run(`
    INSERT INTO detections (label, confidence, created_at)
    VALUES (?, ?, datetime('now'))
  `, [DETECTION_LABEL, DETECTION_CONFIDENCE]);
  console.log("[PROCESS] Detection inserted", {
    detectionId: result.lastInsertRowid,
    label: DETECTION_LABEL,
    confidence: DETECTION_CONFIDENCE
  });

  const reward = await rewardService.processReward(result.lastInsertRowid, DETECTION_LABEL);
  console.log("[PROCESS] Reward evaluation complete", reward);

  if (reward.rejected || reward.minutes <= 0) {
    processState = {
      ...initialState(),
      cooldownUntil: processState.cooldownUntil,
      lastOutcome: "rejected",
      lastReason: reward.reason || "NO_REWARD",
      pipelineStatus: "Bottle rejected"
    };

    notify("BOTTLE_REJECTED");

    return {
      ok: false,
      reason: reward.reason || "NO_REWARD",
      rewardMinutes: 0,
      state: getProcessState()
    };
  }

  const completedRequestId = processState.requestId;
  const completedSessionToken = processState.sessionToken;

  await creditSession(completedSessionToken, reward.minutes * 60);
  console.log("[PROCESS] Session credited", {
    requestId: completedRequestId,
    sessionToken: completedSessionToken,
    rewardMinutes: reward.minutes,
    rewardSeconds: reward.minutes * 60
  });

  processState = {
    ...initialState(),
    cooldownUntil: Date.now() + REWARD_COOLDOWN_MS,
    lastOutcome: "rewarded",
    lastReason: null,
    pipelineStatus: "Credit added!"
  };

  notify("CREDIT_ADDED", {
    requestId: completedRequestId,
    sessionToken: completedSessionToken
  });

  return {
    ok: true,
    reason: "CREDIT_ADDED",
    rewardMinutes: reward.minutes,
    requestId: completedRequestId,
    sessionToken: completedSessionToken,
    state: getProcessState()
  };
}

function resetProcess() {
  console.log("[PROCESS] resetProcess called", {
    previousRequestId: processState.requestId,
    previousStatus: processState.pipelineStatus
  });

  processState = {
    ...initialState(),
    cooldownUntil: processState.cooldownUntil
  };

  notify("RESET");

  return {
    ok: true,
    reason: "RESET",
    state: getProcessState()
  };
}

module.exports = {
  setProcessStateEmitter,
  getProcessState,
  startRequest,
  setDecision,
  setServo,
  triggerIrReward,
  resetProcess,
};