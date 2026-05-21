function createAccess(mac, minutes) {
  console.log(`[HOTSPOT] GRANT ACCESS -> ${mac} for ${minutes} min`);
  return {
    success: true,
    action: "createAccess",
    mac,
    minutes
  };
}

function extendAccess(mac, minutes) {
  console.log(`[HOTSPOT] EXTEND ACCESS -> ${mac} +${minutes} min`);
  return {
    success: true,
    action: "extendAccess",
    mac,
    minutes
  };
}

function revokeAccess(mac) {
  console.log(`[HOTSPOT] REVOKE ACCESS -> ${mac}`);
  return {
    success: true,
    action: "revokeAccess",
    mac
  };
}

module.exports = {
  createAccess,
  extendAccess,
  revokeAccess
};