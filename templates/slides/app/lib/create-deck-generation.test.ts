import { describe, expect, it, vi } from "vitest";

const mockCallAction = vi.hoisted(() => vi.fn());

vi.mock("@agent-native/core/client/hooks", () => ({
  callAction: (...args: unknown[]) => mockCallAction(...args),
  deleteClientAppState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("react-dom", () => ({
  flushSync: (callback: () => void) => callback(),
}));

import {
  getUploadedImageAgentOptions,
  isSourceImprovementRequest,
  requestedSlideCount,
  startDeckGeneration,
} from "./create-deck-generation";

describe("getUploadedImageAgentOptions", () => {
  it("does not forward oversized inline image data", () => {
    const oversizedDataUrl = `data:image/png;base64,${"a".repeat(1_000_000)}`;
    expect(
      getUploadedImageAgentOptions([
        {
          path: "/uploads/large.png",
          url: "https://cdn.example.test/large.png",
          originalName: "large.png",
          filename: "large.png",
          type: "image/png",
          size: 750_000,
          dataUrl: oversizedDataUrl,
        },
      ]),
    ).toEqual({
      referenceImagePaths: ["https://cdn.example.test/large.png"],
    });
  });
});

describe("startDeckGeneration", () => {
  it("extracts an explicit target slide count for continuation", () => {
    expect(requestedSlideCount("Create a dark 6-slide presentation")).toBe(6);
    expect(requestedSlideCount("Create a deck about launches")).toBeUndefined();
  });

  it("treats an implicit improvement prompt as source-preserving", () => {
    expect(
      isSourceImprovementRequest("Make this prettier", [
        {
          path: "/uploads/source.pptx",
          originalName: "source.pptx",
          filename: "source.pptx",
          type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });

  it("treats slide-for-slide restyling requests as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("treats create-from-source requests that preserve order as source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create a slide deck from this PDF, preserving the same order",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);
  });

  it("defaults a plain source conversion to source-preserving", () => {
    expect(
      isSourceImprovementRequest(
        "Create deck: turn this into a deck using our branding",
        [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
      ),
    ).toBe(true);

    expect(
      isSourceImprovementRequest("Make this into a deck", [
        {
          path: "/uploads/source.pdf",
          originalName: "source.pdf",
          filename: "source.pdf",
          type: "application/pdf",
          size: 1024,
        },
      ]),
    ).toBe(true);
  });

  it("keeps an ordinary attached PDF as agent reference material", async () => {
    const deck = {
      id: "deck-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a new deck using this PDF as reference material",
        files: [
          {
            path: "/uploads/reference.pdf",
            originalName: "reference.pdf",
            filename: "ZiVAULRxvgAN1alyiLem.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(deck.slides).toEqual([]);
    expect(mockCallAction).not.toHaveBeenCalledWith(
      "import-file",
      expect.anything(),
      expect.anything(),
    );
    expect(agentSubmit).toHaveBeenCalledOnce();
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Attachments are context for the agent by default",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "do not import or append their slides",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "write presenter-only text into each slide's `notes` field",
    );
    expect(mockCallAction).toHaveBeenCalledWith(
      "patch-deck",
      expect.objectContaining({
        operations: [
          expect.objectContaining({
            fields: expect.objectContaining({
              generationContext: expect.objectContaining({
                originalPrompt:
                  "Create a new deck using this PDF as reference material",
                files: [
                  expect.objectContaining({ path: "/uploads/reference.pdf" }),
                ],
              }),
            }),
          }),
        ],
      }),
    );
  });

  it("passes hosted URLs and inline image bytes through to agentSubmit", async () => {
    const deck = {
      id: "deck-image-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    const inlineImage = "data:image/png;base64,aW1hZ2U=";

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Make this into a deck",
        files: [
          {
            path: "/uploads/hosted.png",
            url: "https://cdn.example.test/hosted.png",
            originalName: "hosted.png",
            filename: "hosted.png",
            type: "image/png",
            size: 1024,
            dataUrl: inlineImage,
          },
          {
            path: "/uploads/inline.jpg",
            originalName: "inline.jpg",
            filename: "inline.jpg",
            type: "image/jpeg",
            size: 1024,
            dataUrl: "data:image/jpeg;base64,amBlZw==",
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(agentSubmit.mock.calls[0]?.[2]).toMatchObject({
      referenceImagePaths: ["https://cdn.example.test/hosted.png"],
      images: [inlineImage, "data:image/jpeg;base64,amBlZw=="],
    });
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "inspect the complete visual source",
    );
  });

  it("cleans up when generation context persistence fails", async () => {
    mockCallAction.mockRejectedValueOnce(new Error("context failed"));
    const deck = {
      id: "deck-context-failure",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const deleteDeck = vi.fn();
    const onSetupFailure = vi.fn();

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt: "Create a deck",
        files: [],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck,
        navigate: vi.fn(),
        agentSubmit: vi.fn(),
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
        onSetupFailure,
      }),
    ).resolves.toBe("failed");

    expect(deleteDeck).toHaveBeenCalledWith(deck.id);
    expect(onSetupFailure).toHaveBeenCalledWith(
      "Create a deck",
      [],
      expect.objectContaining({ message: "context failed" }),
    );
  });

  it("imports an attached source PDF for a slide-for-slide restyling request", async () => {
    const deck = {
      id: "deck-1",
      title: "Untitled Deck",
      createdAt: "2026-08-11T00:00:00.000Z",
      updatedAt: "2026-08-11T00:00:00.000Z",
      slides: [],
    };
    const agentSubmit = vi.fn();
    mockCallAction.mockResolvedValue({
      imported: true,
      deckId: "deck-1",
      slideCount: 4,
    });

    await expect(
      startDeckGeneration({
        session: { user: "owner@example.com" },
        prompt:
          'Please turn this into a deck with our styling. Copy it slide for slide (though note I realized a couple slides are out of order) - a couple of the "after" slides are not right after their "before" slides.',
        files: [
          {
            path: "/uploads/source.pdf",
            originalName: "source.pdf",
            filename: "source.pdf",
            type: "application/pdf",
            size: 1024,
          },
        ],
        designSystems: [],
        createDeck: vi.fn(() => deck),
        ensureDeckPersisted: vi.fn().mockResolvedValue({ persisted: true }),
        deleteDeck: vi.fn(),
        navigate: vi.fn(),
        agentSubmit,
        onPromptClosed: vi.fn(),
        onUnauthenticated: vi.fn(),
        onPersistenceFailure: vi.fn(),
      }),
    ).resolves.toBe("started");

    expect(mockCallAction).toHaveBeenCalledWith(
      "import-file",
      {
        filePath: "/uploads/source.pdf",
        format: "pdf",
        deckId: "deck-1",
        importIntoDeck: true,
      },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain(
      "Source-preserving improvement mode",
    );
    expect(agentSubmit.mock.calls[0]?.[1]).toContain("Do not call add-slide");
  });
});
