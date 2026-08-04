import { env } from "cloudflare:workers";

type AIConfigRow = {
  api_key_ciphertext: string;
  api_key_iv: string;
  configured_at: string | null;
};

export type AIJobExtraction = {
  title: string;
  organization: string;
  sector: "Academic" | "Postdoc" | "Industry" | "Government";
  location: string | null;
  salary: string | null;
  deadline: string | null;
  applicationMaterials: string[];
  warning: string | null;
};

export const AI_EXTRACTION_MODEL = "gpt-5-nano";
const CONFIG_ID = "personal";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function db() {
  if (!env.DB) throw new Error("The Market Desk database is unavailable.");
  return env.DB;
}

function encryptionSecret() {
  return String((env as unknown as Record<string, unknown>).OPENAI_KEY_ENCRYPTION_KEY || "");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const secret = encryptionSecret();
  if (!secret) throw new Error("Secure OpenAI key storage is not configured yet.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptApiKey(apiKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(apiKey));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptApiKey(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(ciphertext));
  return decoder.decode(decrypted);
}

async function getConfig() {
  return db().prepare("SELECT api_key_ciphertext,api_key_iv,configured_at FROM ai_config WHERE id = ?")
    .bind(CONFIG_ID).first<AIConfigRow>();
}

export async function getAIStatus() {
  const config = await getConfig();
  return {
    configured: Boolean(config?.api_key_ciphertext && config.api_key_iv && encryptionSecret()),
    secureStorageReady: Boolean(encryptionSecret()),
    configuredAt: config?.configured_at || null,
    model: AI_EXTRACTION_MODEL,
  };
}

export async function configureOpenAI(apiKey: string) {
  const cleaned = apiKey.trim();
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(cleaned)) throw new Error("Enter a valid replacement OpenAI API key.");
  const encrypted = await encryptApiKey(cleaned);
  const timestamp = new Date().toISOString();
  await db().prepare(`INSERT INTO ai_config (id,api_key_ciphertext,api_key_iv,configured_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET api_key_ciphertext=excluded.api_key_ciphertext,api_key_iv=excluded.api_key_iv,configured_at=excluded.configured_at,updated_at=excluded.updated_at`)
    .bind(CONFIG_ID, encrypted.ciphertext, encrypted.iv, timestamp, timestamp).run();
  return getAIStatus();
}

export async function disconnectOpenAI() {
  await db().prepare("DELETE FROM ai_config WHERE id = ?").bind(CONFIG_ID).run();
  return getAIStatus();
}

async function apiKey() {
  const config = await getConfig();
  if (!config?.api_key_ciphertext || !config.api_key_iv) throw new Error("Connect AI extraction before importing a job link.");
  return decryptApiKey(config.api_key_ciphertext, config.api_key_iv);
}

type OpenAIResponse = {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  error?: { message?: string } | null;
  output?: unknown;
};

function responseContent(value: OpenAIResponse) {
  const output = value.output;
  const textParts: string[] = [];
  const refusals: string[] = [];
  if (!Array.isArray(output)) return { text: "", refusal: "" };
  for (const item of output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as { content?: unknown }).content)) continue;
    for (const content of (item as { content: Array<Record<string, unknown>> }).content) {
      if (content.type === "output_text" && typeof content.text === "string") textParts.push(content.text);
      if (content.type === "refusal" && typeof content.refusal === "string") refusals.push(content.refusal);
    }
  }
  return { text: textParts.join(""), refusal: refusals.join(" ") };
}

function parseStructuredJSON(value: string) {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  for (const candidate of [...new Set(candidates)]) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      // Try the next safe representation before reporting a malformed response.
    }
  }
  return null;
}

function cleanString(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
}

function normalizeDate(value: unknown) {
  const cleaned = cleanString(value, 40);
  if (!cleaned) return null;
  const match = cleaned.match(/^20\d{2}-\d{2}-\d{2}$/);
  return match ? match[0] : null;
}

async function requestExtraction(key: string, input: { source: string; sourceUrl: string; postingText: string }, maxOutputTokens: number) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: AI_EXTRACTION_MODEL,
      store: false,
      service_tier: "default",
      reasoning: { effort: "minimal" },
      max_output_tokens: maxOutputTokens,
      instructions: `Extract a job posting for a private economics job-market tracker. Use only facts explicitly supported by the supplied posting. Do not guess. The organization is the hiring school, institution, government body, or company—not the listing platform or social-media author. Preserve salary currency, range, time period, academic-year terms, and qualifications exactly but concisely. Return a deadline only when a specific calendar date is stated, formatted YYYY-MM-DD. List every required application item separately, including counts, page limits, special statements, reference-letter instructions, forms, transcripts, and work samples. Do not list merely optional items. Classify sector as Academic, Postdoc, Industry, or Government. Use null when location, salary, deadline, or a warning is not stated.`,
      input: `Source: ${input.source}\nOriginal URL: ${input.sourceUrl}\n\nFULL READABLE JOB POSTING\n${input.postingText}`,
      text: {
        format: {
          type: "json_schema",
          name: "economics_job_posting",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              title: { type: "string" },
              organization: { type: "string" },
              sector: { type: "string", enum: ["Academic", "Postdoc", "Industry", "Government"] },
              location: { type: ["string", "null"] },
              salary: { type: ["string", "null"] },
              deadline: { type: ["string", "null"] },
              applicationMaterials: { type: "array", items: { type: "string" } },
              warning: { type: ["string", "null"] },
            },
            required: ["title", "organization", "sector", "location", "salary", "deadline", "applicationMaterials", "warning"],
          },
        },
      },
    }),
  });
  const result = await response.json() as OpenAIResponse;
  if (!response.ok) {
    const detail = cleanString(result.error?.message, 300);
    if (response.status === 401) throw new Error("OpenAI rejected the saved key. Replace it in AI extraction settings.");
    if (response.status === 429) throw new Error("OpenAI could not run the extraction because the account is out of quota or temporarily rate-limited.");
    throw new Error(detail ? `OpenAI extraction failed: ${detail}` : "OpenAI could not extract this posting.");
  }
  return result;
}

export async function extractJobWithAI(input: { source: string; sourceUrl: string; postingText: string }): Promise<AIJobExtraction> {
  const key = await apiKey();
  let result = await requestExtraction(key, input, 4_000);
  if (result.status === "incomplete" && result.incomplete_details?.reason === "max_output_tokens") {
    result = await requestExtraction(key, input, 8_000);
  }
  const output = responseContent(result);
  if (output.refusal) throw new Error(`OpenAI declined to extract this posting: ${cleanString(output.refusal, 300)}`);
  if (result.status === "incomplete") {
    throw new Error("OpenAI stopped before finishing the job extraction. Please try the link again.");
  }
  if (!output.text) throw new Error("OpenAI returned no structured job information. Please try the link again.");
  const parsed = parseStructuredJSON(output.text);
  if (!parsed) throw new Error("OpenAI did not finish a valid job record. Please try the link again.");
  const title = cleanString(parsed.title, 240);
  const organization = cleanString(parsed.organization, 240);
  if (!title || !organization) throw new Error("The posting did not clearly identify both a job title and hiring organization.");
  const materials = Array.isArray(parsed.applicationMaterials)
    ? [...new Set(parsed.applicationMaterials.map((item) => cleanString(item, 180)).filter(Boolean))].slice(0, 40)
    : [];
  const validSectors = new Set(["Academic", "Postdoc", "Industry", "Government"]);
  const sector = validSectors.has(String(parsed.sector)) ? parsed.sector as AIJobExtraction["sector"] : "Academic";
  return {
    title,
    organization,
    sector,
    location: cleanString(parsed.location, 300) || null,
    salary: cleanString(parsed.salary, 500) || null,
    deadline: normalizeDate(parsed.deadline),
    applicationMaterials: materials,
    warning: cleanString(parsed.warning, 500) || null,
  };
}
