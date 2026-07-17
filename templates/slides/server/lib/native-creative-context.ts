import { createHash } from "node:crypto";

import { putPrivateBlob } from "@agent-native/core/private-blob";
import { resolveAccess } from "@agent-native/core/sharing";
import {
  renderSafeNativeHtmlPreviews,
  serializePrivateBlobHandle,
  type NativeResourceCaptureAdapter,
} from "@agent-native/creative-context/server";

import { getAspectRatioDims, type AspectRatio } from "../../shared/aspect-ratios.js";
import { createDeckVersionSnapshot } from "./deck-versions.js";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function text(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function previewText(value: string | undefined, limit = 280) {
  return text(value ?? "").slice(0, limit);
}

function slidePreviewDocument(content: string, width: number, height: number) {
  return `<!doctype html><html><head><style>
    *,*::before,*::after{box-sizing:border-box}html,body{width:${width}px;height:${height}px;margin:0;overflow:hidden;background:#fff}.context-slide{position:relative;width:${width}px;height:${height}px;overflow:hidden}.context-slide>*{width:100%;height:100%}.fmd-slide{width:100%;height:100%}
  </style></head><body><div class="context-slide">${content}</div></body></html>`;
}

async function captureSlidePreviewMedia(input: {
  deckId: string;
  ownerEmail: string;
  slides: Array<{ id: string; content: string; title: string }>;
  aspectRatio?: AspectRatio;
}) {
  const dimensions = getAspectRatioDims(input.aspectRatio);
  const rendered = await renderSafeNativeHtmlPreviews(
    input.slides.map((slide) => ({
      id: slide.id,
      html: slidePreviewDocument(
        slide.content,
        dimensions.width,
        dimensions.height,
      ),
      width: dimensions.width,
      height: dimensions.height,
    })),
  );
  const media = new Map<
    string,
    {
      kind: "image";
      mimeType: "image/png";
      accessMode: "private";
      storageKey: string;
      altText: string;
      contentHash: string;
      width: number;
      height: number;
      metadata: { role: "slide-preview"; slideId: string };
    }
  >();
  await Promise.all(
    rendered.map(async (preview) => {
      const contentHash = hash(Buffer.from(preview.data).toString("base64"));
      const handle = await putPrivateBlob({
        data: preview.data,
        filename: `${input.deckId}-${preview.id}.preview.png`,
        mimeType: "image/png",
        ownerEmail: input.ownerEmail,
        key: `creative-context/slides/${input.deckId}/previews/${contentHash}.png`,
        metadata: {
          appId: "slides",
          resourceType: "slide-preview",
          resourceId: input.deckId,
          contentHash,
        },
      }).catch(() => null);
      if (!handle) return;
      const slide = input.slides.find((candidate) => candidate.id === preview.id);
      media.set(preview.id, {
        kind: "image",
        mimeType: "image/png",
        accessMode: "private",
        storageKey: serializePrivateBlobHandle(handle),
        altText: slide?.title ?? "Slide preview",
        contentHash,
        width: preview.width,
        height: preview.height,
        metadata: { role: "slide-preview", slideId: preview.id },
      });
    }),
  );
  return media;
}

export const nativeDeckCreativeContextAdapter: NativeResourceCaptureAdapter = {
  appId: "slides",
  resourceType: "deck",
  async capture(reference) {
    const access = await resolveAccess("deck", reference.resourceId);
    if (!access) throw new Error("Deck not found");
    const deck = access.resource as {
      id: string;
      title: string;
      data: string;
      ownerEmail: string;
      updatedAt: string;
      visibility?: "private" | "org" | "public";
    };
    if (
      reference.expectedUpdatedAt &&
      reference.expectedUpdatedAt !== deck.updatedAt
    ) {
      throw new Error("Deck changed before it could be submitted to Context.");
    }
    const version = await createDeckVersionSnapshot(deck, {
      force: true,
      label: "Creative Context submission",
    });
    const contentHash = hash(deck.data);
    const handle = await putPrivateBlob({
      data: Buffer.from(deck.data),
      filename: `${deck.id}.deck.json`,
      mimeType: "application/json",
      ownerEmail: deck.ownerEmail,
      key: `creative-context/slides/${deck.id}/${contentHash}.json`,
      metadata: {
        appId: "slides",
        resourceType: "deck",
        resourceId: deck.id,
        contentHash,
      },
    });
    if (!handle)
      throw new Error(
        "Private blob storage is required to submit a deck to Context.",
      );
    const parsed = JSON.parse(deck.data) as {
      aspectRatio?: AspectRatio;
      slides?: Array<{
        id?: string;
        content?: string;
        notes?: string;
        title?: string;
      }>;
    };
    const slides = Array.isArray(parsed.slides) ? parsed.slides : [];
    const slidePreviewMedia = await captureSlidePreviewMedia({
      deckId: deck.id,
      ownerEmail: deck.ownerEmail,
      aspectRatio: parsed.aspectRatio,
      slides: slides.slice(0, 12).map((slide, index) => ({
        id: slide.id ?? String(index),
        content: slide.content ?? "",
        title: slide.title ?? `Slide ${index + 1}`,
      })),
    });
    return {
      artifactKey: `slides:deck:${deck.id}`,
      source: {
        name: "Slides",
        kind: "native-app",
        externalRef: deck.id,
        access: {
          visibility: deck.visibility ?? "private",
          canManage: access.role === "owner" || access.role === "admin",
        },
      },
      items: [
        {
          externalId: `native:slides:deck:${deck.id}`,
          kind: "slides-deck",
          title: deck.title || "Untitled deck",
          canonicalUrl: `/deck/${deck.id}`,
          mimeType: "application/json",
          content: slides
            .map(
              (slide, index) =>
                `Slide ${index + 1}: ${text(slide.content ?? "")} ${slide.notes ?? ""}`,
            )
            .join("\n")
            .slice(0, 40_000),
          summary: `${slides.length} slides captured as an immutable deck version.`,
          contentHash,
          sourceModifiedAt: deck.updatedAt,
          sourceVersion: version.id ?? contentHash,
          metadata: {
            preview: {
              type: "slides",
              slideCount: slides.length,
              slides: slides.slice(0, 24).map((slide, index) => ({
                index: index + 1,
                title: previewText(slide.title, 120) || `Slide ${index + 1}`,
                excerpt: previewText(slide.content),
              })),
            },
          },
          media: [...slidePreviewMedia.values()],
          edges: slides.map((slide, index) => ({
            relation: "contains",
            toExternalId: `native:slides:deck:${deck.id}:slide:${slide.id ?? index}`,
          })),
        },
        ...slides.map((slide, index) => {
          const content =
            `${text(slide.content ?? "")} ${slide.notes ?? ""}`.trim();
          const id = slide.id ?? String(index);
          return {
            externalId: `native:slides:deck:${deck.id}:slide:${id}`,
            kind: "slide",
            title: slide.title ?? `Slide ${index + 1}`,
            canonicalUrl: `/deck/${deck.id}?slide=${encodeURIComponent(id)}`,
            mimeType: "text/html",
            content,
            summary: content.slice(0, 500),
            contentHash: hash(
              `${deck.id}:${id}:${slide.content ?? ""}:${slide.notes ?? ""}`,
            ),
            sourceModifiedAt: deck.updatedAt,
            sourceVersion: version.id ?? contentHash,
              metadata: {
              preview: {
                type: "slide",
                index: index + 1,
                title: previewText(slide.title, 120) || `Slide ${index + 1}`,
                excerpt: previewText(slide.content),
                },
              },
              media: slidePreviewMedia.has(id)
                ? [slidePreviewMedia.get(id)!]
                : undefined,
            };
        }),
      ],
      privateMetadata: {
        nativeResource: {
          appId: "slides",
          resourceType: "deck",
          resourceId: deck.id,
          expectedUpdatedAt: reference.expectedUpdatedAt,
        },
        clone: {
          handle,
          appId: "slides",
          resourceType: "deck",
          resourceId: deck.id,
          contentHash,
          sourceVersion: version.id ?? contentHash,
          updatedAt: deck.updatedAt,
        },
      },
    };
  },
};
