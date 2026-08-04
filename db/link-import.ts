import { extractJobWithAI } from "./ai";

type ImportedJob = {
  sourceUrl: string;
  title: string;
  organization: string;
  sector: string;
  source: string;
  deadline: string;
  location: string;
  salary: string;
  postingText: string;
  requirements: string[];
  warning: string | null;
};

type InterfolioPosition = {
  position_name?: unknown;
  institution?: unknown;
  institution_condensed?: unknown;
  location?: unknown;
  start_date?: unknown;
  end_date?: unknown;
  salary?: unknown;
  active_status?: unknown;
  is_closed?: unknown;
  landing_page_description?: unknown;
  qualifications?: unknown;
  application_instructions?: unknown;
  eeo_statement?: unknown;
};

type DirectJobFields = {
  postingText: string;
  title: string;
  deadline: string;
  location: string;
  salary: string;
  warning: string | null;
};

function isPrivateIpv4(hostname: string) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || first >= 224
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 0)
    || (first === 192 && second === 168)
    || (first === 198 && (second === 18 || second === 19));
}

function isPublicJobUrl(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  if (!host || host === "localhost" || host.endsWith(".localhost") || /\.(?:local|internal|home|lan|onion)$/.test(host)) return false;
  if (host === "metadata.google.internal" || host === "169.254.169.254" || isPrivateIpv4(host)) return false;
  if (host.includes(":")) {
    const normalized = host.toLowerCase();
    if (normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:") || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89a-f]/.test(normalized)) return false;
  }
  return host.includes(".") || host.includes(":");
}

function hostMatches(host: string, root: string) {
  return host === root || host.endsWith(`.${root}`);
}

function sourceName(hostname: string) {
  const host = hostname.toLowerCase();
  if (hostMatches(host, "aeaweb.org")) return "JOE";
  if (hostMatches(host, "econjobmarket.org")) return "EconJobMarket";
  if (hostMatches(host, "academicjobsonline.org")) return "AcademicJobsOnline";
  if (hostMatches(host, "apply.interfolio.com")) return "Interfolio";
  if (hostMatches(host, "x.com") || hostMatches(host, "twitter.com")) return "X";
  return host.replace(/^www\./, "").slice(0, 100);
}

function decodeHtml(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(html: string) {
  return decodeHtml(html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\n[\t ]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 200_000);
}

function readableValue(value: unknown): string {
  if (typeof value === "string") return cleanText(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return [record.name, record.address, record.streetAddress, record.addressLocality, record.addressRegion, record.postalCode, record.addressCountry, record.value, record.currency]
      .map(readableValue)
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

function findJobPosting(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
  if (types.some((type) => String(type).toLowerCase().split(/[\/#]/).pop() === "jobposting")) return record;
  for (const nested of Object.values(record)) {
    const found = findJobPosting(nested);
    if (found) return found;
  }
  return null;
}

function extractStructuredJobText(html: string) {
  const scripts = html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of scripts) {
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(match[1].trim());
      } catch {
        parsed = JSON.parse(decodeHtml(match[1]).trim());
      }
      const posting = findJobPosting(parsed);
      if (!posting) continue;
      const fields: Array<[string, unknown]> = [
        ["Job title", posting.title],
        ["Hiring organization", posting.hiringOrganization],
        ["Location", posting.jobLocation || posting.applicantLocationRequirements],
        ["Remote work", posting.jobLocationType],
        ["Date posted", posting.datePosted],
        ["Application deadline", posting.validThrough],
        ["Employment type", posting.employmentType],
        ["Salary", posting.baseSalary],
        ["Description", posting.description],
        ["Responsibilities", posting.responsibilities],
        ["Qualifications", posting.qualifications],
        ["Education requirements", posting.educationRequirements],
        ["Experience requirements", posting.experienceRequirements],
        ["Skills", posting.skills],
      ];
      return fields.map(([label, value]) => {
        const readable = readableValue(value);
        return readable ? `${label}\n${readable}` : "";
      }).filter(Boolean).join("\n\n");
    } catch {
      // Ignore malformed structured data and continue with the visible page text.
    }
  }
  return "";
}

function interfolioField(label: string, value: unknown) {
  const readable = readableValue(value);
  return readable ? `${label}\n${readable}` : "";
}

function normalizedDate(value: unknown) {
  const readable = readableValue(value);
  if (!readable) return "";
  const parsed = Date.parse(readable);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

async function fetchInterfolioPosition(url: URL): Promise<DirectJobFields> {
  const positionId = url.pathname.match(/^\/(\d+)(?:\/|$)/)?.[1];
  if (!positionId) throw new Error("That Interfolio link does not identify a public position. Open the position page itself and copy its address.");
  const response = await fetch(`https://logic.interfolio.com/dossier-api/positions/${positionId}`, {
    headers: {
      Accept: "application/json",
      "User-Agent": "MarketDesk/1.0 (private, user-initiated job-link import)",
    },
  });
  if (!response.ok) throw new Error(`Interfolio could not provide that public position (${response.status}). Confirm the position is still public and open.`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 2_000_000) throw new Error("That Interfolio position is too large to import safely.");
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("That Interfolio position is too large to import safely.");
  let position: InterfolioPosition;
  try {
    position = JSON.parse(raw) as InterfolioPosition;
  } catch {
    throw new Error("Interfolio returned that position in an unreadable format.");
  }
  const postingText = [
    interfolioField("Job title", position.position_name),
    interfolioField("Institution", position.institution),
    interfolioField("Institution summary", position.institution_condensed),
    interfolioField("Location", position.location),
    interfolioField("Open date", position.start_date),
    interfolioField("Application deadline", position.end_date),
    interfolioField("Salary", position.salary),
    interfolioField("Status", position.active_status),
    interfolioField("Description", position.landing_page_description),
    interfolioField("Qualifications", position.qualifications),
    interfolioField("Application instructions", position.application_instructions),
    interfolioField("Equal employment opportunity statement", position.eeo_statement),
  ].filter(Boolean).join("\n\n").slice(0, 200_000);
  if (postingText.length < 30) throw new Error("That Interfolio position did not contain enough public information to import.");
  return {
    postingText,
    title: readableValue(position.position_name),
    deadline: normalizedDate(position.end_date),
    location: readableValue(position.location),
    salary: readableValue(position.salary),
    warning: position.is_closed === true || readableValue(position.active_status).toLowerCase() === "closed"
      ? "Interfolio marks this position as closed. Its saved details may no longer reflect an active search."
      : null,
  };
}

async function fetchXPost(url: URL) {
  const endpoint = new URL("https://publish.twitter.com/oembed");
  endpoint.searchParams.set("url", url.href);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");
  const response = await fetch(endpoint, { headers: { Accept: "application/json" }, redirect: "follow" });
  if (!response.ok) throw new Error("X could not provide that public post. Confirm the link is public and try again.");
  const result = await response.json() as { html?: string };
  return result.html || "";
}

async function fetchPublicPage(initial: URL, source: string) {
  let current = initial;
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    const response = await fetch(current, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MarketDesk/1.0 (private, user-initiated job-link import)",
      },
      redirect: "manual",
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`${source} redirected without providing a destination.`);
      const next = new URL(location, current);
      if (!isPublicJobUrl(next)) throw new Error("The job link redirected to a private or unsupported address.");
      current = next;
      continue;
    }
    if (!response.ok) throw new Error(`${source} did not allow Market Desk to read that page (${response.status}). Use copied-text import for this listing.`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) throw new Error("That link did not return a readable job page.");
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > 2_000_000) throw new Error("That job page is too large to import safely.");
    const html = await response.text();
    if (html.length > 2_000_000) throw new Error("That job page is too large to import safely.");
    return { html, finalUrl: current };
  }
  throw new Error("The job link redirected too many times.");
}

export async function importJobFromLink(rawUrl: string): Promise<ImportedJob> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Enter a complete public job link.");
  }
  if (!isPublicJobUrl(url)) {
    throw new Error("Use a public HTTPS job-posting link. Private, local, signed-in, and nonstandard-port addresses cannot be imported.");
  }

  let source = sourceName(url.hostname);
  let html = "";
  let postingText = "";
  let directFields: DirectJobFields | null = null;
  if (source === "X") {
    html = await fetchXPost(url);
  } else if (source === "Interfolio") {
    directFields = await fetchInterfolioPosition(url);
    postingText = directFields.postingText;
  } else {
    const page = await fetchPublicPage(url, source);
    html = page.html;
    url = page.finalUrl;
    source = sourceName(url.hostname);
  }
  if (!postingText) {
    const structuredText = extractStructuredJobText(html);
    const visibleText = cleanText(html);
    postingText = [structuredText, visibleText].filter(Boolean).join("\n\n").slice(0, 200_000);
  }
  if (postingText.length < 30) throw new Error("The public page did not contain enough readable information. Use copied-text import for this listing.");
  const extracted = await extractJobWithAI({ source, sourceUrl: url.href, postingText });
  return {
    sourceUrl: url.href,
    title: directFields?.title || extracted.title,
    organization: extracted.organization,
    sector: extracted.sector,
    source,
    deadline: directFields?.deadline || extracted.deadline || "",
    location: directFields?.location || extracted.location || "",
    salary: directFields?.salary || extracted.salary || "",
    postingText,
    requirements: extracted.applicationMaterials,
    warning: extracted.warning || directFields?.warning || (source === "X" ? "This import contains only the public X post. Follow its linked formal posting and verify the full requirements before applying." : null),
  };
}
