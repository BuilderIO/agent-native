import { and, eq } from "drizzle-orm";
import type { H3Event } from "h3";
import { getDb, schema } from "../db/index.js";
import { getSession } from "@agent-native/core/server";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import type { TranscriptSegment } from "../../shared/api.js";

type CallShareRole = "viewer" | "editor" | "admin";

export function getCurrentOwnerEmail(): string {
  const email = getRequestUserEmail();
  if (!email) throw new Error("no authenticated user");
  return email;
}

export async function getEventOwnerEmail(event: H3Event): Promise<string> {
  const session = await getSession(event);
  if (!session?.email) {
    const { createError } = await import("h3");
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  return session.email;
}

export function nanoid(size = 12): string {
  const chars =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  let id = "";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  for (const byte of bytes) id += chars[byte % chars.length];
  return id;
}

export function parseSpaceIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function stringifySpaceIds(ids: string[] | undefined): string {
  return JSON.stringify(ids ?? []);
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * View-counting rule — same as Clips:
 *   ≥ 5 seconds watched, OR ≥ 75% of media, OR scrubbed to end.
 */
export function shouldCountView(
  totalWatchMs: number,
  completedPct: number,
  scrubbedToEnd: boolean,
): boolean {
  return totalWatchMs >= 5000 || completedPct >= 75 || scrubbedToEnd;
}

export interface TalkStats {
  participants: Array<{
    speakerLabel: string;
    talkMs: number;
    talkPct: number;
    longestMonologueMs: number;
    interruptionsCount: number;
    questionsCount: number;
  }>;
  totalTalkMs: number;
}

/**
 * Compute per-speaker talk stats from diarized segments.
 * - talkMs: sum of segment durations per speaker
 * - longestMonologueMs: longest consecutive run by the same speaker
 * - interruptionsCount: times this speaker started while the previous speaker's
 *   segment was still active (detected from overlapping start times)
 * - questionsCount: segments ending in "?"
 */
export function computeTalkStats(segments: TranscriptSegment[]): TalkStats {
  const byLabel = new Map<
    string,
    {
      talkMs: number;
      longestMonologueMs: number;
      currentRunStart: number | null;
      currentRunEnd: number | null;
      interruptionsCount: number;
      questionsCount: number;
    }
  >();

  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs);
  let prev: TranscriptSegment | undefined;

  for (const seg of ordered) {
    const label = seg.speakerLabel || "Speaker 0";
    let row = byLabel.get(label);
    if (!row) {
      row = {
        talkMs: 0,
        longestMonologueMs: 0,
        currentRunStart: null,
        currentRunEnd: null,
        interruptionsCount: 0,
        questionsCount: 0,
      };
      byLabel.set(label, row);
    }

    row.talkMs += Math.max(0, seg.endMs - seg.startMs);
    if (seg.text.trim().endsWith("?")) row.questionsCount += 1;
    if (prev && prev.speakerLabel !== label && seg.startMs < prev.endMs) {
      row.interruptionsCount += 1;
    }

    if (
      row.currentRunStart != null &&
      row.currentRunEnd != null &&
      seg.startMs <= row.currentRunEnd + 1500
    ) {
      row.currentRunEnd = Math.max(row.currentRunEnd, seg.endMs);
    } else {
      if (row.currentRunStart != null && row.currentRunEnd != null) {
        row.longestMonologueMs = Math.max(
          row.longestMonologueMs,
          row.currentRunEnd - row.currentRunStart,
        );
      }
      row.currentRunStart = seg.startMs;
      row.currentRunEnd = seg.endMs;
    }
    prev = seg;
  }

  for (const row of byLabel.values()) {
    if (row.currentRunStart != null && row.currentRunEnd != null) {
      row.longestMonologueMs = Math.max(
        row.longestMonologueMs,
        row.currentRunEnd - row.currentRunStart,
      );
    }
  }

  const totalTalkMs =
    Array.from(byLabel.values()).reduce((s, r) => s + r.talkMs, 0) || 1;

  const participants = Array.from(byLabel.entries()).map(([label, row]) => ({
    speakerLabel: label,
    talkMs: row.talkMs,
    talkPct: Math.round((row.talkMs / totalTalkMs) * 100),
    longestMonologueMs: row.longestMonologueMs,
    interruptionsCount: row.interruptionsCount,
    questionsCount: row.questionsCount,
  }));

  return { participants, totalTalkMs };
}

/**
 * Monochrome palette for participant avatars — rotated by speaker label index.
 */
export const SPEAKER_PALETTE = [
  "#111111",
  "#525252",
  "#737373",
  "#404040",
  "#262626",
  "#171717",
] as const;

export function colorForSpeaker(label: string): string {
  const n = parseInt(label.replace(/\D/g, ""), 10);
  const idx = Number.isFinite(n) ? n : 0;
  return SPEAKER_PALETTE[idx % SPEAKER_PALETTE.length];
}

/**
 * Fetch a single call row, throwing if not found OR if the current request
 * context lacks the requested role on it.
 *
 * Defaults to a "viewer" check so any read of the call row goes through the
 * standard access path. Callers that need a stricter role pass it
 * explicitly; redundant `assertAccess` calls in the action are harmless but
 * no longer required.
 *
 * SAFETY: Inlining the check inside the helper means a future contributor
 * who adds a new caller cannot accidentally drop the access assertion. The
 * old "guard:allow-unscoped" opt-out has been removed.
 */
export async function getCallOrThrow(
  id: string,
  role: CallShareRole = "viewer",
): Promise<typeof schema.calls.$inferSelect> {
  const access = await assertAccess("call", id, role);
  if (!access?.resource) throw new Error(`Call not found: ${id}`);
  return access.resource as typeof schema.calls.$inferSelect;
}

/**
 * Resolve (and possibly create) the current user's default workspace.
 * Matches the clips create-recording pattern — if the user has no workspace
 * yet, we create one on first use.
 */
export async function resolveDefaultWorkspaceId(): Promise<string> {
  const db = getDb();
  const ownerEmail = getCurrentOwnerEmail();
  const [existing] = await db
    .select({ id: schema.workspaces.id })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.ownerEmail, ownerEmail))
    .limit(1);
  if (existing) return existing.id;
  const id = nanoid();
  const now = new Date().toISOString();
  await db.insert(schema.workspaces).values({
    id,
    name: "My Workspace",
    slug: `ws-${id.slice(0, 6).toLowerCase()}`,
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}
