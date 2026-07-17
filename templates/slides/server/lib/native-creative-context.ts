import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { resolveAccess } from "@agent-native/core/sharing";
import type { NativeResourceCaptureAdapter } from "@agent-native/creative-context/server";

import { createDeckVersionSnapshot } from "./deck-versions.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function text(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export const nativeDeckCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "slides",
  resourceType: "deck",
  async capture(reference) {
    const access = await resolveAccess("deck", reference.resourceId);
    if (!access) throw new Error("Deck not found");
    const deck = access.resource as { id: string; title: string; data: string; ownerEmail: string; updatedAt: string };
    if (reference.expectedUpdatedAt && reference.expectedUpdatedAt !== deck.updatedAt) {
      throw new Error("Deck changed before it could be submitted to Context.");
    }
    const version = await createDeckVersionSnapshot(deck, { force: true, label: "Creative Context submission" });
    const contentHash = hash(deck.data);
    const handle = await putPrivateBlob({
      data: Buffer.from(deck.data),
      filename: `${deck.id}.deck.json`,
      mimeType: "application/json",
      ownerEmail: deck.ownerEmail,
      key: `creative-context/slides/${deck.id}/${contentHash}.json`,
      metadata: { appId: "slides", resourceType: "deck", resourceId: deck.id, contentHash },
    });
    if (!handle) throw new Error("Private blob storage is required to submit a deck to Context.");
    const parsed = JSON.parse(deck.data) as { slides?: Array<{ id?: string; content?: string; notes?: string; title?: string }> };
    const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
    return {
      artifactKey: `slides:deck:${deck.id}`,
      source: { name: "Slides", kind: "manual", externalRef: deck.id },
      item: {
        externalId: `native:slides:deck:${deck.id}`,
        kind: "slides-deck",
        title: deck.title || "Untitled deck",
        canonicalUrl: `/deck/${deck.id}`,
        mimeType: "application/json",
        content: slides.map((slide, index) => `Slide ${index + 1}: ${text(slide.content ?? "")} ${slide.notes ?? ""}`).join("\n").slice(0, 40_000),
        summary: `${slides.length} slides captured as an immutable deck version.`,
        contentHash,
        sourceModifiedAt: deck.updatedAt,
        sourceVersion: version.id ?? contentHash,
        metadata: { preview: { type: "slides", slideCount: slides.length }, children: slides.map((slide, index) => ({ id: slide.id ?? String(index), title: slide.title ?? `Slide ${index + 1}`, text: text(slide.content ?? "").slice(0, 240) })) },
      },
      privateMetadata: { clone: { handle, contentHash, sourceVersion: version.id ?? contentHash, updatedAt: deck.updatedAt } },
    };
  },
};
