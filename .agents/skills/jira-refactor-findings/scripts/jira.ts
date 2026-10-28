import { readFileSync } from "node:fs";
import path from "node:path";

import {
  loadSkillConfig,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";

export interface JiraConfig {
  baseUrl: string;
  projectKey: string;
  issueType: string;
  label: string;
  podField: string;
  podOptionId: string;
  propertyKey: string;
  sightingCooldownDays: number;
  maxNewTicketsPerRun: number;
  email: string;
  emailEnv: string;
  tokenEnv: string;
}

export function loadJiraConfig(): JiraConfig {
  return loadSkillConfig<JiraConfig>(import.meta.url);
}

// The branch-run link put on tickets: FRAGILITY_RUN_URL, or the Builder
// project branch derived from a Fusion preview origin.
function deriveRunUrl(): string | null {
  const explicit = process.env.FRAGILITY_RUN_URL;
  if (explicit) return explicit;
  const origin = process.env.FUSION_ENV_ORIGIN;
  const match =
    origin &&
    /^https:\/\/([0-9a-f]{20,32})-([a-z0-9-]+)\.builderio\.xyz/.exec(origin);
  return match
    ? `https://builder.io/app/projects/${match[1]}/${match[2]}`
    : null;
}

export interface Finding {
  key: string;
  url: string;
  summary: string;
  status: string;
  statusCategory: string;
  resolution: string | null;
  created: string;
  updated: string;
  fingerprint: string | null;
  systems: string[];
  paths: string[];
  sightings: Sighting[];
  sightingCount: number;
  /** First sighting date; the sightings list keeps only the latest 60. */
  firstSeen: string | null;
  attachments: string[];
  /** Last date the skill commented, or null when it never has. */
  lastCommented: string | null;
  /** The resolved ticket this one recurs, when it was opened as a recurrence. */
  recurrenceOf: string | null;
}

export interface Sighting {
  runId: string;
  date: string;
  score: number | null;
  verdict: string | null;
  windowCommits: number | null;
  lookbackFixes: number | null;
  source?: string | null;
}

export interface FindingProperty {
  fingerprint: string;
  systems: string[];
  paths: string[];
  firstSeen: string;
  lastSeen: string;
  sightingCount: number;
  sightings: Sighting[];
  lastCommented?: string;
  recurrenceOf?: string;
}

/** Retry-After is either delay-seconds or an HTTP date. */
function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return seconds * 1000;
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 2 ** attempt * 1000;
}

const DECLINED =
  /won'?t (do|fix)|not planned|duplicate|cannot reproduce|declined|obsolete/i;

export class Jira {
  private readonly auth: string;
  readonly base: string;

  constructor(readonly config: JiraConfig = loadJiraConfig()) {
    const { emailEnv, tokenEnv, email, baseUrl } = config;
    const token = process.env[tokenEnv];
    if (!token)
      throw new ScriptError(`${tokenEnv} is not set; Jira steps cannot run`, 2);
    const user = process.env[emailEnv] || email;
    this.auth = `Basic ${Buffer.from(`${user}:${token}`).toString("base64")}`;
    this.base = baseUrl.replace(/\/$/, "");
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }

  async request<T>(
    method: string,
    route: string,
    body?: unknown,
    extra: { form?: FormData; allow404?: boolean; readOnly?: boolean } = {},
  ): Promise<T | null> {
    const headers: Record<string, string> = {
      Authorization: this.auth,
      Accept: "application/json",
    };
    let payload: BodyInit | undefined;
    if (extra.form) {
      headers["X-Atlassian-Token"] = "no-check";
      payload = extra.form;
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    // A POST that fails mid-flight may already have been applied, so only
    // idempotent methods and read-only POSTs (search) are retried; 429 means
    // Jira rejected the request.
    const idempotent = method !== "POST" || Boolean(extra.readOnly);
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${this.base}${route}`, {
          method,
          headers,
          body: payload,
          signal: AbortSignal.timeout(45_000),
        });
      } catch (error) {
        if (idempotent && attempt < 2) continue;
        throw new ScriptError(
          `Jira ${method} ${route} unreachable: ${(error as Error).message}${idempotent ? "" : "; outcome unknown, re-run to reconcile"}`,
          2,
        );
      }
      const retryable =
        response.status === 429 || (idempotent && response.status >= 500);
      if (retryable && attempt < 3) {
        const wait = retryAfterMs(response.headers.get("retry-after"), attempt);
        // Retry-After is a minimum; retrying sooner only earns another 429.
        if (wait > 30_000) {
          throw new ScriptError(
            `Jira ${method} ${route} → ${response.status}: retry after ${Math.ceil(wait / 1000)}s${idempotent ? "" : "; outcome unknown, re-run to reconcile"}`,
            2,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, wait));
        continue;
      }
      if (response.status === 404 && extra.allow404) return null;
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new ScriptError(
          `Jira ${method} ${route} → ${response.status}: credentials rejected or missing permission`,
          2,
        );
      }
      if (!response.ok) {
        // A gateway error on a POST may come after Jira applied it.
        const unknown = !idempotent && response.status >= 500;
        throw new ScriptError(
          `Jira ${method} ${route} → ${response.status}: ${text.slice(0, 600)}${unknown ? "; outcome unknown, re-run to reconcile" : ""}`,
          unknown ? 2 : 1,
        );
      }
      return text ? (JSON.parse(text) as T) : ({} as T);
    }
  }

  async findings(): Promise<Finding[]> {
    const { projectKey, label, propertyKey } = this.config;
    const jql = `project = ${projectKey} AND labels = "${label}" ORDER BY created DESC`;
    const out: Finding[] = [];
    let nextPageToken: string | undefined;
    do {
      const page = await this.request<{
        issues: RawIssue[];
        nextPageToken?: string;
      }>(
        "POST",
        "/rest/api/3/search/jql",
        {
          jql,
          maxResults: 100,
          nextPageToken,
          fields: [
            "summary",
            "status",
            "resolution",
            "created",
            "updated",
            "description",
            "attachment",
          ],
          properties: [propertyKey],
        },
        { readOnly: true },
      );
      if (!page) throw new ScriptError("Jira search returned nothing");
      for (const issue of page.issues) out.push(this.toFinding(issue));
      nextPageToken = page.nextPageToken;
    } while (nextPageToken);
    return out;
  }

  private toFinding(issue: RawIssue): Finding {
    const property = issue.properties?.[this.config.propertyKey] as
      | FindingProperty
      | undefined;
    const description = adfText(issue.fields.description);
    const fingerprint =
      property?.fingerprint ??
      /Fingerprint:\s*`?(fsys:[^\s`]+)/.exec(description)?.[1] ??
      null;
    return {
      key: issue.key,
      url: this.browseUrl(issue.key),
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      statusCategory: issue.fields.status.statusCategory.key,
      resolution: issue.fields.resolution?.name ?? null,
      created: issue.fields.created,
      updated: issue.fields.updated,
      fingerprint,
      systems: property?.systems ?? [],
      paths: property?.paths ?? [],
      sightings: property?.sightings ?? [],
      sightingCount:
        property?.sightingCount ?? property?.sightings?.length ?? 0,
      firstSeen: property?.firstSeen ?? null,
      attachments: (issue.fields.attachment ?? []).map((a) => a.filename),
      lastCommented: property?.lastCommented ?? null,
      recurrenceOf:
        property?.recurrenceOf ??
        /Recurrence of\s+([A-Z][A-Z0-9]+-\d+)/.exec(description)?.[1] ??
        null,
    };
  }

  async currentProperty(key: string): Promise<FindingProperty | null> {
    const res = await this.request<{ value: FindingProperty }>(
      "GET",
      `/rest/api/3/issue/${key}/properties/${this.config.propertyKey}`,
      undefined,
      { allow404: true },
    );
    return res?.value ?? null;
  }

  /** Links `key` to `recurrenceOf` unless a link already exists, so a re-run repairs a link a partial failure skipped. */
  async ensureRecurrenceLink(key: string, recurrenceOf: string): Promise<void> {
    const issue = await this.request<{
      fields: {
        issuelinks?: {
          inwardIssue?: { key: string };
          outwardIssue?: { key: string };
        }[];
      };
    }>("GET", `/rest/api/3/issue/${key}?fields=issuelinks`);
    const linked = (issue?.fields.issuelinks ?? []).some(
      (l) =>
        l.inwardIssue?.key === recurrenceOf ||
        l.outwardIssue?.key === recurrenceOf,
    );
    if (linked) return;
    await this.request("POST", "/rest/api/3/issueLink", {
      type: { name: "Relates" },
      inwardIssue: { key },
      outwardIssue: { key: recurrenceOf },
    });
  }

  async setProperty(key: string, value: FindingProperty): Promise<void> {
    await this.request(
      "PUT",
      `/rest/api/3/issue/${key}/properties/${this.config.propertyKey}`,
      value,
    );
  }

  async attach(
    key: string,
    file: string,
    filename = path.basename(file),
  ): Promise<void> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([readFileSync(file)], { type: "text/markdown" }),
      filename,
    );
    await this.request(
      "POST",
      `/rest/api/3/issue/${key}/attachments`,
      undefined,
      { form },
    );
  }

  async hasRunComment(key: string, runId: string): Promise<boolean> {
    const marker = runMarkerPattern(runId);
    for (let startAt = 0; ; ) {
      const page = await this.request<{
        comments: { body: unknown }[];
        total: number;
      }>(
        "GET",
        `/rest/api/3/issue/${key}/comment?startAt=${startAt}&maxResults=100&orderBy=-created`,
      );
      const comments = page?.comments ?? [];
      if (comments.some((c) => marker.test(adfText(c.body)))) return true;
      startAt += comments.length;
      if (comments.length === 0 || startAt >= (page?.total ?? 0)) return false;
    }
  }

  async comment(key: string, doc: AdfNode): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${key}/comment`, {
      body: doc,
    });
  }
}

export function runMarker(runId: string): string {
  return `fragility run ${runId}`;
}

// Delimited so run "bug-eng-45" never matches a comment for "bug-eng-456" or
// "bug-eng-45.2"; a sentence-ending period still ends the id.
function runMarkerPattern(runId: string): RegExp {
  return new RegExp(
    `fragility run ${escapeRegExp(runId)}(?![A-Za-z0-9_-]|\\.[A-Za-z0-9])`,
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function planAttachmentPattern(planBase: string): RegExp {
  return new RegExp(`^${escapeRegExp(planBase)}-[A-Za-z0-9._-]+\\.md$`);
}

/** Why a ticket overlaps a system and its files; empty when it doesn't. The one matching rule for match and upsert. */
export function overlap(
  system: string,
  files: string[],
  finding: Finding,
): string[] {
  const why: string[] = [];
  if (finding.fingerprint?.startsWith(`fsys:${system.toLowerCase()}:`))
    why.push("fingerprint anchor");
  for (const s of finding.systems) {
    if (s === system) why.push("same system");
    else if (s.startsWith(`${system}/`) || system.startsWith(`${s}/`))
      why.push(`nested system ${s}`);
  }
  const shared = files.filter((f) => finding.paths.includes(f));
  if (shared.length)
    why.push(
      `${shared.length} shared file(s): ${shared.slice(0, 3).join(", ")}`,
    );
  return [...new Set(why)];
}

/**
 * Whether a sighting should comment. The cooldown runs from the last comment,
 * not the last sighting, because every run records a sighting and a system
 * that stays hot would otherwise never comment again. Declined tickets wait
 * four cooldowns. Tickets created before lastCommented was tracked count
 * their first sighting (the create) as the last comment.
 */
export function commentDue(finding: Finding, cooldownDays: number): boolean {
  const days = (isDeclined(finding) ? 4 : 1) * cooldownDays;
  const last =
    finding.lastCommented ?? finding.firstSeen ?? finding.sightings[0]?.date;
  return !last || Date.now() - Date.parse(last) >= days * 86_400_000;
}

export function isDeclined(finding: Finding): boolean {
  return (
    DECLINED.test(finding.resolution ?? "") || DECLINED.test(finding.status)
  );
}

export function isOpen(finding: Finding): boolean {
  return finding.statusCategory !== "done";
}

export function runLink(): { url: string | null; source: string } {
  const url = deriveRunUrl();
  return {
    url,
    source: process.env.FRAGILITY_RUN_URL
      ? "FRAGILITY_RUN_URL"
      : url
        ? "FUSION_ENV_ORIGIN"
        : "none",
  };
}

export function mergeSighting(
  existing: FindingProperty | null,
  base: Pick<FindingProperty, "fingerprint" | "systems" | "paths">,
  sighting: Sighting,
  extra: { commentedOn?: string; recurrenceOf?: string } = {},
): FindingProperty {
  const previous = existing?.sightings ?? [];
  const repeat = previous.some((s) => s.runId === sighting.runId);
  const sightings = [
    ...previous.filter((s) => s.runId !== sighting.runId),
    sighting,
  ].slice(-60);
  return {
    fingerprint: existing?.fingerprint ?? base.fingerprint,
    systems: [...new Set([...(existing?.systems ?? []), ...base.systems])],
    paths: [...new Set([...(existing?.paths ?? []), ...base.paths])].slice(
      0,
      80,
    ),
    firstSeen: existing?.firstSeen ?? sighting.date,
    lastSeen: sighting.date,
    sightingCount:
      (existing?.sightingCount ?? previous.length) + (repeat ? 0 : 1),
    sightings,
    lastCommented: extra.commentedOn ?? existing?.lastCommented,
    recurrenceOf: extra.recurrenceOf ?? existing?.recurrenceOf,
  };
}

export type AdfNode = { type: string; [key: string]: unknown };

export const adf = {
  doc: (...content: AdfNode[]): AdfNode => ({
    type: "doc",
    version: 1,
    content,
  }),
  p: (...content: AdfNode[]): AdfNode => ({ type: "paragraph", content }),
  text: (text: string, href?: string): AdfNode =>
    href
      ? { type: "text", text, marks: [{ type: "link", attrs: { href } }] }
      : { type: "text", text },
  code: (text: string): AdfNode => ({
    type: "text",
    text,
    marks: [{ type: "code" }],
  }),
  bullets: (...items: AdfNode[][]): AdfNode => ({
    type: "bulletList",
    content: items.map((content) => ({
      type: "listItem",
      content: [{ type: "paragraph", content }],
    })),
  }),
};

interface RawIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: string } };
    resolution: { name: string } | null;
    created: string;
    updated: string;
    description: unknown;
    attachment?: { filename: string }[];
  };
  properties?: Record<string, unknown>;
}

export function adfText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: string; content?: unknown[] };
  return (n.text ?? "") + (n.content ?? []).map(adfText).join(" ");
}
