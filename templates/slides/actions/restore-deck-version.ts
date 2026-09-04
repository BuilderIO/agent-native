import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import {
  createDeckVersionSnapshot,
  deckVersionChangeGroupFromAction,
  deckVersionChatContextFromAction,
  deckVersionContentSignature,
} from "../server/lib/deck-versions.js";
import { getDeckUrl } from "./_app-url.js";
import {
  assertDeckWriteApplied,
  deckRevisionWhere,
  nextDeckRevision,
} from "./_deck-write.js";
import { isAgentPatchCaller } from "./patch-deck.js";

export default defineAction({
  description:
    "Restore a deck to a saved history snapshot. The current deck is snapshotted first, so restore is reversible.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    versionId: z.string().describe("Version snapshot ID to restore"),
  }),
  http: { method: "POST" },
  run: async ({ deckId, versionId }, ctx) => {
    const access = await assertAccess("deck", deckId, "editor");
    const current = access.resource;
    const ownerEmail = current.ownerEmail as string;
    const db = getDb();

    const [version] = await db
      .select()
      .from(schema.deckVersions)
      .where(
        and(
          eq(schema.deckVersions.id, versionId),
          eq(schema.deckVersions.deckId, deckId),
          eq(schema.deckVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);

    if (!version) {
      throw new Error(`Deck version not found: ${versionId}`);
    }

    const data = JSON.parse(version.data);
    const now = nextDeckRevision(current.updatedAt);
    const title = version.title || data?.title || current.title || "Untitled";
    data.title = title;

    const designSystemId =
      typeof data.designSystemId === "string" && data.designSystemId
        ? data.designSystemId
        : null;

    if (
      current.title === title &&
      current.designSystemId === designSystemId &&
      deckVersionContentSignature(current.data) ===
        deckVersionContentSignature(data)
    ) {
      if (isAgentPatchCaller(ctx?.caller)) {
        throw new Error(
          "Nothing was written: the selected deck version already matches the current deck. Re-read with get-deck before retrying.",
        );
      }
      return {
        id: deckId,
        title,
        slideCount: Array.isArray(data?.slides) ? data.slides.length : 0,
        restoredVersionId: versionId,
        updatedAt: current.updatedAt,
        url: getDeckUrl(deckId),
        applied: false,
      };
    }

    data.updatedAt = now;

    await db.transaction(async (tx: any) => {
      await createDeckVersionSnapshot(
        {
          id: current.id,
          title: current.title,
          data: current.data,
          ownerEmail,
        },
        {
          force: true,
          chatContext: deckVersionChatContextFromAction(ctx),
          label: "Before restore",
          db: tx,
        },
      );
      const updateResult = await tx
        .update(schema.decks)
        .set({
          title,
          data: JSON.stringify(data),
          designSystemId,
          updatedAt: now,
        })
        .where(deckRevisionWhere(schema.decks, deckId, current.updatedAt));
      assertDeckWriteApplied(updateResult, deckId, "deck restore");
    });

    const agentChangeId = deckVersionChangeGroupFromAction(ctx);
    if (agentChangeId) {
      notifyClients(deckId, { agentChangeId });
    } else {
      notifyClients(deckId);
    }
    await writeAppState("refresh-signal", {
      ts: now,
      source: "restore-deck-version",
    });

    return {
      id: deckId,
      title,
      slideCount: Array.isArray(data?.slides) ? data.slides.length : 0,
      restoredVersionId: versionId,
      updatedAt: now,
      url: getDeckUrl(deckId),
      appUrl: getDeckUrl(deckId),
    };
  },
});
