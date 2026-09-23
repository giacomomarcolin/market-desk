export const allowedSectors = ["Academic", "Postdoc", "Industry", "Government"];

export function validManualSector(value) {
  if (typeof value !== "string" || !allowedSectors.includes(value.trim())) throw new Error("Sector must be Academic, Postdoc, Industry, or Government.");
  return value.trim();
}

export function trimmedField(value, label, maxLength, required = false) {
  if (typeof value !== "string") throw new Error(`${label} must be text.`);
  const trimmed = value.trim().slice(0, maxLength);
  if (required && !trimmed) throw new Error(`${label} is required.`);
  return trimmed || null;
}

export function validManualDeadline(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Deadline must be empty or a valid date.");
  const text = value.trim();
  if (!text) return null;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("Deadline must use YYYY-MM-DD.");
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error("Deadline must be a valid calendar date.");
  return text;
}

export function validManualSourceUrl(value) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Posting URL must be empty or a valid HTTPS URL.");
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || !url.hostname) throw new Error();
  } catch {
    throw new Error("Posting URL must be a valid HTTPS URL.");
  }
  return text.slice(0, 2048);
}
