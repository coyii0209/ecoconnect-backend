function parseDbTimestamp(value) {
  if (!value) return NaN;

  // SQLite CURRENT_TIMESTAMP is UTC but has no timezone marker.
  // Append Z so JS interprets it as UTC instead of local time.
  if (typeof value === "string" && !/[zZ]|[+\-]\d\d:?\d\d$/.test(value)) {
    return new Date(value.replace(" ", "T") + "Z").getTime();
  }

  return new Date(value).getTime();
}

module.exports = {
  parseDbTimestamp,
};