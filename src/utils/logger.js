const LEVEL_WEIGHT = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

function normalizeBool(value, defaultValue = true) {
  if (value === undefined || value === null) return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  return !["0", "false", "off", "no"].includes(normalized);
}

const LOG_ENABLED = normalizeBool(process.env.LOG_ENABLED, true);
const LOG_LEVEL = String(process.env.LOG_LEVEL || "info").trim().toLowerCase();
const ACTIVE_LEVEL = LEVEL_WEIGHT[LOG_LEVEL] !== undefined ? LOG_LEVEL : "info";

let consoleConfigured = false;

function shouldLog(level) {
  if (!LOG_ENABLED) return false;
  return LEVEL_WEIGHT[level] <= LEVEL_WEIGHT[ACTIVE_LEVEL];
}

function formatMeta(meta) {
  if (meta === undefined) return "";
  if (typeof meta === "string") return ` ${meta}`;

  try {
    return ` ${JSON.stringify(meta)}`;
  } catch {
    return ` ${String(meta)}`;
  }
}

function createLogger(scope) {
  function write(level, message, meta) {
    if (!shouldLog(level)) return;

    const ts = new Date().toISOString();
    const prefix = `[${ts}] [${level.toUpperCase()}] [${scope}] ${message}`;
    const line = `${prefix}${formatMeta(meta)}`;

    if (level === "error") {
      console.error(line);
      return;
    }

    if (level === "warn") {
      console.warn(line);
      return;
    }

    console.log(line);
  }

  return {
    error(message, meta) {
      write("error", message, meta);
    },
    warn(message, meta) {
      write("warn", message, meta);
    },
    info(message, meta) {
      write("info", message, meta);
    },
    debug(message, meta) {
      write("debug", message, meta);
    }
  };
}

createLogger.configureGlobalConsole = function configureGlobalConsole() {
  if (consoleConfigured || LOG_ENABLED) {
    consoleConfigured = true;
    return;
  }

  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  consoleConfigured = true;
};

createLogger.isEnabled = LOG_ENABLED;
createLogger.level = ACTIVE_LEVEL;

module.exports = createLogger;
