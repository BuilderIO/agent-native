import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { createDeckVersionSnapshot } from "../server/lib/deck-versions.js";
import { getDeckUrl } from "./_app-url.js";

export default defineAction({
  description:
    "Restore a deck to a saved history snapshot. The current deck is snapshotted first, so restore is reversible.",
  schema: z.object({
    deckId: z.string().describe("Deck ID"),
    versionId: z.string().describe("Version snapshot ID to restore"),
  }),
  run: async ({ deckId, versionId }) => {
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

    await createDeckVersionSnapshot(
      {
        id: current.id,
        title: current.title,
        data: current.data,
        ownerEmail,
      },
      { force: true, label: "Before restore" },
    );

    const data = JSON.parse(version.data);
    const now = new Date().toISOString();
    const title = version.title || data?.title || current.title || "Untitled";
    data.title = title;
    data.updatedAt = now;

    const designSystemId =
      typeof data.designSystemId === "string" && data.designSystemId
        ? data.designSystemId
        : null;

    await db
      .update(schema.decks)
      .set({
        title,
        data: JSON.stringify(data),
        designSystemId,
        updatedAt: now,
      })
      .where(eq(schema.decks.id, deckId));

    notifyClients(deckId);
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
    };
  },
});
