/**
 * Extract a date only when it follows a clearly labeled application/closing
 * deadline in visible posting text. Ambiguous numeric dates are rejected.
 */
export function extractVisibleDeadline(text) {
  const label = /\b(?:closing\s+date|application\s+(?:deadline|closing\s+date)|applications\s+(?:close|closing)|deadline|apply\s+by)\b\s*[:\-–—]?\s*/gi;
  const date = /\b(?:(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4})|(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*[,]?\s+(\d{4})|(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})[,]?\s+(\d{4}))\b/i;
  const months = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, sept: 9, october: 10, november: 11, december: 12, jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  for (const match of text.matchAll(label)) {
    // Stay within the labeled line or its immediate continuation, avoiding a
    // later unrelated date in the body becoming the deadline.
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 120)
      .split(/[.;]/, 1)[0]
      .split("\n", 2)
      .join(" ");
    const found = date.exec(tail);
    date.lastIndex = 0;
    if (!found) continue;
    let year; let month; let day;
    if (found[1]) [, year, month, day] = found;
    else if (found[4]) {
      [, , , , month, day, year] = found;
      // Accept numeric dates only when the order is clear from an impossible
      // month position, or when both positions would yield the same date.
      if (Number(month) > 12 || Number(day) <= 12) continue;
    } else if (found[7]) {
      day = found[7];
      month = months[found[8].toLowerCase()];
      year = found[9];
    } else {
      month = months[found[10].toLowerCase()];
      day = found[11];
      year = found[12];
    }
    const y = Number(year); const m = Number(month); const d = Number(day);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (y < 1000 || parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) continue;
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return "";
}

export function resolveDeadline(visibleDeadline, structuredDeadline, aiDeadline) {
  return visibleDeadline || structuredDeadline || aiDeadline || "";
}
