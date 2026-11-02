import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { spreadsheetRow } from "../db/spreadsheet-row.js";

const job = (overrides = {}) => ({
  organization: "UC Berkeley Goldman",
  department: "Public Policy",
  sector: "Academic",
  deadline: "2026-10-01",
  sourceUrl: "https://aprecruit.berkeley.edu/JPF05497",
  status: "Submitted",
  ...overrides,
});

test("spreadsheet row contains exactly ten ordered, tab-separated cells", () => {
  const cells = spreadsheetRow(job()).split("\t");
  assert.equal(cells.length, 10);
  assert.deepEqual(cells, [
    "UC Berkeley Goldman", "Public Policy", "Academic", "10/01/2026",
    "https://aprecruit.berkeley.edu/JPF05497", "", "Yes", "", "", "",
  ]);
});

test("Submitted sets Giacomo to Yes and in-progress statuses set it to No", () => {
  assert.equal(spreadsheetRow(job({ status: "Submitted" })).split("\t")[6], "Yes");
  for (const status of ["Saved", "Preparing", "Ready"])
    assert.equal(spreadsheetRow(job({ status })).split("\t")[6], "No");
});

test("missing department, deadline, and link are blank cells", () => {
  const cells = spreadsheetRow(job({ department: null, deadline: null, sourceUrl: null })).split("\t");
  assert.equal(cells.length, 10);
  assert.equal(cells[1], "");
  assert.equal(cells[3], "");
  assert.equal(cells[4], "");
});

test("tabs and line breaks in values are replaced with spaces and trimmed", () => {
  const cells = spreadsheetRow(job({
    organization: "  UC\tBerkeley\nGoldman  ",
    department: " Policy\r\nStudies ",
    sourceUrl: " https://example.edu/jobs\t/123 ",
  })).split("\t");
  assert.equal(cells.length, 10);
  assert.equal(cells[0], "UC Berkeley Goldman");
  assert.equal(cells[1], "Policy Studies");
  assert.equal(cells[4], "https://example.edu/jobs /123");
  assert.ok(cells.every((cell) => !/[\r\n\u2028\u2029]/.test(cell)));
});

test("deadline formatting stays on the calendar date across timezones", () => {
  const script = `import { spreadsheetRow } from './db/spreadsheet-row.js'; console.log(spreadsheetRow({ organization: '', department: '', sector: '', deadline: '2026-11-20', sourceUrl: '', status: 'Saved' }).split('\\t')[3]);`;
  for (const TZ of ["Pacific/Honolulu", "Pacific/Kiritimati"])
    assert.equal(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: process.cwd(), env: { ...process.env, TZ }, encoding: "utf8" }).trim(), "11/20/2026");
});
