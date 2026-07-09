/**
 * migrate-board-objects-to-file
 *
 * Lazy, idempotent migration that converts the legacy designs.data.boardObjects
 * JSON blob into the new board file architecture.
 *
 * ## What it does
 *
 * 1. Guards on boardFileId already set — returns early if the migration has
 *    already run (idempotent).
 * 2. Reads designs.data.boardObjects and converts each entry into an HTML
 *    fragment via boardObjectEntryToHtmlFragment, preserving negative left/top
 *    coordinates exactly (no clamping).
 * 3. Inserts the fragments as direct <body> children of a new __board__.html
 *    design file (or merges into an existing one if somehow already present).
 * 4. Reserves one stable file id in designs.data, then upserts the board file.
 * 5. Finalizes boardFileId and nulls boardObjects through a retryable mutation.
 *
 * ## Contract
 *
 * - Requires editor access on the design.
 * - SCHEMA ADDITIVE ONLY — no columns are dropped or renamed; only designs.data
 *   JSON keys change.
 * - Safe to call on designs with no board objects: creates the board file with
 *   an empty body and sets boardFileId.
 *
 * ## Trigger
 *
 * Called by DesignEditor on design open when designs.data.boardFileId is absent.
 */

import { defineAction } from "@agent-native/core";
import { seedFromText } from "@agent-native/core/collab";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import {
  BOARD_FILENAME,
  backfillBoardPrimitiveMarkers,
  boardObjectEntryToHtmlFragment,
  emptyBoardHtml,
} from "../shared/board-file.js";
import { parseBoardObjects } from "../shared/board-objects.js";

export default defineAction({
  description:
    "Migrate the legacy boardObjects blob (designs.data.boardObjects) into the " +
    "new board file architecture. Creates a __board__.html design file, writes " +
    "each board object as an absolute-positioned HTML element (preserving " +
    "negative coordinates), stores boardFileId in designs.data, and nulls " +
    "boardObjects. Idempotent — returns immediately if boardFileId is already " +
    "set. Requires editor access on the design.",
  schema: z.object({
    designId: z
      .string()
      .describe("Design project ID to migrate board objects for."),
  }),
  run: async ({ designId }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();

    // ── 1. Idempotency guard ──────────────────────────────────────────────
    // Reserve one stable file id without clearing boardObjects. If the process
    // stops between phases, the next call resumes the same reservation.
    const [preexistingBoardFile] = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.filename, BOARD_FILENAME),
        ),
      )
      .limit(1);
    const proposedBoardFileId = preexistingBoardFile?.id ?? nanoid();
    const reservation = await mutateDesignData({
      designId,
      mutate: (current) => {
        if (
          (typeof current.boardFileId === "string" && current.boardFileId) ||
          (typeof current.boardFileMigrationId === "string" &&
            current.boardFileMigrationId)
        ) {
          return current;
        }
        return { ...current, boardFileMigrationId: proposedBoardFileId };
      },
      isApplied: (current) =>
        Boolean(
          (typeof current.boardFileId === "string" && current.boardFileId) ||
          (typeof current.boardFileMigrationId === "string" &&
            current.boardFileMigrationId),
        ),
    });
    const parsed = reservation.data;

    if (
      typeof parsed["boardFileId"] === "string" &&
      parsed["boardFileId"].length > 0
    ) {
      // ── Marker backfill path ───────────────────────────────────────────────
      // The board file exists (boardFileId set), but it may have been created
      // before the data-an-primitive marker was introduced.  Run the additive
      // backfill so the layers-panel renders the correct icon (ellipse / text /
      // frame / rectangle) instead of the generic code glyph.
      const existingBoardFileId = parsed["boardFileId"] as string;

      const [boardFileRow] = await db
        .select({ content: schema.designFiles.content })
        .from(schema.designFiles)
        .where(eq(schema.designFiles.id, existingBoardFileId))
        .limit(1);

      if (boardFileRow) {
        const originalContent = boardFileRow.content ?? "";
        // Only run backfill when the board file has node-id elements but is
        // missing at least one data-an-primitive marker.
        const needsBackfill =
          originalContent.includes("data-agent-native-node-id=") &&
          !originalContent.includes("data-an-primitive=");

        if (needsBackfill) {
          const backfilledContent =
            backfillBoardPrimitiveMarkers(originalContent);
          const now = new Date().toISOString();
          await db
            .update(schema.designFiles)
            .set({ content: backfilledContent, updatedAt: now })
            .where(eq(schema.designFiles.id, existingBoardFileId));

          // Best-effort collab re-seed.
          try {
            await seedFromText(existingBoardFileId, backfilledContent);
          } catch {
            // Non-fatal.
          }

          return {
            designId,
            migrated: false,
            boardFileId: existingBoardFileId,
            reason:
              "boardFileId already set — backfilled missing data-an-primitive markers.",
          };
        }
      }

      return {
        designId,
        migrated: false,
        boardFileId: existingBoardFileId,
        reason: "boardFileId already set — migration already complete.",
      };
    }

    // ── 2. Parse legacy board objects ────────────────────────────────────
    const boardObjects = parseBoardObjects(parsed["boardObjects"]);
    const entries = Object.values(boardObjects);

    // ── 3. Build the board HTML ───────────────────────────────────────────
    // Start from the canonical empty-board template and inject each entry as
    // a direct <body> child.  Negative left/top are preserved — the migration
    // intentionally does NOT clamp coords (appendCanvasPrimitiveToHtml clamps
    // to x/y >= 0 for new screen primitives; the board surface has no such
    // restriction).
    let boardHtml = emptyBoardHtml();
    if (entries.length > 0) {
      const fragments = entries
        .sort((a, b) => {
          // Stable render order: lower z first, then creation order.
          const az = a.geometry.z ?? 0;
          const bz = b.geometry.z ?? 0;
          if (az !== bz) return az - bz;
          return a.createdAt < b.createdAt ? -1 : 1;
        })
        .map((entry) => boardObjectEntryToHtmlFragment(entry))
        .join("\n");

      // Insert fragments before </body>.
      boardHtml = boardHtml.replace("</body>", `${fragments}\n</body>`);
    }

    const now = new Date().toISOString();

    // ── 4. Upsert the board file, then finalize the reservation ────────
    const reservationId =
      typeof parsed.boardFileMigrationId === "string" &&
      parsed.boardFileMigrationId
        ? parsed.boardFileMigrationId
        : proposedBoardFileId;
    const [existingBoardFile] = await db
      .select({ id: schema.designFiles.id })
      .from(schema.designFiles)
      .where(
        and(
          eq(schema.designFiles.designId, designId),
          eq(schema.designFiles.filename, BOARD_FILENAME),
        ),
      )
      .limit(1);
    const boardFileId = existingBoardFile?.id ?? reservationId;

    if (existingBoardFile) {
      await db
        .update(schema.designFiles)
        .set({ content: boardHtml, updatedAt: now })
        .where(eq(schema.designFiles.id, boardFileId));
    } else {
      try {
        await db.insert(schema.designFiles).values({
          id: boardFileId,
          designId,
          filename: BOARD_FILENAME,
          fileType: "html",
          content: boardHtml,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        const [concurrentBoardFile] = await db
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.id, boardFileId))
          .limit(1);
        if (!concurrentBoardFile) throw error;
      }
    }

    await mutateDesignData({
      designId,
      mutate: (current) => {
        if (typeof current.boardFileId === "string" && current.boardFileId) {
          return current;
        }
        const next: Record<string, unknown> = {
          ...current,
          boardFileId,
          boardObjects: null,
        };
        delete next.boardFileMigrationId;
        return next;
      },
      isApplied: (current) => current.boardFileId === boardFileId,
    });

    // ── 5. Seed collab state for the new board file ───────────────────────
    // (Best-effort: collab seeding after the file row is committed.)
    try {
      await seedFromText(boardFileId, boardHtml);
    } catch {
      // Non-fatal — the board file still renders from SQL content.
    }

    return {
      designId,
      migrated: true,
      boardFileId,
      migratedObjectCount: entries.length,
      message:
        entries.length > 0
          ? `Migrated ${entries.length} board object(s) to board file ${boardFileId}.`
          : `Created empty board file ${boardFileId} (no legacy board objects).`,
    };
  },
});
