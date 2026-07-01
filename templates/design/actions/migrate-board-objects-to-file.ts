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
 * 4. Stores the new file's id into designs.data.boardFileId in a transaction.
 * 5. Nulls out designs.data.boardObjects so the old model no longer conflicts.
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
    // Read the design data JSON to check whether boardFileId is already set.
    // guard:allow-unscoped — assertAccess "editor" above scopes this read to
    // the requesting user's accessible designs.
    const [existing] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);

    if (!existing) {
      throw new Error(`Design "${designId}" not found.`);
    }

    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(existing.data);
      parsed =
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
    } catch {
      parsed = {};
    }

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

    // ── 4. Upsert the board file and update designs.data atomically ───────
    // Run in a transaction so concurrent opens cannot create two board files.
    let boardFileId = "";

    await db.transaction(async (tx) => {
      // Re-read designs.data inside the transaction to guard against a
      // concurrent migration that raced us.
      const [fresh] = await tx
        .select({ data: schema.designs.data })
        .from(schema.designs)
        .where(eq(schema.designs.id, designId))
        .limit(1);

      if (!fresh) {
        throw new Error(`Design "${designId}" not found.`);
      }

      let freshParsed: Record<string, unknown>;
      try {
        const raw = JSON.parse(fresh.data);
        freshParsed =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
      } catch {
        freshParsed = {};
      }

      // Double-check inside the transaction.
      if (
        typeof freshParsed["boardFileId"] === "string" &&
        freshParsed["boardFileId"].length > 0
      ) {
        boardFileId = freshParsed["boardFileId"] as string;
        return; // Another concurrent call already finished — skip.
      }

      // Check if a __board__.html file was somehow already created (shouldn't
      // happen in normal flow, but be defensive).
      const [existingBoardFile] = await tx
        .select({ id: schema.designFiles.id })
        .from(schema.designFiles)
        .where(
          and(
            eq(schema.designFiles.designId, designId),
            eq(schema.designFiles.filename, BOARD_FILENAME),
          ),
        )
        .limit(1);

      if (existingBoardFile) {
        // Board file exists but boardFileId was not set — link it and update
        // its content.
        boardFileId = existingBoardFile.id;
        await tx
          .update(schema.designFiles)
          .set({ content: boardHtml, updatedAt: now })
          .where(eq(schema.designFiles.id, boardFileId));
      } else {
        // Create the board file.
        boardFileId = nanoid();
        await tx.insert(schema.designFiles).values({
          id: boardFileId,
          designId,
          filename: BOARD_FILENAME,
          fileType: "html",
          content: boardHtml,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Write boardFileId into designs.data; null out boardObjects.
      const nextData: Record<string, unknown> = {
        ...freshParsed,
        boardFileId,
        boardObjects: null,
      };

      await tx
        .update(schema.designs)
        .set({
          data: JSON.stringify(nextData),
          updatedAt: now,
        })
        .where(eq(schema.designs.id, designId));
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
