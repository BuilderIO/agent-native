import { defineAction } from "@agent-native/core/action";
import { listAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { listAutoTitleCandidates } from "./lib/auto-title-candidates.js";

const REQUEST_PREFIX = "clips-ai-request-";

type QueuedAiRequest = Record<string, unknown> & { recordingId: string };

async function listQueuedRequests(): Promise<QueuedAiRequest[]> {
  const entries = await listAppState(REQUEST_PREFIX);

  const requests = entries
    .map((e) => e.value as Record<string, unknown>)
    .filter(
      (v): v is QueuedAiRequest =>
        !!v && typeof v.recordingId === "string" && v.recordingId.length > 0,
    );

  if (requests.length === 0) return [];

  const recordingIds = [...new Set(requests.map((r) => r.recordingId))];

  const db = getDb();
  const accessible = await db
    .select({ id: schema.recordings.id, title: schema.recordings.title })
    .from(schema.recordings)
    .where(
      and(
        accessFilter(schema.recordings, schema.recordingShares),
        inArray(schema.recordings.id, recordingIds),
        eq(schema.recordings.status, "ready"),
      ),
    );

  const titles = new Map(accessible.map((r) => [r.id, r.title]));

  // Not every request kind stores `currentTitle` when queued; fill it from the
  // recording so every delivered request tells the agent what the clip is.
  return requests
    .filter((r) => titles.has(r.recordingId))
    .map((r) => ({
      ...r,
      currentTitle: r.currentTitle ?? titles.get(r.recordingId),
    }));
}

export default defineAction({
  description:
    "List pending clips AI requests (regenerate-title, summary, chapters, etc.) for recordings the current user can access, plus the current user's ready recordings that still need an auto-generated title.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    // Sequential on purpose: fanning out opens extra pooled connections, and
    // production Server-Timing showed connect cost exceeding the queries.
    const requests = await listQueuedRequests();
    const email = getRequestUserEmail();
    const titleCandidates = email ? await listAutoTitleCandidates(email) : [];
    return { requests, titleCandidates };
  },
});
