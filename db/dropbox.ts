import { env } from "cloudflare:workers";

type DropboxConfigRow = {
  app_key: string;
  refresh_token_ciphertext: string | null;
  refresh_token_iv: string | null;
  account_id: string | null;
  connected_at: string | null;
};

type UploadInput = {
  fileId: string;
  organization: string;
  title: string;
  label: string;
  filename: string;
  bytes: ArrayBuffer;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const CONFIG_ID = "personal";

function db() {
  if (!env.DB) throw new Error("The Market Desk database is unavailable.");
  return env.DB;
}

function tokenSecret() {
  return String((env as unknown as Record<string, unknown>).DROPBOX_TOKEN_KEY || "");
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

function base64Url(bytes: Uint8Array) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function encryptionKey() {
  const secret = tokenSecret();
  if (!secret) throw new Error("Secure Dropbox token storage is not configured yet.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(token));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptToken(ciphertext: string, iv: string) {
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(iv) }, await encryptionKey(), base64ToBytes(ciphertext));
  return decoder.decode(decrypted);
}

async function getConfig() {
  return db().prepare("SELECT app_key,refresh_token_ciphertext,refresh_token_iv,account_id,connected_at FROM dropbox_config WHERE id = ?")
    .bind(CONFIG_ID).first<DropboxConfigRow>();
}

export async function getDropboxStatus() {
  const config = await getConfig();
  const counts = await db().prepare(`SELECT
    SUM(CASE WHEN dropbox_status = 'synced' THEN 1 ELSE 0 END) AS synced,
    SUM(CASE WHEN dropbox_status = 'failed' THEN 1 ELSE 0 END) AS failed,
    SUM(CASE WHEN dropbox_status != 'synced' THEN 1 ELSE 0 END) AS pending
    FROM job_files`).first<{ synced: number | null; failed: number | null; pending: number | null }>();
  return {
    configured: Boolean(config?.app_key && tokenSecret()),
    appKeySaved: Boolean(config?.app_key),
    secureStorageReady: Boolean(tokenSecret()),
    connected: Boolean(config?.refresh_token_ciphertext && config?.refresh_token_iv),
    accountId: config?.account_id || null,
    connectedAt: config?.connected_at || null,
    syncedFiles: Number(counts?.synced || 0),
    failedFiles: Number(counts?.failed || 0),
    pendingFiles: Number(counts?.pending || 0),
  };
}

export async function configureDropboxApp(appKey: string) {
  const cleaned = appKey.trim();
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(cleaned)) throw new Error("Enter the App key shown in your Dropbox developer console.");
  const current = await getConfig();
  const timestamp = new Date().toISOString();
  if (!current) {
    await db().prepare("INSERT INTO dropbox_config (id,app_key,updated_at) VALUES (?,?,?)").bind(CONFIG_ID, cleaned, timestamp).run();
  } else if (current.app_key !== cleaned) {
    await db().prepare(`UPDATE dropbox_config SET app_key=?,refresh_token_ciphertext=NULL,refresh_token_iv=NULL,account_id=NULL,connected_at=NULL,updated_at=? WHERE id=?`)
      .bind(cleaned, timestamp, CONFIG_ID).run();
  }
  return getDropboxStatus();
}

export async function beginDropboxAuthorization(requestUrl: string) {
  const config = await getConfig();
  if (!config?.app_key) throw new Error("Save your Dropbox App key first.");
  if (!tokenSecret()) throw new Error("Secure Dropbox token storage is not configured yet.");
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  const redirectUri = new URL("/api/dropbox/callback", requestUrl).toString();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db().batch([
    db().prepare("DELETE FROM dropbox_oauth_states WHERE expires_at < ?").bind(new Date().toISOString()),
    db().prepare("INSERT INTO dropbox_oauth_states (state,code_verifier,redirect_uri,expires_at) VALUES (?,?,?,?)").bind(state, verifier, redirectUri, expiresAt),
  ]);
  const authorize = new URL("https://www.dropbox.com/oauth2/authorize");
  authorize.searchParams.set("client_id", config.app_key);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("token_access_type", "offline");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("scope", "files.content.write");
  return authorize.toString();
}

export async function finishDropboxAuthorization(requestUrl: string) {
  const url = new URL(requestUrl);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) throw new Error("Dropbox authorization was cancelled or incomplete.");
  const savedState = await db().prepare("SELECT code_verifier,redirect_uri,expires_at FROM dropbox_oauth_states WHERE state = ?")
    .bind(state).first<{ code_verifier: string; redirect_uri: string; expires_at: string }>();
  await db().prepare("DELETE FROM dropbox_oauth_states WHERE state = ?").bind(state).run();
  if (!savedState || new Date(savedState.expires_at).getTime() < Date.now()) throw new Error("Dropbox authorization expired. Please try connecting again.");
  const config = await getConfig();
  if (!config?.app_key) throw new Error("Dropbox is not configured.");
  const body = new URLSearchParams({
    code,
    grant_type: "authorization_code",
    client_id: config.app_key,
    redirect_uri: savedState.redirect_uri,
    code_verifier: savedState.code_verifier,
  });
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json() as { refresh_token?: string; account_id?: string; error_description?: string; error?: string };
  if (!response.ok || !result.refresh_token) throw new Error(result.error_description || result.error || "Dropbox did not return a reusable connection.");
  const encrypted = await encryptToken(result.refresh_token);
  const timestamp = new Date().toISOString();
  await db().prepare(`UPDATE dropbox_config SET refresh_token_ciphertext=?,refresh_token_iv=?,account_id=?,connected_at=?,updated_at=? WHERE id=?`)
    .bind(encrypted.ciphertext, encrypted.iv, result.account_id || null, timestamp, timestamp, CONFIG_ID).run();
}

async function accessToken() {
  const config = await getConfig();
  if (!config?.refresh_token_ciphertext || !config.refresh_token_iv) throw new Error("Connect Dropbox before syncing files.");
  const refreshToken = await decryptToken(config.refresh_token_ciphertext, config.refresh_token_iv);
  const body = new URLSearchParams({ refresh_token: refreshToken, grant_type: "refresh_token", client_id: config.app_key });
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const result = await response.json() as { access_token?: string; error_description?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error_description || result.error || "Dropbox could not refresh the connection.");
  return result.access_token;
}

function safeSegment(value: string, fallback: string) {
  const cleaned = value.replace(/[\\/\u0000-\u001f]/g, "-").replace(/\s+/g, " ").replace(/[. ]+$/g, "").trim();
  return (cleaned || fallback).slice(0, 120);
}

function uploadPath(input: UploadInput) {
  const jobFolder = safeSegment(`${input.organization} — ${input.title}`, "Job materials");
  const shortId = input.fileId.replace(/^file_/, "").slice(0, 8);
  const filename = safeSegment(input.filename, "document");
  const label = safeSegment(input.label, "Material");
  return `/Market Desk/${jobFolder}/${label} — ${shortId} — ${filename}`;
}

export async function uploadJobFileToDropbox(input: UploadInput) {
  const config = await getConfig();
  if (!config?.refresh_token_ciphertext || !config.refresh_token_iv) return { status: "not_synced" as const, path: null };
  const path = uploadPath(input);
  await db().prepare("UPDATE job_files SET dropbox_status='syncing',dropbox_path=?,dropbox_error=NULL WHERE id=?").bind(path, input.fileId).run();
  try {
    const token = await accessToken();
    const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
        "Dropbox-API-Arg": JSON.stringify({ path, mode: "overwrite", autorename: false, mute: true, strict_conflict: false }),
      },
      body: input.bytes,
    });
    if (!response.ok) {
      const message = (await response.text()).slice(0, 500);
      throw new Error(`Dropbox upload failed (${response.status})${message ? `: ${message}` : ""}`);
    }
    const syncedAt = new Date().toISOString();
    await db().prepare("UPDATE job_files SET dropbox_status='synced',dropbox_synced_at=?,dropbox_error=NULL WHERE id=?").bind(syncedAt, input.fileId).run();
    return { status: "synced" as const, path };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : "Dropbox sync failed";
    await db().prepare("UPDATE job_files SET dropbox_status='failed',dropbox_error=? WHERE id=?").bind(message, input.fileId).run();
    return { status: "failed" as const, path };
  }
}

export async function disconnectDropbox() {
  try {
    const token = await accessToken();
    await fetch("https://api.dropboxapi.com/2/auth/token/revoke", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  } catch {
    // Clear the local connection even when Dropbox has already revoked it.
  }
  await db().prepare(`UPDATE dropbox_config SET refresh_token_ciphertext=NULL,refresh_token_iv=NULL,account_id=NULL,connected_at=NULL,updated_at=? WHERE id=?`)
    .bind(new Date().toISOString(), CONFIG_ID).run();
}
