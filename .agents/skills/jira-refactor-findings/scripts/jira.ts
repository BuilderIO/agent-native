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
  attachments: string[];
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
    extra: { form?: FormData; allow404?: boolean } = {},
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
    // idempotent methods are retried; 429 means Jira rejected the request.
    const idempotent = method !== "POST";
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
        const wait =
          Number(response.headers.get("retry-after") ?? 2 ** attempt) * 1000;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(wait, 30_000)),
        );
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
        throw new ScriptError(
          `Jira ${method} ${route} → ${response.status}: ${text.slice(0, 600)}`,
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
      }>("POST", "/rest/api/3/search/jql", {
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
      });
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
      attachments: (issue.fields.attachment ?? []).map((a) => a.filename),
    };
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
    const res = await this.request<{ comments: { body: unknown }[] }>(
      "GET",
      `/rest/api/3/issue/${key}/comment?maxResults=100&orderBy=-created`,
    );
    return (res?.comments ?? []).some((c) =>
      adfText(c.body).includes(runMarker(runId)),
    );
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

export function planAttachmentPattern(planBase: string): RegExp {
  const escaped = planBase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}-[A-Za-z0-9._-]+\\.md$`);
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
