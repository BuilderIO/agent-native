/**
 * Engagement metrics and activity for transactional emails, read live from the
 * email provider.
 *
 * Opens and clicks are only known to the provider, so they are read on demand
 * rather than mirrored into our own tables — a mirrored open count goes stale
 * the moment someone opens an old message. Our `email_log` remains the source
 * of truth for what we *sent*; this module only answers what happened to it
 * afterwards.
 *
 * Attribution depends on `sendEmail` tagging each message with its registered
 * email id as a SendGrid category. Messages sent before that tagging existed,
 * or sent by anything else sharing the account, are not attributable to an
 * email in the catalog and are deliberately not counted toward one.
 */

import { resolveSecret } from "@agent-native/core/server";

const SENDGRID_API = "https://api.sendgrid.com/v3";

/**
 * Distinguishes "the provider isn't configured" from "the provider says zero".
 * Callers must render these differently — showing 0% open rate for an
 * unconfigured provider invents a fact.
 */
export type ProviderMetricsResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

export interface EmailEngagement {
  templateId: string;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  /** null when nothing was delivered in the window, so there is no rate yet. */
  openRate: number | null;
}

async function sendgridKey(): Promise<string | null> {
  return resolveSecret("SENDGRID_API_KEY");
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

async function sendgridGet(
  key: string,
  path: string,
  params: Array<[string, string]>,
): Promise<unknown> {
  const url = new URL(`${SENDGRID_API}${path}`);
  for (const [name, value] of params) url.searchParams.append(name, value);
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const error = new Error(
      `SendGrid ${res.status} on ${path}: ${body.slice(0, 300)}`,
    );
    (error as SendGridError).status = res.status;
    (error as SendGridError).body = body;
    throw error;
  }
  return res.json();
}

interface SendGridError extends Error {
  status?: number;
  body?: string;
}

/**
 * SendGrid 404s a category it has never seen. That is a definite answer — no
 * message has been sent under this id yet — not a failed read, so it maps to an
 * empty result rather than an "unavailable" banner.
 */
function isUnknownCategory(error: unknown): boolean {
  const candidate = error as SendGridError;
  return (
    candidate?.status === 404 &&
    typeof candidate.body === "string" &&
    candidate.body.includes("category does not exist")
  );
}

/**
 * Per-email delivered / open / click totals over the window, keyed by the
 * registered email id.
 */
export async function fetchEmailEngagement(
  templateIds: string[],
  windowDays: number,
): Promise<ProviderMetricsResult<EmailEngagement[]>> {
  if (!templateIds.length) return { available: true, data: [] };

  const key = await sendgridKey();
  if (!key) {
    return {
      available: false,
      reason:
        "SENDGRID_API_KEY is not configured, so open and click rates cannot be read.",
    };
  }

  const end = Date.now();
  const start = end - windowDays * 24 * 60 * 60 * 1000;

  try {
    // SendGrid caps categories per request; chunk rather than silently
    // truncating the catalog.
    const chunks: string[][] = [];
    for (let i = 0; i < templateIds.length; i += 10) {
      chunks.push(templateIds.slice(i, i + 10));
    }

    const totals = new Map<string, EmailEngagement>();
    for (const chunk of chunks) {
      let payload: Array<{
        stats?: Array<{ name?: string; metrics?: Record<string, number> }>;
      }>;
      try {
        payload = (await sendgridGet(key, "/categories/stats", [
          ["start_date", isoDate(start)],
          ["end_date", isoDate(end)],
          ["aggregated_by", "day"],
          ...chunk.map((id): [string, string] => ["categories", id]),
        ])) as typeof payload;
      } catch (error) {
        if (isUnknownCategory(error)) continue;
        throw error;
      }

      for (const day of payload ?? []) {
        for (const entry of day.stats ?? []) {
          const name = entry.name;
          if (!name) continue;
          const metrics = entry.metrics ?? {};
          const current = totals.get(name) ?? {
            templateId: name,
            delivered: 0,
            uniqueOpens: 0,
            uniqueClicks: 0,
            openRate: null,
          };
          current.delivered += Number(metrics.delivered ?? 0);
          current.uniqueOpens += Number(metrics.unique_opens ?? 0);
          current.uniqueClicks += Number(metrics.unique_clicks ?? 0);
          totals.set(name, current);
        }
      }
    }

    const data = [...totals.values()].map((entry) => ({
      ...entry,
      openRate:
        entry.delivered > 0 ? entry.uniqueOpens / entry.delivered : null,
    }));
    return { available: true, data };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface EmailActivityEntry {
  msgId: string;
  toEmail: string;
  fromEmail: string;
  subject: string;
  status: string;
  opensCount: number;
  clicksCount: number;
  lastEventTime: string;
}

/**
 * Recent provider-side activity, newest first. SendGrid's Email Activity feed
 * only retains three days without the extended-retention add-on, so an empty
 * result here does not mean nothing was ever sent — `email_log` covers that.
 */
export async function fetchEmailActivity(options: {
  templateId?: string;
  limit?: number;
}): Promise<ProviderMetricsResult<EmailActivityEntry[]>> {
  const key = await sendgridKey();
  if (!key) {
    return {
      available: false,
      reason:
        "SENDGRID_API_KEY is not configured, so the provider activity feed cannot be read.",
    };
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
  const params: Array<[string, string]> = [["limit", String(limit)]];
  if (options.templateId) {
    // Category equality is the only way to scope the feed to one email; the
    // id is ours and contains no quotes, but escape anyway so a future id
    // cannot break out of the query literal.
    const safe = options.templateId.replace(/["\\]/g, "");
    params.push(["query", `category="${safe}"`]);
  }

  try {
    const payload = (await sendgridGet(key, "/messages", params)) as {
      messages?: Array<Record<string, unknown>>;
    };
    const data = (payload.messages ?? []).map((message) => ({
      msgId: String(message.msg_id ?? ""),
      toEmail: String(message.to_email ?? ""),
      fromEmail: String(message.from_email ?? ""),
      subject: String(message.subject ?? ""),
      status: String(message.status ?? ""),
      opensCount: Number(message.opens_count ?? 0),
      clicksCount: Number(message.clicks_count ?? 0),
      lastEventTime: String(message.last_event_time ?? ""),
    }));
    return { available: true, data };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
