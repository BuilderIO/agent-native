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
  isSourceImprovementRequest,
  startDeckGeneration,
} from "./create-deck-generation";

describe("startDeckGeneration", () => {
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
