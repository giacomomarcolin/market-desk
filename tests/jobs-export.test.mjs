import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { exportFilename, selectedJobsCsv } from "../db/jobs-export.js";

const job = (overrides = {}) => ({ title: "Economist", organization: "Example", sector: "Academic", location: null, salary: null, deadline: null, status: "Saved", starred: false, ...overrides });

// Parse CSV including escaped quotes and embedded line breaks to check its shape.
function parseCsv(csv) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (quoted && c === '"' && csv[i + 1] === '"') { cell += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (!quoted && c === ',') { row.push(cell); cell = ""; }
    else if (!quoted && c === '\r' && csv[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  assert.equal(quoted, false);
  return rows;
}

test("selects all qualifying jobs exactly once and exports the six requested columns", () => {
  const statuses = ["Submitted", "Interview", "Flyout", "Offer"];
  const jobs = [...statuses.map((status) => job({ status })), job({ starred: true }), ...statuses.map((status) => job({ status, starred: true })), job()];
  const result = selectedJobsCsv(jobs);
  assert.equal(result.count, 9);
  const rows = parseCsv(result.csv);
  assert.deepEqual(rows[0], ["Position", "Institution / Company", "Sector", "Location / salary", "Deadline", "Status"]);
  assert.equal(rows.length, 10);
  assert.ok(rows.every((row) => row.length === 6));
  assert.ok(!result.csv.includes("Requirements"));
  assert.ok(!result.csv.includes("Starred"));
  assert.deepEqual(rows[1], ["Economist", "Example", "Academic", "", "", "Submitted"]);
  assert.equal(selectedJobsCsv([job()]).count, 0);
});

test("escapes CSV punctuation and preserves Unicode and line breaks", () => {
  const result = selectedJobsCsv([job({ starred: true, title: 'Économiste, "senior"\r\n研究', organization: 'A\rB', location: 'Chicago, IL', salary: '$120,000', deadline: '2026-11-20' })]);
  assert.ok(result.csv.includes('"Économiste, ""senior""\r\n研究"'));
  assert.deepEqual(parseCsv(result.csv)[1], ['Économiste, "senior"\r\n研究', 'A\rB', 'Academic', 'Chicago, IL | $120,000', 'Nov 20', 'Saved']);
  assert.equal(parseCsv(selectedJobsCsv([job({ starred: true, salary: '$1' })]).csv)[1][3], '$1');
});

test("deadline is calendar-date safe in different timezones", () => {
  const script = `import { selectedJobsCsv } from './db/jobs-export.js'; console.log(selectedJobsCsv([{status:'Submitted', deadline:'2026-11-20'}]).csv);`;
  for (const TZ of ["Pacific/Honolulu", "Pacific/Kiritimati"]) {
    const csv = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ }, encoding: "utf8" });
    assert.equal(parseCsv(csv)[1][4], "Nov 20");
  }
});

test("filename uses local calendar date", () => {
  assert.equal(exportFilename(new Date(2026, 0, 2)), "market-desk-selected-jobs-2026-01-02.csv");
});
