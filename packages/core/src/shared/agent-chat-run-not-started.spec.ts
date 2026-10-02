import { describe, expect, it } from "vitest";

import { retryContextFromRequest } from "./agent-chat-run-not-started.js";

describe("retryContextFromRequest", () => {
  it("keeps only what a retry resends", () => {
    expect(
      retryContextFromRequest({
        metadata: {
          references: [
            { id: "reference-1", type: "document" },
            "dropped",
            null,
          ],
          custom: { agentNativeRecoveryAction: "retry" },
          chatScope: { type: "deck", id: "deck-1" },
        },
        model: " model-original ",
        engine: "engine-original",
        effort: "high",
        mode: "plan",
      }),
    ).toEqual({
      references: [{ id: "reference-1", type: "document" }],
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

  it("bounds how many references and how long a setting it stores", () => {
    const context = retryContextFromRequest({
      metadata: {
        references: Array.from({ length: 80 }, (_, id) => ({ id })),
      },
      model: "m".repeat(500),
    });

    expect(context.references).toHaveLength(50);
    expect(context.model).toBeUndefined();
  });
});
