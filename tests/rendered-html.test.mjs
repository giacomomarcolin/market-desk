import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractVisibleDeadline, resolveDeadline } from "../db/deadline.js";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("includes the personal Dropbox setup and file sync controls", async () => {
  const [marketDesk, filesRoute, syncRoute] = await Promise.all([
    source("../app/market-desk.tsx"),
    source("../app/api/files/route.ts"),
    source("../app/api/dropbox/sync/route.ts"),
  ]);

  assert.match(marketDesk, /Personal Dropbox/);
  assert.match(marketDesk, /Authorize Dropbox/);
  assert.match(marketDesk, /Sync existing files/);
  assert.match(marketDesk, /Dropbox ✓/);
  assert.match(filesRoute, /saveJobFile/);
  assert.match(syncRoute, /syncAllJobFilesToDropbox/);
  assert.match(syncRoute, /syncJobFileToDropbox/);
});

test("keeps Dropbox authorization server-side and protects the refresh token", async () => {
  const dropbox = await source("../db/dropbox.ts");

  assert.match(dropbox, /code_challenge_method/);
  assert.match(dropbox, /token_access_type/);
  assert.match(dropbox, /AES-GCM/);
  assert.match(dropbox, /DROPBOX_TOKEN_KEY/);
  assert.match(dropbox, /refresh_token_ciphertext/);
  assert.match(dropbox, /files\.metadata\.read files\.content\.read files\.content\.write/);
  assert.doesNotMatch(dropbox, /DROPBOX_APP_SECRET|client_secret/);
  assert.doesNotMatch(dropbox, /return \{[^}]*access_token|refresh_token: result/);
});

test("validates and preserves the browser-visible Dropbox callback URL", async () => {
  const [dropbox, startRoute, callbackRoute, marketDesk] = await Promise.all([
    source("../db/dropbox.ts"),
    source("../app/api/dropbox/start/route.ts"),
    source("../app/api/dropbox/callback/route.ts"),
    source("../app/market-desk.tsx"),
  ]);
  const validatorSource = dropbox.match(/export function validateDropboxCallbackUrl\(callbackUrl: string\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(validatorSource);
  const executableValidator = validatorSource.replace(/^export /, "").replace("callbackUrl: string", "callbackUrl").replace(/: URL/g, "");
  const validateDropboxCallbackUrl = new Function(`${executableValidator}; return validateDropboxCallbackUrl;`)();
  const publicCallback = "https://didactic-train-rvgxw7945773xgrg-3000.app.github.dev/api/dropbox/callback";

  assert.equal(validateDropboxCallbackUrl(publicCallback), publicCallback);
  assert.throws(() => validateDropboxCallbackUrl("https://attacker.example/api/dropbox/callback"));
  assert.throws(() => validateDropboxCallbackUrl("https://didactic-train-rvgxw7945773xgrg-3000.app.github.dev/other"));
  assert.match(startRoute, /searchParams\.get\("callbackUrl"\)/);
  assert.match(startRoute, /beginDropboxAuthorization\(callbackUrl\)/);
  assert.match(marketDesk, /window\.location\.origin\}\/api\/dropbox\/callback/);
  assert.match(marketDesk, /callbackUrl=\$\{encodeURIComponent\(callbackUrl\)\}/);
  assert.match(dropbox, /searchParams\.set\("redirect_uri", redirectUri\)/);
  assert.match(dropbox, /redirect_uri: savedState\.redirect_uri/);
  assert.match(dropbox, /return \{ applicationOrigin: new URL\(savedState\.redirect_uri\)\.origin \}/);
  assert.match(callbackRoute, /getDropboxAuthorizationOrigin\(callback\.searchParams\.get\("state"\)\)/);
  assert.match(callbackRoute, /new URL\("\/", publicOrigin\)/);
  assert.match(marketDesk, /“Scoped access” and “App folder” access/);
  assert.doesNotMatch(marketDesk, /“Scoped access” and “Full Dropbox” access/);
});

test("uses deterministic safe application folder names and the JobMkt2026 application path", async () => {
  const dropbox = await source("../db/dropbox.ts");
  const folderFunction = dropbox.match(/export function applicationFolderName[\s\S]*?\n}/)?.[0];
  assert.ok(folderFunction);
  const executableFolderFunction = folderFunction.replace(/^export /, "").replaceAll(": string", "");
  const applicationFolderName = new Function(`${executableFolderFunction}; return applicationFolderName;`)();
  assert.equal(applicationFolderName("Stanford Graduate School of Business", "Faculty Positions in Political Economy"), "stanford_graduate_school_of_business_faculty_positions_in_political_economy");
  assert.match(dropbox, /export function applicationFolderName/);
  assert.match(dropbox, /toLowerCase\(\)/);
  assert.match(dropbox, /replace\(\/\[\^a-z0-9\]\+\/g, "_"\)/);
  assert.match(dropbox, /replace\(\/_\+\/g, "_"\)/);
  assert.match(dropbox, /\/JobMkt2026\/applications\/\$\{validDropboxFolderName\(dropboxFolderName \?\? null\) \|\| applicationFolderName/);
  assert.match(dropbox, /mode: "add", autorename: true/);
});

test("lists Dropbox files, treats missing folders as empty, and follows pagination", async () => {
  const dropbox = await source("../db/dropbox.ts");
  assert.match(dropbox, /files\/list_folder"/);
  assert.match(dropbox, /files\/list_folder\/continue/);
  assert.match(dropbox, /if \(!result\.has_more \|\| !result\.cursor\) break/);
  assert.match(dropbox, /if \(dropboxError\(response, responseBody\)\) return \[\]/);
  assert.match(dropbox, /server_modified/);
  assert.match(dropbox, /sizeBytes:/);
});

test("merges direct Dropbox files into prepared files and serves Dropbox content server-side", async () => {
  const [storage, route, workspace] = await Promise.all([
    source("../db/storage.ts"), source("../app/api/files/route.ts"), source("../app/market-desk.tsx"),
  ]);
  assert.match(storage, /listApplicationFiles/);
  assert.match(storage, /dropboxStatus\.connected \? await listApplicationFiles/);
  assert.match(storage, /downloadApplicationFile\(dropboxPath\)/);
  assert.match(route, /getDropboxFile\(path\)/);
  assert.match(workspace, /Refresh from Dropbox/);
  assert.match(workspace, /\?path=\$\{encodeURIComponent\(file\.dropboxPath/);
  assert.match(workspace, /Modified \$\{new Date/);
});

test("uses the fixed lowest-cost AI extraction model with structured output", async () => {
  const [ai, linkImport, aiRoute] = await Promise.all([
    source("../db/ai.ts"),
    source("../db/link-import.ts"),
    source("../app/api/ai/route.ts"),
  ]);

  assert.match(ai, /AI_EXTRACTION_MODEL = "gpt-5-nano"/);
  assert.match(ai, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(ai, /type: "json_schema"/);
  assert.match(ai, /store: false/);
  assert.match(ai, /service_tier: "default"/);
  assert.match(ai, /reasoning: \{ effort: "minimal" \}/);
  assert.match(ai, /result\.status === "incomplete"/);
  assert.match(ai, /textParts\.join\(""\)/);
  assert.match(ai, /content\.type === "refusal"/);
  assert.match(ai, /parseStructuredJSON/);
  assert.doesNotMatch(ai, /unreadable format/);
  assert.match(ai, /OPENAI_KEY_ENCRYPTION_KEY/);
  assert.match(ai, /AES-GCM/);
  assert.match(ai, /applicationMaterials/);
  assert.match(linkImport, /extractJobWithAI/);
  assert.doesNotMatch(linkImport, /inferTitle|inferOrganization|inferSector/);
  assert.doesNotMatch(aiRoute, /api_key_ciphertext|apiKeyCiphertext/);
});

test("shows employer names, location, and salary on tracked jobs", async () => {
  const marketDesk = await source("../app/market-desk.tsx");

  assert.match(marketDesk, /<th>Position<\/th><th>Institution \/ Company<\/th>/);
  assert.match(marketDesk, /className="organization-cell">\{job\.organization\}<\/td>/);
  assert.match(marketDesk, /className="opportunity opportunity-button" onClick=\{\(\) => onOpen\(job\.id\)\}><strong>\{job\.title\}<\/strong><span>\{job\.source\}/);
  assert.match(marketDesk, /Location \/ salary/);
  assert.match(marketDesk, /Salary not listed/);
  assert.match(marketDesk, /AI extraction/);
  assert.match(marketDesk, /gpt-5-nano/);
});

test("shows time-aware pipeline metrics that open their matching jobs", async () => {
  const [marketDesk, styles] = await Promise.all([
    source("../app/market-desk.tsx"),
    source("../app/globals.css"),
  ]);

  assert.match(marketDesk, /Good morning/);
  assert.match(marketDesk, /Good afternoon/);
  assert.match(marketDesk, /Good evening/);
  assert.doesNotMatch(marketDesk, /Collection rhythm/);
  assert.match(marketDesk, /label="In progress"/);
  assert.match(marketDesk, /label="Submitted"/);
  assert.match(marketDesk, /label="Interviews"/);
  assert.match(marketDesk, /label="Flyouts"/);
  assert.match(marketDesk, /label="Offers"/);
  assert.match(marketDesk, /showPipeline\("interview"\)/);
  assert.match(styles, /grid-template-columns: repeat\(5, 1fr\)/);
});

test("saves a private memo with each job", async () => {
  const [marketDesk, storage] = await Promise.all([
    source("../app/market-desk.tsx"),
    source("../db/storage.ts"),
  ]);

  assert.match(marketDesk, /PRIVATE MEMO/);
  assert.match(marketDesk, /Save note/);
  assert.match(marketDesk, /notes: note/);
  assert.match(storage, /notes\?: string/);
  assert.match(storage, /input\.notes\.slice\(0, 5000\)/);
});

test("imports jobs from any public HTTPS website", async () => {
  const [marketDesk, linkImport] = await Promise.all([
    source("../app/market-desk.tsx"),
    source("../db/link-import.ts"),
  ]);

  assert.match(marketDesk, /Accepts any public HTTPS job-posting page/);
  assert.match(linkImport, /function isPublicJobUrl/);
  assert.match(linkImport, /return host\.replace\(\/\^www\\\.\//);
  assert.doesNotMatch(linkImport, /allowedRoots|allowedHost/);
  assert.doesNotMatch(linkImport, /Use a public HTTPS link from JOE/);
  assert.match(linkImport, /Private, local, signed-in, and nonstandard-port addresses cannot be imported/);
});

test("imports a deduplicated batch of job links sequentially", async () => {
  const marketDesk = await source("../app/market-desk.tsx");

  assert.match(marketDesk, /<textarea name="urls"/);
  assert.match(marketDesk, /new Set\(String\(new FormData/);
  assert.match(marketDesk, /urls\.length > 50/);
  assert.match(marketDesk, /for \(const \[index, url\] of urls\.entries\(\)\)/);
  assert.match(marketDesk, /await fetch\("\/api\/import"/);
  assert.match(marketDesk, /already saved/i);
  assert.match(marketDesk, /Importing \$\{progress\.current\} of \$\{progress\.total\}/);
  assert.match(marketDesk, /Show failed URLs/);
});

test("reads Interfolio positions from their public listing data", async () => {
  const linkImport = await source("../db/link-import.ts");

  assert.match(linkImport, /logic\.interfolio\.com\/dossier-api\/positions/);
  assert.match(linkImport, /position\.landing_page_description/);
  assert.match(linkImport, /position\.qualifications/);
  assert.match(linkImport, /position\.application_instructions/);
  assert.match(linkImport, /source === "Interfolio"/);
  assert.match(linkImport, /directFields\?\.title \|\| extracted\.title/);
  assert.match(linkImport, /directFields\?\.location \|\| extracted\.location/);
});

test("uses JobPosting structured data when visible page text is incomplete", async () => {
  const linkImport = await source("../db/link-import.ts");

  assert.match(linkImport, /application\\\/ld\\\+json/);
  assert.match(linkImport, /findJobPosting/);
  assert.match(linkImport, /posting\.hiringOrganization/);
  assert.match(linkImport, /posting\.validThrough/);
  assert.match(linkImport, /posting\.baseSalary/);
});

test("prefers an explicit visible closing date over conflicting JobPosting metadata", () => {
  const html = `<script type="application/ld+json">{"@type":"JobPosting","validThrough":"2026-10-15"}</script>
    <main><h1>Lecturer / Assistant Professor</h1><p>Closing Date: 20 November 2026</p></main>`;
  const structured = JSON.parse(html.match(/<script[^>]*>(.*?)<\/script>/s)[1]).validThrough;
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ");

  assert.equal(resolveDeadline(extractVisibleDeadline(visible), structured, "2026-12-01"), "2026-11-20");
});

test("uses structured validThrough when there is no explicit visible deadline", () => {
  assert.equal(resolveDeadline(extractVisibleDeadline("Posted 1 October 2026"), "2026-10-15", null), "2026-10-15");
});

test("uses a visible deadline when structured metadata is absent", () => {
  assert.equal(resolveDeadline(extractVisibleDeadline("Application deadline: November 20, 2026"), "", null), "2026-11-20");
});

test("does not use unrelated visible dates as application deadlines", () => {
  const visible = "Date posted: 1 October 2026\nStart date: 1 January 2027\nInterview date: 5 December 2026";
  assert.equal(extractVisibleDeadline(visible), "");
  assert.equal(resolveDeadline(extractVisibleDeadline(visible), "", null), "");
});

test("accepts matching visible and structured deadlines and rejects ambiguous numeric dates", () => {
  assert.equal(resolveDeadline(extractVisibleDeadline("Applications close: 11/20/2026"), "2026-11-20", null), "2026-11-20");
  assert.equal(extractVisibleDeadline("Deadline: 10/11/2026"), "");
  assert.equal(extractVisibleDeadline("Apply by: 2026-11-20"), "2026-11-20");
});

test("sorts and displays deadlines as real dates", async () => {
  const [marketDesk, storage] = await Promise.all([
    source("../app/market-desk.tsx"),
    source("../db/storage.ts"),
  ]);

  assert.match(marketDesk, /function deadlineSortKey/);
  assert.match(marketDesk, /function compareDeadlines/);
  assert.match(marketDesk, /aKey === null\) return 1/);
  assert.match(marketDesk, /aKey >= today \? 0 : 1/);
  assert.match(marketDesk, /Deadline: soonest upcoming/);
  assert.match(marketDesk, /Deadline: latest first/);
  assert.match(marketDesk, /Passed \$\{Math\.abs\(daysAway\)\}/);
  assert.match(marketDesk, /Due today/);
  assert.doesNotMatch(marketDesk, /job\.deadline \? "11:59 PM"/);
  assert.match(storage, /function normalizedStoredDeadline/);
  assert.match(storage, /const deadline = normalizedStoredDeadline\(input\.deadline\)/);
});

test("keeps the public template unbound and documents its privacy boundary", async () => {
  const [hostingSource, readme, privacy, releaseCheck] = await Promise.all([
    source("../.openai/hosting.json"),
    source("../README.md"),
    source("../PRIVACY.md"),
    source("../scripts/check-public-release.mjs"),
  ]);
  const hosting = JSON.parse(hostingSource);

  assert.equal(hosting.project_id, undefined);
  assert.equal(hosting.d1, "DB");
  assert.equal(hosting.r2, "FILES");
  assert.match(readme, /single-user/i);
  assert.match(readme, /owner-only/i);
  assert.match(privacy, /Do not expose an unmodified deployment to the public internet/i);
  assert.match(releaseCheck, /Public release check passed/);
});
