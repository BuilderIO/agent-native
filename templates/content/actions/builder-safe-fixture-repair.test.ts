import { describe, expect, it, vi } from "vitest";

import {
  canonicalBuilderCloneData,
  executeFixtureCandidatesWithDeps,
  fixtureRepairPlan,
} from "./builder-safe-fixture-repair.js";

const provenance = [
  { name: "agentNativeSourceId", type: "text", required: false },
  { name: "agentNativeSourceModel", type: "text", required: false },
  { name: "agentNativeTestNote", type: "longText", required: false },
];
function entry(id: string, data: Record<string, unknown> = {}) {
  return {
    id,
    model: "blog-article",
    title: id,
    urlPath: `/${id}`,
    updatedAt: "2026-01-01",
    sourceValues: {},
    rawEntry: { id, model: "blog-article", data },
  };
}
function plan(args: Partial<Parameters<typeof fixtureRepairPlan>[0]> = {}) {
  return fixtureRepairPlan({
    targetModel: "agent-native-blog-article-test",
    sourceFields: [{ name: "topics", type: "list", required: false }],
    targetFields: [
      ...provenance,
      { name: "topics", type: "list", required: false },
    ],
    sourceEntries: [entry("a"), entry("b"), entry("c")],
    targetEntries: [],
    batchSize: 1,
    ...args,
  });
}

function trackingPixel(id: string) {
  return {
    id,
    "@type": "@builder.io/sdk:Element",
    tagName: "img",
    properties: {
      src: "https://cdn.builder.io/api/v1/pixel?apiKey=public-key",
      "aria-hidden": "true",
      alt: "",
      role: "presentation",
      width: "0",
      height: "0",
    },
    responsiveStyles: {
      large: {
        height: "0",
        width: "0",
        display: "block",
        opacity: "0",
        overflow: "hidden",
        pointerEvents: "none",
      },
    },
  };
}

describe("fixtureRepairPlan", () => {
  it("hard gates the model and emits draft-only webhook-free requests", () => {
    const result = plan();
    expect(result.candidates[0]).toMatchObject({
      idempotencyKey: "builder-safe-fixture:a",
      request: {
        method: "POST",
        query: { triggerWebhooks: "false" },
        body: {
          published: "draft",
          data: {
            agentNativeSourceId: "a",
            agentNativeSourceModel: "blog-article",
          },
        },
      },
    });
    expect(() => plan({ targetModel: "blog-article" })).toThrow("only targets");
  });

  it("keeps later candidates discoverable after a replayed first page", () => {
    const existing = entry("target-a", {
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
    existing.rawEntry.published = "draft";
    const result = plan({
      targetEntries: [existing],
      batchSize: 1,
    });
    expect(result.candidates[0]?.sourceId).toBe("b");
    expect(result.inventory).toMatchObject({
      scanned: 3,
      existing: 1,
      unchanged: 1,
      candidates: 1,
      remaining: 1,
      nextCursor: "b",
    });
    expect(plan({ cursor: "b" }).candidates[0]?.sourceId).toBe("c");
  });

  it("repairs an existing truncated target with a draft-only PATCH", () => {
    const source = entry("a", {
      title: "Raw source",
      blocks: [{ id: "block-1", component: { name: "Text" } }],
      author: { "@type": "@builder.io/core:Reference", id: "author-1" },
    });
    const target = entry("target-a", {
      title: "Raw source",
      agentNativeSourceId: "a",
      agentNativeSourceModel: "old-model",
      agentNativeTestNote: "old note",
    });
    target.rawEntry.published = "draft";

    const result = plan({ sourceEntries: [source], targetEntries: [target] });

    expect(result.inventory).toMatchObject({
      existing: 1,
      unchanged: 0,
      repairs: 1,
      missing: 0,
    });
    expect(result.candidates[0]).toMatchObject({
      operation: "repair",
      targetEntryId: "target-a",
      request: {
        method: "PATCH",
        path: "/api/v1/write/agent-native-blog-article-test/target-a",
        query: { triggerWebhooks: "false" },
        body: {
          published: "draft",
          data: {
            title: "Raw source",
            blocks: [{ id: "block-1", component: { name: "Text" } }],
            author: {
              "@type": "@builder.io/core:Reference",
              id: "author-1",
            },
            agentNativeSourceId: "a",
            agentNativeSourceModel: "blog-article",
            agentNativeTestNote: "Agent Native safe fixture backfill",
          },
        },
      },
    });
  });

  it("skips only an exact raw draft clone and rejects duplicate provenance", () => {
    const source = entry("a", { nested: { value: [1, 2, 3] } });
    const exact = entry("target-a", {
      nested: { value: [1, 2, 3] },
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
    exact.rawEntry.published = "draft";
    expect(
      plan({ sourceEntries: [source], targetEntries: [exact] }),
    ).toMatchObject({
      candidates: [],
      inventory: { unchanged: 1, repairs: 0, missing: 0 },
    });
    expect(() =>
      plan({
        sourceEntries: [source],
        targetEntries: [
          exact,
          entry("duplicate", { agentNativeSourceId: "a" }),
        ],
      }),
    ).toThrow("duplicate provenance");
  });

  it("canonicalizes only Builder-managed reference caches and tracking-pixel IDs", () => {
    const source = {
      author: {
        "@type": "@builder.io/core:Reference",
        id: "author-1",
        model: "blog-author",
      },
      blocks: [
        {
          id: "authored-block-1",
          component: { name: "Text", options: { text: "Authored text" } },
        },
        trackingPixel("builder-pixel-source"),
      ],
    };
    const builderNormalized = {
      ...source,
      author: {
        ...source.author,
        value: { id: "author-1", data: { name: "Cached author" } },
      },
      blocks: [source.blocks[0], trackingPixel("builder-pixel-regenerated")],
    };
    expect(canonicalBuilderCloneData(builderNormalized)).toEqual(
      canonicalBuilderCloneData(source),
    );

    const changedText = structuredClone(builderNormalized);
    changedText.blocks[0].component!.options.text = "Different text";
    const changedBlockId = structuredClone(builderNormalized);
    changedBlockId.blocks[0].id = "authored-block-2";
    const changedReferenceId = structuredClone(builderNormalized);
    changedReferenceId.author.id = "author-2";
    for (const actualChange of [
      changedText,
      changedBlockId,
      changedReferenceId,
    ]) {
      expect(canonicalBuilderCloneData(actualChange)).not.toEqual(
        canonicalBuilderCloneData(source),
      );
    }
  });

  it("accepts Builder-managed canonical differences but repairs authored changes", () => {
    const sourceData = {
      author: {
        "@type": "@builder.io/core:Reference",
        id: "author-1",
        model: "blog-author",
      },
      blocks: [
        {
          id: "authored-block-1",
          component: { name: "Text", options: { text: "Authored text" } },
        },
        trackingPixel("builder-pixel-source"),
      ],
    };
    const normalizedTargetData = {
      ...sourceData,
      author: { ...sourceData.author, value: { data: { name: "Cache" } } },
      blocks: [
        sourceData.blocks[0],
        trackingPixel("builder-pixel-regenerated"),
      ],
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    };
    const target = entry("target-a", normalizedTargetData);
    target.rawEntry.published = "draft";
    expect(
      plan({
        sourceEntries: [entry("a", sourceData)],
        targetEntries: [target],
      }),
    ).toMatchObject({
      candidates: [],
      inventory: { unchanged: 1, repairs: 0 },
    });

    for (const mutate of [
      (data: typeof normalizedTargetData) => {
        data.blocks[0].component!.options.text = "Different text";
      },
      (data: typeof normalizedTargetData) => {
        data.blocks[0].id = "authored-block-2";
      },
      (data: typeof normalizedTargetData) => {
        data.author.id = "author-2";
      },
    ]) {
      const changed = structuredClone(normalizedTargetData);
      mutate(changed);
      const changedTarget = entry("target-a", changed);
      changedTarget.rawEntry.published = "draft";
      expect(
        plan({
          sourceEntries: [entry("a", sourceData)],
          targetEntries: [changedTarget],
        }).candidates[0],
      ).toMatchObject({ operation: "repair", sourceId: "a" });
    }
  });

  it("reports archived source drift without planning target deletion", () => {
    const archivedSnapshot = entry("target-archived", {
      agentNativeSourceId: "archived-source",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
    const result = plan({ targetEntries: [archivedSnapshot] });
    expect(result.inventory).toMatchObject({
      sourceTotal: 3,
      targetTotal: 1,
      snapshotOnlyTargetSourceIds: ["archived-source"],
      snapshotOnlyTargetPolicy: expect.stringContaining(
        "never triggers deletion",
      ),
      missing: 3,
    });
  });

  it("preserves nested rich source data while only overriding provenance", () => {
    const result = plan({
      sourceEntries: [
        entry("a", {
          title: "Original",
          topics: [{ name: "nested", refs: [{ id: "reference-id" }] }],
          hero: {
            image: "https://cdn.example/image",
            video: { url: "https://cdn.example/video" },
          },
          agentNativeSourceModel: "old",
        }),
      ],
    });
    expect(result.candidates[0]?.request.body.data).toEqual({
      title: "Original",
      topics: [{ name: "nested", refs: [{ id: "reference-id" }] }],
      hero: {
        image: "https://cdn.example/image",
        video: { url: "https://cdn.example/video" },
      },
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
  });

  it("reports source-to-target additions and rejects incompatible schema", () => {
    expect(plan({ targetFields: provenance }).additions).toEqual([
      { name: "topics", type: "list", required: false },
    ]);
    expect(() =>
      plan({
        targetFields: [
          ...provenance,
          { name: "topics", type: "text", required: false },
        ],
      }),
    ).toThrow("incompatible");
  });

  it("never writes when schema has additions", () => {
    const result = plan({ targetFields: provenance });
    expect(result.additions).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("writes a canary sequentially and verifies exact raw data and draft state", async () => {
    const result = plan();
    const write = vi.fn(async () => ({
      ok: true,
      status: 201,
      entryId: "fixture-a",
      responseBody: {},
    }));
    const executed = await executeFixtureCandidatesWithDeps({
      candidates: result.candidates,
      executeWrite: write,
      readTargetInventory: async () =>
        ({
          state: "live",
          entries: [
            (() => {
              const target = entry(
                "fixture-a",
                result.candidates[0]!.expectedData,
              );
              target.rawEntry.published = "draft";
              return target;
            })(),
          ],
          fetchedAt: "now",
          message: null,
          progress: { partial: false, hasMore: false },
        }) as never,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(executed.writes[0]).toMatchObject({
      sourceId: "a",
      entryId: "fixture-a",
    });
    expect(executed.verification.attempts).toBe(1);
  });

  it("verifies through the canonical semantic clone representation", async () => {
    const sourceData = {
      author: {
        "@type": "@builder.io/core:Reference",
        id: "author-1",
        model: "blog-author",
      },
      blocks: [trackingPixel("builder-pixel-source")],
    };
    const result = plan({ sourceEntries: [entry("a", sourceData)] });
    const normalizedTarget = entry("fixture-a", {
      author: {
        ...sourceData.author,
        value: { id: "author-1", data: { name: "Cached author" } },
      },
      blocks: [trackingPixel("builder-pixel-regenerated")],
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
    normalizedTarget.rawEntry.published = "draft";

    await expect(
      executeFixtureCandidatesWithDeps({
        candidates: result.candidates,
        executeWrite: async () => ({ ok: true, status: 200, responseBody: {} }),
        readTargetInventory: async () =>
          ({
            state: "live",
            entries: [normalizedTarget],
            progress: { partial: false, hasMore: false },
          }) as never,
      }),
    ).resolves.toMatchObject({
      verification: { attempts: 1, verifiedSourceIds: ["a"] },
    });
  });

  it("retries only the read when Builder draft visibility lags", async () => {
    const result = plan();
    const write = vi.fn(async () => ({
      ok: true,
      status: 200,
      entryId: "fixture-a",
      responseBody: {},
    }));
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        state: "live",
        entries: [],
        progress: { partial: false, hasMore: false },
      })
      .mockResolvedValueOnce({
        state: "live",
        entries: [
          (() => {
            const target = entry(
              "fixture-a",
              result.candidates[0]!.expectedData,
            );
            target.rawEntry.published = "draft";
            return target;
          })(),
        ],
        progress: { partial: false, hasMore: false },
      });
    const wait = vi.fn(async () => undefined);
    const executed = await executeFixtureCandidatesWithDeps({
      candidates: result.candidates,
      executeWrite: write,
      readTargetInventory: read as never,
      wait,
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(1_000);
    expect(executed.verification.attempts).toBe(2);
  });

  it("stops after a write failure and fails loud on ambiguous verification", async () => {
    const result = plan({ batchSize: 2 });
    const write = vi.fn(async () => ({
      ok: false,
      status: 500,
      responseBody: null,
      error: "HTTP 500",
    }));
    await expect(
      executeFixtureCandidatesWithDeps({
        candidates: result.candidates,
        executeWrite: write,
        readTargetInventory: async () => ({}) as never,
      }),
    ).rejects.toThrow("draft write failed");
    expect(write).toHaveBeenCalledTimes(1);
    await expect(
      executeFixtureCandidatesWithDeps({
        candidates: plan().candidates,
        executeWrite: async () => ({ ok: true, status: 201, responseBody: {} }),
        wait: async () => undefined,
        readTargetInventory: async () =>
          ({
            state: "live",
            entries: [],
            progress: { partial: false, hasMore: false },
          }) as never,
      }),
    ).rejects.toThrow("after 12 read attempts: a: found 0");
  });

  it("fails verification when Builder returns a truncated clone", async () => {
    const result = plan({
      sourceEntries: [entry("a", { blocks: [{ id: "1" }] })],
    });
    const truncated = entry("fixture-a", {
      agentNativeSourceId: "a",
      agentNativeSourceModel: "blog-article",
      agentNativeTestNote: "Agent Native safe fixture backfill",
    });
    truncated.rawEntry.published = "draft";
    await expect(
      executeFixtureCandidatesWithDeps({
        candidates: result.candidates,
        executeWrite: async () => ({ ok: true, status: 200, responseBody: {} }),
        wait: async () => undefined,
        readTargetInventory: async () =>
          ({
            state: "live",
            entries: [truncated],
            progress: { partial: false, hasMore: false },
          }) as never,
      }),
    ).rejects.toThrow("a: cloned data differs");
  });
});
