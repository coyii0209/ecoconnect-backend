const { execSync } = require("child_process");
const createLogger = require("../utils/logger");

const ALLOWED_SET_NAME = process.env.HOTSPOT_ALLOWED_SET_NAME || "allowed_clients";
const SHOULD_ENFORCE = process.env.HOTSPOT_ENFORCE_COMMANDS === "1" || process.platform === "linux";
const log = createLogger("HOTSPOT");

function normalizeMac(mac) {
  return String(mac || "").trim().toLowerCase();
}

function normalizeIp(ip) {
  const raw = String(ip || "").trim();
  if (!raw) return "";
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  if (raw === "::1") return "127.0.0.1";
  return raw;
}

function isSafeIpValue(ip) {
  return /^[0-9a-fA-F:.]+$/.test(ip);
}

function runCommand(command, allowFailure = false) {
  log.debug("Executing command", { command, allowFailure, enforce: SHOULD_ENFORCE });

  if (!SHOULD_ENFORCE) {
    log.debug("Dry-run command skipped", { command });
    return true;
  }

  try {
    execSync(command, {
      stdio: "pipe",
      encoding: "utf8"
    });
    log.debug("Command success", { command });
    return true;
  } catch (error) {
    log.warn("Command failed", { command, allowFailure, message: error.message });
    if (!allowFailure) {
      throw error;
    }

    return false;
  }
}

function getIpFromMac(mac) {
  const normalizedMac = normalizeMac(mac);
  log.debug("Resolving IP for MAC", { mac, normalizedMac });

  if (!normalizedMac) {
    throw new Error("MAC address is required");
  }

  const arpCandidates = [];

  try {
    const neighRaw = execSync("ip neigh show", { encoding: "utf8", stdio: "pipe" });
    const lines = neighRaw.split("\n");

    for (const line of lines) {
      if (!line) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const ip = parts[0];
      const lladdrIndex = parts.indexOf("lladdr");
      if (lladdrIndex === -1 || !parts[lladdrIndex + 1]) continue;

      const rowMac = normalizeMac(parts[lladdrIndex + 1]);
      if (rowMac === normalizedMac) {
        log.debug("MAC resolved via ip neigh", { mac: normalizedMac, ip });
        return ip;
      }

      arpCandidates.push({ ip, mac: rowMac });
    }
  } catch (error) {
    log.debug("Could not read ip neigh show output", { message: error.message });
  }

  try {
    const arpRaw = execSync("arp -an", { encoding: "utf8", stdio: "pipe" });
    const lines = arpRaw.split("\n");

    for (const line of lines) {
      if (!line) continue;

      const match = line.match(/\(([^)]+)\).*?(([0-9a-f]{2}:){5}[0-9a-f]{2})/i);
      if (!match) continue;

      const ip = match[1];
      const rowMac = normalizeMac(match[2]);
      if (rowMac === normalizedMac) {
        log.debug("MAC resolved via arp", { mac: normalizedMac, ip });
        return ip;
      }

      arpCandidates.push({ ip, mac: rowMac });
    }
  } catch (error) {
    log.debug("Could not read arp output", { message: error.message });
  }

  throw new Error(`No IP found for MAC ${mac}. Seen entries: ${arpCandidates.length}`);
}

function getMacFromIp(ip) {
  const normalizedIp = normalizeIp(ip);
  log.debug("Resolving MAC for IP", { ip, normalizedIp });

  if (!normalizedIp) {
    throw new Error("IP address is required");
  }

  if (!isSafeIpValue(normalizedIp)) {
    throw new Error("Invalid IP format");
  }

  try {
    const neighRaw = execSync(`ip neigh show ${normalizedIp}`, { encoding: "utf8", stdio: "pipe" });
    const lines = neighRaw.split("\n");

    for (const line of lines) {
      if (!line) continue;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 5) continue;

      const rowIp = normalizeIp(parts[0]);
      const lladdrIndex = parts.indexOf("lladdr");
      if (lladdrIndex === -1 || !parts[lladdrIndex + 1]) continue;

      const rowMac = normalizeMac(parts[lladdrIndex + 1]);
      if (rowIp === normalizedIp && rowMac) {
        log.debug("IP resolved via ip neigh", { ip: normalizedIp, mac: rowMac });
        return rowMac;
      }
    }
  } catch (error) {
    log.debug("Could not read ip neigh show output", { message: error.message, ip: normalizedIp });
  }

  try {
    const arpRaw = execSync("arp -an", { encoding: "utf8", stdio: "pipe" });
    const lines = arpRaw.split("\n");

    for (const line of lines) {
      if (!line) continue;

      const match = line.match(/\(([^)]+)\).*?(([0-9a-f]{2}:){5}[0-9a-f]{2})/i);
      if (!match) continue;

      const rowIp = normalizeIp(match[1]);
      const rowMac = normalizeMac(match[2]);
      if (rowIp === normalizedIp && rowMac) {
        log.debug("IP resolved via arp", { ip: normalizedIp, mac: rowMac });
        return rowMac;
      }
    }
  } catch (error) {
    log.debug("Could not read arp output", { message: error.message });
  }

  throw new Error(`No MAC found for IP ${normalizedIp}`);
}

function allowClientIp(clientIp) {
  log.info("Allowing client IP", { clientIp, setName: ALLOWED_SET_NAME });
  runCommand(`sudo ipset add -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  runCommand(`sudo iptables -D FORWARD -s ${clientIp} -j DROP`, true);
}

function blockClientIp(clientIp) {
  log.info("Blocking client IP", { clientIp, setName: ALLOWED_SET_NAME });
  runCommand(`sudo ipset del -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  const dropRuleExists = runCommand(`sudo iptables -C FORWARD -s ${clientIp} -j DROP`, true);
  if (!dropRuleExists) {
    runCommand(`sudo iptables -I FORWARD -s ${clientIp} -j DROP`);
  }
}

function listAllowedClientIps() {
  log.debug("Listing allowed client IPs", { setName: ALLOWED_SET_NAME });

  if (!SHOULD_ENFORCE) {
    log.debug("Dry-run ipset list", { setName: ALLOWED_SET_NAME });
    return [];
  }

  let output = "";

  try {
    output = execSync(`sudo ipset list ${ALLOWED_SET_NAME}`, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    log.warn("Could not list allowed client IPs", {
      setName: ALLOWED_SET_NAME,
      message: error.message
    });
    return [];
  }

  const lines = output.split("\n");
  const ips = [];
  let inMembers = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === "Members:") {
      inMembers = true;
      continue;
    }

    if (!inMembers) continue;

    const member = normalizeIp(trimmed);
    if (member && isSafeIpValue(member)) {
      ips.push(member);
    }
  }

  log.info("Allowed client IPs listed", { count: ips.length });
  return ips;
}

function revokeAccessByIp(clientIp) {
  const normalizedIp = normalizeIp(clientIp);
  if (!normalizedIp) {
    throw new Error("IP address is required");
  }

  log.info("Revoking access by IP", { ip: normalizedIp });
  blockClientIp(normalizedIp);

  return {
    success: true,
    action: "revokeAccessByIp",
    ip: normalizedIp
  };
}

function revokeAllAllowedClientIps() {
  const ips = listAllowedClientIps();
  let revokedCount = 0;

  for (const ip of ips) {
    try {
      revokeAccessByIp(ip);
      revokedCount += 1;
    } catch (error) {
      log.warn("Failed to revoke allowed client IP", { ip, message: error.message });
    }
  }

  log.info("Revoke-all complete", {
    total: ips.length,
    revokedCount
  });

  return {
    total: ips.length,
    revokedCount
  };
}

function createAccess(mac, minutes) {
  const ip = getIpFromMac(mac);
  allowClientIp(ip);

  log.info("Access granted", { mac, ip, minutes });
  return {
    success: true,
    action: "createAccess",
    mac,
    ip,
    minutes
  };
}

function extendAccess(mac, minutes) {
  const ip = getIpFromMac(mac);
  allowClientIp(ip);

  log.info("Access extended", { mac, ip, minutes });
  return {
    success: true,
    action: "extendAccess",
    mac,
    ip,
    minutes
  };
}

function revokeAccess(mac) {
  const ip = getIpFromMac(mac);
  blockClientIp(ip);

  log.info("Access revoked", { mac, ip });
  return {
    success: true,
    action: "revokeAccess",
    mac,
    ip
  };
}

module.exports = {
  createAccess,
  extendAccess,
  revokeAccess,
  getIpFromMac,
  getMacFromIp,
  normalizeIp,
  normalizeMac,
  listAllowedClientIps,
  revokeAccessByIp,
  revokeAllAllowedClientIps
};
