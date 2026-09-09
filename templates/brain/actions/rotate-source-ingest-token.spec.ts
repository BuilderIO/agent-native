import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  eq: vi.fn(() => "where"),
  nanoid: vi.fn(() => "new-token-material"),
  nowIso: vi.fn(() => "2026-07-22T00:00:00.000Z"),
  parseJson: vi.fn(() => ({})),
  serializeSource: vi.fn((source) => ({ id: source.id })),
  sha256Hex: vi.fn(async (value: string) => `hash:${value}`),
  stableJson: vi.fn((value) => JSON.stringify(value)),
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("drizzle-orm", () => ({ eq: mocks.eq }));

const set = vi.fn();
const where = vi.fn();
const update = vi.fn(() => ({ set }));
const limit = vi.fn();
const selectWhere = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ where: selectWhere }));
const select = vi.fn(() => ({ from }));

vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update, select }),
  schema: { brainSources: { id: "brainSources.id" } },
}));

vi.mock("../server/lib/brain.js", () => mocks);

import rotateSourceIngestTokenAction from "./rotate-source-ingest-token.js";

const action = rotateSourceIngestTokenAction as unknown as {
  agentTool: boolean;
  toolCallable: boolean;
  run: (args: { sourceId: string }) => Promise<unknown>;
};

describe("rotate-source-ingest-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rotates a Clips source token and returns it once", async () => {
    const source = {
      id: "source-clips",
      provider: "clips",
      sourceKey: "clips",
      configJson: "{}",
    };
    mocks.assertAccess.mockResolvedValue({ resource: source });
    set.mockReturnValue({ where });
    limit.mockResolvedValue([{ ...source, ingestTokenHash: "stored-hash" }]);

    await expect(action.run({ sourceId: source.id })).resolves.toEqual({
      source: { id: source.id },
      ingestToken: "brain_new-token-material",
    });

    expect(mocks.assertAccess).toHaveBeenCalledWith(
      "brain-source",
      source.id,
      "admin",
    );
    expect(set).toHaveBeenCalledWith({
      sourceKey: "clips",
      ingestTokenHash: "hash:brain_new-token-material",
      configJson:
        '{"sourceKey":"clips","ingestTokenHash":"hash:brain_new-token-material"}',
      updatedAt: "2026-07-22T00:00:00.000Z",
    });
    expect(action.agentTool).toBe(false);
    expect(action.toolCallable).toBe(false);
  });

  it("supports legacy sources whose key only exists in config", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        id: "source-generic",
        provider: "generic",
        sourceKey: null,
        configJson: '{"sourceKey":"legacy-clips"}',
      },
    });
    mocks.parseJson.mockReturnValueOnce({ sourceKey: "legacy-clips" });
    mocks.parseJson.mockReturnValueOnce({ sourceKey: "legacy-clips" });
    set.mockReturnValue({ where });
    limit.mockResolvedValue([{ id: "source-generic" }]);

    await action.run({ sourceId: "source-generic" });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "legacy-clips" }),
    );
  });

  it("rejects sources that cannot receive signed ingest", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: { id: "source-slack", provider: "slack", sourceKey: "slack" },
    });

    await expect(action.run({ sourceId: "source-slack" })).rejects.toThrow(
      "Only configured Clips or generic sources",
    );
  });

  it("rejects a source without a configured source key", async () => {
    mocks.assertAccess.mockResolvedValue({
      resource: {
        id: "source-clips",
        provider: "clips",
        sourceKey: null,
        configJson: "{}",
      },
    });

    await expect(action.run({ sourceId: "source-clips" })).rejects.toThrow(
      "missing a signed-ingest source key",
    );
  });
});
