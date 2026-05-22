const { execSync } = require("child_process");

const ALLOWED_SET_NAME = process.env.HOTSPOT_ALLOWED_SET_NAME || "allowed_clients";
const SHOULD_ENFORCE = process.env.HOTSPOT_ENFORCE_COMMANDS === "1" || process.platform === "linux";

function normalizeMac(mac) {
  return String(mac || "").trim().toLowerCase();
}

function runCommand(command, allowFailure = false) {
  if (!SHOULD_ENFORCE) {
    console.log(`[HOTSPOT] DRY RUN: ${command}`);
    return true;
  }

  try {
    execSync(command, {
      stdio: "pipe",
      encoding: "utf8"
    });
    return true;
  } catch (error) {
    if (!allowFailure) {
      throw error;
    }

    return false;
  }
}

function getIpFromMac(mac) {
  const normalizedMac = normalizeMac(mac);
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
        return ip;
      }

      arpCandidates.push({ ip, mac: rowMac });
    }
  } catch (error) {
    console.warn("[HOTSPOT] Could not read 'arp -an' output", error.message);
  }

  throw new Error(`No IP found for MAC ${mac}. Seen entries: ${arpCandidates.length}`);
}

function allowClientIp(clientIp) {
  runCommand(`sudo ipset add -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  runCommand(`sudo iptables -D FORWARD -s ${clientIp} -j DROP`, true);
}

function blockClientIp(clientIp) {
  runCommand(`sudo ipset del -exist ${ALLOWED_SET_NAME} ${clientIp}`);
  const dropRuleExists = runCommand(`sudo iptables -C FORWARD -s ${clientIp} -j DROP`, true);
  if (!dropRuleExists) {
    runCommand(`sudo iptables -I FORWARD -s ${clientIp} -j DROP`);
  }
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
  getIpFromMac
};
