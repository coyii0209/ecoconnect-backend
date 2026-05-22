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

function notify(reason) {
  emitProcessState({
    reason,
    state: getProcessState()
  });
}

function isLocked() {
  return processState.requestActive || processState.cameraActive || processState.servoGateOpened;
}

function startRequest(sessionToken) {
  const session = getSession(sessionToken);

  if (!session) {
    return {
      ok: false,
      reason: "SESSION_NOT_FOUND",
      state: getProcessState()
    };
  }

  if (session.status === "EXPIRED") {
    return {
      ok: false,
      reason: "SESSION_EXPIRED",
      state: getProcessState()
    };
  }

  if (processState.cooldownUntil > Date.now()) {
    return {
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      state: getProcessState()
    };
  }

  if (isLocked()) {
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
  if (!processState.requestActive || processState.yoloDecision !== "pending") {
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
  if (opened) {
    if (!processState.requestActive || processState.yoloDecision !== "valid") {
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

function triggerIrReward() {
  if (processState.cooldownUntil > Date.now()) {
    return {
      ok: false,
      reason: "COOLDOWN_ACTIVE",
      state: getProcessState()
    };
  }

  if (!processState.requestActive || processState.yoloDecision !== "valid" || !processState.servoGateOpened || !processState.sessionToken) {
    return {
      ok: false,
      reason: "FLOW_NOT_READY",
      state: getProcessState()
    };
  }

  const insertDetection = db.prepare(`
    INSERT INTO detections (label, confidence, created_at)
    VALUES (?, ?, datetime('now'))
  `);

  const result = insertDetection.run(DETECTION_LABEL, DETECTION_CONFIDENCE);
  const reward = rewardService.processReward(result.lastInsertRowid, DETECTION_LABEL);

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

  creditSession(processState.sessionToken, reward.minutes * 60);

  processState = {
    ...initialState(),
    cooldownUntil: Date.now() + REWARD_COOLDOWN_MS,
    lastOutcome: "rewarded",
    lastReason: null,
    pipelineStatus: "Credit added!"
  };

  notify("CREDIT_ADDED");

  return {
    ok: true,
    reason: "CREDIT_ADDED",
    rewardMinutes: reward.minutes,
    state: getProcessState()
  };
}

function resetProcess() {
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