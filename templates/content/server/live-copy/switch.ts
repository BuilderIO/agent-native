import type { ActionRunContext } from "@agent-native/core/action";
import {
  LiveCopyError,
  mutateLiveCopy,
  readLiveCopy,
  seedLiveCopy,
} from "@agent-native/core/collab";
import { getDbExec } from "@agent-native/core/db";
import { ensureSuggestionTables } from "@agent-native/core/review";
import { eq } from "drizzle-orm";

import { assertSourceAllowsPageEdit } from "../../actions/_document-source.js";
import { getDb, schema } from "../db/index.js";
import {
  liveBodyWriterFlagsOn,
  liveBodyWriterGate,
  liveBodyWriterPageColumns,
  type LiveBodyWriterGate,
} from "../lib/live-body-writer.js";
import { CONTENT_LIVE_COPY_EDITS, contentLiveCopy } from "./binding.js";
import { liveBodySwitchBlockers } from "./eligibility.js";
import {
  LiveBodyConversionError,
  liveBodySwitchIneligible,
  persistLiveBodyConversion,
} from "./persist.js";
import { withLiveBodyConversion } from "./write-cause.js";
import { liveCopyBaseChanged } from "./write.js";

const CONVERSION_ATTEMPTS = 3;

async function readPage(documentId: string) {
  // guard:allow-unscoped — set-live-body-switch checks editor access before it switches a page.
  const [page] = await getDb()
    .select({
      ...liveBodyWriterPageColumns(),
      content: schema.documents.content,
      sourceMode: schema.documents.sourceMode,
      sourceRootPath: schema.documents.sourceRootPath,
      sourcePath: schema.documents.sourcePath,
    })
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))
    .limit(1);
  return page;
}

/**
 * Switches a page to its live copy: makes the live copy hold the stored body
 * (seeding it, or editing it to match, so open editors merge rather than
 * reload), then marks the page switched in the same commit. The stored body
 * wins over Yjs-only edits, so switch a page before an editor binds to it;
 * with `keepLiveEdits`, a live copy that holds text the stored body lacks
 * refuses the switch with `live_edits` instead.
 * Throws `LiveBodyConversionError` `flag_off` unless both flags are on for
 * the page's owner, `local_file` for a page linked to a local file,
 * `opted_out` with `unlessOptedOut` for a page sent back to legacy,
 * `ineligible` while another writer that reaches the page can't write through
 * the live copy (`liveBodySwitchBlockers`), and
 * `base_changed` when the body keeps moving.
 */
export async function switchPageToLiveCopy(
  documentId: string,
  options: {
    ctx?: ActionRunContext | undefined;
    keepLiveEdits?: true;
    unlessOptedOut?: true;
  } = {},
): Promise<LiveBodyWriterGate> {
  for (let attempt = 0; attempt < CONVERSION_ATTEMPTS; attempt += 1) {
    const page = await readPage(documentId);
    if (!page) return { writePath: "legacy", reason: "no_page" };
    assertSourceAllowsPageEdit(page);
    const gate = await liveBodyWriterGate(documentId);
    if (gate.writePath === "live_copy") return gate;
    const blockers = await liveBodySwitchBlockers(getDbExec(), documentId);
    if (blockers === undefined)
      return { writePath: "legacy", reason: "no_page" };
    if (blockers.length > 0)
      throw liveBodySwitchIneligible(documentId, blockers);
    if (!(await liveBodyWriterFlagsOn(page))) {
      throw new LiveBodyConversionError(
        "flag_off",
        documentId,
        `The live-copy writer is off for page ${documentId}'s owner.`,
      );
    }
    // The conversion commit re-baselines pending suggestions, and core
    // creates their tables only outside a transaction.
    await ensureSuggestionTables();
    const conversion = {
      documentId,
      baseRevision: page.bodyRevision,
      ...(options.unlessOptedOut ? { unlessOptedOut: true as const } : {}),
    };
    try {
      await withLiveBodyConversion(
        conversion,
        { ctx: options.ctx, operation: "switch-live-body" },
        async () => {
          const live = await readLiveCopy(contentLiveCopy, documentId);
          if (live.kind === "live") {
            // A copy nothing has edited since the page's last live-copy
            // commit, while legacy writes moved the stored body on, holds
            // only text those writes replaced: the stored body replaces it,
            // unless a tab edits it first.
            const onlyBehind =
              live.version === page.liveCopyVersion &&
              page.collabBodyRevision !== page.bodyRevision;
            await mutateLiveCopy(contentLiveCopy, documentId, {
              edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
              input: {
                content: page.content,
                ...(!options.keepLiveEdits
                  ? {}
                  : onlyBehind
                    ? { expected: live.text }
                    : { keepLiveEdits: true }),
              },
              // An edit that changes nothing commits no live copy, so the
              // binding's persist does not run; switch the page here.
              persist: async (tx, change) => {
                if (!change.changed) {
                  await persistLiveBodyConversion(
                    tx,
                    conversion,
                    change.text,
                    change.version,
                  );
                }
              },
            });
            return;
          }
          const seeded = await seedLiveCopy(contentLiveCopy, documentId, {
            source: page.content,
          });
          if (!seeded.seeded) {
            throw new LiveBodyConversionError(
              "base_changed",
              documentId,
              `Page ${documentId}'s live copy was seeded while it was being switched.`,
            );
          }
        },
      );
    } catch (error) {
      if (
        (error instanceof LiveBodyConversionError &&
          error.code === "base_changed") ||
        liveCopyBaseChanged(error)
      ) {
        continue;
      }
      if (
        error instanceof LiveCopyError &&
        error.code === "build_refused" &&
        error.reason === "live_edits"
      ) {
        throw new LiveBodyConversionError(
          "live_edits",
          documentId,
          `Page ${documentId}'s live copy holds text its stored body lacks, so it wasn't switched.`,
        );
      }
      throw error;
    }
    return liveBodyWriterGate(documentId);
  }
  throw new LiveBodyConversionError(
    "base_changed",
    documentId,
    `Page ${documentId} kept changing while it was being switched to its live copy.`,
  );
}

/**
 * Sends a page's body writes back to the legacy path, and keeps the backfill
 * from switching it again. Its live copy stays; the first legacy body write
 * leaves it behind, so switching back converts the page again.
 */
export async function switchPageToLegacy(
  documentId: string,
): Promise<LiveBodyWriterGate> {
  await getDb()
    .update(schema.documents)
    .set({
      liveBodySwitchedAt: null,
      liveBodyOptedOutAt: new Date().toISOString(),
    })
    .where(eq(schema.documents.id, documentId));
  return liveBodyWriterGate(documentId);
}
