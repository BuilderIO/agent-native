/**
 * Agent views — counting when an *outside agent* reads a clip through the
 * public agent APIs (`/api/agent-context.json`, `/api/agent-transcript.json`,
 * `/api/agent-frame.jpg`), as opposed to a human opening the player.
 *
 * Those routes are agent-only surfaces: a human watching a clip never hits
 * them, so a request on one is the signal. Counts live in their own table so
 * every existing human-view query stays agent-free by construction.
 */

import { createHash } from "node:crypto";

import { count, desc, eq, sql } from "drizzle-orm";
import { getRequestHeader, getRequestIP, type H3Event } from "h3";

import { getDb, schema } from "../db/index.js";
import { nanoid } from "./recordings.js";

/**
 * One agent's burst of context + transcript + frame polls is one view.
 * Fixed windows mean a burst straddling a boundary counts twice; switch to
 * last-seen-gap dedup if that ever shows up in the numbers.
 */
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

export const UNKNOWN_AGENT_LABEL = "Agent";

export function agentLabelFromUserAgent(userAgent: string): string {
  for (const [pattern, label] of AGENT_LABELS) {
    if (pattern.test(userAgent)) return label;
  }
  return UNKNOWN_AGENT_LABEL;
}

export function agentViewSessionId(
  now: number,
  bucketMs = AGENT_VIEW_SESSION_MS,
): string {
  return String(Math.floor(now / bucketMs));
}

/** Hashed so an agent is distinguishable across polls without storing its IP. */
export function agentKeyFor(userAgent: string, ip: string): string {
  return createHash("sha256")
    .update(`${userAgent}|${ip}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Best-effort: never let view accounting fail an agent's read of a clip.
 */
export async function recordAgentView(
  event: H3Event,
  recordingId: string,
  nowMs: number = Date.now(),
): Promise<void> {
  try {
    const userAgent = (getRequestHeader(event, "user-agent") ?? "").slice(
      0,
      512,
    );
    const ip = getRequestIP(event) || "unknown";
    const now = new Date(nowMs).toISOString();

    await getDb()
      .insert(schema.recordingAgentViews)
      .values({
        id: nanoid(),
        recordingId,
        agentKey: agentKeyFor(userAgent, ip),
        agentLabel: agentLabelFromUserAgent(userAgent),
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
  agentLabel: string;
  views: number;
  lastSeenAt: string;
}

/** Agents that read this clip, most recent first, grouped by product label. */
export async function listRecordingAgentViewers(
  recordingId: string,
  limit = 8,
): Promise<AgentViewerSummary[]> {
  const rows = await getDb()
    .select({
      agentLabel: schema.recordingAgentViews.agentLabel,
      views: count(),
      lastSeenAt: sql<string>`MAX(${schema.recordingAgentViews.lastSeenAt})`,
    })
    .from(schema.recordingAgentViews)
    .where(eq(schema.recordingAgentViews.recordingId, recordingId))
    .groupBy(schema.recordingAgentViews.agentLabel)
    .orderBy(desc(sql`MAX(${schema.recordingAgentViews.lastSeenAt})`))
    .limit(limit);

  return rows.map((r) => ({
    agentLabel: r.agentLabel || UNKNOWN_AGENT_LABEL,
    views: Number(r.views ?? 0),
    lastSeenAt: r.lastSeenAt,
  }));
}
