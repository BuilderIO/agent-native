/**
 * Distinct tags already in use, for autocomplete in the tag box on a
 * recording page.
 *
 * This is deliberately not folded into `get-recording-player-data`, which
 * already reads the current recording's tags: that action is refetched
 * whenever the player invalidates, while the tag vocabulary changes rarely.
 * Recomputing an org-wide DISTINCT on every one of those reads would be waste.
 * Keeping it separate lets the page cache it.
 *
 * Scope mirrors the library view in `list-recordings` on purpose: suggestions
 * come from the caller's own recordings in their active organization, not the
 * whole organization, so one signed-in user cannot enumerate what another has
 * been working on from their tag names. A caller with no resolvable identity
 * gets an empty list rather than everything.
 *
 * Usage:
 *   pnpm action list-recording-tags
 */

import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  getActiveOrganizationId,
  ownerEmailMatches,
} from "../server/lib/recordings.js";

const MAX_SUGGESTIONS = 500;

export default defineAction({
  description:
    "List the distinct tags already used across your own recordings, for tag autocomplete. Read-only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const email = getRequestUserEmail();
    if (!email) return { tags: [] };

    const db = getDb();
    const orgId = await getActiveOrganizationId();

    const where = [
      ownerEmailMatches(schema.recordings.ownerEmail, email),
      isNull(schema.recordings.trashedAt),
    ];
    if (orgId) where.push(eq(schema.recordings.organizationId, orgId));

    const rows = await db
      .selectDistinct({ tag: schema.recordingTags.tag })
      .from(schema.recordingTags)
      .innerJoin(
        schema.recordings,
        eq(schema.recordings.id, schema.recordingTags.recordingId),
      )
      .where(and(...where))
      .orderBy(asc(schema.recordingTags.tag))
      .limit(MAX_SUGGESTIONS);

    const seen = new Map<string, string>();
    for (const row of rows) {
      const clean = (row.tag ?? "").trim();
      if (!clean) continue;
      const key = clean.toLowerCase();
      if (!seen.has(key)) seen.set(key, clean);
    }

    return {
      tags: [...seen.values()].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    };
  },
});
