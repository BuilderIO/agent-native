import { describe, expect, it } from "vitest";

import {
  sanitizePublicMetadata,
  serializePublicBrandProfile,
  serializePublicContextDetail,
  serializePublicJob,
  serializePublicReviewItems,
} from "./public-serialization.js";

const PRIVATE_HANDLE = "creative-context-blob:private-object";

function serialized(value: unknown): string {
  return JSON.stringify(value);
}

function expectNoCapabilities(value: unknown) {
  const output = serialized(value);
  expect(output).not.toContain(PRIVATE_HANDLE);
  expect(output).not.toMatch(
    /storageKey|blobRef|rawSnapshotBlobRef|providerUrl|leaseToken|leaseOwner|secret-token/i,
  );
}

describe("creative context public serialization", () => {
  it("recursively removes capability-looking keys and values", () => {
    const result = sanitizePublicMetadata({
      safe: "caption",
      nested: {
        storageKey: PRIVATE_HANDLE,
        providerUrl: "https://provider.example/private",
        token: "secret-token",
        values: [PRIVATE_HANDLE, "safe"],
      },
      nativeClone: { handle: "opaque-native-handle" },
    });
    expect(result).toEqual({ safe: "caption", nested: { values: ["safe"] } });
  });

  it("redacts capability URLs embedded inside warning and error strings", () => {
    expect(
      sanitizePublicMetadata(
        "Fetch failed for https://provider.example/private?token=example: timeout",
      ),
    ).toBe("Fetch failed for [redacted] timeout");
    expect(
      sanitizePublicMetadata(
        "Warning: creative-context-blob:v1:opaque-example is unavailable",
      ),
    ).toBe("Warning: [redacted] is unavailable");
  });

  it("replaces context item media handles with an access-scoped id URL", () => {
    const result = serializePublicContextDetail({
      item: {
        id: "item-1",
        thumbnailBlobRef: PRIVATE_HANDLE,
        canonicalUrl: "https://provider.example/private?token=example",
        provenance: {
          warning:
            "Source https://provider.example/private?token=example failed",
          role: "hero",
        },
      },
      version: {
        id: "version-1",
        rawSnapshotBlobRef: PRIVATE_HANDLE,
        metadata: { blobRef: PRIVATE_HANDLE, role: "hero" },
      },
      chunks: [{ id: "chunk-1", metadata: { storageKey: PRIVATE_HANDLE } }],
      media: [
        {
          id: "media-1",
          storageKey: PRIVATE_HANDLE,
          provenanceUrl: "https://provider.example/private",
          url: null,
          metadata: { providerUrl: "https://provider.example/private" },
        },
      ],
      edges: [{ id: "edge-1", metadata: { label: "derived" } }],
    } as any);
    expect(result.item.hasThumbnail).toBe(true);
    expect(result.item).toMatchObject({
      canonicalUrl: null,
      provenance: { warning: "Source [redacted] failed", role: "hero" },
    });
    expect(result.media[0]?.url).toBe(
      "/_agent-native/creative-context/media?mediaId=media-1",
    );
    expect(result.media[0]?.hasOriginal).toBe(true);
    expectNoCapabilities(result);
  });

  it("omits leases, requests, checkpoints, and nested result capabilities", () => {
    const result = serializePublicJob({
      id: "job-1",
      sourceId: "source-1",
      kind: "import",
      status: "running",
      mode: "incremental",
      progressCurrent: 2,
      progressTotal: 4,
      attempts: 1,
      leaseOwner: "worker-secret",
      leaseToken: "secret-token",
      leaseExpiresAt: "tomorrow",
      nextResumeAt: null,
      budget: { token: "secret-token" },
      checkpoint: { blobRef: PRIVATE_HANDLE },
      request: { providerUrl: "https://provider.example/private" },
      result: { safe: 2, nested: { storageKey: PRIVATE_HANDLE } },
      error: null,
      createdAt: "now",
      startedAt: "now",
      completedAt: null,
    });
    expect(result).toMatchObject({ id: "job-1", result: { safe: 2 } });
    expectNoCapabilities(result);
  });

  it("sanitizes brand payloads and review provenance", () => {
    const brand = serializePublicBrandProfile({
      profile: { id: "brand-1" } as any,
      dna: {
        id: "dna-1",
        payload: {
          summary: "Safe",
          visual: { layoutPatterns: [{ thumbnailBlobRef: PRIVATE_HANDLE }] },
        },
      } as any,
      versions: [],
    });
    const review = serializePublicReviewItems([
      {
        id: "item-1",
        thumbnailBlobRef: PRIVATE_HANDLE,
        provenance: {
          providerUrl: "https://provider.example/private",
          source: "figma",
        },
      } as any,
    ]);
    expect(review[0]).toMatchObject({
      id: "item-1",
      hasThumbnail: true,
      provenance: { source: "figma" },
    });
    expectNoCapabilities({ brand, review });
  });
});
