import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { trimmedField, validDropboxFolderName, validManualDeadline, validManualSector, validManualSourceUrl } from "../db/job-fields.js";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("existing skipped jobs are presented as Not Interested and stay out of Overview and pipeline metrics", async () => {
  const ui = await source("../app/market-desk.tsx");
  assert.match(ui, /bucket: "active" \| "maybe" \| "skipped"/);
  assert.match(ui, /job\.bucket === "skipped" \? " · Not Interested"/);
  assert.match(ui, /view === "overview" \? "active" : view === "not-interested" \? "skipped"/);
  assert.match(ui, /view === "overview" && job\.bucket === "maybe"/);
  assert.match(ui, /data\.jobs\.filter\(\(job\) => job\.bucket !== "skipped"\)/);
  assert.match(ui, /job\.bucket !== "skipped" && pipelineFilters\[pipelineFilter\]/);
});

test("Not Interested view uses only skipped jobs, has a count, and searches saved reasons", async () => {
  const ui = await source("../app/market-desk.tsx");
  assert.match(ui, /type View = "overview" \| "jobs" \| "not-interested" \| "sources"/);
  assert.match(ui, /Not Interested <b>\{data\.jobs\.filter\(\(job\) => job\.bucket === "skipped"\)\.length\}<\/b>/);
  assert.match(ui, /view === "not-interested" \? job\.notInterestedReason : null/);
  assert.match(ui, /showReason=\{view === "not-interested"\}/);
  assert.match(ui, /\{showReason && <th>Reason<\/th>\}/);
  assert.match(ui, /\{showReason && <td><span className="reason-preview"/);
  assert.match(ui, /Reviewed opportunities you decided not to pursue/);
  assert.match(ui, /<option value="status">Application status<\/option>/);
  assert.match(ui, /Filter by sector/);
  assert.match(ui, /onOpen=\{openJob\}/);
  assert.match(ui, /view === "overview" && \(/);
});

test("bucket changes save skipped and active while preserving a saved reason", async () => {
  const storage = await source("../db/storage.ts");
  const updateSource = storage.match(/export async function updateJob\([\s\S]*?\n\}/)?.[0];
  assert.ok(updateSource);
  const javascript = ts.transpileModule(updateSource.replace(/^export /, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const calls = [];
  const database = { prepare(sql) { return { bind(...values) { calls.push({ sql, values }); return { run: async () => {} }; } }; } };
  const updateJob = new Function("ensureMarketSchema", "db", "now", "validDropboxFolderName", "trimmedField", "validManualSector", "validManualDeadline", "validManualSourceUrl", `${javascript}; return updateJob;`)(
    async () => {}, () => database, () => "2026-10-03T00:00:00.000Z", validDropboxFolderName,
    trimmedField, validManualSector, validManualDeadline, validManualSourceUrl,
  );

  await updateJob({ id: "job-1", bucket: "skipped" });
  assert.match(calls[0].sql, /UPDATE jobs SET bucket = \?, updated_at = \? WHERE id = \?/);
  assert.deepEqual(calls[0].values, ["skipped", "2026-10-03T00:00:00.000Z", "job-1"]);
  await updateJob({ id: "job-1", bucket: "active" });
  assert.deepEqual(calls[1].values, ["active", "2026-10-03T00:00:00.000Z", "job-1"]);
  assert.doesNotMatch(calls[1].sql, /not_interested_reason/);
  await updateJob({ id: "job-1", notInterestedReason: "Location" });
  assert.deepEqual(calls[2].values, ["Location", "2026-10-03T00:00:00.000Z", "job-1"]);
  await updateJob({ id: "job-1", notInterestedReason: "Location and fit" });
  assert.deepEqual(calls[3].values, ["Location and fit", "2026-10-03T00:00:00.000Z", "job-1"]);
  await updateJob({ id: "job-1", notInterestedReason: "" });
  assert.deepEqual(calls[4].values, [null, "2026-10-03T00:00:00.000Z", "job-1"]);
});

test("reason migration is idempotent and reason text can be saved, edited, and cleared", async () => {
  const [storage, schema, ui] = await Promise.all([source("../db/storage.ts"), source("../db/schema.ts"), source("../app/market-desk.tsx")]);
  const helper = storage.match(/async function addJobColumnIfMissing\([\s\S]*?\n\}/)?.[0];
  assert.ok(helper);
  const javascript = ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const columns = new Set(["id", "bucket"]);
  let alters = 0;
  const d1 = {
    prepare(sql) {
      if (sql === "PRAGMA table_info(jobs)") return { all: async () => ({ results: [...columns].map((name) => ({ name })) }) };
      return { run: async () => { alters += 1; columns.add("not_interested_reason"); } };
    },
  };
  const addJobColumnIfMissing = new Function(`${javascript}; return addJobColumnIfMissing;`)();
  await addJobColumnIfMissing(d1, "not_interested_reason", "TEXT");
  await addJobColumnIfMissing(d1, "not_interested_reason", "TEXT");
  assert.equal(alters, 1);
  assert.match(storage, /not_interested_reason TEXT/);
  assert.match(storage, /addJobColumnIfMissing\(d1, "not_interested_reason", "TEXT"\)/);
  assert.match(storage, /notInterestedReason: row\.not_interested_reason \?\? null/);
  assert.match(schema, /notInterestedReason: text\("not_interested_reason"\)/);
  assert.match(storage, /if \(typeof input\.notInterestedReason === "string"\).*not_interested_reason = \?.*slice\(0, 5000\) \|\| null/);
  assert.match(ui, /maxLength=\{5000\}/);
  assert.match(ui, /Save reason/);
  assert.match(ui, /Unsaved changes/);
  assert.match(ui, /job\.bucket === "skipped" && <JobReasonEditor/);
});

test("permanent deletion stays separate and requires explicit confirmation", async () => {
  const ui = await source("../app/market-desk.tsx");
  assert.match(ui, /Permanently delete job/);
  assert.match(ui, /window\.confirm\(`Permanently delete/);
  assert.match(ui, /method: "DELETE"/);
  assert.match(ui, /if \(!confirmed\) return/);
});
