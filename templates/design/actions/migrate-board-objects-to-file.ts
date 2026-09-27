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

import { defineAction } from "@agent-native/core/action";
import { seedFromText } from "@agent-native/core/collab";
import { injectDocumentMarkup } from "@agent-native/core/shared";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mutateDesignData } from "../server/lib/design-data-mutation.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  withDesignSourceMutationTransaction,
  writeInlineSourceFile,
} from "../server/source-workspace.js";
import {
  BOARD_FILENAME,
  backfillBoardPrimitiveMarkers,
  boardObjectEntryToHtmlFragment,
  emptyBoardHtml,
} from "../shared/board-file.js";
import { parseBoardObjects } from "../shared/board-objects.js";

const sourceFileColumns = {
  id: schema.designFiles.id,
  designId: schema.designFiles.designId,
  filename: schema.designFiles.filename,
  fileType: schema.designFiles.fileType,
  content: schema.designFiles.content,
  createdAt: schema.designFiles.createdAt,
  updatedAt: schema.designFiles.updatedAt,
};

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
  run: async ({ designId }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();

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
      const existingBoardFileId = parsed["boardFileId"] as string;

      const [boardFileRow] = await db
        .select(sourceFileColumns)
        .from(schema.designFiles)
        .where(eq(schema.designFiles.id, existingBoardFileId))
        .limit(1);

      if (boardFileRow) {
        const live = await readLiveSourceFile(boardFileRow);
        const originalContent = live.content;
        const needsBackfill =
          originalContent.includes("data-agent-native-node-id=") &&
          !originalContent.includes("data-an-primitive=");

        if (needsBackfill) {
          const backfilledContent =
            backfillBoardPrimitiveMarkers(originalContent);
          await writeInlineSourceFile({
            designId,
            file: boardFileRow,
            content: backfilledContent,
            expectedVersionHash: live.versionHash,
          });

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

    const boardObjects = parseBoardObjects(parsed["boardObjects"]);
    const entries = Object.values(boardObjects);

    let boardHtml = emptyBoardHtml();
    if (entries.length > 0) {
      const fragments = entries
        .sort((a, b) => {
          const az = a.geometry.z ?? 0;
          const bz = b.geometry.z ?? 0;
          if (az !== bz) return az - bz;
          return a.createdAt < b.createdAt ? -1 : 1;
        })
        .map((entry) => boardObjectEntryToHtmlFragment(entry))
        .join("\n");

      boardHtml = injectDocumentMarkup(boardHtml, `${fragments}\n`);
    }

    const now = new Date().toISOString();

    const reservationId =
      typeof parsed.boardFileMigrationId === "string" &&
      parsed.boardFileMigrationId
        ? parsed.boardFileMigrationId
        : proposedBoardFileId;
    const [existingBoardFile] = await db
      .select(sourceFileColumns)
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
      const live = await readLiveSourceFile(existingBoardFile);
      await writeInlineSourceFile({
        designId,
        file: existingBoardFile,
        content: boardHtml,
        expectedVersionHash: live.versionHash,
      });
    } else {
      try {
        await withDesignSourceMutationTransaction(designId, (tx) =>
          tx.insert(schema.designFiles).values({
            id: boardFileId,
            designId,
            filename: BOARD_FILENAME,
            fileType: "html",
            content: boardHtml,
            createdAt: now,
            updatedAt: now,
          }),
        );
      } catch (error) {
        const [concurrentBoardFile] = await db
          .select({ id: schema.designFiles.id })
          .from(schema.designFiles)
          .where(eq(schema.designFiles.id, boardFileId))
          .limit(1);
        if (!concurrentBoardFile) throw error;
      }

      await seedFromText(boardFileId, boardHtml);
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
