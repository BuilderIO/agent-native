import { readFileSync } from "node:fs";
import path from "node:path";

import {
  loadSkillConfig,
  ScriptError,
} from "../../fragility-common/lib/cli.ts";
import {
  type CreateInput,
  type Finding,
  type FindingProperty,
  type Inline,
  type Paragraph,
  runMarkerPattern,
  type Tracker,
} from "../../fragility-common/lib/findings.ts";

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

/** Retry-After is either delay-seconds or an HTTP date. */
function retryAfterMs(header: string | null, attempt: number): number {
  const seconds = Number(header);
  if (header && Number.isFinite(seconds)) return seconds * 1000;
  const date = header ? Date.parse(header) : NaN;
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return 2 ** attempt * 1000;
}

export function parseJiraKey(raw: string): string {
  const key = /([A-Z][A-Z0-9]+-\d+)/.exec(raw)?.[1];
  if (!key) throw new ScriptError(`${raw} is not a Jira issue key or URL`);
  return key;
}

const DECLINED =
  /won'?t (do|fix)|not planned|duplicate|cannot reproduce|declined|obsolete/i;

export class Jira implements Tracker {
  readonly name = "Jira";
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

  get label(): string {
    return this.config.label;
  }

  get sightingCooldownDays(): number {
    return this.config.sightingCooldownDays;
  }

  get maxNewTicketsPerRun(): number {
    return this.config.maxNewTicketsPerRun;
  }

  browseUrl(key: string): string {
    return `${this.base}/browse/${key}`;
  }

  ticketUrl(key: string): string {
    return this.browseUrl(key);
  }

  parseKey(raw: string): string {
    return parseJiraKey(raw);
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
    const status = issue.fields.status.name;
    const resolution = issue.fields.resolution?.name ?? null;
    return {
      key: issue.key,
      url: this.browseUrl(issue.key),
      summary: issue.fields.summary,
      status,
      open: issue.fields.status.statusCategory.key !== "done",
      declined: DECLINED.test(resolution ?? "") || DECLINED.test(status),
      resolution,
      created: issue.fields.created,
      updated: issue.fields.updated,
      fingerprint,
      systems: property?.systems ?? [],
      paths: property?.paths ?? [],
      sightings: property?.sightings ?? [],
      sightingCount:
        property?.sightingCount ?? property?.sightings?.length ?? 0,
      firstSeen: property?.firstSeen ?? null,
      plans: (issue.fields.attachment ?? []).map((a) => a.filename),
      lastCommented: property?.lastCommented ?? null,
      recurrenceOf:
        property?.recurrenceOf ??
        /Recurrence of\s+([A-Z][A-Z0-9]+-\d+)/.exec(description)?.[1] ??
        null,
    };
  }

  async create({ meta, facts }: CreateInput): Promise<string> {
    const { projectKey, issueType, label, podField, podOptionId } = this.config;
    const res = await this.request<{ key: string }>(
      "POST",
      "/rest/api/3/issue",
      {
        fields: {
          project: { key: projectKey },
          issuetype: { name: issueType },
          summary: `[${meta.area}] Refactor: ${meta.title}`.slice(0, 250),
          labels: [label],
          [podField]: [{ id: podOptionId }],
          description: adf.doc(
            adf.p(adf.text(meta.summary)),
            adf.bullets(
              ...[
                ...facts,
                [{ text: `Full plan attached: ${meta.runId}.` }],
              ].map(adfInlines),
            ),
          ),
        },
      },
    );
    if (!res?.key) throw new ScriptError("Jira create returned no issue key");
    return res.key;
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

  async attachPlan(
    key: string,
    file: string,
    planName = path.basename(file),
  ): Promise<void> {
    const form = new FormData();
    form.append(
      "file",
      new Blob([readFileSync(file)], { type: "text/markdown" }),
      planName,
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

  async comment(key: string, paragraphs: Paragraph[]): Promise<void> {
    await this.request("POST", `/rest/api/3/issue/${key}/comment`, {
      body: adf.doc(...paragraphs.map((p) => adf.p(...adfInlines(p)))),
    });
  }
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

function adfInlines(paragraph: Inline[]): AdfNode[] {
  return paragraph.map((i) =>
    i.code ? adf.code(i.text) : adf.text(i.text, i.href),
  );
}

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
