import { createHash } from "node:crypto";

import { defineAction } from "@agent-native/core";
import { readPrivateBlob, type PrivateBlobHandle } from "@agent-native/core/private-blob";
import { getRequestOrgId, getRequestUserEmail } from "@agent-native/core/server/request-context";
import { resolveNativeContextCloneReference } from "@agent-native/creative-context/server";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getDeckUrl } from "./_app-url.js";

const cloneSchema = z.object({ handle: z.object({ id: z.string(), provider: z.string(), opaque: z.literal(true) }), appId: z.literal("slides"), resourceType: z.literal("deck"), resourceId: z.string(), contentHash: z.string(), sourceVersion: z.string(), updatedAt: z.string() });

export default defineAction({
  description: "Clone one exact governed Slides deck version without exposing its native payload.",
  schema: z.object({ contextId: z.string(), artifactKey: z.string(), resourceId: z.string(), expectedUpdatedAt: z.string().optional(), title: z.string().optional() }),
  run: async (args) => {
    const reference = await resolveNativeContextCloneReference({ appId: "slides", resourceType: "deck", resourceId: args.resourceId, expectedUpdatedAt: args.expectedUpdatedAt, contextId: args.contextId, artifactKey: args.artifactKey });
    const clone = cloneSchema.parse(reference.privateMetadata.clone);
    const raw = await readPrivateBlob(clone.handle as PrivateBlobHandle);
    const data = Buffer.from(raw.data).toString("utf8");
    if (createHash("sha256").update(data).digest("hex") !== clone.contentHash) throw new Error("Governed deck clone payload failed integrity verification.");
    const deck = JSON.parse(data) as { slides?: Array<Record<string, unknown>>; title?: string; designSystemId?: string };
    const email = getRequestUserEmail(); if (!email) throw new Error("no authenticated user");
    const id = `deck-${nanoid()}`; const now = new Date().toISOString(); const title = args.title?.trim() || `Copy of ${deck.title ?? "deck"}`;
    deck.title = title; deck.createdAt = now; deck.updatedAt = now;
    deck.slides = (deck.slides ?? []).map((slide) => ({ ...slide, id: `slide-${nanoid(8)}` }));
    await getDb().insert(schema.decks).values({ id, title, data: JSON.stringify(deck), designSystemId: deck.designSystemId ?? null, ownerEmail: email, orgId: getRequestOrgId() ?? null, createdAt: now, updatedAt: now });
    const [saved] = await getDb().select({ id: schema.decks.id, title: schema.decks.title }).from(schema.decks).where(eq(schema.decks.id, id));
    if (!saved) throw new Error("Deck clone did not persist.");
    return { id: saved.id, title: saved.title, slideCount: deck.slides.length, url: getDeckUrl(id), clonedExactVersion: clone.sourceVersion };
  },
});
