function spreadsheetCell(value) {
  return String(value ?? "").replace(/[\t\r\n\u2028\u2029]+/g, " ").trim();
}

function spreadsheetDeadline(value) {
  const match = value?.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
  return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}/${year}`;
}

export function spreadsheetRow(job) {
  return [
    spreadsheetCell(job.organization),
    spreadsheetCell(job.department),
    spreadsheetCell(job.sector),
    spreadsheetDeadline(job.deadline),
    spreadsheetCell(job.sourceUrl),
    "",
    job.status === "Submitted" ? "Yes" : "No",
    "",
    "",
    "",
  ].join("\t");
}
