
import { createHash } from "node:crypto";

import { count, desc, eq, sql } from "drizzle-orm";
import { getRequestHeader, getRequestIP, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { nanoid } from "./recordings.js";

export const AGENT_VIEW_SESSION_MS = 30 * 60 * 1000;

const AGENT_LABELS: [RegExp, string][] = [
  [/claude|anthropic/i, "Claude"],
  [/chatgpt|gptbot|oai-searchbot|openai/i, "ChatGPT"],
  [/perplexity/i, "Perplexity"],
  [/gemini|google-extended|googleother/i, "Gemini"],
  [/copilot/i, "Copilot"],
  [/cursor/i, "Cursor"],
  [/bingbot|bingpreview/i, "Bing"],
  [/applebot/i, "Apple Intelligence"],
  [/meta-external|facebookbot/i, "Meta AI"],
  [/bytespider|amazonbot|ccbot|diffbot|youbot/i, "Crawler"],
];

export function agentLabelFromUserAgent(userAgent: string): string | null {
  for (const [pattern, label] of AGENT_LABELS) {
    if (pattern.test(userAgent)) return label;
  }
  return null;
}

export function agentViewSessionId(
  now: number,
  bucketMs = AGENT_VIEW_SESSION_MS,
): string {
  return String(Math.floor(now / bucketMs));
}

export function agentKeyFor(userAgent: string, ip: string): string {
  return createHash("sha256")
    .update(`${userAgent}|${ip}`)
    .digest("hex")
    .slice(0, 32);
}

export async function recordAgentView(
  event: H3Event,
  recordingId: string,
  options: { agentLabel?: string | null; nowMs?: number } = {},
): Promise<void> {
  try {
    const nowMs = options.nowMs ?? Date.now();
    const userAgent = (getRequestHeader(event, "user-agent") ?? "").slice(
      0,
      512,
    );
    const ip = getRequestIP(event) || "unknown";
    const now = new Date(nowMs).toISOString();
    const agentLabel =
      options.agentLabel?.trim() || agentLabelFromUserAgent(userAgent);

    await getDb()
      .insert(schema.recordingAgentViews)
      .values({
        id: nanoid(),
        recordingId,
        agentKey: agentKeyFor(userAgent, ip),
        agentLabel,
        userAgent: userAgent || null,
        viewSessionId: agentViewSessionId(nowMs),
        firstSeenAt: now,
        lastSeenAt: now,
        requestCount: 1,
      })
      .onConflictDoUpdate({
        target: [
          schema.recordingAgentViews.recordingId,
          schema.recordingAgentViews.agentKey,
          schema.recordingAgentViews.viewSessionId,
        ],
        set: {
          lastSeenAt: now,
          agentLabel: sql`COALESCE(excluded.agent_label, ${schema.recordingAgentViews.agentLabel})`,
          requestCount: sql`${schema.recordingAgentViews.requestCount} + 1`,
        },
      });
  } catch (err) {
    console.warn("[agent-views] failed to record agent view:", err);
  }
}

export async function countRecordingAgentViews(
  recordingId: string,
): Promise<number> {
  const [row] = await getDb()
    .select({ value: count() })
    .from(schema.recordingAgentViews)
    .where(eq(schema.recordingAgentViews.recordingId, recordingId));
  return Number(row?.value ?? 0);
}

export interface AgentViewerSummary {
  agentLabel: string | null;
  userAgent: string | null;
  views: number;
  lastSeenAt: string;
}

export async function listRecordingAgentViewers(
  recordingId: string,
  limit = 8,
): Promise<AgentViewerSummary[]> {
  const groupKey = sql<string>`COALESCE(${schema.recordingAgentViews.agentLabel}, ${schema.recordingAgentViews.userAgent}, '')`;
  const rows = await getDb()
    .select({
      agentLabel: sql<
        string | null
      >`MAX(${schema.recordingAgentViews.agentLabel})`,
      userAgent: sql<
        string | null
      >`MAX(${schema.recordingAgentViews.userAgent})`,
      views: count(),
      lastSeenAt: sql<string>`MAX(${schema.recordingAgentViews.lastSeenAt})`,
    })
    .from(schema.recordingAgentViews)
    .where(eq(schema.recordingAgentViews.recordingId, recordingId))
    .groupBy(groupKey)
    .orderBy(desc(sql`MAX(${schema.recordingAgentViews.lastSeenAt})`))
    .limit(limit);

  return rows.map((r) => ({
    agentLabel: r.agentLabel || null,
    userAgent: r.userAgent || null,
    views: Number(r.views ?? 0),
    lastSeenAt: r.lastSeenAt,
  }));
}
