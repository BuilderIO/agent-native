/**
 * List pending clips AI requests for the current user.
 *
 * Collapses the per-recording `clips-ai-request-<id>` polling done by the
 * auto-title bridge into a single call. Application state is already
 * session-scoped, and we additionally filter the referenced recordings through
 * `accessFilter` so we never return a request for a recording the user can't
 * access. Only requests for `status = "ready"` recordings are returned — the
 * bridge ignores non-ready recordings, so excluding them avoids sending large
 * transcript blobs for recordings the hook will skip this tick.
 */

import { defineAction } from "@agent-native/core";
import { listAppState } from "@agent-native/core/application-state";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

const REQUEST_PREFIX = "clips-ai-request-";

export default defineAction({
  description:
    "List pending clips AI requests (regenerate-title, summary, chapters, etc.) for recordings the current user can access.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const entries = await listAppState(REQUEST_PREFIX);

    const requests = entries
      .map((e) => e.value as Record<string, unknown>)
      .filter(
        (v): v is Record<string, unknown> & { recordingId: string } =>
          !!v && typeof v.recordingId === "string" && v.recordingId.length > 0,
      );

    if (requests.length === 0) return { requests: [] };

    const recordingIds = [...new Set(requests.map((r) => r.recordingId))];

    const db = getDb();
    const accessible = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          accessFilter(schema.recordings, schema.recordingShares),
          inArray(schema.recordings.id, recordingIds),
          eq(schema.recordings.status, "ready"),
        ),
      );

    const accessibleIds = new Set(accessible.map((r) => r.id));

    return {
      requests: requests.filter((r) => accessibleIds.has(r.recordingId)),
    };
  },
});
