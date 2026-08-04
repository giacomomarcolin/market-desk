import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(),
  organization: text("organization").notNull(),
  department: text("department"),
  title: text("title").notNull(),
  sector: text("sector").notNull(),
  location: text("location"),
  salary: text("salary"),
  deadline: text("deadline"),
  source: text("source").notNull(),
  sourceUrl: text("source_url").unique(),
  sourceSnapshot: text("source_snapshot"),
  collectionMode: text("collection_mode").notNull().default("manual"),
  status: text("status").notNull().default("Saved"),
  bucket: text("bucket").notNull().default("active"),
  nextAction: text("next_action"),
  notes: text("notes"),
  starred: integer("starred", { mode: "boolean" }).notNull().default(false),
  capturedAt: text("captured_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const aiConfig = sqliteTable("ai_config", {
  id: text("id").primaryKey(),
  apiKeyCiphertext: text("api_key_ciphertext").notNull(),
  apiKeyIv: text("api_key_iv").notNull(),
  configuredAt: text("configured_at"),
  updatedAt: text("updated_at").notNull(),
});

export const jobFiles = sqliteTable("job_files", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  filename: text("filename").notNull(),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  dropboxPath: text("dropbox_path"),
  dropboxStatus: text("dropbox_status").notNull().default("not_synced"),
  dropboxSyncedAt: text("dropbox_synced_at"),
  dropboxError: text("dropbox_error"),
});

export const dropboxConfig = sqliteTable("dropbox_config", {
  id: text("id").primaryKey(),
  appKey: text("app_key").notNull(),
  refreshTokenCiphertext: text("refresh_token_ciphertext"),
  refreshTokenIv: text("refresh_token_iv"),
  accountId: text("account_id"),
  connectedAt: text("connected_at"),
  updatedAt: text("updated_at").notNull(),
});

export const dropboxOauthStates = sqliteTable("dropbox_oauth_states", {
  state: text("state").primaryKey(),
  codeVerifier: text("code_verifier").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  expiresAt: text("expires_at").notNull(),
});

export const jobRequirements = sqliteTable("job_requirements", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  documentVersion: text("document_version"),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const sourceMonitors = sqliteTable("source_monitors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  method: text("method").notNull(),
  url: text("url"),
  status: text("status").notNull(),
  cadenceHours: integer("cadence_hours").notNull().default(24),
  lastCheckedAt: text("last_checked_at"),
  nextCheckAt: text("next_check_at"),
  itemsAdded: integer("items_added").notNull().default(0),
  message: text("message"),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  dueAt: text("due_at"),
  completed: integer("completed", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const collectionRuns = sqliteTable("collection_runs", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull().references(() => sourceMonitors.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  itemsSeen: integer("items_seen").notNull().default(0),
  itemsAdded: integer("items_added").notNull().default(0),
  message: text("message"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
});
