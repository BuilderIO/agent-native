import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertAccess: vi.fn(),
  readAppState: vi.fn(),
  createContextPack: vi.fn(),
  deriveContextPack: vi.fn(),
  getCreativeContextItem: vi.fn(),
  getCreativeContextItemByExternalId: vi.fn(),
  getGenerationCreativeContext: vi.fn(),
  nativeCreativeArtifactFromMetadata: vi.fn(),
  notifyClients: vi.fn(),
  reassembleNativeCreativeArtifact: vi.fn(),
  validateCompiledNativeHtml: vi.fn(),
  recordGenerationCreativeContext: vi.fn(),
  createDeckVersionSnapshot: vi.fn(),
  updatedDeck: null as Record<string, unknown> | null,
}));

vi.mock("@agent-native/core", () => ({
  defineAction: (value: unknown) => value,
  embedApp: (value: unknown) => value,
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

vi.mock("@agent-native/core/server", () => ({
  buildDeepLink: ({ params }: { params: { deckId: string } }) =>
    `/slides/${params.deckId}`,
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestOrgId: () => "org-1",
}));

vi.mock("@agent-native/core/sharing", () => ({
  assertAccess: mocks.assertAccess,
}));

vi.mock("@agent-native/creative-context", () => ({
  nativeCreativeArtifactFromMetadata: mocks.nativeCreativeArtifactFromMetadata,
  reassembleNativeCreativeArtifact: mocks.reassembleNativeCreativeArtifact,
  validateCompiledNativeHtml: mocks.validateCompiledNativeHtml,
}));

vi.mock("@agent-native/creative-context/server", () => ({
  getGenerationCreativeContext: mocks.getGenerationCreativeContext,
  mergeCreativeContextReuseLabels: (existing: unknown[], added: unknown[]) => [
    ...existing,
    ...added,
  ],
  recordGenerationCreativeContext: mocks.recordGenerationCreativeContext,
  replaceCreativeContextElementProvenance: (
    existing: unknown[],
    added: unknown[],
  ) => [...existing, ...added],
}));

vi.mock("@agent-native/creative-context/store", () => ({
  createContextPack: mocks.createContextPack,
  deriveContextPack: mocks.deriveContextPack,
  getCreativeContextItem: mocks.getCreativeContextItem,
  getCreativeContextItemByExternalId: mocks.getCreativeContextItemByExternalId,
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

vi.mock("../server/db/index.js", () => {
  const row = {
    id: "deck-1",
    title: "Target deck",
    ownerEmail: "owner@example.test",
    data: "",
  };
  const db = {
    select: () => ({
      from: () => ({
        where: async () => [
          { ...row, data: JSON.stringify(mocks.updatedDeck) },
        ],
      }),
    }),
    transaction: async (run: (tx: unknown) => Promise<void>) =>
      run({
        update: () => ({
          set: (values: { data: string }) => ({
            where: async () => {
              mocks.updatedDeck = JSON.parse(values.data);
            },
          }),
        }),
      }),
  };
  return { getDb: () => db, schema: { decks: {} } };
});

vi.mock("../server/handlers/decks.js", () => ({
  notifyClients: mocks.notifyClients,
}));

vi.mock("../server/lib/deck-versions.js", () => ({
  createDeckVersionSnapshot: mocks.createDeckVersionSnapshot,
}));

vi.mock("./_app-url.js", () => ({ getDeckUrl: (id: string) => `/deck/${id}` }));
vi.mock("./patch-deck.js", () => ({
  withDeckLock: (_id: string, run: () => Promise<unknown>) => run(),
}));

import action from "./clone-context-slide.js";

const html =
  '<div class="fmd-slide google-slides-native" data-source-slide-id="slide-source" style="position:relative;width:960px;height:540px"><p style="margin:0">Exact native code</p></div>';

describe("clone-context-slide pack integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatedDeck = { slides: [] };
    mocks.readAppState.mockResolvedValue({ contextMode: "auto" });
    mocks.assertAccess.mockResolvedValue({ role: "editor" });
    mocks.getGenerationCreativeContext.mockResolvedValue(null);
    mocks.getCreativeContextItem.mockResolvedValue({
      item: {
        id: "item-root",
        sourceId: "source-1",
        externalId: "deck-source:slide-source",
        title: "Source slide",
        mimeType: "text/html",
        provenance: {
          compiler: "@agent-native/creative-context:google-slides-native",
        },
      },
      version: {
        id: "version-root",
        mimeType: "text/html",
        content: html,
        metadata: { nativeArtifact: {} },
      },
      chunks: [],
      media: [],
      edges: [],
    });
    mocks.nativeCreativeArtifactFromMetadata.mockReturnValue({
      schemaVersion: 1,
      app: "slides",
      format: "slides-html",
      rootExternalId: "deck-source:slide-source",
      fidelityReport: {
        exact: { count: 1 },
        approximated: { count: 0, reasons: [] },
        imageFallback: { count: 0, reasons: [] },
      },
    });
    mocks.reassembleNativeCreativeArtifact.mockResolvedValue({
      html,
      artifact: {},
      evidence: [
        { itemId: "item-root", itemVersionId: "version-root" },
        { itemId: "item-child", itemVersionId: "version-child" },
      ],
    });
    mocks.createContextPack.mockResolvedValue({ id: "pack-created" });
    mocks.deriveContextPack.mockResolvedValue({ id: "pack-derived" });
  });

  it("creates an immutable evidence pack when the deck has none", async () => {
    const result = await action.run({
      deckId: "deck-1",
      itemId: "item-root",
      itemVersionId: "version-root",
      slideId: "slide-clone",
    });

    expect(mocks.createContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        members: [
          expect.objectContaining({ itemVersionId: "version-root" }),
          expect.objectContaining({ itemVersionId: "version-child" }),
        ],
      }),
    );
    expect(mocks.deriveContextPack).not.toHaveBeenCalled();
    expect(mocks.updatedDeck).toMatchObject({
      creativeContext: { contextMode: "pinned", contextPackId: "pack-created" },
      slides: [{ id: "slide-clone", content: html }],
    });
    expect(mocks.recordGenerationCreativeContext).toHaveBeenCalledWith(
      expect.objectContaining({
        contextPackId: "pack-created",
        reuseLabels: expect.arrayContaining([
          expect.objectContaining({ itemVersionId: "version-root" }),
          expect.objectContaining({ itemVersionId: "version-child" }),
        ]),
      }),
      expect.anything(),
    );
    expect(result).toMatchObject({
      clonedWithoutRegeneration: true,
      contextPackId: "pack-created",
      evidenceCount: 2,
    });
  });

  it("derives an immutable union pack from the deck's existing pack", async () => {
    mocks.updatedDeck = {
      slides: [],
      creativeContext: {
        contextMode: "pinned",
        contextPackId: "pack-existing",
        reuseLabels: [],
      },
    };

    const result = await action.run({
      deckId: "deck-1",
      itemId: "item-root",
      itemVersionId: "version-root",
    });

    expect(mocks.deriveContextPack).toHaveBeenCalledWith(
      expect.objectContaining({
        packId: "pack-existing",
        addMembers: expect.arrayContaining([
          expect.objectContaining({ itemVersionId: "version-root" }),
          expect.objectContaining({ itemVersionId: "version-child" }),
        ]),
      }),
    );
    expect(mocks.createContextPack).not.toHaveBeenCalled();
    expect(result).toMatchObject({ contextPackId: "pack-derived" });
    expect(mocks.updatedDeck).toMatchObject({
      creativeContext: { contextPackId: "pack-derived" },
    });
  });

  it("enforces the global context opt-out before reading library code", async () => {
    mocks.readAppState.mockResolvedValue({ contextMode: "off" });

    await expect(
      action.run({
        deckId: "deck-1",
        itemId: "item-root",
        itemVersionId: "version-root",
      }),
    ).rejects.toThrow("Creative Context is off");
    expect(mocks.getCreativeContextItem).not.toHaveBeenCalled();
    expect(mocks.createContextPack).not.toHaveBeenCalled();
  });
});
