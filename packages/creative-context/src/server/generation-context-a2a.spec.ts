import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
  getContextPack: vi.fn(),
  getCreativeContextItem: vi.fn(),
  listAccessibleSearchDocuments: vi.fn(),
  listCreativeContexts: vi.fn(),
  getCreativeContextById: vi.fn(),
  getCreativeContextAppBinding: vi.fn(),
  createContextPack: vi.fn(),
  performCreativeContextSearch: vi.fn(),
  recordLocal: vi.fn(),
  getLocal: vi.fn(),
  hasA2A: vi.fn(),
  callA2A: vi.fn(),
  getRequestOrgId: vi.fn(),
  createArtifactCapability: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: mocks.getRequestOrgId,
}));

vi.mock("../store/index.js", () => ({
  getContextPack: mocks.getContextPack,
  getCreativeContextItem: mocks.getCreativeContextItem,
  listAccessibleSearchDocuments: mocks.listAccessibleSearchDocuments,
  listCreativeContexts: mocks.listCreativeContexts,
  getCreativeContextById: mocks.getCreativeContextById,
  getCreativeContextAppBinding: mocks.getCreativeContextAppBinding,
  createContextPack: mocks.createContextPack,
}));

vi.mock("../store/generation.js", () => ({
  recordGenerationCreativeContext: mocks.recordLocal,
  getGenerationCreativeContext: mocks.getLocal,
}));

vi.mock("./retrieval.js", () => ({
  performCreativeContextSearch: mocks.performCreativeContextSearch,
}));

vi.mock("./isolated-a2a.js", () => ({
  callIsolatedCreativeContextA2A: mocks.callA2A,
  hasIsolatedCreativeContextA2A: mocks.hasA2A,
  isolatedResolvePayload: vi.fn((input) => ({
    query: input.query,
    role: input.role,
    limit: input.limit,
    contextPackId: input.contextPackId,
    contextPackSource: input.contextPackSource,
    ...(input.selectedContextId
      ? { selectedContextId: input.selectedContextId }
      : {}),
  })),
}));

vi.mock("./generation-artifact-access.js", () => ({
  assertGenerationArtifactAccess: vi.fn(),
  createGenerationArtifactAccessCapability: mocks.createArtifactCapability,
}));

import {
  getGenerationCreativeContext,
  recordGenerationCreativeContext,
  resolveGenerationCreativeContext,
  validateGenerationCreativeContext,
} from "./generation-context.js";

const emptyRemoteContext = {
  contextMode: "auto" as const,
  contextPackId: null,
  reuseLabels: [],
  results: [],
};

describe("generation context isolated A2A routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readAppState.mockResolvedValue({ contextMode: "auto" });
    mocks.hasA2A.mockReturnValue(true);
    mocks.getRequestOrgId.mockReturnValue("org-1");
    mocks.createArtifactCapability.mockImplementation(
      async (_identity, _target, operation) => `cap-${operation}`,
    );
    mocks.callA2A.mockResolvedValue(emptyRemoteContext);
    mocks.listCreativeContexts.mockResolvedValue({ contexts: [] });
    mocks.getCreativeContextById.mockResolvedValue(null);
    mocks.getCreativeContextAppBinding.mockResolvedValue(null);
  });

  it("routes bounded resolve, validate, read, and record operations remotely", async () => {
    await resolveGenerationCreativeContext({
      role: "slides",
      query: "launch deck",
    });
    await validateGenerationCreativeContext({ reuseLabels: [] });
    await getGenerationCreativeContext({
      appId: "slides",
      artifactType: "deck",
      artifactId: "deck-1",
    });
    await recordGenerationCreativeContext({
      appId: "slides",
      artifactType: "deck",
      artifactId: "deck-1",
      contextMode: "auto",
      contextPackId: null,
      reuseLabels: [],
    });

    expect(mocks.callA2A).toHaveBeenNthCalledWith(1, "resolve", {
      role: "slides",
      query: "launch deck",
      limit: undefined,
      contextPackId: undefined,
      contextPackSource: undefined,
    });
    expect(mocks.callA2A).toHaveBeenNthCalledWith(2, "validate", {
      contextPackId: undefined,
      contextPackSource: undefined,
      reuseLabels: [],
      reuseLabelsSource: undefined,
    });
    expect(mocks.callA2A).toHaveBeenNthCalledWith(3, "read", {
      identity: {
        appId: "slides",
        artifactType: "deck",
        artifactId: "deck-1",
      },
      artifactAccessCapability: "cap-read",
    });
    expect(mocks.callA2A).toHaveBeenNthCalledWith(
      4,
      "record",
      expect.objectContaining({
        artifactId: "deck-1",
        artifactAccessCapability: "cap-record",
      }),
    );
    expect(mocks.recordLocal).not.toHaveBeenCalled();
    expect(mocks.getLocal).not.toHaveBeenCalled();
  });

  it("keeps the in-process path as the zero-configuration default", async () => {
    mocks.hasA2A.mockReturnValue(false);
    mocks.performCreativeContextSearch.mockResolvedValue({
      contextPackId: null,
      results: [],
    });

    await expect(
      resolveGenerationCreativeContext({ role: "content", query: "brief" }),
    ).resolves.toEqual(emptyRemoteContext);
    expect(mocks.performCreativeContextSearch).toHaveBeenCalled();
    expect(mocks.callA2A).not.toHaveBeenCalled();
  });

  it("fuses Default with the selected specialty and snapshots the provenance", async () => {
    mocks.hasA2A.mockReturnValue(false);
    mocks.readAppState.mockResolvedValue({
      contextMode: "auto",
      selectedContextId: "specialty-1",
    });
    mocks.listCreativeContexts.mockResolvedValue({
      contexts: [{ id: "default-1", kind: "default" }],
    });
    mocks.getCreativeContextById.mockResolvedValue({
      id: "specialty-1",
      kind: "specialty",
    });
    mocks.performCreativeContextSearch
      .mockResolvedValueOnce({
        results: [
          {
            itemId: "base-item",
            itemVersionId: "base-v1",
            kind: "slide",
            title: "Default evidence",
            score: 0.5,
            reasons: ["default"],
          },
        ],
      })
      .mockResolvedValueOnce({
        results: [
          {
            itemId: "specialty-item",
            itemVersionId: "specialty-v1",
            kind: "slide",
            title: "Specialty evidence",
            score: 0.5,
            reasons: ["specialty"],
          },
        ],
      });
    mocks.createContextPack.mockResolvedValue({ id: "snapshot-1" });

    await expect(
      resolveGenerationCreativeContext({ role: "slides", query: "launch" }),
    ).resolves.toMatchObject({ contextPackId: "snapshot-1" });
    expect(mocks.performCreativeContextSearch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ contextId: "default-1", snapshot: false }),
    );
    expect(mocks.performCreativeContextSearch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ contextId: "specialty-1", snapshot: false }),
    );
    expect(mocks.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        baseContextId: "default-1",
        specialtyContextId: "specialty-1",
        selectionReason: "explicit specialty selection",
      }),
    );
  });

  it("forwards a selected specialty to isolated resolution", async () => {
    mocks.readAppState.mockResolvedValue({
      contextMode: "auto",
      selectedContextId: "specialty-1",
    });
    await resolveGenerationCreativeContext({ role: "design", query: "hero" });
    expect(mocks.callA2A).toHaveBeenCalledWith(
      "resolve",
      expect.objectContaining({ selectedContextId: "specialty-1" }),
    );
  });
});
