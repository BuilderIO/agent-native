import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import {
  readPrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDeckUrl } from "./_app-url.js";
import { trackDeckCreated } from "./_deck-tracking.js";
import { assertDeckInlineImagesPersistable } from "./_render-artifacts.js";

export default defineAction({
  description:
    "Clone one exact governed Slides deck version without exposing its native payload.",
  schema: z.object({
    contextId: z.string(),
    artifactKey: z.string(),
    resourceId: z.string(),
    expectedUpdatedAt: z.string().optional(),
    title: z.string().optional(),
  }),
  publicAgent: { expose: true, readOnly: false, requiresAuth: true },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
  run: async (args, ctx) => {
    const reference = await resolveNativeContextCloneReference({
      appId: "slides",
      resourceType: "deck",
      resourceId: args.resourceId,
      expectedUpdatedAt: args.expectedUpdatedAt,
      contextId: args.contextId,
      artifactKey: args.artifactKey,
    });
    const raw = await readPrivateBlob(
      reference.cloneHandle as PrivateBlobHandle,
    );
    const data = Buffer.from(raw.data).toString("utf8");
    const contentHash = createHash("sha256").update(data).digest("hex");
    if (
      raw.metadata?.appId !== "slides" ||
      raw.metadata?.resourceType !== "deck" ||
      raw.metadata?.resourceId !== args.resourceId ||
      raw.metadata?.contentHash !== contentHash
    )
      fail("Governed deck clone payload failed integrity verification.", {
        errorCode: "creative_context_clone_integrity_failed",
        statusCode: 422,
      });
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("Deck not found.", {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }
    const deck = parsed as Record<string, unknown> & {
      slides?: Array<Record<string, unknown>>;
      title?: string;
      designSystemId?: string;
    };
    if (Object.hasOwn(deck, "appId") && deck.appId !== "slides") {
      fail("Deck not found.", {
        errorCode: "deck_not_found",
        statusCode: 404,
      });
    }
    const email = getRequestUserEmail();
    if (!email)
      fail("no authenticated user", {
        errorCode: "not_authenticated",
        statusCode: 401,
      });
    const id = `deck-${nanoid()}`;
    const now = new Date().toISOString();
    const title = args.title?.trim() || `Copy of ${deck.title ?? "deck"}`;
    deck.appId = "slides-2";
    deck.title = title;
    deck.createdAt = now;
    deck.updatedAt = now;
    deck.slides = (deck.slides ?? []).map((slide) => ({
      ...slide,
      id: `slide-${nanoid(8)}`,
    }));
    assertDeckInlineImagesPersistable(null, deck);
    await getDb()
      .insert(schema.decks)
      .values({
        id,
        title,
        data: JSON.stringify(deck),
        designSystemId: deck.designSystemId ?? null,
        ownerEmail: email,
        orgId: getRequestOrgId() ?? null,
        createdAt: now,
        updatedAt: now,
      });
    const [saved] = await getDb()
      .select({ id: schema.decks.id, title: schema.decks.title })
      .from(schema.decks)
      .where(eq(schema.decks.id, id));
    if (!saved)
      fail("Deck clone did not persist.", {
        errorCode: "deck_clone_persistence_unverified",
        statusCode: 500,
      });
    trackDeckCreated(
      saved.id,
      {
        creationMethod: "duplicate",
        purpose: "direct",
        slideCount: deck.slides.length,
      },
      ctx,
    );
    return {
      id: saved.id,
      title: saved.title,
      slideCount: deck.slides.length,
      url: getDeckUrl(id),
      clonedExactVersion: reference.publishedItemVersionId,
    };
  },
});
