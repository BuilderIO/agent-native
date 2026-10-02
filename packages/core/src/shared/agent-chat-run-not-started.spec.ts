import { describe, expect, it, vi } from "vitest";

import {
  boundedRetryReferences,
  retryContextFromRequest,
} from "./agent-chat-run-not-started.js";

const reference = {
  type: "file",
  path: "docs/brief.md",
  name: "brief.md",
  source: "workspace",
  refType: "file",
  refId: "brief-1",
  metadata: { size: 12 },
} as const;

describe("retryContextFromRequest", () => {
  it("keeps only what a retry resends", () => {
    expect(
      retryContextFromRequest({
        metadata: {
          references: [reference, "dropped", null],
          custom: { agentNativeRecoveryAction: "retry" },
          chatScope: { type: "deck", id: "deck-1" },
        },
        model: " model-original ",
        engine: "engine-original",
        effort: "high",
        mode: "plan",
      }),
    ).toEqual({
      references: [reference],
      model: "model-original",
      engine: "engine-original",
      effort: "high",
      requestMode: "plan",
    });
  });

  it("is empty for a request without any of them", () => {
    expect(
      retryContextFromRequest({ model: "", engine: 3, mode: "build" }),
    ).toEqual({});
    expect(retryContextFromRequest({ metadata: { references: "no" } })).toEqual(
      {},
    );
  });

  it("bounds a long setting and reports the references it did not keep", () => {
    const onDropped = vi.fn();
    const context = retryContextFromRequest(
      {
        metadata: { references: [reference, { id: "not-a-reference" }] },
        model: "m".repeat(500),
      },
      onDropped,
    );

    expect(context.references).toEqual([reference]);
    expect(context.model).toBeUndefined();
    expect(onDropped).toHaveBeenCalledWith(1);
  });
});

describe("boundedRetryReferences", () => {
  it("drops a reference with an unknown type, a missing or oversized field, or loose metadata", () => {
    const { references, dropped } = boundedRetryReferences([
      reference,
      { ...reference, type: "document" },
      { ...reference, path: undefined },
      { ...reference, name: "n".repeat(501) },
      { ...reference, refId: 7 },
      { ...reference, metadata: "loose" },
      { ...reference, metadata: { blob: "x".repeat(2_001) } },
      { ...reference, metadata: [1] },
    ]);

    expect(references).toEqual([reference]);
    expect(dropped).toBe(7);
  });

  it("never stores fields outside the reference shape", () => {
    const { references } = boundedRetryReferences([
      { ...reference, nested: { deep: { payload: "x".repeat(10_000) } } },
    ]);

    expect(references).toEqual([reference]);
    expect(references[0]).not.toHaveProperty("nested");
  });

  it("keeps at most 50 references and a bounded total size", () => {
    const many = boundedRetryReferences(
      Array.from({ length: 80 }, () => reference),
    );
    expect(many.references).toHaveLength(50);
    expect(many.dropped).toBe(30);

    const fat = { ...reference, metadata: { note: "n".repeat(1_900) } };
    const budget = boundedRetryReferences(
      Array.from({ length: 30 }, () => fat),
    );
    expect(JSON.stringify(budget.references).length).toBeLessThanOrEqual(
      16_000,
    );
    expect(budget.references.length + budget.dropped).toBe(30);
  });
});
