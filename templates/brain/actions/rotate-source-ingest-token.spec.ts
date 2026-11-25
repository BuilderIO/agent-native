import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  eq: vi.fn(() => "where"),
  nanoid: vi.fn(() => "new-token-material"),
  nowIso: vi.fn(() => "2026-07-22T00:00:00.000Z"),
  parseJson: vi.fn((value: string | null | undefined, fallback: unknown) => {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }),
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

vi.mock("drizzle-orm", () => ({
  eq: mocks.eq,
  and: vi.fn(() => "where"),
  isNull: vi.fn(() => "null"),
}));

const set = vi.fn();
const returning = vi.fn();
const where = vi.fn(() => ({ returning }));
const update = vi.fn(() => ({ set }));
vi.mock("../server/db/index.js", () => ({
  getDb: () => ({ update }),
  schema: {
    brainSources: {
      id: "brainSources.id",
      configJson: "configJson",
      sourceKey: "sourceKey",
      ingestTokenHash: "ingestTokenHash",
    },
  },
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
      ingestTokenHash: "old-hash",
      configJson: '{"sourceKey":"clips","ingestTokenHash":"old-hash"}',
    };
    mocks.assertAccess.mockResolvedValue({ resource: source });
    set.mockReturnValue({ where });
    returning.mockResolvedValue([
      { ...source, ingestTokenHash: "stored-hash" },
    ]);

    await expect(action.run({ sourceId: source.id })).resolves.toEqual({
      source: { id: source.id },
      sourceKey: "clips",
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
        ingestTokenHash: null,
        configJson: '{"sourceKey":"legacy-clips"}',
      },
    });
    set.mockReturnValue({ where });
    returning.mockResolvedValue([{ id: "source-generic" }]);

    await expect(
      action.run({ sourceId: "source-generic" }),
    ).resolves.toMatchObject({
      sourceKey: "legacy-clips",
      ingestToken: "brain_new-token-material",
    });

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "legacy-clips" }),
    );
  });

  it("does not rotate or reveal a key without admin access", async () => {
    mocks.assertAccess.mockRejectedValueOnce(new Error("Forbidden"));

    await expect(action.run({ sourceId: "source-clips" })).rejects.toThrow(
      "Forbidden",
    );
    expect(update).not.toHaveBeenCalled();
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
        ingestTokenHash: null,
        configJson: "{}",
      },
    });

    await expect(action.run({ sourceId: "source-clips" })).rejects.toThrow(
      "missing a signed-ingest source key",
    );
  });
});
