import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getContextSource: vi.fn(),
  inventory: vi.fn(),
}));

vi.mock("../store/index.js", () => ({
  getContextSource: mocks.getContextSource,
}));

vi.mock("../server/context.js", () => ({
  getCreativeContext: vi.fn(() => ({
    connectors: { get: () => ({ inventory: mocks.inventory }) },
    connectorContext: {},
  })),
}));

import action from "./preview-context-import.js";

describe("preview-context-import public boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getContextSource.mockResolvedValue({
      id: "source-1",
      kind: "upload",
      config: {},
      connectionId: null,
      ownerEmail: "alice@example.test",
    });
    mocks.inventory.mockResolvedValue({
      items: [
        {
          externalId: "upload-1",
          kind: "uploaded-document",
          title: "Launch deck",
          metadata: {
            entryIndex: 0,
            storageKey: "creative-context-blob:v1:private-value",
            warning:
              "Fetched https://provider.example/private?token=secret-value",
          },
        },
      ],
      nextCursor: null,
      complete: true,
      coverage: { inspected: 1, returned: 1, truncated: false },
    });
  });

  it("does not expose upload handles or substring capability URLs", async () => {
    const result = (await action.run({
      sourceId: "source-1",
      limit: 50,
    })) as any;

    expect(result.items[0].metadata).toEqual({
      entryIndex: 0,
      warning: "Fetched [redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("creative-context-blob");
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
});
