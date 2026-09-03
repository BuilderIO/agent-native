import { resolveConnectorSecret } from "../connectors/credentials.js";

const DEFAULT_BASE_URL = "https://sentry.io/api/0";
const MAX_LIMIT = 100;

export interface SentryClientOptions {
  ownerEmail: string;
  orgId?: string | null;
  orgSlug?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SentryIssue {
  id: string;
  shortId: string;
  title: string;
  culprit: string;
  permalink: string;
  level: string;
  status: string;
  projectSlug: string;
  count: string;
  firstSeen: string;
  lastSeen: string;
}

export interface SentryEvent {
  eventId: string;
  title: string;
  message: string;
  dateCreated: string;
  tags: readonly { key: string; value: string }[];
  context: Readonly<Record<string, unknown>>;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Sentry response was not an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`Sentry response is missing ${field}`);
  return value;
}

function limit(value?: number): number {
  if (value === undefined) return MAX_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT)
    throw new Error(`Sentry limit must be an integer from 1 to ${MAX_LIMIT}`);
  return value;
}

function parseIssue(value: unknown): SentryIssue {
  const item = object(value);
  const project = object(item.project);
  return {
    id: string(item.id, "issue id"),
    shortId: string(item.shortId, "issue short id"),
    title: string(item.title, "issue title"),
    culprit: string(item.culprit, "issue culprit"),
    permalink: string(item.permalink, "issue permalink"),
    level: string(item.level, "issue level"),
    status: string(item.status, "issue status"),
    projectSlug: string(project.slug, "issue project slug"),
    count: string(item.count, "issue count"),
    firstSeen: string(item.firstSeen, "issue first seen"),
    lastSeen: string(item.lastSeen, "issue last seen"),
  };
}

function parseEvent(value: unknown): SentryEvent {
  const item = object(value);
  const tags = item.tags;
  if (!Array.isArray(tags))
    throw new Error("Sentry event response is missing tags");
  return {
    eventId: string(item.eventID, "event id"),
    title: string(item.title, "event title"),
    message: string(item.message, "event message"),
    dateCreated: string(item.dateCreated, "event created time"),
    tags: tags.map((tag) => {
      const value = object(tag);
      return {
        key: string(value.key, "event tag key"),
        value: string(value.value, "event tag value"),
      };
    }),
    context: object(item.context),
  };
}

export function createSentryClient(options: SentryClientOptions) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

  async function credential(
    key: "SENTRY_SERVER_TOKEN" | "SENTRY_AUTH_TOKEN",
  ): Promise<string | undefined> {
    return resolveConnectorSecret(key, options.ownerEmail, {
      orgId: options.orgId,
    });
  }

  async function request<T>(path: string): Promise<T> {
    const token =
      (await credential("SENTRY_SERVER_TOKEN")) ??
      (await credential("SENTRY_AUTH_TOKEN"));
    if (!token)
      throw new Error(
        "SENTRY_SERVER_TOKEN or SENTRY_AUTH_TOKEN is not configured for this workspace",
      );
    const response = (await fetchImpl(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    })) as JsonResponse;
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(
        `Sentry API request failed: HTTP ${response.status}${detail ? ` - ${detail}` : ""}`,
      );
    }
    return (await response.json()) as T;
  }

  async function organization(): Promise<string> {
    const value =
      options.orgSlug?.trim() ||
      (await resolveConnectorSecret("SENTRY_ORG_SLUG", options.ownerEmail, {
        orgId: options.orgId,
      }));
    if (!value)
      throw new Error("SENTRY_ORG_SLUG is not configured for this workspace");
    return encodeURIComponent(value);
  }

  return {
    async listIssues(
      query?: string,
      requestedLimit?: number,
    ): Promise<readonly SentryIssue[]> {
      const params = new URLSearchParams({
        limit: String(limit(requestedLimit)),
        sort: "freq",
      });
      if (query?.trim()) params.set("query", query.trim().slice(0, 500));
      const value = await request<unknown>(
        `/organizations/${await organization()}/issues/?${params}`,
      );
      if (!Array.isArray(value))
        throw new Error("Sentry issue response was not an array");
      return value.map(parseIssue);
    },

    async listEvents(
      issueId: string,
      requestedLimit?: number,
    ): Promise<readonly SentryEvent[]> {
      const id = issueId.trim();
      if (!id) throw new Error("Sentry issue id is required");
      const params = new URLSearchParams({
        limit: String(limit(requestedLimit)),
      });
      const value = await request<unknown>(
        `/organizations/${await organization()}/issues/${encodeURIComponent(id)}/events/?${params}`,
      );
      if (!Array.isArray(value))
        throw new Error("Sentry event response was not an array");
      return value.map(parseEvent);
    },
  };
}
