import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.doesNotMatch(dropbox, /DROPBOX_APP_SECRET|client_secret/);
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

  assert.match(marketDesk, /className="org-mark" title=\{job\.organization\}>\{job\.organization\}/);
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
