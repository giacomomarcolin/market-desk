const exportStatuses = new Set(["Submitted", "Interview", "Flyout", "Offer"]);
const headers = ["Position", "Institution / Company", "Sector", "Location / salary", "Deadline", "Status"];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDeadline(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) return value || "";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return value;
  return `${months[month - 1]} ${day}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function selectedJobsCsv(jobs) {
  const selected = jobs.filter((job) => job.starred === true || exportStatuses.has(job.status));
  const rows = selected.map((job) => [
    job.title, job.organization, job.sector,
    [job.location, job.salary].filter(Boolean).join(" | "),
    formatDeadline(job.deadline), job.status,
  ]);
  return { count: selected.length, csv: [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n" };
}

export function exportFilename(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `market-desk-selected-jobs-${now.getFullYear()}-${month}-${day}.csv`;
}
