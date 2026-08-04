import { env } from "cloudflare:workers";
import { getDropboxStatus, uploadJobFileToDropbox } from "./dropbox";
import { getAIStatus } from "./ai";

type D1Row = Record<string, unknown>;
type CreateJobInput = {
  title?: string;
  organization?: string;
  sector?: string;
  source?: string;
  sourceUrl?: string;
  deadline?: string;
  location?: string;
  salary?: string;
  postingText?: string;
  requirements?: string[];
};

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function db() {
  if (!env.DB) throw new Error("The Market Desk database is unavailable.");
  return env.DB;
}

function bool(value: unknown) {
  return value === true || value === 1;
}

function normalizedStoredDeadline(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return null;
  const exact = text.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (exact) {
    const year = Number(exact[1]);
    const month = Number(exact[2]);
    const day = Number(exact[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return text;
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

function mapJob(row: D1Row) {
  return {
    id: row.id,
    organization: row.organization,
    department: row.department,
    title: row.title,
    sector: row.sector,
    location: row.location,
    salary: row.salary,
    deadline: row.deadline,
    source: row.source,
    sourceUrl: row.source_url,
    status: row.status,
    bucket: row.bucket || "active",
    requirementsDone: Number(row.requirements_done || 0),
    requirementsTotal: Number(row.requirements_total || 0),
    nextAction: row.next_action,
    starred: bool(row.starred),
    updatedAt: row.updated_at,
  };
}

function mapSource(row: D1Row) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    method: row.method,
    url: row.url,
    status: row.status,
    cadenceHours: Number(row.cadence_hours || 24),
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    itemsAdded: Number(row.items_added || 0),
    message: row.message,
  };
}

export async function ensureMarketSchema() {
  const d1 = db();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      organization TEXT NOT NULL,
      department TEXT,
      title TEXT NOT NULL,
      sector TEXT NOT NULL,
      location TEXT,
      salary TEXT,
      deadline TEXT,
      source TEXT NOT NULL,
      source_url TEXT UNIQUE,
      source_snapshot TEXT,
      collection_mode TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'Saved',
      bucket TEXT NOT NULL DEFAULT 'active',
      next_action TEXT,
      notes TEXT,
      starred INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS job_files (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      filename TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      content_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      uploaded_at TEXT NOT NULL,
      dropbox_path TEXT,
      dropbox_status TEXT NOT NULL DEFAULT 'not_synced',
      dropbox_synced_at TEXT,
      dropbox_error TEXT
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS dropbox_config (
      id TEXT PRIMARY KEY,
      app_key TEXT NOT NULL,
      refresh_token_ciphertext TEXT,
      refresh_token_iv TEXT,
      account_id TEXT,
      connected_at TEXT,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS ai_config (
      id TEXT PRIMARY KEY,
      api_key_ciphertext TEXT NOT NULL,
      api_key_iv TEXT NOT NULL,
      configured_at TEXT,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS dropbox_oauth_states (
      state TEXT PRIMARY KEY,
      code_verifier TEXT NOT NULL,
      redirect_uri TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS job_requirements (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      document_version TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS source_monitors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT,
      status TEXT NOT NULL,
      cadence_hours INTEGER NOT NULL DEFAULT 24,
      last_checked_at TEXT,
      next_check_at TEXT,
      items_added INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due_at TEXT,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS collection_runs (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL REFERENCES source_monitors(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      items_seen INTEGER NOT NULL DEFAULT 0,
      items_added INTEGER NOT NULL DEFAULT 0,
      message TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs(status)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS jobs_deadline_idx ON jobs(deadline)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS requirements_job_idx ON job_requirements(job_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS files_job_idx ON job_files(job_id)"),
    d1.prepare("CREATE INDEX IF NOT EXISTS tasks_due_idx ON tasks(due_at)"),
  ]);
  const jobColumns = await d1.prepare("PRAGMA table_info(jobs)").all<{ name: string }>();
  if (!jobColumns.results.some((column) => column.name === "bucket")) {
    await d1.prepare("ALTER TABLE jobs ADD COLUMN bucket TEXT NOT NULL DEFAULT 'active'").run();
  }
  if (!jobColumns.results.some((column) => column.name === "salary")) {
    await d1.prepare("ALTER TABLE jobs ADD COLUMN salary TEXT").run();
  }
  if (!jobColumns.results.some((column) => column.name === "notes")) {
    await d1.prepare("ALTER TABLE jobs ADD COLUMN notes TEXT").run();
  }
  const fileColumns = await d1.prepare("PRAGMA table_info(job_files)").all<{ name: string }>();
  const fileColumnNames = new Set(fileColumns.results.map((column) => column.name));
  if (!fileColumnNames.has("dropbox_path")) await d1.prepare("ALTER TABLE job_files ADD COLUMN dropbox_path TEXT").run();
  if (!fileColumnNames.has("dropbox_status")) await d1.prepare("ALTER TABLE job_files ADD COLUMN dropbox_status TEXT NOT NULL DEFAULT 'not_synced'").run();
  if (!fileColumnNames.has("dropbox_synced_at")) await d1.prepare("ALTER TABLE job_files ADD COLUMN dropbox_synced_at TEXT").run();
  if (!fileColumnNames.has("dropbox_error")) await d1.prepare("ALTER TABLE job_files ADD COLUMN dropbox_error TEXT").run();
  await removePlaceholderJobs();
  await seedMarketDesk();
}

async function removePlaceholderJobs() {
  const d1 = db();
  const ids = ["job_mit", "job_stanford", "job_fed", "job_cornerstone"];
  const placeholders = ids.map(() => "?").join(",");
  await d1.batch([
    d1.prepare(`DELETE FROM job_files WHERE job_id IN (${placeholders})`).bind(...ids),
    d1.prepare(`DELETE FROM job_requirements WHERE job_id IN (${placeholders})`).bind(...ids),
    d1.prepare(`DELETE FROM tasks WHERE job_id IN (${placeholders})`).bind(...ids),
    d1.prepare(`DELETE FROM jobs WHERE id IN (${placeholders})`).bind(...ids),
  ]);
}

async function seedMarketDesk() {
  const d1 = db();
  const sourceCount = await d1.prepare("SELECT COUNT(*) AS count FROM source_monitors").first<{ count: number }>();
  if (!sourceCount?.count) {
    const createdAt = now();
    await d1.batch([
      d1.prepare("INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("source_joe", "JOE", "Academic", "guided_capture", "https://www.aeaweb.org/joe/listings", "manual", 24, "Use guided capture or an approved alert; JOE restricts automated collection.", createdAt),
      d1.prepare("INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("source_ejm", "EconJobMarket", "Academic", "guided_capture", "https://econjobmarket.org/", "manual", 24, "Candidate listings use guided capture; automated access requires authorization.", createdAt),
      d1.prepare("INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("source_ajo", "AcademicJobsOnline", "Academic", "official_page", "https://academicjobsonline.org/ajo/econ", "review", 24, "Economics listings are identified; automatic access remains off until rules are confirmed.", createdAt),
      d1.prepare("INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("source_x", "X postdocs", "Postdoc", "official_api", "https://x.com/search", "credential", 6, "Recent-post monitoring is ready to connect with an official X API credential.", createdAt),
      d1.prepare("INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,message,created_at) VALUES (?,?,?,?,?,?,?,?,?)").bind("source_industry", "Industry watchlist", "Industry", "guided_capture", null, "manual", 24, "Add official employer feeds for consulting, tech, finance, and research roles.", createdAt),
    ]);
  }

}

export async function getDashboardData() {
  await ensureMarketSchema();
  const d1 = db();
  const [jobsResult, sourcesResult, tasksResult, dropbox, ai] = await Promise.all([
    d1.prepare(`SELECT j.*, SUM(CASE WHEN r.completed = 1 THEN 1 ELSE 0 END) AS requirements_done, COUNT(r.id) AS requirements_total
      FROM jobs j LEFT JOIN job_requirements r ON r.job_id = j.id
      GROUP BY j.id ORDER BY j.starred DESC, CASE WHEN j.deadline IS NULL THEN 1 ELSE 0 END, j.deadline ASC`).all(),
    d1.prepare("SELECT * FROM source_monitors ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'credential' THEN 1 WHEN 'review' THEN 2 ELSE 3 END, name").all(),
    d1.prepare("SELECT t.*, j.organization FROM tasks t LEFT JOIN jobs j ON j.id = t.job_id ORDER BY t.completed, CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END, t.due_at").all(),
    getDropboxStatus(),
    getAIStatus(),
  ]);
  return {
    jobs: jobsResult.results.map((row) => mapJob(row as D1Row)),
    sources: sourcesResult.results.map((row) => mapSource(row as D1Row)),
    tasks: tasksResult.results.map((row) => ({ id: row.id, jobId: row.job_id, title: row.title, dueAt: row.due_at, completed: bool(row.completed), organization: row.organization })),
    dropbox,
    ai,
  };
}

export async function getJobDetails(jobId: string) {
  await ensureMarketSchema();
  const d1 = db();
  const job = await d1.prepare(`SELECT j.*, SUM(CASE WHEN r.completed = 1 THEN 1 ELSE 0 END) AS requirements_done, COUNT(r.id) AS requirements_total
    FROM jobs j LEFT JOIN job_requirements r ON r.job_id = j.id WHERE j.id = ? GROUP BY j.id`).bind(jobId).first<D1Row>();
  if (!job) throw new Error("Job not found.");
  const [requirements, files] = await Promise.all([
    d1.prepare("SELECT id,label,completed,document_version FROM job_requirements WHERE job_id = ? ORDER BY sort_order,label").bind(jobId).all<D1Row>(),
    d1.prepare("SELECT id,label,filename,content_type,size_bytes,uploaded_at,dropbox_path,dropbox_status,dropbox_synced_at,dropbox_error FROM job_files WHERE job_id = ? ORDER BY uploaded_at DESC").bind(jobId).all<D1Row>(),
  ]);
  return {
    ...mapJob(job),
    sourceSnapshot: job.source_snapshot,
    notes: job.notes,
    capturedAt: job.captured_at,
    requirements: requirements.results.map((row) => ({ id: row.id, label: row.label, completed: bool(row.completed), documentVersion: row.document_version })),
    files: files.results.map((row) => ({ id: row.id, label: row.label, filename: row.filename, contentType: row.content_type, sizeBytes: Number(row.size_bytes), uploadedAt: row.uploaded_at, dropboxPath: row.dropbox_path, dropboxStatus: row.dropbox_status || "not_synced", dropboxSyncedAt: row.dropbox_synced_at, dropboxError: row.dropbox_error })),
  };
}

function inferredRequirements(text: string, sector: string) {
  const candidates = [
    ["CV", /\b(curriculum vitae|cv)\b/i],
    ["Resume", /\br[eé]sum[eé]\b/i],
    ["Cover letter", /cover letter|application letter|letter of (?:interest|motivation)/i],
    ["Job-market paper", /job.?market paper/i],
    ["Writing sample", /writing sample/i],
    ["Research statement", /research statement|statement of research/i],
    ["Research proposal", /research proposal/i],
    ["Research summary", /research summary|summary of research/i],
    ["Teaching statement", /teaching statement|teaching philosophy|statement of teaching/i],
    ["Teaching portfolio", /teaching portfolio/i],
    ["Teaching evaluations", /teaching evaluations?|evidence of teaching (?:effectiveness|excellence)/i],
    ["Diversity and inclusion statement", /diversity statement|dei statement|edi statement|inclusive excellence statement|statement (?:on|describing).*?(?:diversity|equity|inclusion)/i],
    ["Transcript", /transcripts?|academic record/i],
    ["Reference letters", /reference letters?|letters? of recommendation|confidential letters? of reference/i],
    ["Reference contact information", /(?:names?|contact information|contact details) (?:of|for) (?:\w+ )?(?:references|referees)/i],
    ["Publication list", /list of publications|publication list/i],
    ["Research papers", /research papers?|selected publications/i],
    ["Dissertation abstract", /dissertation abstract/i],
    ["Sample syllabus", /sample syllab(?:us|i)|course syllabus/i],
    ["Portfolio", /professional portfolio|work portfolio/i],
    ["Statement of purpose", /statement of purpose/i],
    ["Personal statement", /personal statement/i],
    ["Degree certificate", /degree certificate|copy of (?:your )?(?:degree|diploma)/i],
    ["Application form", /completed application form|online application form/i],
    ["Work authorization documentation", /proof of (?:work authorization|eligibility to work)|work authorization document/i],
    ["EEO or diversity form", /eeo form|equal employment opportunity form|diversity survey/i],
  ] as const;
  const found = candidates.filter(([, pattern]) => pattern.test(text)).map(([label]) => label);
  if (found.length) return found;
  if (sector === "Academic") return ["CV", "Cover letter", "Job-market paper", "Research statement", "Reference letters"];
  if (sector === "Postdoc") return ["CV", "Cover letter", "Research proposal", "Reference letters"];
  return ["Resume", "Cover letter", "Writing sample"];
}

export async function createJob(input: CreateJobInput, collectionMode = "manual") {
  await ensureMarketSchema();
  if (!input.title?.trim() || !input.organization?.trim()) throw new Error("Title and organization are required.");
  const d1 = db();
  const jobId = id("job");
  const timestamp = now();
  const sector = input.sector || "Academic";
  const deadline = normalizedStoredDeadline(input.deadline);
  const suppliedRequirements = Array.isArray(input.requirements)
    ? [...new Set(input.requirements.map((label) => String(label).trim().replace(/\s+/g, " ").slice(0, 180)).filter(Boolean))].slice(0, 40)
    : null;
  const requirements = suppliedRequirements || inferredRequirements(input.postingText || "", sector);
  const nextAction = sector === "Academic" ? "Review fit and tailor application materials" : "Review role and identify the next application step";
  const statements = [
    d1.prepare(`INSERT INTO jobs (id,organization,title,sector,location,salary,deadline,source,source_url,source_snapshot,collection_mode,status,next_action,starred,captured_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(jobId, input.organization.trim(), input.title.trim(), sector, input.location || null, input.salary || null, deadline, input.source || "Manual capture", input.sourceUrl || null, input.postingText || null, collectionMode, "Saved", nextAction, 0, timestamp, timestamp),
    d1.prepare("INSERT INTO tasks (id,job_id,title,due_at,completed,created_at) VALUES (?,?,?,?,?,?)").bind(id("task"), jobId, nextAction, deadline, 0, timestamp),
    ...requirements.map((label, index) => d1.prepare("INSERT INTO job_requirements (id,job_id,label,completed,sort_order) VALUES (?,?,?,?,?)").bind(id("req"), jobId, label, 0, index)),
  ];
  await d1.batch(statements);
  return { id: jobId };
}

export async function updateJob(input: { id?: string; status?: string; starred?: boolean; bucket?: string; notes?: string }) {
  await ensureMarketSchema();
  if (!input.id) throw new Error("Job id is required.");
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.status) { fields.push("status = ?"); values.push(input.status); }
  if (input.bucket && ["active", "maybe", "skipped"].includes(input.bucket)) { fields.push("bucket = ?"); values.push(input.bucket); }
  if (typeof input.starred === "boolean") { fields.push("starred = ?"); values.push(input.starred ? 1 : 0); }
  if (typeof input.notes === "string") { fields.push("notes = ?"); values.push(input.notes.slice(0, 5000) || null); }
  if (!fields.length) return;
  fields.push("updated_at = ?"); values.push(now(), input.id);
  await db().prepare(`UPDATE jobs SET ${fields.join(", ")} WHERE id = ?`).bind(...values).run();
}

export async function updateRequirement(input: { id?: string; completed?: boolean }) {
  await ensureMarketSchema();
  if (!input.id || typeof input.completed !== "boolean") throw new Error("A requirement and completion state are required.");
  await db().prepare("UPDATE job_requirements SET completed = ? WHERE id = ?").bind(input.completed ? 1 : 0, input.id).run();
}

export async function addJobRequirement(input: { jobId?: string; label?: string }) {
  await ensureMarketSchema();
  const jobId = input.jobId?.trim();
  const label = input.label?.trim().replace(/\s+/g, " ").slice(0, 180);
  if (!jobId || !label) throw new Error("Enter a required application material.");
  const d1 = db();
  const job = await d1.prepare("SELECT id FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job) throw new Error("Job not found.");
  const duplicate = await d1.prepare("SELECT id FROM job_requirements WHERE job_id = ? AND lower(label) = lower(?)").bind(jobId, label).first();
  if (duplicate) throw new Error("That required material is already listed.");
  const order = await d1.prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM job_requirements WHERE job_id = ?").bind(jobId).first<{ next_order: number }>();
  const requirementId = id("req");
  await d1.batch([
    d1.prepare("INSERT INTO job_requirements (id,job_id,label,completed,sort_order) VALUES (?,?,?,?,?)").bind(requirementId, jobId, label, 0, Number(order?.next_order || 0)),
    d1.prepare("UPDATE jobs SET updated_at = ? WHERE id = ?").bind(now(), jobId),
  ]);
  return { id: requirementId };
}

export async function deleteJob(jobId: string) {
  await ensureMarketSchema();
  if (!jobId) throw new Error("Job id is required.");
  const d1 = db();
  const job = await d1.prepare("SELECT id FROM jobs WHERE id = ?").bind(jobId).first();
  if (!job) throw new Error("Job not found.");
  const fileRows = await d1.prepare("SELECT object_key FROM job_files WHERE job_id = ?").bind(jobId).all<{ object_key: string }>();
  const objectKeys = fileRows.results.map((row) => row.object_key).filter(Boolean);
  if (objectKeys.length) await filesBucket().delete(objectKeys);
  await d1.batch([
    d1.prepare("DELETE FROM job_files WHERE job_id = ?").bind(jobId),
    d1.prepare("DELETE FROM job_requirements WHERE job_id = ?").bind(jobId),
    d1.prepare("DELETE FROM tasks WHERE job_id = ?").bind(jobId),
    d1.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId),
  ]);
}

function filesBucket() {
  const bucket = (env as unknown as { FILES?: R2Bucket }).FILES;
  if (!bucket) throw new Error("File storage is unavailable.");
  return bucket;
}

export async function saveJobFile(jobId: string, file: File, label?: string) {
  await ensureMarketSchema();
  if (!jobId || !file?.name || file.size <= 0) throw new Error("Choose a file to upload.");
  if (file.size > 25 * 1024 * 1024) throw new Error("Files must be 25 MB or smaller.");
  const job = await db().prepare("SELECT id,organization,title FROM jobs WHERE id = ?").bind(jobId).first<{ id: string; organization: string; title: string }>();
  if (!job) throw new Error("Job not found.");
  const fileId = id("file");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-140) || "document";
  const objectKey = `jobs/${jobId}/${fileId}-${safeName}`;
  const contentType = file.type || "application/octet-stream";
  const bytes = await file.arrayBuffer();
  await filesBucket().put(objectKey, bytes, { httpMetadata: { contentType } });
  await db().prepare("INSERT INTO job_files (id,job_id,label,filename,object_key,content_type,size_bytes,uploaded_at) VALUES (?,?,?,?,?,?,?,?)")
    .bind(fileId, jobId, label?.trim() || file.name, file.name, objectKey, contentType, file.size, now()).run();
  const dropbox = await uploadJobFileToDropbox({ fileId, organization: job.organization, title: job.title, label: label?.trim() || file.name, filename: file.name, bytes });
  return { id: fileId, dropboxStatus: dropbox.status };
}

export async function syncJobFileToDropbox(fileId: string) {
  await ensureMarketSchema();
  const metadata = await db().prepare(`SELECT f.id,f.label,f.filename,f.object_key,j.organization,j.title
    FROM job_files f JOIN jobs j ON j.id=f.job_id WHERE f.id=?`).bind(fileId).first<D1Row>();
  if (!metadata) throw new Error("File not found.");
  const object = await filesBucket().get(String(metadata.object_key));
  if (!object) throw new Error("Stored file not found.");
  return uploadJobFileToDropbox({
    fileId: String(metadata.id),
    organization: String(metadata.organization),
    title: String(metadata.title),
    label: String(metadata.label),
    filename: String(metadata.filename),
    bytes: await object.arrayBuffer(),
  });
}

export async function syncAllJobFilesToDropbox() {
  await ensureMarketSchema();
  const rows = await db().prepare("SELECT id FROM job_files WHERE dropbox_status != 'synced' ORDER BY uploaded_at LIMIT 50").all<{ id: string }>();
  let synced = 0;
  let failed = 0;
  for (const row of rows.results) {
    const result = await syncJobFileToDropbox(row.id);
    if (result.status === "synced") synced += 1;
    else failed += 1;
  }
  return { attempted: rows.results.length, synced, failed };
}

export async function getJobFile(fileId: string) {
  await ensureMarketSchema();
  const metadata = await db().prepare("SELECT id,filename,object_key,content_type,size_bytes FROM job_files WHERE id = ?").bind(fileId).first<D1Row>();
  if (!metadata) throw new Error("File not found.");
  const object = await filesBucket().get(String(metadata.object_key));
  if (!object) throw new Error("Stored file not found.");
  return { metadata, object };
}

export async function createSourceMonitor(input: { name?: string; category?: string; method?: string; url?: string; cadenceHours?: string | number }) {
  await ensureMarketSchema();
  if (!input.name?.trim() || !input.url?.trim() || !["rss", "json"].includes(input.method || "")) throw new Error("A valid feed is required.");
  const cadence = Math.max(1, Number(input.cadenceHours) || 24);
  await db().prepare(`INSERT INTO source_monitors (id,name,category,method,url,status,cadence_hours,next_check_at,items_added,message,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id("source"), input.name.trim(), input.category || "Academic", input.method, input.url.trim(), "active", cadence, now(), 0, "Official feed enabled. New entries are deduplicated by source URL.", now()).run();
}

export async function markSourceReviewed(sourceId: string) {
  await ensureMarketSchema();
  if (!sourceId) throw new Error("Source id is required.");
  await db().prepare("UPDATE source_monitors SET last_checked_at = ? WHERE id = ?").bind(now(), sourceId).run();
}

function stripMarkup(value: string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
}

function tag(block: string, name: string) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? stripMarkup(match[1]) : "";
}

function parseFeed(text: string) {
  const blocks = text.match(/<item\b[\s\S]*?<\/item>/gi) || text.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, 100).map((block) => {
    const linkTag = tag(block, "link");
    const href = block.match(/<link[^>]+href=["']([^"']+)["']/i)?.[1] || linkTag;
    return { title: tag(block, "title"), url: href, organization: tag(block, "author") || "Feed import", location: "", deadline: "", postingText: tag(block, "description") || tag(block, "summary") || tag(block, "content") };
  }).filter((item) => item.title && item.url);
}

function parseJson(value: unknown) {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const list = Array.isArray(value) ? value : [record.jobs, record.items, record.results].find(Array.isArray) || [];
  return (list as Array<Record<string, unknown>>).slice(0, 100).map((item) => ({
    title: String(item.title || item.name || item.position || ""),
    url: String(item.url || item.link || item.apply_url || ""),
    organization: String(item.organization || item.company || item.institution || "Feed import"),
    location: String(item.location || ""),
    deadline: String(item.deadline || item.closing_date || "").slice(0, 10),
    postingText: String(item.description || item.summary || ""),
  })).filter((item) => item.title && item.url);
}

export async function collectDueSources(force = false) {
  await ensureMarketSchema();
  const d1 = db();
  const sources = await d1.prepare("SELECT * FROM source_monitors WHERE status = 'active' AND method IN ('rss','json')").all<D1Row>();
  let sourcesChecked = 0;
  let itemsAdded = 0;
  for (const source of sources.results) {
    if (!force && source.next_check_at && new Date(String(source.next_check_at)).getTime() > Date.now()) continue;
    sourcesChecked += 1;
    const runId = id("run");
    const startedAt = now();
    await d1.prepare("INSERT INTO collection_runs (id,source_id,status,started_at) VALUES (?,?,?,?)").bind(runId, source.id, "running", startedAt).run();
    try {
      const response = await fetch(String(source.url), { headers: { Accept: source.method === "rss" ? "application/rss+xml, application/atom+xml, text/xml" : "application/json" } });
      if (!response.ok) throw new Error(`Source returned ${response.status}`);
      const entries = source.method === "rss" ? parseFeed(await response.text()) : parseJson(await response.json());
      let added = 0;
      for (const entry of entries) {
        const existing = await d1.prepare("SELECT id FROM jobs WHERE source_url = ?").bind(entry.url).first();
        if (existing) continue;
        await createJob({ ...entry, sector: String(source.category), source: String(source.name), sourceUrl: entry.url }, String(source.method));
        added += 1;
      }
      const checkedAt = now();
      const nextCheckAt = new Date(Date.now() + Number(source.cadence_hours || 24) * 3_600_000).toISOString();
      await d1.batch([
        d1.prepare("UPDATE source_monitors SET last_checked_at=?, next_check_at=?, items_added=items_added+?, message=? WHERE id=?").bind(checkedAt, nextCheckAt, added, added ? `${added} new job${added === 1 ? "" : "s"} added on the latest check.` : "Checked successfully; no new jobs found.", source.id),
        d1.prepare("UPDATE collection_runs SET status=?, items_seen=?, items_added=?, message=?, completed_at=? WHERE id=?").bind("succeeded", entries.length, added, "Collection completed", checkedAt, runId),
      ]);
      itemsAdded += added;
    } catch (error) {
      const completedAt = now();
      const message = error instanceof Error ? error.message : "Collection failed";
      await d1.batch([
        d1.prepare("UPDATE source_monitors SET last_checked_at=?, next_check_at=?, message=? WHERE id=?").bind(completedAt, new Date(Date.now() + 6 * 3_600_000).toISOString(), `Check failed: ${message}`, source.id),
        d1.prepare("UPDATE collection_runs SET status=?, message=?, completed_at=? WHERE id=?").bind("failed", message, completedAt, runId),
      ]);
    }
  }
  return { automaticSources: sources.results.length, sourcesChecked, itemsAdded };
}
