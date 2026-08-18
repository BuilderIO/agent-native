import { defineAction } from "@agent-native/core";
import { listAppState } from "@agent-native/core/application-state";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getCurrentOwnerEmail,
  ownerEmailMatches,
} from "../server/lib/recordings.js";
import {
  REWIND_EXTENSION_PREFIX,
  type RewindExtensionRequest,
} from "./request-rewind-extension.js";

export default defineAction({
  description:
    "List pending local Rewind pre-roll requests for the signed-in Clips Alpha app.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const entries = await listAppState(REWIND_EXTENSION_PREFIX);
    const staleProcessingCutoff = Date.now() - 2 * 60_000;
    const requests = entries
      .map((entry) => entry.value as unknown as RewindExtensionRequest)
      .filter(
        (request) =>
          request &&
          typeof request.recordingId === "string" &&
          (request.status === "pending" ||
            (request.status === "processing" &&
              Date.parse(request.updatedAt) < staleProcessingCutoff)),
      );
    if (!requests.length) return { requests: [] };
    const ids = [...new Set(requests.map((request) => request.recordingId))];
    const ownerEmail = getCurrentOwnerEmail();
    const accessible = await getDb()
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          inArray(schema.recordings.id, ids),
          eq(schema.recordings.status, "ready"),
        ),
      );
    const allowed = new Set(accessible.map((row) => row.id));
    return {
      requests: requests.filter((request) => allowed.has(request.recordingId)),
    };
  },
});
