const { execSync } = require("child_process");

const ALLOWED_SET_NAME = process.env.HOTSPOT_ALLOWED_SET_NAME || "allowed_clients";
const SHOULD_ENFORCE = process.env.HOTSPOT_ENFORCE_COMMANDS === "1" || process.platform === "linux";

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
  console.log("[HOTSPOT] Executing command", { command, allowFailure, enforce: SHOULD_ENFORCE });

  if (!SHOULD_ENFORCE) {
    console.log(`[HOTSPOT] DRY RUN: ${command}`);
    return true;
  }

  try {
    execSync(command, {
      stdio: "pipe",
      encoding: "utf8"
    });
    console.log("[HOTSPOT] Command success", { command });
    return true;
  } catch (error) {
    console.warn("[HOTSPOT] Command failed", { command, allowFailure, message: error.message });
    if (!allowFailure) {
      throw error;
    }

    return false;
  }
}

function getIpFromMac(mac) {
  const normalizedMac = normalizeMac(mac);
  console.log("[HOTSPOT] Resolving IP for MAC", { mac, normalizedMac });

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
        console.log("[HOTSPOT] MAC resolved via ip neigh", { mac: normalizedMac, ip });
        return ip;
      }

      arpCandidates.push({ ip, mac: rowMac });
    }
  } catch (error) {
    console.warn("[HOTSPOT] Could not read 'ip neigh show' output", error.message);
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
        console.log("[HOTSPOT] MAC resolved via arp -an", { mac: normalizedMac, ip });
        return ip;
      }

      arpCandidates.push({ ip, mac: rowMac });
    }
  } catch (error) {
    console.warn("[HOTSPOT] Could not read 'arp -an' output", error.message);
  }

  throw new Error(`No IP found for MAC ${mac}. Seen entries: ${arpCandidates.length}`);
}

function getMacFromIp(ip) {
  const normalizedIp = normalizeIp(ip);
  console.log("[HOTSPOT] Resolving MAC for IP", { ip, normalizedIp });

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
        console.log("[HOTSPOT] IP resolved via ip neigh", { ip: normalizedIp, mac: rowMac });
        return rowMac;
      }
    }
  } catch (error) {
    console.warn("[HOTSPOT] Could not read 'ip neigh show <ip>' output", error.message);
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
        console.log("[HOTSPOT] IP resolved via arp -an", { ip: normalizedIp, mac: rowMac });
        return rowMac;
      }
    }
  } catch (error) {
    console.warn("[HOTSPOT] Could not read 'arp -an' output", error.message);
  }

  throw new Error(`No MAC found for IP ${normalizedIp}`);
}

function allowClientIp(clientIp) {
  console.log("[HOTSPOT] Allow client IP", { clientIp, setName: ALLOWED_SET_NAME });
  runCommand(`sudo ipset add -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  runCommand(`sudo iptables -D FORWARD -s ${clientIp} -j DROP`, true);
}

function blockClientIp(clientIp) {
  console.log("[HOTSPOT] Block client IP", { clientIp, setName: ALLOWED_SET_NAME });
  runCommand(`sudo ipset del -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  const dropRuleExists = runCommand(`sudo iptables -C FORWARD -s ${clientIp} -j DROP`, true);
  if (!dropRuleExists) {
    runCommand(`sudo iptables -I FORWARD -s ${clientIp} -j DROP`);
  }
}

function listAllowedClientIps() {
  console.log("[HOTSPOT] Listing allowed client IPs", { setName: ALLOWED_SET_NAME });

  if (!SHOULD_ENFORCE) {
    console.log("[HOTSPOT] DRY RUN: ipset list", { setName: ALLOWED_SET_NAME });
    return [];
  }

  let output = "";

  try {
    output = execSync(`sudo ipset list ${ALLOWED_SET_NAME}`, { encoding: "utf8", stdio: "pipe" });
  } catch (error) {
    console.warn("[HOTSPOT] Could not list allowed client IPs", {
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

  console.log("[HOTSPOT] Allowed client IPs found", { count: ips.length, ips });
  return ips;
}

function revokeAccessByIp(clientIp) {
  const normalizedIp = normalizeIp(clientIp);
  if (!normalizedIp) {
    throw new Error("IP address is required");
  }

  console.log("[HOTSPOT] REVOKE ACCESS BY IP ->", normalizedIp);
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
      console.warn("[HOTSPOT] Failed to revoke allowed client IP", { ip, message: error.message });
    }
  }

  console.log("[HOTSPOT] revokeAllAllowedClientIps complete", {
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

  console.log(`[HOTSPOT] GRANT ACCESS -> ${mac} (${ip}) for ${minutes} min`);
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

  console.log(`[HOTSPOT] EXTEND ACCESS -> ${mac} (${ip}) +${minutes} min`);
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

  console.log(`[HOTSPOT] REVOKE ACCESS -> ${mac} (${ip})`);
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
