/**
 * Move a recording to the trash by setting trashedAt.
 *
 * Usage:
 *   pnpm action trash-recording --id=<id>
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Move a recording to trash. Soft-delete — use restore-recording to undo, or delete-recording-permanent to remove forever.",
  schema: z.object({
    id: z.string().describe("Recording ID"),
    skipIfReady: z
      .boolean()
      .optional()
      .describe(
        "When true, don't trash a recording whose upload already finished (status is 'ready') — used to close a cancel-vs-finalize race atomically.",
      ),
  }),
  run: async (args) => {
    await assertAccess("recording", args.id, "editor");

    const db = getDb();

    const [existing] = await db
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));
    if (!existing) throw new Error(`Recording not found: ${args.id}`);

    const now = new Date().toISOString();
    // When `skipIfReady` is set, make the trash conditional on the row NOT
    // already being 'ready' — this closes the TOCTOU race where finalize
    // flips the row to 'ready' concurrently with a cancel. Without the WHERE
    // guard, a finalize that lands between a caller's read and this write
    // would get silently trashed even though the upload finished.
    await db
      .update(schema.recordings)
      .set({ trashedAt: now, updatedAt: now })
      .where(
        args.skipIfReady
          ? and(
              eq(schema.recordings.id, args.id),
              ne(schema.recordings.status, "ready"),
            )
          : eq(schema.recordings.id, args.id),
      );

    // Re-select to report whether the trash actually applied — portable
    // across Postgres/SQLite without relying on driver-specific affected-row
    // counts.
    const [after] = await db
      .select({
        status: schema.recordings.status,
        trashedAt: schema.recordings.trashedAt,
      })
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.id));

    const trashedAt = after?.trashedAt ?? null;
    const skipped = Boolean(args.skipIfReady) && !trashedAt;

    await writeAppState("refresh-signal", { ts: Date.now() });
    console.log(
      skipped
        ? `Skipped trashing recording ${args.id} — already ready`
        : `Trashed recording ${args.id}`,
    );
    return { id: args.id, trashedAt, skipped };
  },
});
