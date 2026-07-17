import { describe, expect, it, vi } from "vitest";

import { ContextConnectorQuotaError } from "../connectors/provider-response.js";
import { ContextImportConnectorRegistry } from "../connectors/registry.js";
import type { ContextImportConnector } from "../connectors/types.js";
import type {
  ContextIngestBatch,
  ContextJob,
  ContextSource,
} from "../types.js";
import { runContextImportJob } from "./import-runner.js";
import type {
  ContextImportJobPersistence,
  ContextImportProgressReporter,
} from "./types.js";

function source(): ContextSource {
  return {
    id: "source-1",
    name: "Launch library",
    kind: "manual",
    externalRef: null,
    connectionId: null,
    containerOwnerVerifiedAt: null,
    config: {},
    upstreamAccess: "unknown",
    status: "active",
    healthStatus: "healthy",
    syncCursor: null,
    itemCount: 0,
    restrictedItemCount: 0,
    lastSyncedAt: null,
    lastError: null,
    ownerEmail: "owner@example.com",
    orgId: null,
    visibility: "private",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function job(request: Record<string, unknown> = {}): ContextJob {
  return {
    id: "job-1",
    sourceId: "source-1",
    kind: "import",
    status: "queued",
    mode: "full",
    progressCurrent: 0,
    progressTotal: null,
    attempts: 0,
    leaseOwner: null,
    leaseToken: null,
    leaseExpiresAt: null,
    nextResumeAt: null,
    budget: null,
    checkpoint: null,
    request,
    result: null,
    error: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
  };
}

function persistence(initial: ContextJob) {
  let current = initial;
  const ingested: ContextIngestBatch[] = [];
  const reconcile = vi.fn(async () => ({ removed: 1, restored: 0 }));
  const upsertInventory = vi.fn(async (input: { items: unknown[] }) => ({
    sourceId: "source-1",
    received: input.items.length,
    created: input.items.length,
    updated: 0,
    itemIds: [],
  }));
  const markVerified = vi.fn(async () => {});
  const updateSyncCursor = vi.fn(async () => {});
  const adapter: ContextImportJobPersistence = {
    async getJob() {
      return current;
    },
    async claimJobLease(input) {
      current = {
        ...current,
        status: "running",
        leaseOwner: input.owner,
        leaseToken: input.token,
        leaseExpiresAt: input.expiresAt,
      };
      return current;
    },
    async renewJobLease() {
      return true;
    },
    async releaseJobLease() {
      current = { ...current, leaseOwner: null, leaseToken: null };
      return true;
    },
    async updateLeasedJob(input) {
      current = { ...current, ...input.patch };
      return current;
    },
    upsertSourceInventory: upsertInventory,
    async ingestItems(batch) {
      ingested.push(batch);
      return {
        sourceId: batch.sourceId,
        received: batch.items.length,
        created: batch.items.length,
        versioned: 0,
        unchanged: 0,
        itemIds: batch.items.map((item) => `item:${item.externalId}`),
        mediaIds: [],
      };
    },
    reconcileSourceInventory: reconcile,
    markSourceContainerOwnerVerified: markVerified,
    updateSourceSyncCursor: updateSyncCursor,
  };
  return {
    adapter,
    ingested,
    reconcile,
    upsertInventory,
    markVerified,
    updateSyncCursor,
    current: () => current,
  };
}

const quietProgress: ContextImportProgressReporter = {
  async start() {},
  async update() {},
  async complete() {},
};

describe("context import runner", () => {
  it("persists authoritative connector ownership before applying hydration selection", async () => {
    const connector: ContextImportConnector = {
      kind: "google-slides",
      label: "Google Slides",
      supportsIncremental: true,
      async inventory() {
        return {
          items: [
            {
              externalId: "deck-a",
              kind: "google-slides-presentation",
              title: "Deck A",
              metadata: { accessSignals: { ownedByMe: true } },
            },
          ],
          nextCursor: null,
          complete: true,
          coverage: { inspected: 1, returned: 1, truncated: false },
        };
      },
      async fetch() {
        return { items: [] };
      },
      verifiesContainerOwner() {
        return true;
      },
    };
    const state = persistence(job({ itemExternalIds: [] }));
    const slidesSource = {
      ...source(),
      kind: "google-slides",
      config: { presentationIds: ["deck-a"] },
    };

    await runContextImportJob({
      jobId: "job-1",
      source: slidesSource,
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "slides" },
      progress: quietProgress,
    });

    expect(state.markVerified).toHaveBeenCalledWith("source-1");
  });

  it("inventories first, hydrates only an exact requested subset, and reconciles against all discovered ids", async () => {
    const fetched: string[] = [];
    const connector: ContextImportConnector = {
      kind: "manual",
      label: "Fixture",
      supportsIncremental: true,
      async inventory() {
        return {
          items: ["a", "b", "c"].map((externalId) => ({
            externalId,
            kind: "fixture",
            title: externalId,
            sourceModifiedAt: "2026-07-01T00:00:00.000Z",
          })),
          nextCursor: null,
          complete: true,
          coverage: { inspected: 3, returned: 3, truncated: false },
        };
      },
      async fetch(request) {
        fetched.push(request.item.externalId);
        return {
          items: [
            {
              externalId: request.item.externalId,
              kind: "fixture",
              title: request.item.title,
              content: request.item.title,
              contentHash: `hash:${request.item.externalId}`,
            },
          ],
        };
      },
    };
    const state = persistence(job({ itemExternalIds: ["b"], reconcile: true }));
    const result = await runContextImportJob({
      jobId: "job-1",
      source: source(),
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "slides" },
      progress: quietProgress,
    });

    expect(result.yielded).toBe(false);
    expect(fetched).toEqual(["b"]);
    expect(state.ingested[0]?.items.map((item) => item.externalId)).toEqual([
      "b",
    ]);
    expect(state.upsertInventory).toHaveBeenCalledWith({
      sourceId: "source-1",
      items: expect.arrayContaining([
        expect.objectContaining({ externalId: "a" }),
        expect.objectContaining({ externalId: "b" }),
        expect.objectContaining({ externalId: "c" }),
      ]),
      completedAt: expect.any(String),
    });
    expect(state.reconcile).toHaveBeenCalledWith({
      sourceId: "source-1",
      presentExternalIds: ["a", "b", "c"],
      completedAt: expect.any(String),
    });
    expect(result.job.result).toMatchObject({
      inventoryCount: 1,
      inventoryDiscovered: 3,
      ingested: 1,
      created: 1,
      failed: 0,
      deferred: 2,
    });
  });

  it("separates pagination resume cursors from the next-run sync high-water", async () => {
    const inventoryRequests: Array<{
      cursor?: string | null;
      syncCursor?: string | null;
    }> = [];
    let page = 0;
    const connector: ContextImportConnector = {
      kind: "manual",
      label: "Incremental fixture",
      supportsIncremental: true,
      async inventory(request) {
        inventoryRequests.push(request);
        page += 1;
        return {
          items: [
            {
              externalId: `item-${page}`,
              kind: "fixture",
              title: `Item ${page}`,
              sourceModifiedAt: `2026-07-${String(page + 10).padStart(2, "0")}T00:00:00.000Z`,
            },
          ],
          nextCursor: page === 1 ? "page-2" : null,
          complete: page === 2,
          coverage: { inspected: 1, returned: 1, truncated: page === 1 },
        };
      },
      async fetch(request) {
        return {
          items: [
            {
              externalId: request.item.externalId,
              kind: "fixture",
              title: request.item.title,
              content: request.item.title,
              contentHash: request.item.externalId,
            },
          ],
        };
      },
    };
    const state = persistence({ ...job(), mode: "incremental" });
    await runContextImportJob({
      jobId: "job-1",
      source: { ...source(), syncCursor: "2026-07-01T00:00:00.000Z" },
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "slides" },
      progress: quietProgress,
    });

    expect(inventoryRequests).toEqual([
      {
        sourceId: "source-1",
        config: {},
        cursor: null,
        syncCursor: "2026-07-01T00:00:00.000Z",
        limit: 100,
      },
      {
        sourceId: "source-1",
        config: {},
        cursor: "page-2",
        syncCursor: "2026-07-01T00:00:00.000Z",
        limit: 100,
      },
    ]);
    expect(state.updateSyncCursor).toHaveBeenCalledWith(
      "source-1",
      "2026-07-12T00:00:00.000Z",
    );
  });

  it.each([
    {
      connectorKind: "google-slides" as const,
      parentKind: "google-slides-presentation",
      childKind: "google-slides-slide",
    },
    {
      connectorKind: "upload" as const,
      parentKind: "uploaded-document",
      childKind: "uploaded-section",
    },
  ])(
    "$connectorKind hydration parses the selected parent and reconciles its children idempotently",
    async ({ connectorKind, parentKind, childKind }) => {
      const connector: ContextImportConnector = {
        kind: connectorKind,
        label: "Multi-part fixture",
        supportsIncremental: true,
        async inventory() {
          return {
            items: ["deck-a", "deck-b"].map((externalId) => ({
              externalId,
              kind: parentKind,
              title: externalId,
            })),
            nextCursor: null,
            complete: true,
            coverage: { inspected: 2, returned: 2, truncated: false },
          };
        },
        async fetch(request) {
          return {
            items: [
              {
                externalId: request.item.externalId,
                kind: parentKind,
                title: request.item.title,
                content: "Two indexed children.",
                contentHash: `${request.item.externalId}:parent`,
                parseStatus: "parsed",
              },
              ...[1, 2].map((child) => ({
                externalId: `${request.item.externalId}:child-${child}`,
                kind: childKind,
                title: `Child ${child}`,
                content: `Child ${child}`,
                contentHash: `${request.item.externalId}:${child}`,
              })),
            ],
          };
        },
      };
      const state = persistence(
        job({ itemExternalIds: ["deck-a"], reconcile: true }),
      );
      await runContextImportJob({
        jobId: "job-1",
        source: { ...source(), kind: connectorKind },
        workerId: "worker-1",
        persistence: state.adapter,
        connectors: new ContextImportConnectorRegistry([connector]),
        connectorContext: { appId: "slides" },
        progress: quietProgress,
      });

      expect(state.reconcile).toHaveBeenCalledWith({
        sourceId: "source-1",
        presentExternalIds: [
          "deck-a",
          "deck-b",
          "deck-a:child-1",
          "deck-a:child-2",
        ],
        completedAt: expect.any(String),
      });
      expect(state.ingested[0]?.items).toEqual([
        expect.objectContaining({
          externalId: "deck-a",
          parseStatus: "parsed",
        }),
        expect.objectContaining({ externalId: "deck-a:child-1" }),
        expect.objectContaining({ externalId: "deck-a:child-2" }),
      ]);
    },
  );

  it("pauses at provider quota and persists the exact resume time", async () => {
    const retryAt = "2026-07-16T18:00:00.000Z";
    const connector: ContextImportConnector = {
      kind: "manual",
      label: "Fixture",
      supportsIncremental: true,
      async inventory() {
        throw new ContextConnectorQuotaError({
          provider: "figma",
          retryAt,
          retryAfterMs: 60_000,
        });
      },
      async fetch() {
        return { items: [] };
      },
    };
    const state = persistence(job());
    const result = await runContextImportJob({
      jobId: "job-1",
      source: source(),
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "slides" },
      progress: quietProgress,
    });

    expect(result).toMatchObject({
      yielded: true,
      reason: "quota",
      job: { status: "paused", nextResumeAt: retryAt },
    });
    expect(state.current().budget).toMatchObject({
      quotaProvider: "figma",
      quotaRetryAfterMs: 60_000,
    });
  });

  it("pauses when thumbnail hydration hits quota instead of recording an item failure", async () => {
    const retryAt = "2026-07-16T19:00:00.000Z";
    const connector: ContextImportConnector = {
      kind: "manual",
      label: "Fixture",
      supportsIncremental: true,
      async inventory() {
        return {
          items: [
            {
              externalId: "deck-1",
              kind: "google-slides-presentation",
              title: "Deck",
              sourceModifiedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
          complete: true,
          coverage: { inspected: 1, returned: 1, truncated: false },
        };
      },
      async fetch() {
        throw new ContextConnectorQuotaError({
          provider: "google_slides",
          retryAt,
          retryAfterMs: 120_000,
        });
      },
    };
    const state = persistence(job({ itemExternalIds: ["deck-1"] }));
    const result = await runContextImportJob({
      jobId: "job-1",
      source: source(),
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "slides" },
      progress: quietProgress,
    });

    expect(result).toMatchObject({
      yielded: true,
      reason: "quota",
      job: { status: "paused", nextResumeAt: retryAt },
    });
    expect(state.current().checkpoint).toMatchObject({ itemsFailed: 0 });
  });

  it("runs brand-DNA inference after a material import and merges the preview into the result", async () => {
    const connector: ContextImportConnector = {
      kind: "manual",
      label: "Fixture",
      supportsIncremental: true,
      async inventory() {
        return {
          items: [
            {
              externalId: "guide",
              kind: "manual-document",
              title: "Guide",
              sourceModifiedAt: "2026-07-01T00:00:00.000Z",
            },
          ],
          nextCursor: null,
          complete: true,
          coverage: { inspected: 1, returned: 1, truncated: false },
        };
      },
      async fetch(request) {
        return {
          items: [
            {
              externalId: request.item.externalId,
              kind: request.item.kind,
              title: request.item.title,
              content: "Warm and direct.",
              contentHash: "hash-guide",
            },
          ],
        };
      },
    };
    const state = persistence(job({ itemExternalIds: ["guide"] }));
    const infer = vi.fn(async () => ({
      preview: {
        profileId: "profile-1",
        dnaVersionId: "dna-1",
        contentHash: "a".repeat(64),
        summary: "Warm and direct",
        colors: ["#112233"],
        fonts: ["Inter"],
        layoutThumbnails: [],
        voiceLine: "Warm and direct.",
        confidence: 0.8,
      },
    }));
    state.adapter.inferBrandDnaProposal = infer;
    const result = await runContextImportJob({
      jobId: "job-1",
      source: source(),
      workerId: "worker-1",
      persistence: state.adapter,
      connectors: new ContextImportConnectorRegistry([connector]),
      connectorContext: { appId: "content" },
      progress: quietProgress,
    });

    expect(infer).toHaveBeenCalledWith({
      sourceId: "source-1",
      profileId: undefined,
    });
    expect(result.job.result).toMatchObject({
      inference: {
        brandDnaProposal: {
          profileId: "profile-1",
          dnaVersionId: "dna-1",
          confidence: 0.8,
        },
        media: [],
      },
    });
  });
});
