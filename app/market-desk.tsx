"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Job = {
  id: string;
  organization: string;
  department: string | null;
  title: string;
  sector: string;
  location: string | null;
  salary: string | null;
  deadline: string | null;
  source: string;
  sourceUrl: string | null;
  status: string;
  bucket: "active" | "maybe" | "skipped";
  requirementsDone: number;
  requirementsTotal: number;
  nextAction: string | null;
  starred: boolean;
  updatedAt: string;
};

type JobRequirement = { id: string; label: string; completed: boolean; documentVersion: string | null };
type JobFile = { id: string; label: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: string; dropboxPath: string | null; dropboxStatus: "not_synced" | "syncing" | "synced" | "failed"; dropboxSyncedAt: string | null; dropboxError: string | null };
type JobDetails = Job & {
  sourceSnapshot: string | null;
  notes: string | null;
  capturedAt: string;
  requirements: JobRequirement[];
  files: JobFile[];
};

type SourceMonitor = {
  id: string;
  name: string;
  category: string;
  method: string;
  url: string | null;
  status: string;
  cadenceHours: number;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  itemsAdded: number;
  message: string | null;
};

type Task = {
  id: string;
  jobId: string | null;
  title: string;
  dueAt: string | null;
  completed: boolean;
  organization: string | null;
};

type DropboxStatus = { configured: boolean; appKeySaved: boolean; secureStorageReady: boolean; connected: boolean; accountId: string | null; connectedAt: string | null; syncedFiles: number; failedFiles: number; pendingFiles: number };
type AIStatus = { configured: boolean; secureStorageReady: boolean; configuredAt: string | null; model: string };
type DashboardData = { jobs: Job[]; sources: SourceMonitor[]; tasks: Task[]; dropbox: DropboxStatus; ai: AIStatus };
type View = "overview" | "jobs" | "sources";
type PipelineFilter = "in-progress" | "submitted" | "interview" | "flyout" | "offer";
type JobDraft = {
  sourceUrl: string;
  title: string;
  organization: string;
  sector: string;
  source: string;
  deadline: string;
  location: string;
  salary: string;
  postingText: string;
};
type LinkImportProgress = { current: number; total: number };
type LinkImportFailure = { url: string; error: string };
type LinkImportReport = { summary: string; failures: LinkImportFailure[] };

const emptyDropbox: DropboxStatus = { configured: false, appKeySaved: false, secureStorageReady: false, connected: false, accountId: null, connectedAt: null, syncedFiles: 0, failedFiles: 0, pendingFiles: 0 };
const emptyAI: AIStatus = { configured: false, secureStorageReady: false, configuredAt: null, model: "gpt-5-nano" };
const emptyData: DashboardData = { jobs: [], sources: [], tasks: [], dropbox: emptyDropbox, ai: emptyAI };
const statusOptions = ["Saved", "Preparing", "Ready", "Submitted", "Interview", "Flyout", "Offer", "Closed"];
const statusRank = new Map(statusOptions.map((status, index) => [status, index]));
const pipelineFilters: Record<PipelineFilter, { label: string; statuses: string[] }> = {
  "in-progress": { label: "Applications in progress", statuses: ["Saved", "Preparing", "Ready"] },
  submitted: { label: "Submitted applications", statuses: ["Submitted"] },
  interview: { label: "Interviews", statuses: ["Interview"] },
  flyout: { label: "Flyouts", statuses: ["Flyout"] },
  offer: { label: "Offers", statuses: ["Offer"] },
};
const emptyJobDraft: JobDraft = { sourceUrl: "", title: "", organization: "", sector: "Academic", source: "Manual capture", deadline: "", location: "", salary: "", postingText: "" };

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function sourceFromText(value: string) {
  const text = value.toLowerCase();
  if (text.includes("econjobmarket.org") || text.includes("econjobmarket")) return "EconJobMarket";
  if (text.includes("academicjobsonline.org") || text.includes("academicjobsonline")) return "AcademicJobsOnline";
  if (text.includes("aeaweb.org/joe") || /\bjoe network\b/.test(text)) return "JOE";
  if (text.includes("x.com/") || text.includes("twitter.com/")) return "X";
  return "Manual capture";
}

function labeledLine(text: string, labels: string[]) {
  const escaped = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = text.match(new RegExp(`^\\s*(?:${escaped})\\s*[:–—-]\\s*(.+?)\\s*$`, "im"));
  return match?.[1]?.trim().slice(0, 240) || "";
}

function normalizedDeadline(value: string) {
  if (!value) return "";
  const numeric = value.match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (numeric) return `${numeric[1]}-${numeric[2].padStart(2, "0")}-${numeric[3].padStart(2, "0")}`;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "" : new Date(parsed).toISOString().slice(0, 10);
}

function inferCopiedListing(raw: string): JobDraft {
  const postingText = raw.trim().slice(0, 100_000);
  const lines = postingText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const title = labeledLine(postingText, ["job title", "position title", "position", "title"])
    || lines.find((line) => line.length < 180 && /(assistant|associate|full) professor|post-?doctoral|postdoc|economist|lecturer|research fellow|researcher/i.test(line))
    || "";
  const organization = labeledLine(postingText, ["institution", "organization", "employer", "university", "company"])
    || lines.find((line) => line.length < 180 && /\b(university|college|institute|school of|federal reserve|research)\b/i.test(line) && line !== title)
    || "";
  const deadlineText = labeledLine(postingText, ["application deadline", "deadline", "closing date", "review date", "apply by", "applications due"]);
  const sourceUrl = lines.find((line) => /^https?:\/\/\S+$/i.test(line))?.replace(/[),.;]+$/, "") || "";
  const source = sourceFromText(`${sourceUrl}\n${postingText.slice(0, 5_000)}`);
  const sector = /\bpost-?doctoral|\bpostdoc\b|research fellow/i.test(title) ? "Postdoc" : "Academic";
  return {
    sourceUrl,
    title,
    organization,
    sector,
    source,
    deadline: normalizedDeadline(deadlineText),
    location: labeledLine(postingText, ["location", "job location", "work location"]),
    salary: labeledLine(postingText, ["salary", "compensation", "pay range"]),
    postingText,
  };
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function deadlineSortKey(value: string | null) {
  const match = value?.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return year * 10_000 + month * 100 + day;
}

function todaySortKey(now = new Date()) {
  return now.getFullYear() * 10_000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function compareDeadlines(a: string | null, b: string | null, direction: "soonest" | "latest", today: number) {
  const aKey = deadlineSortKey(a);
  const bKey = deadlineSortKey(b);
  if (aKey === null && bKey === null) return 0;
  if (aKey === null) return 1;
  if (bKey === null) return -1;
  if (direction === "latest") return bKey - aKey;
  const aGroup = aKey >= today ? 0 : 1;
  const bGroup = bKey >= today ? 0 : 1;
  if (aGroup !== bGroup) return aGroup - bGroup;
  return aGroup === 0 ? aKey - bKey : bKey - aKey;
}

function deadlinePresentation(value: string | null, now = new Date()) {
  const key = deadlineSortKey(value);
  if (!value) return { label: "No fixed deadline", detail: "Rolling / not listed", tone: "missing" };
  if (key === null) return { label: "Check posting", detail: "Deadline needs review", tone: "invalid" };
  const year = Math.floor(key / 10_000);
  const month = Math.floor((key % 10_000) / 100);
  const day = key % 100;
  const date = new Date(Date.UTC(year, month - 1, day));
  const label = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  const localTodayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAway = Math.round((date.getTime() - localTodayUtc) / 86_400_000);
  if (daysAway < 0) return { label, detail: `Passed ${Math.abs(daysAway)} day${daysAway === -1 ? "" : "s"} ago`, tone: "passed" };
  if (daysAway === 0) return { label, detail: "Due today", tone: "urgent" };
  return { label, detail: `In ${daysAway} day${daysAway === 1 ? "" : "s"}`, tone: daysAway <= 14 ? "urgent" : "upcoming" };
}

function relativeTime(value: string | null) {
  if (!value) return "Not checked yet";
  const hours = Math.round((Date.now() - new Date(value).getTime()) / 3_600_000);
  if (hours < 1) return "Just checked";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceState(source: SourceMonitor) {
  if (source.status === "active") return { label: "Automatic", tone: "active" };
  if (source.status === "credential") return { label: "Needs access", tone: "attention" };
  if (source.status === "review") return { label: "Reviewing", tone: "attention" };
  return { label: "Guided capture", tone: "manual" };
}

export function MarketDesk() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<View>("overview");
  const [greeting, setGreeting] = useState("Welcome back");
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter | null>(null);
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("All sectors");
  const [bucket, setBucket] = useState<"active" | "maybe" | "skipped" | "all">("active");
  const [sortBy, setSortBy] = useState("deadline-soonest");
  const [selectedJob, setSelectedJob] = useState<JobDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [jobOpen, setJobOpen] = useState(false);
  const [jobDraft, setJobDraft] = useState<JobDraft>(emptyJobDraft);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [linkImportProgress, setLinkImportProgress] = useState<LinkImportProgress | null>(null);
  const [linkImportError, setLinkImportError] = useState("");
  const [linkImportReport, setLinkImportReport] = useState<LinkImportReport | null>(null);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [dropboxOpen, setDropboxOpen] = useState(false);
  const [dropboxBusy, setDropboxBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadData(runDueCollectors = false) {
    setLoading(true);
    try {
      if (runDueCollectors) {
        await fetch("/api/collect", { method: "POST" });
      }
      const response = await fetch("/api/data", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the tracker");
      setData(await response.json());
    } catch {
      setNotice("The tracker could not reach its private database. Please refresh in a moment.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const refreshGreeting = () => setGreeting(greetingForHour(new Date().getHours()));
    const initializeTimer = window.setTimeout(() => {
      void loadData(true);
      refreshGreeting();
      const params = new URLSearchParams(window.location.search);
      const dropboxResult = params.get("dropbox");
      if (dropboxResult) {
        setDropboxOpen(true);
        setNotice(dropboxResult === "connected" ? "Dropbox connected. You can now copy existing materials into your personal Dropbox." : params.get("message") || "Dropbox could not be connected.");
        window.history.replaceState({}, "", window.location.pathname);
      }
    }, 0);
    const greetingTimer = window.setInterval(refreshGreeting, 60_000);
    return () => {
      window.clearTimeout(initializeTimer);
      window.clearInterval(greetingTimer);
    };
  }, []);

  function navigate(nextView: View) {
    setPipelineFilter(null);
    setView(nextView);
  }

  function showPipeline(filter: PipelineFilter) {
    setPipelineFilter(filter);
    setView("jobs");
    setBucket("all");
    setSearch("");
    setSector("All sectors");
  }

  const filteredJobs = useMemo(() => {
    const query = search.trim().toLowerCase();
    const today = todaySortKey();
    const byName = (a: Job, b: Job) => a.organization.localeCompare(b.organization) || a.title.localeCompare(b.title);
    return data.jobs.filter((job) => {
      const matchesSearch = !query || [job.organization, job.department, job.title, job.location, job.source]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);
      const matchesSector = sector === "All sectors" || job.sector === sector;
      const effectiveBucket = view === "overview" ? "active" : bucket;
      const matchesBucket = effectiveBucket === "all" || job.bucket === effectiveBucket || (view === "overview" && job.bucket === "maybe");
      const matchesPipeline = !pipelineFilter || pipelineFilters[pipelineFilter].statuses.includes(job.status);
      return matchesSearch && matchesSector && matchesBucket && matchesPipeline;
    }).sort((a, b) => {
      if (sortBy === "status") return (statusRank.get(a.status) ?? 99) - (statusRank.get(b.status) ?? 99) || compareDeadlines(a.deadline, b.deadline, "soonest", today) || byName(a, b);
      if (sortBy === "deadline-latest") return compareDeadlines(a.deadline, b.deadline, "latest", today) || byName(a, b);
      if (sortBy === "updated") return b.updatedAt.localeCompare(a.updatedAt) || byName(a, b);
      return compareDeadlines(a.deadline, b.deadline, "soonest", today) || byName(a, b);
    });
  }, [data.jobs, search, sector, bucket, sortBy, view, pipelineFilter]);

  const metrics = useMemo(() => {
    const trackedJobs = data.jobs.filter((job) => job.bucket !== "skipped");
    return {
      inProgress: trackedJobs.filter((job) => pipelineFilters["in-progress"].statuses.includes(job.status)).length,
      submitted: trackedJobs.filter((job) => job.status === "Submitted").length,
      interviews: trackedJobs.filter((job) => job.status === "Interview").length,
      flyouts: trackedJobs.filter((job) => job.status === "Flyout").length,
      offers: trackedJobs.filter((job) => job.status === "Offer").length,
    };
  }, [data.jobs]);

  const automaticSourceCount = data.sources.filter((source) => source.status === "active" && ["rss", "json"].includes(source.method)).length;

  async function updateJob(id: string, patch: Record<string, unknown>) {
    setData((current) => ({
      ...current,
      jobs: current.jobs.map((job) => job.id === id ? { ...job, ...patch } as Job : job),
    }));
    const response = await fetch("/api/jobs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...patch }),
    });
    if (!response.ok) {
      setNotice("That change did not save. The dashboard has been refreshed.");
      await loadData();
      return false;
    } else if (selectedJob?.id === id) {
      setSelectedJob((current) => current ? { ...current, ...patch } as JobDetails : current);
    }
    return true;
  }

  async function openJob(id: string) {
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/jobs?id=${encodeURIComponent(id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      setSelectedJob(await response.json());
    } catch {
      setNotice("That job workspace could not be opened. Please try again.");
    } finally {
      setDetailsLoading(false);
    }
  }

  async function refreshSelectedJob() {
    if (!selectedJob) return;
    const response = await fetch(`/api/jobs?id=${encodeURIComponent(selectedJob.id)}`, { cache: "no-store" });
    if (response.ok) setSelectedJob(await response.json());
  }

  async function toggleRequirement(requirement: JobRequirement) {
    setSelectedJob((current) => current ? {
      ...current,
      requirements: current.requirements.map((item) => item.id === requirement.id ? { ...item, completed: !item.completed } : item),
    } : current);
    const response = await fetch("/api/requirements", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: requirement.id, completed: !requirement.completed }),
    });
    if (!response.ok) setNotice("That requirement did not update. Please try again.");
    await Promise.all([loadData(), refreshSelectedJob()]);
  }

  async function addRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob) return;
    const formElement = event.currentTarget;
    const label = String(new FormData(formElement).get("label") || "").trim();
    if (!label) return;
    setSaving(true);
    try {
      const response = await fetch("/api/requirements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJob.id, label }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The required material could not be added.");
      formElement.reset();
      await Promise.all([loadData(), refreshSelectedJob()]);
      setNotice("Required material added to this job checklist.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The required material could not be added.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedJob(job: JobDetails) {
    const confirmed = window.confirm(`Permanently delete “${job.title}” and its checklist, tasks, notes, and uploaded files? This cannot be undone.`);
    if (!confirmed) return;
    setSaving(true);
    try {
      const response = await fetch("/api/jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: job.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "The job could not be deleted.");
      setSelectedJob(null);
      setData((current) => ({ ...current, jobs: current.jobs.filter((item) => item.id !== job.id), tasks: current.tasks.filter((task) => task.jobId !== job.id) }));
      await loadData();
      setNotice("Job tracker permanently deleted.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The job could not be deleted.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob) return;
    setSaving(true);
    const form = new FormData(event.currentTarget);
    form.set("jobId", selectedJob.id);
    try {
      const response = await fetch("/api/files", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Upload failed");
      event.currentTarget.reset();
      await Promise.all([loadData(), refreshSelectedJob()]);
      setNotice(body.dropboxStatus === "synced" ? "File added and copied to your personal Dropbox." : "File added to this job workspace.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The file could not be uploaded.");
    } finally {
      setSaving(false);
    }
  }

  async function configureDropbox(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDropboxBusy(true);
    try {
      const appKey = String(new FormData(event.currentTarget).get("appKey") || "");
      const response = await fetch("/api/dropbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appKey }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Dropbox setup could not be saved.");
      setData((current) => ({ ...current, dropbox: result }));
      setNotice("Dropbox App key saved. You can now authorize your personal Dropbox.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dropbox setup could not be saved.");
    } finally {
      setDropboxBusy(false);
    }
  }

  async function configureAI(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAiBusy(true);
    try {
      const apiKey = String(new FormData(event.currentTarget).get("apiKey") || "");
      const response = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "AI extraction setup could not be saved.");
      setData((current) => ({ ...current, ai: result }));
      event.currentTarget.reset();
      setNotice(`AI extraction connected with ${result.model}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI extraction setup could not be saved.");
    } finally {
      setAiBusy(false);
    }
  }

  async function disconnectAI() {
    if (!window.confirm("Remove the saved OpenAI API key from Market Desk?")) return;
    setAiBusy(true);
    try {
      const response = await fetch("/api/ai", { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "AI extraction could not be disconnected.");
      setData((current) => ({ ...current, ai: result }));
      setNotice("AI extraction disconnected and the saved key was removed.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "AI extraction could not be disconnected.");
    } finally {
      setAiBusy(false);
    }
  }

  async function syncDropbox(fileId?: string) {
    setDropboxBusy(true);
    try {
      const response = await fetch("/api/dropbox/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fileId ? { fileId } : {}) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Dropbox sync failed.");
      await Promise.all([loadData(), selectedJob ? refreshSelectedJob() : Promise.resolve()]);
      setNotice(fileId ? "File copied to Dropbox." : `${result.synced || 0} existing file${result.synced === 1 ? "" : "s"} copied to Dropbox${result.failed ? `; ${result.failed} need another try` : ""}.`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dropbox sync failed.");
    } finally {
      setDropboxBusy(false);
    }
  }

  async function disconnectDropboxConnection() {
    if (!window.confirm("Disconnect Dropbox? Files already copied there will remain in Dropbox.")) return;
    setDropboxBusy(true);
    try {
      const response = await fetch("/api/dropbox", { method: "DELETE" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Dropbox could not be disconnected.");
      setData((current) => ({ ...current, dropbox: result }));
      setNotice("Dropbox disconnected. Existing Dropbox copies were left untouched.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Dropbox could not be disconnected.");
    } finally {
      setDropboxBusy(false);
    }
  }

  async function moveJob(job: JobDetails, nextBucket: "active" | "maybe" | "skipped") {
    await updateJob(job.id, { bucket: nextBucket });
    if (nextBucket === "skipped") {
      setSelectedJob(null);
      setNotice("Job moved to Skipped. It remains saved in the opportunity ledger.");
    } else {
      setNotice(nextBucket === "maybe" ? "Job moved to Maybe." : "Job restored to the active dashboard.");
    }
  }

  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      setJobOpen(false);
      setJobDraft(emptyJobDraft);
      setNotice("Job saved. Its requirements and next action are ready to refine.");
      await loadData();
    } catch {
      setNotice("The job could not be saved. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function submitLinkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const urls = [...new Set(String(new FormData(event.currentTarget).get("urls") || "")
      .split(/\r?\n/)
      .map((url) => url.trim())
      .filter(Boolean))];
    if (!urls.length) {
      setLinkImportError("Enter at least one job-posting URL.");
      return;
    }
    if (urls.length > 50) {
      setLinkImportError(`A batch can contain at most 50 unique URLs. This list contains ${urls.length}.`);
      return;
    }
    if (!data.ai.configured) {
      setLinkImportOpen(false);
      setAiOpen(true);
      setNotice("Connect AI extraction before importing a job link.");
      return;
    }
    setLinkImportError("");
    setLinkImportReport(null);
    setSaving(true);
    setLinkImportProgress({ current: 0, total: urls.length });
    const importedIds: string[] = [];
    const failures: LinkImportFailure[] = [];
    let skipped = 0;
    try {
      for (const [index, url] of urls.entries()) {
        setLinkImportProgress({ current: index + 1, total: urls.length });
        try {
          const response = await fetch("/api/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
          });
          const result = await response.json().catch(() => ({})) as { id?: string; error?: string };
          if (!response.ok) {
            const message = result.error || "The job link could not be imported.";
            if (/already saved/i.test(message)) skipped += 1;
            else failures.push({ url, error: message });
          } else if (result.id) {
            importedIds.push(result.id);
          } else {
            failures.push({ url, error: "The job link could not be imported." });
          }
        } catch (error) {
          failures.push({ url, error: error instanceof Error ? error.message : "The job link could not be imported." });
        }
      }
      const summary = `${importedIds.length} job${importedIds.length === 1 ? "" : "s"} imported, ${skipped} already saved, ${failures.length} failed.`;
      setLinkImportOpen(false);
      await loadData();
      setNotice(summary);
      setLinkImportReport({ summary, failures });
      if (urls.length === 1 && importedIds[0]) await openJob(importedIds[0]);
      if (urls.length > 1) {
        setSelectedJob(null);
        setView("jobs");
      }
    } finally {
      setSaving(false);
      setLinkImportProgress(null);
    }
  }

  async function submitMonitor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error();
      setMonitorOpen(false);
      setNotice("Monitor added. It will check automatically when due.");
      await fetch("/api/collect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: true }) });
      await loadData();
    } catch {
      setNotice("That monitor could not be added. Confirm the feed URL and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function runCollection() {
    if (!automaticSourceCount) {
      setView("sources");
      setNotice("No automatic monitors are configured yet. Add an official RSS, Atom, or JSON feed to enable collection.");
      return;
    }
    setNotice("Checking eligible sources…");
    const response = await fetch("/api/collect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    const result = response.ok ? await response.json() : null;
    setNotice(result ? `Collection finished: ${result.sourcesChecked} source${result.sourcesChecked === 1 ? "" : "s"} checked, ${result.itemsAdded} new job${result.itemsAdded === 1 ? "" : "s"} saved.` : "Collection could not run right now.");
    await loadData();
  }

  async function reviewSource(id: string) {
    setData((current) => ({ ...current, sources: current.sources.map((source) => source.id === id ? { ...source, lastCheckedAt: new Date().toISOString() } : source) }));
    const response = await fetch("/api/sources", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!response.ok) setNotice("That source review could not be recorded.");
  }

  return (
    <div className="market-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand"><span className="brand-mark">M</span><span>Market Desk</span></div>
        <p className="season-label">ECONOMICS JOB MARKET</p>
        <nav className="side-nav">
          <button className={view === "overview" ? "selected" : ""} onClick={() => navigate("overview")}><span>01</span> Overview</button>
          <button className={view === "jobs" ? "selected" : ""} onClick={() => navigate("jobs")}><span>02</span> All jobs <b>{data.jobs.length}</b></button>
          <button className={view === "sources" ? "selected" : ""} onClick={() => navigate("sources")}><span>03</span> Sources <b>{data.sources.length}</b></button>
        </nav>
        <div className="sidebar-footer"><span className="privacy-dot" /> Private workspace</div>
      </aside>

      <main>
        <header className="topbar">
          <div>
            <p className="eyebrow">YOUR SEARCH, ONE SYSTEM</p>
            <h1>{view === "sources" ? "Source watch" : view === "jobs" ? "Opportunity ledger" : greeting}</h1>
          </div>
          <div className="top-actions">
            <button className={`button secondary ai-button ${data.ai.configured ? "connected" : ""}`} onClick={() => setAiOpen(true)}><span className="ai-dot" /> AI extraction</button>
            <button className={`button secondary dropbox-button ${data.dropbox.connected ? "connected" : ""}`} onClick={() => setDropboxOpen(true)}><span className="dropbox-dot" /> Dropbox</button>
            <button className="button secondary monitor-button" onClick={() => setMonitorOpen(true)}>+ Add monitor</button>
            <button className="button secondary import-button" onClick={() => { setLinkImportError(""); setLinkImportReport(null); setLinkImportOpen(true); }}>Import from link</button>
            <button className="button primary" onClick={() => { setJobDraft(emptyJobDraft); setJobOpen(true); }}>+ Add job</button>
          </div>
        </header>

        {notice && <div className="notice" role="status"><div><span>{notice}</span>{linkImportReport?.summary === notice && linkImportReport.failures.length > 0 && <details className="import-failures"><summary>Show failed URLs</summary><ul>{linkImportReport.failures.map((failure) => <li key={failure.url}><strong>{failure.url}</strong><span>{failure.error}</span></li>)}</ul></details>}</div><button aria-label="Dismiss notice" onClick={() => { setNotice(""); setLinkImportReport(null); }}>×</button></div>}

        {view === "sources" ? (
          <SourcesView sources={data.sources} loading={loading} automaticCount={automaticSourceCount} onRun={runCollection} onAdd={() => setMonitorOpen(true)} onReview={reviewSource} />
        ) : (
          <>
            <section className="collection-strip" aria-label="Collection status">
              <div className="collection-copy">
                <span className="pulse" />
                <div><strong>{automaticSourceCount ? `${automaticSourceCount} automatic monitor${automaticSourceCount === 1 ? "" : "s"} configured` : "0 automatic monitors configured"}</strong><p>{automaticSourceCount ? "Approved feeds accumulate new jobs automatically over time." : `${data.sources.length} sources are tracked, but each currently needs manual review, permission, or credentials.`}</p></div>
              </div>
              <div className="source-pips">
                {data.sources.slice(0, 5).map((source) => {
                  const state = sourceState(source);
                  return <button key={source.id} onClick={() => navigate("sources")} title={source.message || state.label}><span className={`source-dot ${state.tone}`} />{source.name}</button>;
                })}
              </div>
              <button className="text-button" onClick={automaticSourceCount ? runCollection : () => navigate("sources")}>{automaticSourceCount ? `Check ${automaticSourceCount} now →` : "Configure a monitor →"}</button>
            </section>

            {view === "overview" && (
              <section className="metrics" aria-label="Application summary">
                <Metric label="In progress" value={metrics.inProgress} detail="Saved, preparing, or ready" onClick={() => showPipeline("in-progress")} />
                <Metric label="Submitted" value={metrics.submitted} detail="Applications sent" onClick={() => showPipeline("submitted")} />
                <Metric label="Interviews" value={metrics.interviews} detail="First-round conversations" onClick={() => showPipeline("interview")} />
                <Metric label="Flyouts" value={metrics.flyouts} detail="Campus or final rounds" onClick={() => showPipeline("flyout")} />
                <Metric label="Offers" value={metrics.offers} detail="Offers received" tone={metrics.offers ? "success" : ""} onClick={() => showPipeline("offer")} />
              </section>
            )}

            <section className="workspace-grid">
              <div className="jobs-panel">
                <div className="panel-heading">
                  <div><p className="eyebrow">{pipelineFilter ? "PIPELINE VIEW" : view === "overview" ? "ACTIVE LEDGER" : "COMPLETE LEDGER"}</p><h2>{pipelineFilter ? pipelineFilters[pipelineFilter].label : view === "overview" ? "Applications in motion" : "All opportunities"}</h2></div>
                  <div className="filters">
                    {pipelineFilter && <button className="clear-filter" onClick={() => setPipelineFilter(null)}>Clear pipeline filter</button>}
                    <label><span className="sr-only">Search jobs</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search institution or role" /></label>
                    <label><span className="sr-only">Filter by sector</span><select value={sector} onChange={(event) => setSector(event.target.value)}><option>All sectors</option><option>Academic</option><option>Postdoc</option><option>Industry</option><option>Government</option></select></label>
                    <label><span className="sr-only">Sort jobs</span><select className="sort-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}><option value="deadline-soonest">Deadline: soonest upcoming</option><option value="deadline-latest">Deadline: latest first</option><option value="status">Application status</option><option value="updated">Recently updated</option></select></label>
                  </div>
                </div>
                {view === "jobs" && <div className="bucket-tabs" role="group" aria-label="Job collection"><button className={bucket === "active" ? "selected" : ""} onClick={() => setBucket("active")}>Active <span>{data.jobs.filter((job) => job.bucket === "active").length}</span></button><button className={bucket === "maybe" ? "selected" : ""} onClick={() => setBucket("maybe")}>Maybe <span>{data.jobs.filter((job) => job.bucket === "maybe").length}</span></button><button className={bucket === "skipped" ? "selected" : ""} onClick={() => setBucket("skipped")}>Skipped <span>{data.jobs.filter((job) => job.bucket === "skipped").length}</span></button><button className={bucket === "all" ? "selected" : ""} onClick={() => setBucket("all")}>All <span>{data.jobs.length}</span></button></div>}
                <JobTable jobs={view === "overview" ? filteredJobs.slice(0, 6) : filteredJobs} loading={loading || detailsLoading} onUpdate={updateJob} onOpen={openJob} />
              </div>
            </section>
          </>
        )}
      </main>

      {jobOpen && <JobModal initialValues={jobDraft} onClose={() => setJobOpen(false)} onSubmit={submitJob} saving={saving} />}
      {linkImportOpen && <LinkImportModal onClose={() => setLinkImportOpen(false)} onSubmit={submitLinkImport} saving={saving} progress={linkImportProgress} error={linkImportError} />}
      {monitorOpen && <MonitorModal onClose={() => setMonitorOpen(false)} onSubmit={submitMonitor} saving={saving} />}
      {dropboxOpen && <DropboxModal status={data.dropbox} onClose={() => setDropboxOpen(false)} onConfigure={configureDropbox} onSync={() => syncDropbox()} onDisconnect={disconnectDropboxConnection} busy={dropboxBusy} />}
      {aiOpen && <AIModal status={data.ai} onClose={() => setAiOpen(false)} onConfigure={configureAI} onDisconnect={disconnectAI} busy={aiBusy} />}
      {selectedJob && <JobWorkspace job={selectedJob} dropboxConnected={data.dropbox.connected} onClose={() => setSelectedJob(null)} onMove={moveJob} onUpdate={updateJob} onToggleRequirement={toggleRequirement} onAddRequirement={addRequirement} onDelete={deleteSelectedJob} onUpload={uploadFile} onSyncFile={(fileId) => syncDropbox(fileId)} saving={saving || dropboxBusy} />}
    </div>
  );
}

function Metric({ label, value, detail, tone = "", onClick }: { label: string; value: number; detail: string; tone?: string; onClick: () => void }) {
  return <button type="button" className={`metric ${tone}`} onClick={onClick} aria-label={`Show ${label.toLowerCase()}: ${value}`}><span className="metric-label">{label}</span><span className="metric-value"><strong>{value}</strong><span>{detail}</span></span></button>;
}

function JobTable({ jobs, loading, onUpdate, onOpen }: { jobs: Job[]; loading: boolean; onUpdate: (id: string, patch: Record<string, unknown>) => void; onOpen: (id: string) => void }) {
  if (loading) return <div className="table-loading">Loading your market ledger…</div>;
  if (!jobs.length) return <div className="table-loading">No jobs match these filters yet. Capture one from any source to begin.</div>;
  const now = new Date();
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Position</th><th>Institution / Company</th><th>Sector</th><th>Location / salary</th><th>Deadline</th><th>Requirements</th><th>Status</th><th><span className="sr-only">Star</span></th></tr></thead>
        <tbody>{jobs.map((job) => {
          const progress = job.requirementsTotal ? Math.round((job.requirementsDone / job.requirementsTotal) * 100) : 0;
          const deadline = deadlinePresentation(job.deadline, now);
          return (
            <tr key={job.id}>
              <td><button className="opportunity opportunity-button" onClick={() => onOpen(job.id)}><strong>{job.title}</strong><span>{job.source}{job.bucket === "maybe" ? " · Maybe" : job.bucket === "skipped" ? " · Skipped" : ""}</span></button></td>
              <td className="organization-cell">{job.organization}</td>
              <td><span className={`sector sector-${job.sector.toLowerCase()}`}>{job.sector}</span></td>
              <td><span className="job-place">{job.location || "Not listed"}</span><span className={`cell-note ${job.salary ? "salary" : ""}`}>{job.salary || "Salary not listed"}</span></td>
              <td><strong className={`deadline ${deadline.tone}`}>{deadline.label}</strong><span className={`cell-note deadline-note ${deadline.tone}`}>{deadline.detail}</span></td>
              <td><div className="requirement"><span>{job.requirementsDone}/{job.requirementsTotal || "—"}</span><div className="mini-bar"><i style={{ width: `${progress}%` }} /></div></div></td>
              <td><select className={`status-select status-${job.status.toLowerCase()}`} value={job.status} aria-label={`Status for ${job.title}`} onChange={(event) => onUpdate(job.id, { status: event.target.value })}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></td>
              <td><button className={`star ${job.starred ? "on" : ""}`} aria-label={`${job.starred ? "Unstar" : "Star"} ${job.title}`} onClick={() => onUpdate(job.id, { starred: !job.starred })}>★</button></td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
}

function JobWorkspace({ job, dropboxConnected, onClose, onMove, onUpdate, onToggleRequirement, onAddRequirement, onDelete, onUpload, onSyncFile, saving }: {
  job: JobDetails;
  dropboxConnected: boolean;
  onClose: () => void;
  onMove: (job: JobDetails, bucket: "active" | "maybe" | "skipped") => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => Promise<boolean>;
  onToggleRequirement: (requirement: JobRequirement) => void;
  onAddRequirement: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (job: JobDetails) => void;
  onUpload: (event: FormEvent<HTMLFormElement>) => void;
  onSyncFile: (fileId: string) => void;
  saving: boolean;
}) {
  const [editingDetails, setEditingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [detailsSaving, setDetailsSaving] = useState(false);

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDetailsSaving(true);
    setDetailsError("");
    const form = new FormData(event.currentTarget);
    const saved = await onUpdate(job.id, {
      title: form.get("title"), organization: form.get("organization"), sector: form.get("sector"),
      deadline: form.get("deadline"), location: form.get("location"), salary: form.get("salary"), sourceUrl: form.get("sourceUrl"),
    });
    setDetailsSaving(false);
    if (saved) setEditingDetails(false);
    else setDetailsError("Could not save these details. Please review them and try again.");
  }

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="job-drawer" role="dialog" aria-modal="true" aria-labelledby="job-workspace-title">
        <header className="drawer-header">
          <div className="drawer-title"><span className="org-mark large" title={job.organization}>{job.organization}</span><div><p className="eyebrow">{job.organization}</p><h2 id="job-workspace-title">{job.title}</h2><p>{job.location || "Location not listed"} · {job.salary || "Salary not listed"} · {job.source}</p></div></div>
          <button className="modal-close" onClick={onClose} aria-label="Close job workspace">×</button>
        </header>

        <div className="drawer-actions">
          <button className="button secondary" onClick={() => setEditingDetails((value) => !value)}>{editingDetails ? "Close edit" : "Edit details"}</button>
          {job.sourceUrl ? <a className="button primary" href={job.sourceUrl} target="_blank" rel="noreferrer">Open original posting ↗</a> : <span className="missing-link">No posting link was captured</span>}
          <label><span>Application status</span><select value={job.status} onChange={(event) => onUpdate(job.id, { status: event.target.value })}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
          <div className="fit-actions">
            {job.bucket !== "active" && <button className="button secondary" onClick={() => onMove(job, "active")}>Restore to dashboard</button>}
            <button className={`button secondary ${job.bucket === "maybe" ? "is-selected" : ""}`} onClick={() => onMove(job, job.bucket === "maybe" ? "active" : "maybe")}>Maybe</button>
            <button className="button skip" onClick={() => onMove(job, "skipped")}>Skip</button>
            <button className="button danger" onClick={() => onDelete(job)} disabled={saving}>Delete job</button>
          </div>
        </div>

        <div className="drawer-content">
          {editingDetails && <form className="edit-job-details" onSubmit={saveDetails}>
            <div className="detail-heading"><div><p className="eyebrow">MANUAL CORRECTION</p><h3>Edit job details</h3></div></div>
            <div className="edit-job-grid">
              <label>Position title<input name="title" required maxLength={240} defaultValue={job.title} /></label>
              <label>Institution / Company<input name="organization" required maxLength={240} defaultValue={job.organization} /></label>
              <label>Sector<select name="sector" defaultValue={job.sector}><option>Academic</option><option>Postdoc</option><option>Industry</option><option>Government</option></select></label>
              <label>Deadline<input name="deadline" type="date" defaultValue={job.deadline || ""} /></label>
              <label>Location<input name="location" maxLength={240} defaultValue={job.location || ""} /></label>
              <label>Salary / compensation<input name="salary" maxLength={240} defaultValue={job.salary || ""} /></label>
              <label className="wide">Posting URL<input name="sourceUrl" type="url" maxLength={2048} defaultValue={job.sourceUrl || ""} /></label>
            </div>
            {detailsError && <p className="edit-details-error" role="alert">{detailsError}</p>}
            <div className="edit-details-actions"><button type="button" className="button secondary" onClick={() => { setEditingDetails(false); setDetailsError(""); }}>Cancel</button><button type="submit" className="button primary" disabled={detailsSaving}>{detailsSaving ? "Saving…" : "Save changes"}</button></div>
          </form>}
          <JobNoteEditor job={job} onSave={onUpdate} />

          <section className="detail-section">
            <div className="detail-heading"><div><p className="eyebrow">EXTRACTED CHECKLIST</p><h3>Application requirements</h3></div><span>{job.requirements.filter((item) => item.completed).length}/{job.requirements.length} prepared</span></div>
            <div className="requirements-list">
              {job.requirements.map((requirement) => <label className="requirement-row" key={requirement.id}><input type="checkbox" checked={requirement.completed} onChange={() => onToggleRequirement(requirement)} /><span><strong>{requirement.label}</strong><small>{requirement.completed ? "Prepared" : "Still needed"}</small></span></label>)}
              {!job.requirements.length && <p className="empty-copy">No requirements were extracted from this posting.</p>}
            </div>
            <form className="requirement-add" onSubmit={onAddRequirement}><label><span>Add required material</span><input name="label" required maxLength={180} placeholder="e.g. Two-page policy statement" /></label><button className="button secondary" type="submit" disabled={saving}>{saving ? "Adding…" : "+ Add requirement"}</button></form>
          </section>

          <section className="detail-section files-section">
            <div className="detail-heading"><div><p className="eyebrow">JOB-SPECIFIC MATERIALS</p><h3>Prepared files</h3></div><span>{job.files.length} file{job.files.length === 1 ? "" : "s"}</span></div>
            <div className="files-list">
              {job.files.map((file) => <article className="file-row" key={file.id}><a className="file-main" href={`/api/files?id=${encodeURIComponent(file.id)}`}><span className="file-icon">DOC</span><span><strong>{file.label}</strong><small>{file.filename} · {fileSize(file.sizeBytes)}</small></span><b>Download</b></a><div className="file-sync"><span className={`sync-state ${file.dropboxStatus}`} title={file.dropboxError || file.dropboxPath || ""}>{file.dropboxStatus === "synced" ? "Dropbox ✓" : file.dropboxStatus === "syncing" ? "Syncing…" : file.dropboxStatus === "failed" ? "Sync failed" : "Tracker only"}</span>{dropboxConnected && file.dropboxStatus !== "synced" && <button type="button" onClick={() => onSyncFile(file.id)} disabled={saving}>Try sync</button>}</div></article>)}
              {!job.files.length && <div className="empty-files"><strong>No files attached yet</strong><span>Keep the tailored cover letter, statement, CV, and final submission documents with this job.</span></div>}
            </div>
            <form className="file-upload" onSubmit={onUpload}>
              <label><span>Document label</span><input name="label" placeholder="e.g. Tailored cover letter" /></label>
              <label className="file-input"><span>Choose file</span><input name="file" type="file" required accept=".pdf,.doc,.docx,.txt,.rtf,.tex,.zip,.xlsx,.csv,.ppt,.pptx" /></label>
              <button className="button primary" type="submit" disabled={saving}>{saving ? "Uploading…" : "Add file"}</button>
              <small>PDF, Word, LaTeX, spreadsheets, slides, text, or ZIP · up to 25 MB</small>
            </form>
          </section>

          {job.sourceSnapshot && <details className="posting-snapshot"><summary>View full saved job description</summary><p>{job.sourceSnapshot}</p></details>}
        </div>
      </section>
    </div>
  );
}

function JobNoteEditor({ job, onSave }: { job: JobDetails; onSave: (id: string, patch: Record<string, unknown>) => Promise<boolean> }) {
  const [note, setNote] = useState(job.notes || "");
  const [state, setState] = useState<"saved" | "unsaved" | "saving" | "error">("saved");

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState("saving");
    const saved = await onSave(job.id, { notes: note });
    setState(saved ? "saved" : "error");
  }

  return <section className="detail-section note-section">
    <div className="detail-heading"><div><p className="eyebrow">PRIVATE MEMO</p><h3>Notes</h3></div><span>{state === "saving" ? "Saving…" : state === "unsaved" ? "Unsaved changes" : state === "error" ? "Could not save" : "Saved"}</span></div>
    <form className="job-note-form" onSubmit={saveNote}>
      <textarea value={note} onChange={(event) => { setNote(event.target.value); setState("unsaved"); }} maxLength={5000} rows={4} placeholder="Add fit notes, contacts, interview details, or reminders for this job…" aria-label={`Notes for ${job.title}`} />
      <div><span>{note.length.toLocaleString()} / 5,000</span><button className="button secondary" type="submit" disabled={state === "saving" || state === "saved"}>{state === "saving" ? "Saving…" : "Save note"}</button></div>
    </form>
  </section>;
}

function SourcesView({ sources, loading, automaticCount, onRun, onAdd, onReview }: { sources: SourceMonitor[]; loading: boolean; automaticCount: number; onRun: () => void; onAdd: () => void; onReview: (id: string) => void }) {
  return (
    <section className="sources-page">
      <div className="sources-intro"><div><p className="eyebrow">ONGOING DISCOVERY</p><h2>Build coverage as the market develops</h2><p>Tracked sources are not automatically scraped. Only an approved feed or API connection becomes an automatic monitor.</p></div><div className="top-actions"><button className="button secondary" onClick={onAdd}>+ Add RSS / JSON feed</button><button className="button primary" onClick={onRun} disabled={!automaticCount}>{automaticCount ? `Run ${automaticCount} automatic monitor${automaticCount === 1 ? "" : "s"}` : "No automatic monitors yet"}</button></div></div>
      <div className="source-summary" aria-label="Source connection summary"><article><p>Sources tracked</p><strong>{sources.length}</strong><span>Known places to review</span></article><article className={automaticCount ? "connected" : "attention"}><p>Automatic monitors</p><strong>{automaticCount}</strong><span>{automaticCount ? "Approved connections" : "Add an official feed"}</span></article><article><p>Manual or gated</p><strong>{sources.length - automaticCount}</strong><span>Review, permission, or access needed</span></article></div>
      <div className="source-grid">
        {loading ? <div className="table-loading">Loading sources…</div> : sources.map((source) => {
          const state = sourceState(source);
          return <article className="source-card" key={source.id}><div className="source-card-top"><span className="source-monogram">{initials(source.name)}</span><span className={`state-badge ${state.tone}`}>{state.label}</span></div><h3>{source.name}</h3><p>{source.message}</p><dl><div><dt>Method</dt><dd>{source.method.replaceAll("_", " ")}</dd></div><div><dt>Last activity</dt><dd>{relativeTime(source.lastCheckedAt)}</dd></div><div><dt>Jobs added</dt><dd>{source.itemsAdded}</dd></div></dl><div className="source-card-actions">{source.url ? <a href={source.url} target="_blank" rel="noreferrer" onClick={() => onReview(source.id)}>{source.status === "active" ? "Open feed ↗" : "Open & record review ↗"}</a> : <button onClick={() => onReview(source.id)}>Mark reviewed today</button>}</div></article>;
        })}
      </div>
      <div className="policy-note"><strong>What “automatic” means</strong><p>Market Desk only collects from a source when you add an official RSS/Atom feed, a permitted JSON endpoint, or authorized API access. Opening a gated source records a manual review; it does not scrape the site.</p></div>
    </section>
  );
}

function ModalFrame({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><p className="eyebrow">MARKET DESK INTAKE</p><h2 id="modal-title">{title}</h2><p className="modal-subtitle">{subtitle}</p>{children}</section></div>;
}

function AIModal({ status, onClose, onConfigure, onDisconnect, busy }: {
  status: AIStatus;
  onClose: () => void;
  onConfigure: (event: FormEvent<HTMLFormElement>) => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  return <ModalFrame title="AI extraction" subtitle="Connect your own OpenAI account so Market Desk can read each imported posting as a whole." onClose={onClose}>
    <div className="ai-setup">
      <div className={`ai-model-card ${status.configured ? "connected" : ""}`}><span>{status.configured ? "✓" : "AI"}</span><div><strong>{status.model}</strong><p>The cheapest suitable OpenAI extraction model. There is no free generative extraction model, and Market Desk will not switch to a more expensive one.</p></div></div>
      <ul className="ai-facts"><li>Your API key is encrypted before it is stored.</li><li>Posting text is sent only when you choose “Import from link.”</li><li>OpenAI response storage is disabled for these requests.</li></ul>
      {!status.secureStorageReady && <div className="form-help"><strong>Secure storage is not ready</strong><span>The site owner must add the OPENAI_KEY_ENCRYPTION_KEY secret before an API key can be saved.</span></div>}
      <form className="ai-key-form" onSubmit={onConfigure}><label><span>{status.configured ? "Replace saved API key" : "OpenAI API key"}</span><input name="apiKey" type="password" required autoComplete="off" placeholder="Paste a newly created key here" aria-label="OpenAI API key" /></label><button className="button primary" disabled={busy || !status.secureStorageReady}>{busy ? "Saving…" : status.configured ? "Save replacement key" : "Connect AI"}</button></form>
      {status.configured && <div className="ai-actions"><span>Connected for future link imports</span><button className="button secondary" onClick={onDisconnect} disabled={busy}>Remove saved key</button></div>}
      <p className="dropbox-privacy">Revoke the key pasted into this chat and use a new replacement here. The saved key is never returned to the browser after submission.</p>
    </div>
  </ModalFrame>;
}

function DropboxModal({ status, onClose, onConfigure, onSync, onDisconnect, busy }: {
  status: DropboxStatus;
  onClose: () => void;
  onConfigure: (event: FormEvent<HTMLFormElement>) => void;
  onSync: () => void;
  onDisconnect: () => void;
  busy: boolean;
}) {
  const callbackUrl = typeof window === "undefined" ? "" : `${window.location.origin}/api/dropbox/callback`;
  return <ModalFrame title="Personal Dropbox" subtitle="Keep a second copy of every job-specific material in your own Dropbox App folder." onClose={onClose}>
    <div className="dropbox-setup">
      {status.connected ? <>
        <div className="dropbox-connected-card"><span className="dropbox-check">✓</span><div><strong>Dropbox is connected</strong><p>New uploads are copied automatically into folders organized by job.</p></div></div>
        <div className="dropbox-stats"><div><strong>{status.syncedFiles}</strong><span>Synced</span></div><div><strong>{status.pendingFiles}</strong><span>Waiting</span></div><div><strong>{status.failedFiles}</strong><span>Need retry</span></div></div>
        <div className="dropbox-path"><span>Dropbox location</span><strong>Apps / your Dropbox app / Market Desk</strong></div>
        <div className="dropbox-actions"><button className="button primary" onClick={onSync} disabled={busy || !status.pendingFiles}>{busy ? "Syncing…" : "Sync existing files"}</button><button className="button secondary" onClick={onDisconnect} disabled={busy}>Disconnect</button></div>
      </> : <>
        <ol className="setup-steps">
          <li><span>1</span><div><strong>Create a Dropbox API app</strong><p>Choose “Scoped access” and “App folder,” then enable <code>files.content.write</code>.</p><a href="https://www.dropbox.com/developers/apps/create" target="_blank" rel="noreferrer">Open Dropbox App Console ↗</a></div></li>
          <li><span>2</span><div><strong>Add this redirect URI</strong><p>Paste it into the app’s OAuth 2 redirect URI list.</p><code className="callback-url">{callbackUrl}</code></div></li>
          <li><span>3</span><div><strong>Save the App key</strong><p>The App key is public; Market Desk never asks for or stores an App secret.</p><form className="dropbox-key-form" onSubmit={onConfigure}><input name="appKey" required placeholder="Dropbox App key" aria-label="Dropbox App key" /><button className="button secondary" disabled={busy}>{busy ? "Saving…" : status.appKeySaved ? "Replace key" : "Save key"}</button></form></div></li>
        </ol>
        <div className="dropbox-connect-row"><div><strong>{status.appKeySaved ? "App key saved" : "Complete steps 1–3 first"}</strong><span>Dropbox will ask you to approve access once.</span></div>{status.appKeySaved && <a className="button primary connect-link" href="/api/dropbox/start">Authorize Dropbox</a>}</div>
      </>}
      <p className="dropbox-privacy">Market Desk can write only inside its Dropbox App folder. Disconnecting does not delete files already copied there.</p>
    </div>
  </ModalFrame>;
}

function JobModal({ initialValues, onClose, onSubmit, saving }: { initialValues: JobDraft; onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean }) {
  const [draft, setDraft] = useState(initialValues);
  const [clipboardMessage, setClipboardMessage] = useState(initialValues.postingText ? "Copied text imported. Review the detected fields, add the original link, then save." : "Copy the visible posting on the source page, then import it here.");

  function update(field: keyof JobDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function importClipboard(kind: "posting" | "link") {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (!text) throw new Error("empty");
      if (kind === "link") {
        const candidate = text.split(/\s+/).find((value) => /^https?:\/\//i.test(value));
        if (!candidate) throw new Error("link");
        setDraft((current) => ({ ...current, sourceUrl: candidate, source: sourceFromText(candidate) === "Manual capture" ? current.source : sourceFromText(candidate) }));
        setClipboardMessage("Original posting link added.");
      } else {
        const inferred = inferCopiedListing(text);
        setDraft((current) => ({ ...inferred, sourceUrl: inferred.sourceUrl || current.sourceUrl }));
        setClipboardMessage("Copied text imported and common fields detected. Please review anything marked as required before saving.");
      }
    } catch (error) {
      setClipboardMessage(error instanceof Error && error.message === "link" ? "Copy the page address from your browser, then try again." : "Clipboard access was blocked or empty. You can paste directly into the fields below.");
    }
  }

  return <ModalFrame title="Capture an opportunity" subtitle="Use a guided clipboard import for gated sources, or enter the job manually." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}>
    <div className="guided-capture wide"><div><strong>Manual capture assistant</strong><span>{clipboardMessage}</span></div><div><button type="button" className="button secondary" onClick={() => importClipboard("posting")}>Import copied text</button><button type="button" className="button secondary" onClick={() => importClipboard("link")}>Add copied link</button></div></div>
    <label className="wide">Posting URL<input name="sourceUrl" type="url" placeholder="https://…" value={draft.sourceUrl} onChange={(event) => update("sourceUrl", event.target.value)} /></label><label>Job title<input name="title" required placeholder="Assistant Professor" value={draft.title} onChange={(event) => update("title", event.target.value)} /></label><label>Organization<input name="organization" required placeholder="University or firm" value={draft.organization} onChange={(event) => update("organization", event.target.value)} /></label><label>Sector<select name="sector" value={draft.sector} onChange={(event) => update("sector", event.target.value)}><option>Academic</option><option>Postdoc</option><option>Industry</option><option>Government</option></select></label><label>Source<select name="source" value={draft.source} onChange={(event) => update("source", event.target.value)}><option>JOE</option><option>EconJobMarket</option><option>AcademicJobsOnline</option><option>X</option><option>Employer website</option><option>Manual capture</option></select></label><label>Deadline<input name="deadline" type="date" value={draft.deadline} onChange={(event) => update("deadline", event.target.value)} /></label><label>Location<input name="location" placeholder="City, State or Remote" value={draft.location} onChange={(event) => update("location", event.target.value)} /></label><label>Salary / compensation<input name="salary" placeholder="$120,000–$145,000, if listed" value={draft.salary} onChange={(event) => update("salary", event.target.value)} /></label><label className="wide">Posting text or requirements<textarea name="postingText" rows={7} placeholder="Paste the listing or its application requirements. Market Desk will identify common documents." value={draft.postingText} onChange={(event) => update("postingText", event.target.value)} /></label><div className="form-help wide"><strong>Why this is manual</strong><span>You choose and copy one visible posting for your private tracker. Market Desk does not fetch, crawl, or sign in to the source website.</span></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Saving…" : "Save opportunity"}</button></div></form></ModalFrame>;
}

function LinkImportModal({ onClose, onSubmit, saving, progress, error }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean; progress: LinkImportProgress | null; error: string }) {
  const progressLabel = progress ? `Importing ${progress.current} of ${progress.total}…` : "AI extract & save";
  return <ModalFrame title="Import jobs from links" subtitle="Paste one public job-posting URL per line. Market Desk will read and save each posting in order." onClose={saving ? () => undefined : onClose}><form className="modal-form link-import-form" onSubmit={onSubmit}><label className="wide">Job-posting links (one per line)<textarea name="urls" required autoFocus rows={7} disabled={saving} placeholder={"https://jobs.example.edu/posting/123\nhttps://jobs.example.edu/posting/456"} aria-describedby={error ? "link-import-error" : undefined} /></label>{error && <div className="form-error wide" id="link-import-error" role="alert">{error}</div>}<div className="form-help wide"><strong>Full-posting AI extraction</strong><span>Accepts any public HTTPS job-posting page that is readable without signing in. Imports up to 50 unique links sequentially; blank lines and repeated URLs are ignored. The configured gpt-5-nano model extracts the employer, location, salary, deadline, full description, and every stated application material.</span></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{progressLabel}</button></div></form></ModalFrame>;
}

function MonitorModal({ onClose, onSubmit, saving }: { onClose: () => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; saving: boolean }) {
  return <ModalFrame title="Add an automatic monitor" subtitle="Use an official RSS/Atom feed or a JSON endpoint you are permitted to access. Due monitors run when Market Desk opens." onClose={onClose}><form className="modal-form" onSubmit={onSubmit}><label>Name<input name="name" required placeholder="Department postdoc feed" /></label><label>Category<select name="category" defaultValue="Academic"><option>Academic</option><option>Postdoc</option><option>Industry</option><option>Government</option></select></label><label className="wide">Feed or API URL<input name="url" type="url" required placeholder="https://example.edu/jobs.rss" /></label><label>Format<select name="method" defaultValue="rss"><option value="rss">RSS / Atom</option><option value="json">JSON</option></select></label><label>Check every<select name="cadenceHours" defaultValue="24"><option value="6">6 hours</option><option value="12">12 hours</option><option value="24">24 hours</option><option value="168">Weekly</option></select></label><div className="form-help wide"><strong>What happens next?</strong><span>Market Desk imports new entries, deduplicates them by URL, and keeps the source and capture time attached.</span></div><div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={saving}>{saving ? "Adding…" : "Add monitor"}</button></div></form></ModalFrame>;
}
