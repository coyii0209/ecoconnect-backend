const { SerialPort } = require("serialport");
const createLogger = require("../utils/logger");

const log = createLogger("SERVO");

const BAUD_RATE = parseInt(process.env.SERVO_BAUD_RATE || "115200", 10);
const OPEN_COMMAND = String(process.env.SERVO_OPEN_COMMAND || "o");
const CLOSE_COMMAND = String(process.env.SERVO_CLOSE_COMMAND || "c");
const READY_DELAY_MS = parseInt(process.env.SERVO_READY_DELAY_MS || "1500", 10);
const PORT_HINT = String(process.env.SERVO_PORT || "").trim();

let activePort = null;
let activePortPath = null;
let isReady = false;
let commandQueue = Promise.resolve();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function scorePort(portPath) {
  if (!portPath) return 0;
  if (/ttyUSB/i.test(portPath)) return 100;
  if (/ttyACM/i.test(portPath)) return 90;
  if (/cu\.usbmodem/i.test(portPath)) return 80;
  if (/cu\.usbserial/i.test(portPath)) return 70;
  return 0;
}

async function resolvePortPath() {
  if (PORT_HINT) {
    return PORT_HINT;
  }

  const ports = await SerialPort.list();

  if (!ports.length) {
    throw new Error("No serial devices found for servo");
  }

  const ranked = ports
    .map((port) => ({
      path: port.path,
      score: scorePort(port.path)
    }))
    .sort((a, b) => b.score - a.score);

  if (!ranked[0]?.path) {
    throw new Error("Unable to select a serial device for servo");
  }

  return ranked[0].path;
}

async function ensureOpenPort() {
  if (activePort && activePort.isOpen) {
    return activePort;
  }

  const path = await resolvePortPath();

  activePort = new SerialPort({
    path,
    baudRate: BAUD_RATE,
    autoOpen: false
  });

  activePort.on("close", () => {
    log.warn("Servo serial port closed", { path: activePortPath });
    activePort = null;
    activePortPath = null;
    isReady = false;
  });

  activePort.on("error", (error) => {
    log.error("Servo serial port error", {
      path: activePortPath,
      message: error.message
    });
  });

  await new Promise((resolve, reject) => {
    activePort.open((error) => {
      if (error) {
        return reject(error);
      }
      return resolve();
    });
  });

  activePortPath = path;

  if (!isReady && READY_DELAY_MS > 0) {
    // Arduino-class boards often reboot on serial open.
    await delay(READY_DELAY_MS);
  }

  isReady = true;
  log.info("Servo serial port ready", {
    path: activePortPath,
    baudRate: BAUD_RATE
  });

  return activePort;
}

async function sendRawCommand(command) {
  const port = await ensureOpenPort();

  await new Promise((resolve, reject) => {
    port.write(command, (writeError) => {
      if (writeError) {
        return reject(writeError);
      }

      port.drain((drainError) => {
        if (drainError) {
          return reject(drainError);
        }
        return resolve();
      });
    });
  });

  log.debug("Servo command sent", {
    path: activePortPath,
    command
  });
}

function enqueueCommand(command) {
  commandQueue = commandQueue.then(() => sendRawCommand(command));
  return commandQueue;
}

async function openGate() {
  await enqueueCommand(OPEN_COMMAND);
  return { ok: true, command: OPEN_COMMAND, path: activePortPath };
}

async function closeGate() {
  await enqueueCommand(CLOSE_COMMAND);
  return { ok: true, command: CLOSE_COMMAND, path: activePortPath };
}

module.exports = {
  openGate,
  closeGate
};