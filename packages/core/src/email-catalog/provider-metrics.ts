/**
 * Engagement metrics and activity for registered transactional emails, read
 * from the active provider in the current app's request context.
 */

import { z } from "zod";

import { resolveSecret } from "../server/credential-provider.js";
import { getEmailProvider } from "../server/email.js";

const SENDGRID_API = "https://api.sendgrid.com/v3";
const SENDGRID_PAGE_SIZE = 1000;
const SENDGRID_MAX_PAGES = 10;

export type ProviderMetricsResult<T> =
  | { available: true; data: T }
  | { available: false; reason: string };

export interface EmailEngagement {
  templateId: string;
  delivered: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number | null;
}

type SendGridAccess =
  | { available: true; key: string }
  | { available: false; reason: string };

const categoryMetricsSchema = z
  .object({
    delivered: z.number().default(0),
    unique_opens: z.number().default(0),
    unique_clicks: z.number().default(0),
  })
  .passthrough();

const categoryStatSchema = z
  .object({
    name: z.string(),
    metrics: categoryMetricsSchema.default(() => ({
      delivered: 0,
      unique_opens: 0,
      unique_clicks: 0,
    })),
  })
  .passthrough();

const categorySumsSchema = z.object({
  stats: z.array(categoryStatSchema).default([]),
});

const activitySchema = z.object({
  messages: z
    .array(
      z
        .object({
          msg_id: z.string().default(""),
          to_email: z.string().default(""),
          from_email: z.string().default(""),
          subject: z.string().default(""),
          status: z.string().default(""),
          opens_count: z.coerce.number().default(0),
          clicks_count: z.coerce.number().default(0),
          last_event_time: z.string().default(""),
        })
        .passthrough(),
    )
    .default([]),
});

async function activeSendGrid(): Promise<SendGridAccess> {
  const provider = await getEmailProvider();
  if (provider === "resend") {
    return {
      available: false,
      reason:
        "Email delivery uses Resend, so SendGrid metrics do not describe the active transport.",
    };
  }
  if (provider !== "sendgrid") {
    return {
      available: false,
      reason:
        "No email provider is configured, so provider metrics cannot be read.",
    };
  }
  const key = await resolveSecret("SENDGRID_API_KEY");
  if (!key) {
    return {
      available: false,
      reason:
        "SendGrid is the active email transport, but SENDGRID_API_KEY could not be resolved.",
    };
  }
  return { available: true, key };
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
    const body = await res
      .text()
      .catch((cause) => `<error body unreadable: ${cause}>`);
    throw new Error(`SendGrid ${res.status} on ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function fetchEmailEngagement(
  templateIds: string[],
  windowDays: number,
): Promise<ProviderMetricsResult<EmailEngagement[]>> {
  if (!templateIds.length) return { available: true, data: [] };

  const sendgrid = await activeSendGrid();
  if (!sendgrid.available) return sendgrid;

  const end = Date.now();
  const start = end - windowDays * 24 * 60 * 60 * 1000;
  const requested = new Set(templateIds);
  const data: EmailEngagement[] = [];

  try {
    for (let page = 0; page < SENDGRID_MAX_PAGES; page += 1) {
      const payload = categorySumsSchema.parse(
        await sendgridGet(sendgrid.key, "/categories/stats/sums", [
          ["start_date", isoDate(start)],
          ["end_date", isoDate(end)],
          ["limit", String(SENDGRID_PAGE_SIZE)],
          ["offset", String(page * SENDGRID_PAGE_SIZE)],
        ]),
      );

      for (const entry of payload.stats) {
        if (!requested.has(entry.name)) continue;
        requested.delete(entry.name);
        const delivered = entry.metrics.delivered;
        const uniqueOpens = entry.metrics.unique_opens;
        data.push({
          templateId: entry.name,
          delivered,
          uniqueOpens,
          uniqueClicks: entry.metrics.unique_clicks,
          openRate: delivered > 0 ? Math.min(uniqueOpens / delivered, 1) : null,
        });
      }

      if (requested.size === 0 || payload.stats.length < SENDGRID_PAGE_SIZE) {
        break;
      }
    }

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

export async function fetchEmailActivity(options: {
  templateId: string;
  limit?: number;
}): Promise<ProviderMetricsResult<EmailActivityEntry[]>> {
  const sendgrid = await activeSendGrid();
  if (!sendgrid.available) return sendgrid;

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 1000);
  const safe = options.templateId.replace(/["\\]/g, "");

  try {
    const payload = activitySchema.parse(
      await sendgridGet(sendgrid.key, "/messages", [
        ["limit", String(limit)],
        ["query", `category="${safe}"`],
      ]),
    );
    return {
      available: true,
      data: payload.messages.map((message) => ({
        msgId: message.msg_id,
        toEmail: message.to_email,
        fromEmail: message.from_email,
        subject: message.subject,
        status: message.status,
        opensCount: message.opens_count,
        clicksCount: message.clicks_count,
        lastEventTime: message.last_event_time,
      })),
    };
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
