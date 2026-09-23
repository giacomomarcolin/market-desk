import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { trimmedField, validDropboxFolderName, validManualDeadline, validManualSector, validManualSourceUrl } from "../db/job-fields.js";

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

test("Dropbox folder names become bounded safe slugs and can be cleared", () => {
  assert.equal(validDropboxFolderName("MIT Sloan - TIES"), "mit_sloan_ties");
  assert.equal(validDropboxFolderName("__MIT___Sloan__"), "mit_sloan");
  assert.equal(validDropboxFolderName("  "), null);
  assert.equal(validDropboxFolderName(null), null);
  assert.equal(validDropboxFolderName("../../outside\\folder"), "outside_folder");
  assert.throws(() => validDropboxFolderName("../.."), /letters or numbers/);
  for (const value of ["/", "\\", ".."])
    assert.throws(() => validDropboxFolderName(value), /letters or numbers/);
  const longName = validDropboxFolderName("Very long folder name ".repeat(10));
  assert.ok(longName.length <= 80);
  assert.match(longName, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
});

test("job schema and PATCH support a nullable Dropbox folder without changing job identity", async () => {
  const [storage, schema, workspace] = await Promise.all([
    source("../db/storage.ts"), source("../db/schema.ts"), source("../app/market-desk.tsx"),
  ]);
  assert.match(storage, /dropbox_folder_name TEXT/);
  assert.match(storage, /PRAGMA table_info\(jobs\)/);
  assert.match(storage, /ALTER TABLE jobs ADD COLUMN dropbox_folder_name TEXT/);
  assert.match(schema, /dropboxFolderName: text\("dropbox_folder_name"\)/);
  assert.match(storage, /dropboxFolderName: row\.dropbox_folder_name \?\? null/);
  assert.match(storage, /if \(input\.dropboxFolderName !== undefined\).*validDropboxFolderName\(input\.dropboxFolderName\)/);
  assert.match(storage, /dropboxFolderPath: applicationFolderPath/);
  assert.match(workspace, /dropboxFolderName: form\.get\("dropboxFolderName"\)/);
  assert.match(workspace, /Changing this does not move files already stored in the previous Dropbox folder/);
  assert.match(workspace, /Dropbox: \{job\.dropboxFolderPath\}\//);
});

test("Dropbox folder resolution overrides the generated path for uploads and listings", async () => {
  const [dropbox, storage] = await Promise.all([source("../db/dropbox.ts"), source("../db/storage.ts")]);
  const functions = ["applicationFolderName", "applicationFolderPath"].map((name) => {
    const match = dropbox.match(new RegExp(`export function ${name}[\\s\\S]*?\\n}`));
    assert.ok(match, `${name} exists`);
    return match[0];
  }).join("\n").replaceAll("export function", "function");
  const javascript = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const { applicationFolderPath } = new Function("validDropboxFolderName", `${javascript}; return { applicationFolderPath };`)(validDropboxFolderName);
  const oldPath = "/JobMkt2026/applications/stanford_graduate_school_of_business_faculty_positions_in_political_economy";
  assert.equal(applicationFolderPath("Stanford Graduate School of Business", "Faculty Positions in Political Economy"), oldPath);
  assert.equal(applicationFolderPath("Stanford Graduate School of Business", "Faculty Positions in Political Economy", null), oldPath);
  assert.equal(applicationFolderPath("Stanford Graduate School of Business", "Faculty Positions in Political Economy", ""), oldPath);
  assert.equal(applicationFolderPath("Stanford Graduate School of Business", "Faculty Positions in Political Economy", "MIT Sloan - TIES"), "/JobMkt2026/applications/mit_sloan_ties");
  assert.equal(applicationFolderPath("A", "B", "../../outside\\folder"), "/JobMkt2026/applications/outside_folder");
  assert.match(dropbox, /const folder = applicationFolderPath\(input\.organization, input\.title, input\.dropboxFolderName\)/);
  assert.match(dropbox, /const path = `\$\{folder\}\/\$\{safeFilename\(input\.filename\)\}`/);
  assert.match(dropbox, /ensureApplicationFolder\(folder, token\)/);
  assert.match(dropbox, /const folder = applicationFolderPath\(organization, title, dropboxFolderName\)/);
  assert.match(storage, /listApplicationFiles\(String\(job\.organization\), String\(job\.title\), dropboxFolderName\)/);
  assert.match(storage, /dropboxFolderName: job\.dropbox_folder_name/);
  assert.match(storage, /dropboxFolderName: metadata\.dropbox_folder_name/);
});

test("job PATCH saves a normalized Dropbox folder and clears it to null", async () => {
  const storage = await source("../db/storage.ts");
  const functionSource = storage.match(/export async function updateJob[\s\S]*?\n}/)?.[0];
  assert.ok(functionSource);
  const javascript = ts.transpileModule(functionSource.replace(/^export /, ""), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const updates = [];
  const database = { prepare(sql) { return { bind(...values) { updates.push({ sql, values }); return { run: async () => {} }; } }; } };
  const updateJob = new Function("ensureMarketSchema", "db", "now", "validDropboxFolderName", "trimmedField", "validManualSector", "validManualDeadline", "validManualSourceUrl", `${javascript}; return updateJob;`)(
    async () => {}, () => database, () => "2026-09-23T00:00:00.000Z", validDropboxFolderName,
    trimmedField, validManualSector, validManualDeadline, validManualSourceUrl,
  );
  await updateJob({ id: "job_1", dropboxFolderName: "MIT Sloan - TIES" });
  await updateJob({ id: "job_1", dropboxFolderName: "" });
  assert.match(updates[0].sql, /dropbox_folder_name = \?/);
  assert.deepEqual(updates[0].values, ["mit_sloan_ties", "2026-09-23T00:00:00.000Z", "job_1"]);
  assert.deepEqual(updates[1].values, [null, "2026-09-23T00:00:00.000Z", "job_1"]);
  assert.ok(updates.every(({ sql }) => !/organization = \?|title = \?/.test(sql)));
});
