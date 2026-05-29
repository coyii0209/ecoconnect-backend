const db = require("../database/sqlite");
const { getSession, creditSession } = require("./session.service");
const rewardService = require("./reward.service");
const servoService = require("./servo.service");
const createLogger = require("../utils/logger");

const REWARD_COOLDOWN_MS = 5000;
const DETECTION_LABEL = process.env.REWARD_DETECTION_LABEL || "plastic_bottle";
const DETECTION_CONFIDENCE = parseFloat(process.env.REWARD_DETECTION_CONFIDENCE || "0.95");
const DEBUG_PROCESS_LOGS = process.env.DEBUG_PROCESS_LOGS === "1";
const log = createLogger("PROCESS");
let emitProcessState = () => {};

function debugLog(message, meta) {
  if (DEBUG_PROCESS_LOGS) {
    log.debug(message, meta);
  }
}

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
  debugLog("State update", {
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
  debugLog("startRequest called", { sessionToken });
  const session = await getSession(sessionToken);

  if (!session) {
    log.warn("startRequest rejected: session not found", { sessionToken });
    return {
      ok: false,
      reason: "SESSION_NOT_FOUND",
      state: getProcessState()
    };
  }

  if (session.status === "EXPIRED") {
    log.warn("startRequest rejected: session expired", { sessionToken });
    return {
      ok: false,
      reason: "SESSION_EXPIRED",
      state: getProcessState()
    };
  }

  if (processState.cooldownUntil > Date.now()) {
    log.warn("startRequest rejected: cooldown active", {
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
    log.warn("startRequest rejected: process already active", {
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
  debugLog("setDecision called", { decision, requestId: processState.requestId });
  if (!processState.requestActive || processState.yoloDecision !== "pending") {
    log.warn("setDecision rejected: flow not ready", {
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

async function setServo(opened) {
  debugLog("setServo called", { opened, requestId: processState.requestId });

  if (opened) {
    if (!processState.requestActive || processState.yoloDecision !== "valid") {
      log.warn("setServo(open) rejected: flow not ready", {
        requestActive: processState.requestActive,
        yoloDecision: processState.yoloDecision
      });
      return {
        ok: false,
        reason: "FLOW_NOT_READY",
        state: getProcessState()
      };
    }

    try {
      await servoService.openGate();
    } catch (error) {
      log.error("setServo(open) failed: hardware command error", {
        message: error.message
      });
      return {
        ok: false,
        reason: "SERVO_COMMAND_FAILED",
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

  try {
    await servoService.closeGate();
  } catch (error) {
    log.error("setServo(close) failed: hardware command error", {
      message: error.message
    });
    return {
      ok: false,
      reason: "SERVO_COMMAND_FAILED",
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
  debugLog("triggerIrReward called", {
    requestActive: processState.requestActive,
    yoloDecision: processState.yoloDecision,
    servoGateOpened: processState.servoGateOpened,
    hasSessionToken: Boolean(processState.sessionToken)
  });

  if (processState.cooldownUntil > Date.now()) {
    log.warn("triggerIrReward rejected: cooldown active", {
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
    log.warn("triggerIrReward rejected: flow not ready", {
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

  processState = {
    ...processState,
    irBottomDetected: true,
    pipelineStatus: "IR detected, processing reward"
  };

  notify("IR_DETECTED");

  await db.ready();

  const result = await db.run(`
    INSERT INTO detections (label, confidence, created_at)
    VALUES (?, ?, datetime('now'))
  `, [DETECTION_LABEL, DETECTION_CONFIDENCE]);
  debugLog("Detection inserted", {
    detectionId: result.lastInsertRowid,
    label: DETECTION_LABEL,
    confidence: DETECTION_CONFIDENCE
  });

  const reward = await rewardService.processReward(result.lastInsertRowid, DETECTION_LABEL);
  debugLog("Reward evaluation complete", reward);

  const completedRequestId = processState.requestId;
  const completedSessionToken = processState.sessionToken;

  let rewardGranted = false;
  let rewardMinutes = 0;
  let completionReason = reward.reason || "NO_REWARD";
  let outcome = "rejected";
  let pipelineStatus = "Bottle rejected";

  if (!reward.rejected && reward.minutes > 0) {
    await creditSession(completedSessionToken, reward.minutes * 60);
    log.info("Session credited from process", {
      requestId: completedRequestId,
      sessionToken: completedSessionToken,
      rewardMinutes: reward.minutes,
      rewardSeconds: reward.minutes * 60
    });

    rewardGranted = true;
    rewardMinutes = reward.minutes;
    completionReason = "CREDIT_ADDED";
    outcome = "rewarded";
    pipelineStatus = "Credit added!";
  }

  try {
    await servoService.closeGate();
  } catch (error) {
    log.error("triggerIrReward failed to close servo gate", {
      message: error.message,
      requestId: completedRequestId,
      sessionToken: completedSessionToken
    });

    processState = {
      ...processState,
      pipelineStatus: "Reward done, waiting for servo close",
      lastOutcome: outcome,
      lastReason: "SERVO_CLOSE_FAILED"
    };

    notify("SERVO_CLOSE_FAILED", {
      requestId: completedRequestId,
      sessionToken: completedSessionToken
    });

    return {
      ok: false,
      reason: "SERVO_CLOSE_FAILED",
      rewardMinutes,
      requestId: completedRequestId,
      sessionToken: completedSessionToken,
      state: getProcessState()
    };
  }

  processState = {
    ...initialState(),
    cooldownUntil: Date.now() + REWARD_COOLDOWN_MS,
    lastOutcome: outcome,
    lastReason: rewardGranted ? null : completionReason,
    pipelineStatus
  };

  if (rewardGranted) {
    notify("CREDIT_ADDED", {
      requestId: completedRequestId,
      sessionToken: completedSessionToken
    });

    return {
      ok: true,
      reason: "CREDIT_ADDED",
      rewardMinutes,
      requestId: completedRequestId,
      sessionToken: completedSessionToken,
      state: getProcessState()
    };
  }

  notify("BOTTLE_REJECTED", {
    requestId: completedRequestId,
    sessionToken: completedSessionToken
  });

  return {
    ok: false,
    reason: completionReason,
    rewardMinutes,
    requestId: completedRequestId,
    sessionToken: completedSessionToken,
    state: getProcessState()
  };
}

async function resetProcess() {
  debugLog("resetProcess called", {
    previousRequestId: processState.requestId,
    previousStatus: processState.pipelineStatus
  });

  try {
    await servoService.closeGate();
  } catch (error) {
    log.error("resetProcess failed to close servo gate", {
      message: error.message
    });
    return {
      ok: false,
      reason: "SERVO_COMMAND_FAILED",
      state: getProcessState()
    };
  }

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