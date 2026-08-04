import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".vinext",
  ".wrangler",
  "dist",
  "node_modules",
  "outputs",
  "work",
]);
const textExtensions = new Set([
  ".css",
  ".example",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yml",
  ".yaml",
]);
const findings = [];

function relative(file) {
  return path.relative(root, file) || ".";
}

function report(file, message) {
  findings.push(`${relative(file)}: ${message}`);
}

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectFiles(file)));
      }
      continue;
    }
    if (entry.isFile()) files.push(file);
  }

  return files;
}

const files = await collectFiles(root);

for (const file of files) {
  const name = path.basename(file);
  const extension = path.extname(file).toLowerCase();

  if (
    (name === ".env" || name === ".dev.vars") &&
    name !== ".env.example"
  ) {
    report(file, "local secrets file must not be included");
  }

  if ([".db", ".sqlite", ".sqlite3"].includes(extension)) {
    report(file, "local database file must not be included");
  }

  if (!textExtensions.has(extension) && !name.startsWith(".")) continue;

  let content;
  try {
    content = await readFile(file, "utf8");
  } catch {
    continue;
  }

  const projectPrefix = ["appg", "prj_"].join("");
  const openAiPrefix = ["sk", "proj", ""].join("-");
  const personalPathPrefix = ["", "Users", ""].join("/");

  if (new RegExp(`${projectPrefix}[a-z0-9]{16,}`, "i").test(content)) {
    report(file, "contains a bound Sites project identifier");
  }
  if (new RegExp(`${openAiPrefix}[A-Za-z0-9_-]{20,}`).test(content)) {
    report(file, "contains what looks like a live OpenAI API key");
  }
  if (content.includes(personalPathPrefix)) {
    report(file, "contains an absolute personal filesystem path");
  }
  if (/https:\/\/[a-z0-9.-]+\.chatgpt\.site\b/i.test(content)) {
    report(file, "contains a specific deployed Sites URL");
  }
  if (
    relative(file).startsWith(`drizzle${path.sep}`) &&
    extension === ".sql" &&
    /\binsert\s+into\s+["'`]?jobs\b/i.test(content)
  ) {
    report(file, "contains seeded job records in a database migration");
  }
}

const hostingFile = path.join(root, ".openai", "hosting.json");
try {
  const hosting = JSON.parse(await readFile(hostingFile, "utf8"));
  if (typeof hosting.project_id === "string" && hosting.project_id.trim()) {
    report(hostingFile, "project_id must be removed before public release");
  }
  if (hosting.d1 !== "DB" || hosting.r2 !== "FILES") {
    report(hostingFile, "expected portable DB and FILES bindings");
  }
} catch (error) {
  report(hostingFile, `could not validate hosting configuration: ${error.message}`);
}

const exampleEnv = path.join(root, ".env.example");
try {
  const lines = (await readFile(exampleEnv, "utf8")).split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, "");
    const looksLikePlaceholder =
      value === "" ||
      /^<.*>$/.test(value) ||
      /^(change-me|replace(?:-me|-with)|your[-_])/i.test(value);
    if (!looksLikePlaceholder) {
      report(exampleEnv, `${match[1]} must use an empty value or an obvious placeholder`);
    }
  }
} catch (error) {
  report(exampleEnv, `could not validate example environment file: ${error.message}`);
}

if (findings.length > 0) {
  console.error("Public release check failed:\n");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Public release check passed (${files.length} files inspected).`);
}
