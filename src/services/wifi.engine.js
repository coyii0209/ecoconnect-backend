const fs = require("fs");
const path = require("path");

const allowedPath = path.join(__dirname, "../../allowed_macs.txt");
const blockedPath = path.join(__dirname, "../../blocked_macs.txt");

// ensure files exist
function init() {
  if (!fs.existsSync(allowedPath)) fs.writeFileSync(allowedPath, "");
  if (!fs.existsSync(blockedPath)) fs.writeFileSync(blockedPath, "");
}

// allow device internet
function allowMAC(mac) {
  init();

  fs.appendFileSync(allowedPath, mac + "\n");

  console.log(`[WIFI] ALLOW ${mac}`);
}

// block device internet
function blockMAC(mac) {
  init();

  fs.appendFileSync(blockedPath, mac + "\n");

  console.log(`[WIFI] BLOCK ${mac}`);
}

// check status
function getStatus(mac) {
  init();

  const allowed = fs.readFileSync(allowedPath, "utf-8");
  const blocked = fs.readFileSync(blockedPath, "utf-8");

  if (allowed.includes(mac)) return "allowed";
  if (blocked.includes(mac)) return "blocked";
  return "unknown";
}

module.exports = {
  allowMAC,
  blockMAC,
  getStatus,
};