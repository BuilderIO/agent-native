import { defineAction } from "@agent-native/core";
import {
  getRequestUserEmail,
  getRequestOrgId,
} from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";

const CARD_TYPES = [
  "pr-to-review",
  "my-pr-status-change",
  "my-pr-ci-failure",
  "run-needs-input",
  "error-new",
] as const;

/**
 * Mute or unmute a card type for the current user. When muted, the
 * `list-attention-queue` aggregator filters out every card of that type
 * before returning. Per-user state — does not affect anyone else.
 */
export default defineAction({
  description:
    "Mute (or unmute) an Attention Queue card type for the current user. Muted card types do not surface in the queue.",
  schema: z.object({
    cardType: z.enum(CARD_TYPES).describe("Card type to mute or unmute."),
    muted: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "true to mute (default), false to unmute and resurface the card type.",
      ),
  }),
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      throw new Error("Sign in to manage muted card types.");
    }
    const orgId = getRequestOrgId() ?? null;

    const db = getDb();
    const existing = await db
      .select()
      .from(schema.workbenchMutedTypes)
      .where(
        and(
          eq(schema.workbenchMutedTypes.ownerEmail, ownerEmail),
          eq(schema.workbenchMutedTypes.cardType, args.cardType),
        ),
      )
      .limit(1);

    if (args.muted) {
      if (existing.length > 0) {
        return {
          ok: true,
          cardType: args.cardType,
          muted: true,
          message: "Already muted.",
        };
      }
      await db.insert(schema.workbenchMutedTypes).values({
        id: nanoid(),
        cardType: args.cardType,
        ownerEmail,
        orgId: orgId ?? undefined,
        visibility: "private",
      });
      return {
        ok: true,
        cardType: args.cardType,
        muted: true,
        message: `Muted ${args.cardType}.`,
      };
    }

    // Unmute — delete the row if present.
    if (existing.length === 0) {
      return {
        ok: true,
        cardType: args.cardType,
        muted: false,
        message: "Was not muted.",
      };
    }
    await db
      .delete(schema.workbenchMutedTypes)
      .where(eq(schema.workbenchMutedTypes.id, existing[0].id));
    return {
      ok: true,
      cardType: args.cardType,
      muted: false,
      message: `Unmuted ${args.cardType}.`,
    };
  },
});
