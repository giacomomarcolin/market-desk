import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { trimmedField, validManualDeadline, validManualSector, validManualSourceUrl } from "../db/job-fields.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("manual edits accept corrected title and organization values", () => {
  assert.equal(trimmedField("  Assistant Professor  ", "Title", 240, true), "Assistant Professor");
  assert.equal(trimmedField("  Example University  ", "Institution / Company", 240, true), "Example University");
  assert.throws(() => trimmedField("   ", "Title", 240, true), /required/);
  assert.throws(() => trimmedField("   ", "Institution / Company", 240, true), /required/);
});

test("manual deadlines can change between valid YYYY-MM-DD dates", () => {
  assert.equal(validManualDeadline("2026-11-20"), "2026-11-20");
  assert.equal(validManualDeadline("2027-01-15"), "2027-01-15");
});

test("manual location, salary, and deadline fields can be cleared", () => {
  assert.equal(trimmedField("  ", "Location", 240), null);
  assert.equal(trimmedField("", "Salary / compensation", 240), null);
  assert.equal(validManualDeadline(""), null);
  assert.equal(validManualDeadline(null), null);
});

test("manual edits reject invalid sectors and malformed deadlines", () => {
  for (const sector of ["Other", "academic", ""])
    assert.throws(() => validManualSector(sector), /Sector/);
  for (const deadline of ["2026-2-01", "2026-02-30", "November 20, 2026", "2026/11/20"])
    assert.throws(() => validManualDeadline(deadline), /Deadline/);
});

test("manual posting URL accepts HTTPS and rejects malformed or non-HTTPS URLs", () => {
  assert.equal(validManualSourceUrl(" https://jobs.example.edu/role "), "https://jobs.example.edu/role");
  assert.equal(validManualSourceUrl(""), null);
  for (const url of ["http://jobs.example.edu/role", "not a URL", "https://"])
    assert.throws(() => validManualSourceUrl(url), /HTTPS URL/);
});

test("job updates keep status and notes support and patch only approved columns", async () => {
  const [storage, workspace] = await Promise.all([source("../db/storage.ts"), source("../app/market-desk.tsx")]);
  for (const field of ["title", "organization", "sector", "deadline", "location", "salary", "source_url"])
    assert.match(storage, new RegExp(`\\"${field} = \\?\\"`));
  assert.match(storage, /status\?: string/);
  assert.match(storage, /notes\?: string/);
  assert.match(storage, /notes = \?/);
  assert.doesNotMatch(storage.slice(storage.indexOf("export async function updateJob"), storage.indexOf("export async function updateRequirement")), /source_snapshot\s*=/);
  assert.match(workspace, /Edit details/);
  assert.match(workspace, /type="date"/);
  assert.match(workspace, /Save changes/);
  assert.match(workspace, /Cancel/);
});
