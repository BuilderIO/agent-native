import type { ActionRunContext } from "@agent-native/core/action";
import {
  mutateLiveCopy,
  readLiveCopy,
  seedLiveCopy,
} from "@agent-native/core/collab";
import { eq } from "drizzle-orm";

import { getDb, schema } from "../db/index.js";
import {
  liveBodyWriterFlagsOn,
  liveBodyWriterGate,
  liveBodyWriterPageColumns,
  type LiveBodyWriterGate,
} from "../lib/live-body-writer.js";
import { CONTENT_LIVE_COPY_EDITS, contentLiveCopy } from "./binding.js";
import {
  LiveBodyConversionError,
  persistLiveBodyConversion,
} from "./persist.js";
import { withLiveBodyConversion } from "./write-cause.js";

const CONVERSION_ATTEMPTS = 3;

async function readPage(documentId: string) {
  // guard:allow-unscoped — set-live-body-switch checks editor access before it switches a page.
  const [page] = await getDb()
    .select({
      ...liveBodyWriterPageColumns,
      content: schema.documents.content,
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
 * wins over Yjs-only edits, so switch a page before an editor binds to it.
 * Throws `LiveBodyConversionError` `flag_off` unless both flags are on for
 * the page's owner, `local_file` for a page linked to a local file, and
 * `base_changed` when the body keeps moving.
 */
export async function switchPageToLiveCopy(
  documentId: string,
  options: { ctx?: ActionRunContext } = {},
): Promise<LiveBodyWriterGate> {
  for (let attempt = 0; attempt < CONVERSION_ATTEMPTS; attempt += 1) {
    const page = await readPage(documentId);
    if (!page) return { writePath: "legacy", reason: "no_page" };
    const gate = await liveBodyWriterGate(documentId);
    if (gate.writePath === "live_copy") return gate;
    if (!(await liveBodyWriterFlagsOn(page))) {
      throw new LiveBodyConversionError(
        "flag_off",
        documentId,
        `The live-copy writer is off for page ${documentId}'s owner.`,
      );
    }
    const conversion = { documentId, baseRevision: page.bodyRevision };
    try {
      await withLiveBodyConversion(
        conversion,
        { ctx: options.ctx, operation: "switch-live-body" },
        async () => {
          const live = await readLiveCopy(contentLiveCopy, documentId);
          if (live.kind === "live") {
            await mutateLiveCopy(contentLiveCopy, documentId, {
              edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
              input: { content: page.content },
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
        error instanceof LiveBodyConversionError &&
        error.code === "base_changed"
      ) {
        continue;
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
 * Sends a page's body writes back to the legacy path. Its live copy stays;
 * the first legacy body write leaves it behind, so switching back converts
 * the page again.
 */
export async function switchPageToLegacy(
  documentId: string,
): Promise<LiveBodyWriterGate> {
  await getDb()
    .update(schema.documents)
    .set({ liveBodySwitchedAt: null })
    .where(eq(schema.documents.id, documentId));
  return liveBodyWriterGate(documentId);
}
